import type { Page } from "@playwright/test";

export const SYNTHETIC_APPLICATION_ORIGIN = "https://pay.ci.clean-pay.dev";
export const SYNTHETIC_FIXTURE_STORAGE_PREFIX = "clean-pay:browser-journey:";
export const SYNTHETIC_TURNSTILE_STORAGE_KEY =
  "clean-pay:browser-journey:turnstile-boundary";

type StorageArea = "localStorage" | "sessionStorage";

type FixtureStorageEntry = {
  area: StorageArea;
  key: string;
  value: string;
};

type StorageSnapshot = {
  fixtureEntries: FixtureStorageEntry[];
  localStorageKeyCount: number;
  origin: string;
  sessionStorageKeyCount: number;
};

/**
 * Simulates a browser logout without erasing the fixture's Turnstile ledger.
 * The preserved value is validated and restored byte-for-byte so a later
 * challenge cannot accidentally reuse a token sequence from before logout.
 */
export async function clearSyntheticLogoutState(page: Page) {
  if (new URL(page.url()).origin !== SYNTHETIC_APPLICATION_ORIGIN) {
    throw new Error("Synthetic logout requires the exact application origin.");
  }

  const before = await readStorageSnapshot(page);
  const preservedValue = assertSyntheticLogoutStorageSnapshot(before, "before-clear");

  const after = await page.evaluate((contract) => {
    if (location.origin !== contract.origin) {
      throw new Error("Synthetic logout origin changed before storage clear.");
    }

    const fixtureEntries: Array<{ area: StorageArea; key: string; value: string }> = [];
    for (const [area, storage] of [
      ["localStorage", localStorage],
      ["sessionStorage", sessionStorage],
    ] as const) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(contract.fixturePrefix)) {
          fixtureEntries.push({ area, key, value: storage.getItem(key) ?? "" });
        }
      }
    }
    fixtureEntries.sort((left, right) => (
      `${left.area}:${left.key}`.localeCompare(`${right.area}:${right.key}`)
    ));
    if (
      fixtureEntries.length !== 1
      || fixtureEntries[0]?.area !== "sessionStorage"
      || fixtureEntries[0]?.key !== contract.preservedKey
      || fixtureEntries[0]?.value !== contract.preservedValue
    ) {
      throw new Error("Synthetic logout storage changed after fixture validation.");
    }

    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(contract.preservedKey, contract.preservedValue);

    return {
      fixtureEntries: [{
        area: "sessionStorage" as const,
        key: contract.preservedKey,
        value: sessionStorage.getItem(contract.preservedKey) ?? "",
      }],
      localStorageKeyCount: localStorage.length,
      origin: location.origin,
      sessionStorageKeyCount: sessionStorage.length,
    };
  }, {
    fixturePrefix: SYNTHETIC_FIXTURE_STORAGE_PREFIX,
    origin: SYNTHETIC_APPLICATION_ORIGIN,
    preservedKey: SYNTHETIC_TURNSTILE_STORAGE_KEY,
    preservedValue,
  });

  const restoredValue = assertSyntheticLogoutStorageSnapshot(after, "after-clear");
  if (restoredValue !== preservedValue) {
    throw new Error("Synthetic logout did not restore the Turnstile state byte-for-byte.");
  }

  await page.context().clearCookies();
  if ((await page.context().cookies()).length !== 0) {
    throw new Error("Synthetic logout did not clear every browser cookie.");
  }
}

export function assertSyntheticLogoutStorageSnapshot(
  value: unknown,
  phase: "before-clear" | "after-clear",
) {
  if (!isRecord(value) || !exactKeys(value, [
    "fixtureEntries",
    "localStorageKeyCount",
    "origin",
    "sessionStorageKeyCount",
  ])) {
    throw new Error("Synthetic logout storage snapshot has an invalid schema.");
  }
  if (
    value.origin !== SYNTHETIC_APPLICATION_ORIGIN
    || !boundedCount(value.localStorageKeyCount)
    || !boundedCount(value.sessionStorageKeyCount)
    || !Array.isArray(value.fixtureEntries)
    || value.fixtureEntries.length !== 1
  ) {
    throw new Error("Synthetic logout storage snapshot violates its exact contract.");
  }

  const [entry] = value.fixtureEntries;
  if (
    !isRecord(entry)
    || !exactKeys(entry, ["area", "key", "value"])
    || entry.area !== "sessionStorage"
    || entry.key !== SYNTHETIC_TURNSTILE_STORAGE_KEY
    || typeof entry.value !== "string"
  ) {
    throw new Error("Synthetic logout refuses extra or unsafe fixture storage keys.");
  }
  if (phase === "after-clear" && (
    value.localStorageKeyCount !== 0 || value.sessionStorageKeyCount !== 1
  )) {
    throw new Error("Synthetic logout left application storage behind.");
  }

  assertTurnstileStorageValue(entry.value);
  return entry.value;
}

