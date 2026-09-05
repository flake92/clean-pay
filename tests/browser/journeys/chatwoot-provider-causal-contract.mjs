import { types } from "node:util";

export const CHATWOOT_PROVIDER_CAUSAL_CONTRACT_VERSION = 2;

// This characterization belongs to the task-added profile -> cabinet Chatwoot
// scenario. The original journey-v5 fixtures and arrival ledgers are unchanged.
const initialNodes = Object.freeze([
  ["auth.challenge", "challenge_verified"],
  ["auth.authorize", "authorization_code_issued"],
  ["auth.token", "token_exchanged"],
  ["auth.jwks", "jwks_read"],
  ["auth.session", "auth_session_issued"],
  ["profile.authorize", "read_profile"],
  ["profile.notification-preferences", "read_notification_preferences"],
  ["profile.model", "read_profile"],
  ["profile.support-authorize", "read_profile"],
  ["profile.support-subscription", "read_subscription"],
  ["profile.contact", "contact_identity_probed"],
  ["cabinet.profile", "read_profile"],
  ["cabinet.authorize", "read_profile"],
  ["cabinet.referral", "read_referral_program"],
  ["cabinet.subscription", "read_subscription"],
  ["cabinet.offers", "read_offers"],
  ["cabinet.devices", "read_devices"],
  ["cabinet.subscription-user", "read_user_by_uuid"],
  ["cabinet.support-authorize", "read_profile"],
  ["cabinet.support-subscription", "read_subscription"],
  ["cabinet.contact", "contact_identity_probed"],
].map(([id, effect]) => Object.freeze({ id, effect })));

export const CHATWOOT_INITIAL_PROVIDER_EFFECTS = Object.freeze(initialNodes.map(({ effect }) => effect));

// loadCabinetViewModel starts subscription/offers/devices with Promise.allSettled;
// CabinetReferralContent is a separate Suspense branch. Only subscription's
// awaited response precedes getLiveRemnawaveSubscriptionUrl. Arrival order among
// the four independent GETs, or between their siblings and that child, is not a
// semantic ordering. All other anchors deliberately remain exact.
const fanout = initialNodes.slice(13, 18);
const initialEdges = Object.freeze([
  ...initialNodes.slice(0, 12).map(({ id }, index) => [id, initialNodes[index + 1].id]),
  ...fanout.map(({ id }) => [initialNodes[12].id, id]),
  ["cabinet.subscription", "cabinet.subscription-user"],
  ...fanout.map(({ id }) => [id, initialNodes[18].id]),
  [initialNodes[18].id, initialNodes[19].id],
  [initialNodes[19].id, initialNodes[20].id],
].map((edge) => Object.freeze(edge)));

const entryKeys = Object.freeze([
  "body_bytes", "body_contract", "body_sha256", "credential_contract", "effect",
  "idempotency_key_contract", "idempotency_key_present", "idempotency_key_sha256",
  "method", "pathname", "query_keys", "sequence", "service",
]);

export function assertChatwootProviderCausalLedger(entries, phase) {
  if (phase === "recreated") {
    throw new Error("Chatwoot recreated provider causal contract is uncharacterized.");
  }
  if (phase !== "gap" && phase !== "stable") fail();
  const raw = denseArray(entries, initialNodes.length);
  if (raw.length !== initialNodes.length) fail();
  const semanticNodeIds = raw.map((entry, index) => {
    if (ownData(entry, "sequence") !== index + 1) fail();
    const effect = ownData(entry, "effect");
    const node = index >= 13 && index <= 17
      ? fanout.find((candidate) => candidate.effect === effect)
      : initialNodes[index];
    if (!node || node.effect !== effect) fail();
    return node.id;
  });
  if (new Set(semanticNodeIds).size !== initialNodes.length) fail();
  for (const [before, after] of initialEdges) {
    if (semanticNodeIds.indexOf(before) >= semanticNodeIds.indexOf(after)) fail();
  }
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
  const contract = assertChatwootProviderCausalLedger(entries, phase);
  const nodes = initialNodes.map(({ id }) => {
    const entryIndex = contract.semanticNodeIds.indexOf(id);
    const entry = ownData(entries, String(entryIndex));
    if (types.isProxy(entry) || Reflect.ownKeys(entry).length !== entryKeys.length
      || entryKeys.some((key) => !Object.hasOwn(entry, key))) fail();
    const budget = { nodes: 0, bytes: 0 };
    const value = Object.fromEntries(entryKeys.filter((key) => key !== "sequence")
      .map((key) => [key, copyData(ownData(entry, key), budget, 0)]));
    return Object.freeze({ nodeId: id, value: Object.freeze(value) });
  });
  return Object.freeze({
    contractVersion: contract.contractVersion,
    nodes: Object.freeze(nodes),
    edges: initialEdges,
  });
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
