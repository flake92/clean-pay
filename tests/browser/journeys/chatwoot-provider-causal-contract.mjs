import { types } from "node:util";

import {
  canonicalizeChatwootProviderArrivalOrder,
  chatwootProviderExpectedEffects,
} from "./chatwoot-provider-ledger-order.mjs";

export const CHATWOOT_PROVIDER_CAUSAL_CONTRACT_VERSION = 3;
export const CHATWOOT_INITIAL_PROVIDER_EFFECTS = chatwootProviderExpectedEffects("gap");
export const CHATWOOT_RECREATED_PROVIDER_EFFECTS = chatwootProviderExpectedEffects("recreated");

const entryKeys = Object.freeze([
  "body_bytes", "body_contract", "body_sha256", "credential_contract", "effect",
  "idempotency_key_contract", "idempotency_key_present", "idempotency_key_sha256",
  "method", "pathname", "query_keys", "sequence", "service",
]);

export function assertChatwootProviderCausalLedger(entries, phase) {
  const canonicalEntries = validatedCanonicalEntries(entries, phase);
  const semanticNodeIds = canonicalEntries.map(causalNodeId);
  if (new Set(semanticNodeIds).size !== canonicalEntries.length) fail();
  return Object.freeze({
    contractVersion: CHATWOOT_PROVIDER_CAUSAL_CONTRACT_VERSION,
    semanticNodeIds: Object.freeze(semanticNodeIds),
  });
}

/** Called after exact endpoint validation and the existing referential projection.
 * Keeps every full entry value except the arrival ordinal in this ADDITIONAL
 * causal category. The original ordered entry is retained in the raw category.
 */
export function projectChatwootProviderCausalEntries(entries, phase) {
  const canonicalEntries = validatedCanonicalEntries(entries, phase);
  const semanticNodeIds = canonicalEntries.map(causalNodeId);
  const nodes = canonicalEntries.map((entry, index) => {
    const budget = { nodes: 0, bytes: 0 };
    return Object.freeze({
      nodeId: semanticNodeIds[index],
      value: Object.freeze(Object.fromEntries(entryKeys
        .filter((key) => key !== "sequence")
        .map((key) => [key, copyData(ownData(entry, key), budget, 0)]))),
    });
  });
  return Object.freeze({
    contractVersion: CHATWOOT_PROVIDER_CAUSAL_CONTRACT_VERSION,
    nodes: Object.freeze(nodes),
    edges: causalDependencyEdges(semanticNodeIds, phase),
  });
}

function validatedCanonicalEntries(entries, phase) {
  let expectedEffects;
  try {
    expectedEffects = chatwootProviderExpectedEffects(phase);
  } catch {
    fail();
  }
  const raw = denseArray(entries, 64);
  if (raw.length !== expectedEffects.length) fail();
  const safeEntries = raw.map((entry, index) => {
    if (types.isProxy(entry) || Reflect.ownKeys(entry).length !== entryKeys.length
      || entryKeys.some((key) => !Object.hasOwn(entry, key))) fail();
    const budget = { nodes: 0, bytes: 0 };
    const value = Object.freeze(Object.fromEntries(entryKeys.map((key) => [
      key,
      copyData(ownData(entry, key), budget, 0),
    ])));
    if (ownData(value, "sequence") !== index + 1) fail();
    return value;
  });
  try {
    const canonical = canonicalizeChatwootProviderArrivalOrder(safeEntries, phase);
    if (canonical.length !== expectedEffects.length) fail();
    return Object.freeze(canonical.map((entry) => Object.freeze(entry)));
  } catch {
    fail();
  }
}

function causalNodeId(entry, index) {
  const ordinal = String(index + 1).padStart(2, "0");
  return `${ordinal}:${ownData(entry, "service")}:${ownData(entry, "effect")}:${ownData(entry, "pathname")}`;
}

// These are the explicit cross-request dependencies whose content is bound into
// the proof. The complete accepted partial order is validated by the single
// source of truth in chatwoot-provider-ledger-order.mjs before this projection.
function causalDependencyEdges(nodeIds, phase) {
  const initial = [
    [1, 4], [4, 5], [5, 6], [6, 7],
    [0, 8], [8, 9], [9, 10], [10, 11], [11, 12],
    [12, 13], [12, 14], [13, 15], [14, 15], [15, 16], [16, 17],
    [17, 18], [18, 19], [18, 20], [19, 21], [19, 22], [19, 23], [19, 24],
    [21, 24], [20, 25], [21, 25], [22, 25], [23, 25], [24, 25], [25, 26], [26, 27],
  ];
  const recreated = phase === "recreated" ? [
    [27, 28], [28, 29], [29, 30], [30, 31], [31, 32], [32, 33],
    [33, 34], [33, 35], [34, 36], [34, 37], [34, 38], [34, 39],
    [36, 39], [35, 40], [36, 40], [37, 40], [38, 40], [39, 40], [40, 41],
  ] : [];
  return Object.freeze([...initial, ...recreated].map(([before, after]) => Object.freeze([
    nodeIds[before],
    nodeIds[after],
  ])));
}

function copyData(value, budget, depth) {
  budget.nodes += 1;
  if (budget.nodes > 1_024 || depth > 8) fail();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail();
    return value;
  }
  if (typeof value === "string") {
    budget.bytes += Buffer.byteLength(value, "utf8");
    if (value.length > 2_048 || budget.bytes > 128 * 1_024) fail();
    return value;
  }
  if (!value || typeof value !== "object" || types.isProxy(value)) fail();
  if (Array.isArray(value)) {
    return Object.freeze(denseArray(value, 64).map((entry) => copyData(entry, budget, depth + 1)));
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32 || keys.some((key) => typeof key !== "string" || key.length > 128)) fail();
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, copyData(ownData(value, key), budget, depth + 1)])));
}

function denseArray(value, maximum) {
  if (types.isProxy(value) || !Array.isArray(value)) fail();
  const length = ownData(value, "length");
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum
    || Reflect.ownKeys(value).length !== length + 1) fail();
  return Array.from({ length }, (_, index) => ownData(value, String(index)));
}

function ownData(value, key) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
  return descriptor.value;
}

function fail() {
  throw new Error("Chatwoot provider ledger escaped its versioned causal contract.");
}
