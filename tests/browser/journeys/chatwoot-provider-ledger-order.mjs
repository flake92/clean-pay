// Phase-specific causal ordering for the production-image Chatwoot journey.
// Sources: backend/health/checks.ts; application/profile/load-profile.ts;
// application/cabinet/load-cabinet.ts; the capture's profile -> cabinet navigation.
// Only independent reads within an explicit stage may change arrival order.
// This module never drops an entry, changes a body, or validates credentials.
// The caller must retain the endpoint/body/credential decoder and raw-prefix checks.

const item = (effect, pathname = null) => Object.freeze({ effect, pathname });
const one = (effect) => Object.freeze({ items: Object.freeze([item(effect)]), before: [] });
const probePaths = Object.freeze([
  "/api/v1/public/auth/email/start",
  "/api/v1/public/auth/identify",
  "/api/v1/public/auth/service-session",
  "/api/v1/public/auth/notification-preferences",
]);
const readiness = Object.freeze({
  items: Object.freeze([
    item("challenge_verified"), item("read_public_plans"), item("read_metadata"),
    item("jwks_read"), ...probePaths.map((pathname) => item("probe_contract", pathname)),
  ]),
  // Remnashop probes are sequential; Remnawave, JWKS and Turnstile are independent.
  before: Object.freeze([[1, 4], [4, 5], [5, 6], [6, 7]]),
});
const cabinetReads = Object.freeze({
  items: Object.freeze([
    item("read_referral_program"), item("read_subscription"), item("read_offers"),
    item("read_devices"), item("read_user_by_uuid"),
  ]),
  // The Remnawave user lookup consumes the returned subscription identity.
  before: Object.freeze([[1, 4]]),
});
const profileReads = Object.freeze({
  items: Object.freeze([item("read_notification_preferences"), item("read_profile")]),
  before: Object.freeze([]),
});
const cabinet = Object.freeze([
  one("read_profile"), one("read_profile"), cabinetReads,
  one("read_profile"), one("read_subscription"), one("contact_identity_probed"),
]);
const initial = Object.freeze([
  readiness, one("authorization_code_issued"), one("token_exchanged"),
  one("jwks_read"), one("auth_session_issued"), one("read_profile"), profileReads,
  one("read_profile"), one("read_subscription"), one("contact_identity_probed"),
  ...cabinet,
]);
const recreated = Object.freeze([
  ...initial,
  // The second login uses the already-warmed OIDC key cache, then opens /cabinet.
  one("challenge_verified"), one("authorization_code_issued"), one("token_exchanged"),
  one("auth_session_issued"), one("read_profile"), ...cabinet,
]);

function planFor(phase) {
  if (phase === "gap" || phase === "stable") return initial;
  if (phase === "recreated") return recreated;
  throw new Error("Chatwoot provider phase is invalid.");
}

export function chatwootProviderExpectedEffects(phase) {
  return Object.freeze(planFor(phase).flatMap(({ items }) => items.map(({ effect }) => effect)));
}

function stagePositions(entries, phase) {
  const plan = planFor(phase);
  const size = plan.reduce((sum, { items }) => sum + items.length, 0);
  if (!Array.isArray(entries) || entries.length !== size) {
    throw new Error("Chatwoot provider ledger is incomplete or outside its bound.");
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (!Object.hasOwn(entries, index) || !entries[index]
      || typeof entries[index] !== "object" || Array.isArray(entries[index])
      || entries[index].sequence !== index + 1) {
      throw new Error("Chatwoot provider sequence escaped its exact endpoint contract.");
    }
  }
  const positions = [];
  let offset = 0;
  for (const [stageIndex, stage] of plan.entries()) {
    const stageEntries = entries.slice(offset, offset + stage.items.length);
    const found = stage.items.map((expected) => {
      const matches = [];
      for (let index = 0; index < stageEntries.length; index += 1) {
        const entry = stageEntries[index];
        if (entry.effect === expected.effect
          && (expected.pathname === null || expected.pathname === entry.pathname)) {
          matches.push(index);
        }
      }
      if (matches.length !== 1) {
        throw new Error(`Chatwoot provider causal stage ${stageIndex} escaped its exact endpoint contract.`);
      }
      return matches[0];
    });
    if (new Set(found).size !== stage.items.length
      || stage.before.some(([left, right]) => found[left] >= found[right])) {
      throw new Error(`Chatwoot provider causal stage ${stageIndex} escaped its exact endpoint contract.`);
    }
    positions.push(...found.map((index) => index + offset));
    offset += stage.items.length;
  }
  return positions;
}

export function assertChatwootProviderCausalOrder(entries, phase) {
  stagePositions(entries, phase);
}

// Comparison-only view. Raw entries and sequence counters stay unchanged for
// same-stack Gap -> Stable -> Recreated prefix and atomic snapshot checks.
export function canonicalizeChatwootProviderArrivalOrder(entries, phase) {
  return stagePositions(entries, phase).map((index, canonicalIndex) => ({
    ...structuredClone(entries[index]), sequence: canonicalIndex + 1,
  }));
}
