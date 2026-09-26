import { expect, test } from "@playwright/test";

import {
  assertChatwootProviderCausalLedger,
  CHATWOOT_INITIAL_PROVIDER_EFFECTS,
  CHATWOOT_PROVIDER_CAUSAL_CONTRACT_VERSION,
  CHATWOOT_RECREATED_PROVIDER_EFFECTS,
  projectChatwootProviderCausalEntries,
} from "./chatwoot-provider-causal-contract.mjs";
import { chatwootProviderExpectedEffects } from "./chatwoot-provider-ledger-order.mjs";
import { JOURNEY_FIXTURE_FILENAMES } from "./journey-fixture-manifest.mjs";

type ProviderPhase = "gap" | "stable" | "recreated";

const probePaths = [
  "/api/v1/public/auth/email/start",
  "/api/v1/public/auth/identify",
  "/api/v1/public/auth/service-session",
  "/api/v1/public/auth/notification-preferences",
];

test("binds one provider order source, the causal v3 contract and its diagnostics into the fixture", () => {
  const required = [
    "chatwoot-provider-ledger-order.mjs",
    "chatwoot-provider-causal-contract.mjs",
    "chatwoot-provider-causal-contract.contract.spec.ts",
    "chatwoot-provider-ledger-diagnostic.contract.spec.ts",
    "chatwoot-provider-ledger-diagnostic.mjs",
  ];
  for (const filename of required) {
    expect(JOURNEY_FIXTURE_FILENAMES.filter((entry) => entry === filename)).toEqual([filename]);
  }
  expect(CHATWOOT_PROVIDER_CAUSAL_CONTRACT_VERSION).toBe(3);
  expect(CHATWOOT_INITIAL_PROVIDER_EFFECTS).toEqual(chatwootProviderExpectedEffects("gap"));
  expect(CHATWOOT_RECREATED_PROVIDER_EFFECTS).toEqual(chatwootProviderExpectedEffects("recreated"));
});

test("accepts the exact 28-event gap and stable ledgers and the 42-event recreated ledger", () => {
  for (const phase of ["gap", "stable", "recreated"] as const) {
    const entries = fixture(phase);
    const before = JSON.stringify(entries);
    const expectedCount = phase === "recreated" ? 42 : 28;
    const contract = assertChatwootProviderCausalLedger(entries, phase);
    const projection = projectChatwootProviderCausalEntries(entries, phase);
    expect(entries).toHaveLength(expectedCount);
    expect(contract).toEqual({
      contractVersion: 3,
      semanticNodeIds: projection.nodes.map(({ nodeId }) => nodeId),
    });
    expect(new Set(contract.semanticNodeIds).size).toBe(expectedCount);
    expect(projection.nodes).toHaveLength(expectedCount);
    expect(projection.edges).toHaveLength(phase === "recreated" ? 49 : 30);
    expect(JSON.stringify(entries)).toBe(before);
  }
});

test("canonicalizes only the explicitly allowed independent arrival orders", () => {
  const initial = fixture("gap");
  const expected = projectChatwootProviderCausalEntries(initial, "gap");
  const allowed = [
    swapAndResequence(initial, 0, 1),
    swapAndResequence(initial, 1, 2),
    swapAndResequence(initial, 13, 14),
    swapAndResequence(initial, 19, 20),
  ];
  for (const entries of allowed) {
    expect(projectChatwootProviderCausalEntries(entries, "gap")).toEqual(expected);
    expect(projectChatwootProviderCausalEntries(entries, "stable")).toEqual(expected);
  }

  const earlyContact = moveAndResequence(initial, 27, 18);
  const earlyContactProjection = projectChatwootProviderCausalEntries(earlyContact, "gap");
  expect(earlyContactProjection.nodes).toHaveLength(28);
  expect(earlyContactProjection.nodes.map(({ value }) => value)).toEqual(
    earlyContact.map(({ sequence, ...value }) => {
      void sequence;
      return value;
    }),
  );

  let accepted = 0;
  let rejected = 0;
  for (const order of permutations([20, 21, 22, 23, 24])) {
    const entries = initial.map((entry, index) => index >= 20 && index <= 24
      ? { ...initial[order[index - 20]], sequence: index + 1 }
      : entry);
    if (order.indexOf(21) < order.indexOf(24)) {
      expect(projectChatwootProviderCausalEntries(entries, "gap")).toEqual(expected);
      accepted += 1;
    } else {
      expect(() => assertChatwootProviderCausalLedger(entries, "gap"))
        .toThrow(/versioned causal contract/);
      rejected += 1;
    }
  }
  expect({ accepted, rejected }).toEqual({ accepted: 60, rejected: 60 });

  const recreated = fixture("recreated");
  const recreatedExpected = projectChatwootProviderCausalEntries(recreated, "recreated");
  for (const entries of [
    swapAndResequence(recreated, 13, 14),
    swapAndResequence(recreated, 34, 35),
    swapAndResequence(recreated, 37, 38),
  ]) {
    expect(projectChatwootProviderCausalEntries(entries, "recreated")).toEqual(recreatedExpected);
  }
});