async function readStorageSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate((contract) => {
    const fixtureEntries: FixtureStorageEntry[] = [];
    for (const [area, storage] of [
      ["localStorage", localStorage],
      ["sessionStorage", sessionStorage],
    ] as const) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(contract.fixturePrefix)) {
          fixtureEntries.push({ area, key, value: storage.getItem(key) ?? "" });
        }
      }
    }
    fixtureEntries.sort((left, right) => (
      `${left.area}:${left.key}`.localeCompare(`${right.area}:${right.key}`)
    ));
    return {
      fixtureEntries,
      localStorageKeyCount: localStorage.length,
      origin: location.origin,
      sessionStorageKeyCount: sessionStorage.length,
    };
  }, {
    fixturePrefix: SYNTHETIC_FIXTURE_STORAGE_PREFIX,
  });
}

function assertTurnstileStorageValue(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Synthetic logout Turnstile state is not valid JSON.");
  }
  if (
    !isRecord(parsed)
    || !exactKeys(parsed, ["calls", "issueSequence", "sequence"])
    || !boundedPositiveInteger(parsed.sequence, 1_024)
    || !boundedPositiveInteger(parsed.issueSequence, 4_096)
    || !Array.isArray(parsed.calls)
    || parsed.calls.length === 0
    || parsed.calls.length > 8_192
  ) {
    throw new Error("Synthetic logout Turnstile state has an invalid schema.");
  }

  const rendered = new Map<string, string>();
  const renderSequence: number[] = [];
  const issueSequence: number[] = [];
  for (const call of parsed.calls) {
    if (!isRecord(call) || typeof call.method !== "string") {
      throw new Error("Synthetic logout Turnstile call has an invalid schema.");
    }
    if (call.method === "render") {
      assertExactTurnstileCall(call, ["action", "method", "widgetId"]);
      const widgetSequence = widgetIdSequence(call.widgetId);
      assertTurnstileAction(call.action);
      if (rendered.has(String(call.widgetId))) {
        throw new Error("Synthetic logout Turnstile widget was rendered twice.");
      }
      rendered.set(String(call.widgetId), String(call.action));
      renderSequence.push(widgetSequence);
      continue;
    }
    if (call.method === "challenge") {
      assertExactTurnstileCall(call, ["action", "issue", "method", "widgetId"]);
      const widgetId = String(call.widgetId);
      widgetIdSequence(widgetId);
      assertTurnstileAction(call.action);
      if (
        !boundedPositiveInteger(call.issue, 4_096)
        || rendered.get(widgetId) !== call.action
      ) {
        throw new Error("Synthetic logout Turnstile challenge is inconsistent.");
      }
      issueSequence.push(Number(call.issue));
      continue;
    }
    if (["execute", "remove", "reset"].includes(call.method)) {
      assertExactTurnstileCall(call, ["method", "widgetId"]);
      const widgetId = String(call.widgetId);
      widgetIdSequence(widgetId);
      if (!rendered.has(widgetId)) {
        throw new Error("Synthetic logout Turnstile call references an unknown widget.");
      }
      continue;
    }
    throw new Error("Synthetic logout Turnstile call method is not allowed.");
  }

  if (
    !isExactSequence(renderSequence, Number(parsed.sequence))
    || !isExactSequence(issueSequence, Number(parsed.issueSequence))
  ) {
    throw new Error("Synthetic logout Turnstile counters are not sequential.");
  }
}

function assertExactTurnstileCall(call: Record<string, unknown>, keys: string[]) {
  if (!exactKeys(call, keys)) {
    throw new Error("Synthetic logout Turnstile call contains extra fields.");
  }
}

function assertTurnstileAction(value: unknown) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,127}$/.test(value)) {
    throw new Error("Synthetic logout Turnstile action is unsafe.");
  }
}

function widgetIdSequence(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Synthetic logout Turnstile widget id is invalid.");
  }
  const match = /^synthetic-turnstile-([1-9][0-9]{0,3})$/.exec(value);
  const sequence = match ? Number(match[1]) : 0;
  if (!boundedPositiveInteger(sequence, 1_024)) {
    throw new Error("Synthetic logout Turnstile widget id is invalid.");
  }
  return sequence;
}

function isExactSequence(values: number[], upperBound: number) {
  return values.length === upperBound
    && values.every((value, index) => value === index + 1);
}

function boundedCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000;
}

function boundedPositiveInteger(value: unknown, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
