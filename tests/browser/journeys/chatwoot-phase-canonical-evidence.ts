import { projectExactJourneyGeneratedValues } from "../journey-comparison-projection";

const BASELINE_COMMIT = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const PROJECT = "journey-1440x900";
const JOURNEY = "telegram-oidc-cabinet-profile-link-referral-passkey";

type ExactPhaseEvidenceInput = {
  accessibility: string;
  browserRequests: unknown[];
  boundaryCalls: unknown[];
  computedStyles: unknown[];
  dom: unknown;
  fixtureContractSha256: string;
  interactive: unknown[];
  network: {
    requests: unknown[];
    serverActionCount: number;
    serverActions: unknown[];
  };
  providerEffects: {
    database: unknown;
    entries: unknown[];
  };
  storage: unknown;
};

/**
 * Applies only the immutable journey-v5 referential projection, in memory,
 * before turning the complete bounded observations into ordered canonical
 * strings for the proof-scoped HMAC sealer. No raw value leaves this call.
 */
export function canonicalChatwootPhaseEvidence(input: ExactPhaseEvidenceInput) {
  assertExactInput(input);
  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    baselineCommit: BASELINE_COMMIT,
    source: {
      fixtureContract: {
        version: "journey-v5",
        sha256: input.fixtureContractSha256,
      },
    },
    syntheticReset: null,
    project: PROJECT,
    journey: JOURNEY,
    checkpoints: [],
    navigations: [],
    boundaries: [],
    console: [],
    network: structuredClone(input.network),
    providerEffects: structuredClone(input.providerEffects),
  };
  projectExactJourneyGeneratedValues(manifest);

  const network = exactRecord(manifest.network, "projected phase network");
  const requests = exactArray(network.requests, "projected phase requests");
  const serverActions = exactArray(network.serverActions, "projected phase Server Actions");
  if (
    !Number.isSafeInteger(network.serverActionCount)
    || network.serverActionCount !== serverActions.length
    || requests.length === 0
    || serverActions.length === 0
  ) {
    throw new Error("Projected phase network is incomplete.");
  }
  const provider = exactRecord(manifest.providerEffects, "projected provider evidence");
  const providerEntries = exactArray(provider.entries, "projected provider ledger");
  if (providerEntries.length === 0 || provider.database === undefined) {
    throw new Error("Projected provider evidence is incomplete.");
  }

  return Object.freeze({
    accessibility: Object.freeze([canonical(input.accessibility)]),
    boundaryCalls: canonicalEntries(input.boundaryCalls, "boundary calls"),
    computedStyles: canonicalEntries(input.computedStyles, "computed styles"),
    dom: Object.freeze([canonical(input.dom)]),
    interactive: canonicalEntries(input.interactive, "interactive state"),
    providerEffects: Object.freeze([
      ...providerEntries.map((entry) => canonical(
        exactRecord(entry, "projected provider entry").effect,
      )),
      canonical({ database: provider.database }),
    ]),
    providerLedger: Object.freeze([
      ...providerEntries.map(canonical),
      canonical({ database: provider.database }),
    ]),
    requestSequence: Object.freeze([
      ...requests.map((entry) => canonical({ source: "network-recorder", value: entry })),
      ...input.browserRequests.map((entry) => canonical({
        source: "strict-browser-policy",
        value: entry,
      })),
    ]),
    serverActions: Object.freeze(serverActions.map(canonical)),
    storage: Object.freeze([canonical(input.storage)]),
  });
}

function assertExactInput(value: ExactPhaseEvidenceInput) {
  exactKeys(value, [
    "accessibility",
    "browserRequests",
    "boundaryCalls",
    "computedStyles",
    "dom",
    "fixtureContractSha256",
    "interactive",
    "network",
    "providerEffects",
    "storage",
  ], "phase evidence input");
  if (
    typeof value.accessibility !== "string"
    || value.accessibility.length === 0
    || value.accessibility.length > 1_000_000
    || !/^[a-f0-9]{64}$/.test(value.fixtureContractSha256)
  ) throw new Error("Phase accessibility or fixture contract is invalid.");
  for (const [name, entries] of [
    ["strict browser requests", value.browserRequests],
    ["boundary calls", value.boundaryCalls],
    ["computed styles", value.computedStyles],
    ["interactive state", value.interactive],
  ] as const) exactArray(entries, name);
  exactKeys(value.network, ["requests", "serverActionCount", "serverActions"], "phase network");
  exactArray(value.network.requests, "phase requests");
  exactArray(value.network.serverActions, "phase Server Actions");
  if (
    value.network.serverActionCount !== value.network.serverActions.length
    || value.network.requests.length === 0
    || value.network.serverActions.length === 0
  ) throw new Error("Phase network is incomplete.");
  exactKeys(value.providerEffects, ["database", "entries"], "phase provider evidence");
  exactArray(value.providerEffects.entries, "phase provider ledger");
  if (value.providerEffects.entries.length === 0 || value.providerEffects.database === undefined) {
    throw new Error("Phase provider evidence is incomplete.");
  }
}

function canonicalEntries(value: unknown[], label: string) {
  if (value.length === 0) throw new Error(`Phase ${label} evidence is empty.`);
  return Object.freeze(value.map(canonical));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    assertDenseArray(value, "nested canonical evidence");
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
    )).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Phase evidence contains an unsupported value.");
  return serialized;
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function exactArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  assertDenseArray(value, label);
  return value;
}

function assertDenseArray(value: unknown[], label: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be a dense own-index array.`);
    }
  }
}

function exactKeys(value: unknown, keys: string[], label: string) {
  const record = exactRecord(value, label);
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has unexpected fields.`);
  }
}