test("rejects causal swaps, incorrect cardinality, duplicates and sequence changes", () => {
  const forbiddenInitialSwaps = [
    [1, 4],
    [4, 5],
    [8, 9],
    [9, 10],
    [15, 16],
    [16, 17],
    [21, 24],
    [24, 25],
    [26, 27],
  ];
  for (const [left, right] of forbiddenInitialSwaps) {
    expect(() => assertChatwootProviderCausalLedger(
      swapAndResequence(fixture("gap"), left, right),
      "gap",
    )).toThrow(/versioned causal contract/);
  }
  for (const [left, right] of [[28, 29], [29, 30], [30, 31], [36, 39], [39, 40], [40, 41]]) {
    expect(() => assertChatwootProviderCausalLedger(
      swapAndResequence(fixture("recreated"), left, right),
      "recreated",
    )).toThrow(/versioned causal contract/);
  }

  const duplicate = fixture("gap");
  duplicate[22] = { ...duplicate[21], sequence: 23 };
  expect(() => assertChatwootProviderCausalLedger(duplicate, "gap")).toThrow();
  expect(() => assertChatwootProviderCausalLedger(fixture("gap").slice(0, -1), "gap")).toThrow();
  expect(() => assertChatwootProviderCausalLedger([...fixture("gap"), fixture("gap")[27]], "gap"))
    .toThrow();
  const ordinal = fixture("gap");
  ordinal[14].sequence = 999;
  expect(() => assertChatwootProviderCausalLedger(ordinal, "gap")).toThrow();
  expect(() => assertChatwootProviderCausalLedger(fixture("gap"), "unknown" as ProviderPhase)).toThrow();
});

test("retains every full entry field and deeply freezes the additional projection", () => {
  for (const phase of ["gap", "recreated"] as const) {
    const entries = fixture(phase);
    const before = structuredClone(entries);
    const projected = projectChatwootProviderCausalEntries(entries, phase);
    expectDeepFrozen(projected);
    for (const [index, node] of projected.nodes.entries()) {
      const { sequence, ...fullValue } = entries[index];
      expect(sequence).toBe(index + 1);
      expect(node.value).toEqual(fullValue);
      expect(Object.keys(node.value).sort()).toEqual(Object.keys(fullValue).sort());
      expect(node.value).not.toHaveProperty("sequence");
    }
    expect(entries).toEqual(before);

    const changedCredential = fixture(phase);
    changedCredential[12].credential_contract.headers.push("x-changed-credential");
    expect(projectChatwootProviderCausalEntries(changedCredential, phase)).not.toEqual(projected);
    const changedDigest = fixture(phase);
    changedDigest[12].body_sha256 = "f".repeat(64);
    expect(projectChatwootProviderCausalEntries(changedDigest, phase)).not.toEqual(projected);
    const changedBody = fixture(phase);
    changedBody[12].body_contract.fields.push("changed-body-field");
    expect(projectChatwootProviderCausalEntries(changedBody, phase)).not.toEqual(projected);
  }
});

test("rejects getters, proxies, sparse arrays and extra entry fields without invoking unsafe data", () => {
  let reads = 0;
  const getter = fixture("gap");
  Object.defineProperty(getter[13], "effect", {
    get() { reads += 1; return "read_notification_preferences"; },
  });
  expect(() => assertChatwootProviderCausalLedger(getter, "gap")).toThrow();

  const nestedGetter = fixture("gap");
  Object.defineProperty(nestedGetter[13].credential_contract, "headers", {
    get() { reads += 1; return []; },
  });
  expect(() => projectChatwootProviderCausalEntries(nestedGetter, "gap")).toThrow();

  const proxiedLedger = new Proxy(fixture("gap"), {
    get() { reads += 1; return undefined; },
  });
  expect(() => assertChatwootProviderCausalLedger(proxiedLedger, "gap")).toThrow();
  const proxiedEntry = fixture("gap");
  proxiedEntry[10] = new Proxy(proxiedEntry[10], {
    get() { reads += 1; return undefined; },
  });
  expect(() => assertChatwootProviderCausalLedger(proxiedEntry, "gap")).toThrow();
  expect(reads).toBe(0);

  const extra = fixture("gap");
  Object.defineProperty(extra[0], "unexpected", { value: "not-dropped" });
  expect(() => projectChatwootProviderCausalEntries(extra, "gap")).toThrow();
  const symbolExtra = fixture("gap");
  Object.defineProperty(symbolExtra[0], Symbol("unexpected"), { value: "not-dropped" });
  expect(() => projectChatwootProviderCausalEntries(symbolExtra, "gap")).toThrow();
  const sparse = fixture("gap");
  delete (sparse as unknown[])[13];
  expect(() => assertChatwootProviderCausalLedger(sparse, "gap")).toThrow();
  const sparseNested = fixture("gap");
  delete sparseNested[13].query_keys[0];
  expect(() => projectChatwootProviderCausalEntries(sparseNested, "gap")).toThrow();
});

function fixture(phase: ProviderPhase) {
  const effects = phase === "recreated"
    ? CHATWOOT_RECREATED_PROVIDER_EFFECTS
    : CHATWOOT_INITIAL_PROVIDER_EFFECTS;
  let probeIndex = 0;
  return effects.map((effect: string, index: number) => {
    const pathname = effect === "probe_contract"
      ? probePaths[probeIndex++]
      : `/synthetic/${effect}`;
    return {
      sequence: index + 1,
      effect,
      method: index < 12 || index >= 28 ? "POST" : "GET",
      pathname,
      service: serviceFor(effect),
      query_keys: [`query-${index}`, "locale"],
      body_bytes: index,
      body_contract: { format: "json", fields: [`field-${index}`, "public"] },
      body_sha256: index.toString(16).padStart(64, "0"),
      credential_contract: {
        headers: [`x-synthetic-${index}`],
        cookies: [`cookie-${index}`],
      },
      idempotency_key_present: index % 2 === 0,
      idempotency_key_sha256: index % 2 === 0 ? (index + 1).toString(16).padStart(64, "0") : null,
      idempotency_key_contract: index % 2 === 0
        ? { source: "header", name: `synthetic-${index}` }
        : null,
    };
  });
}

function serviceFor(effect: string) {
  if (["authorization_code_issued", "token_exchanged", "jwks_read"].includes(effect)) return "telegram-oidc";
  if (effect === "challenge_verified") return "turnstile";
  if (effect === "contact_identity_probed") return "chatwoot";
  if (effect === "read_user_by_uuid") return "remnawave";
  return "remnashop";
}

function swapAndResequence<T extends { sequence: number }>(entries: T[], left: number, right: number) {
  const changed = entries.map((entry) => structuredClone(entry));
  [changed[left], changed[right]] = [changed[right], changed[left]];
  return changed.map((entry, index) => ({ ...entry, sequence: index + 1 }));
}

function moveAndResequence<T extends { sequence: number }>(entries: T[], from: number, to: number) {
  const changed = entries.map((entry) => structuredClone(entry));
  const [moved] = changed.splice(from, 1);
  changed.splice(to, 0, moved);
  return changed.map((entry, index) => ({ ...entry, sequence: index + 1 }));
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) expectDeepFrozen(descriptor.value, seen);
  }
}

function permutations(values: number[]): number[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index))
    .map((tail) => [value, ...tail]));
}
