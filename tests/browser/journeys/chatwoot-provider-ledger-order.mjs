import { isDeepStrictEqual } from "node:util";

// Phase-specific causal ordering for the production-image Chatwoot journey.
// Sources: backend/health/checks.ts; application/profile/load-profile.ts;
// application/cabinet/load-cabinet.ts; the capture's profile -> cabinet navigation.
// Readiness and browser login are independent lanes; only their own causal
// constraints are ordered. Raw arrival order remains available to phase checks.
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
const initialBrowserStageVariants = Object.freeze([
  Object.freeze([one("challenge_verified"), ...initial.slice(1)]),
  Object.freeze([
    one("challenge_verified"),
    ...initial.slice(1, 10),
    cabinet[cabinet.length - 1],
    ...cabinet.slice(0, -1),
  ]),
]);
const recreated = Object.freeze([
  ...initial,
  // The second login uses the already-warmed OIDC key cache, then opens /cabinet.
  one("challenge_verified"), one("authorization_code_issued"), one("token_exchanged"),
  one("auth_session_issued"), one("read_profile"), ...cabinet.slice(0, -1),
]);

function planFor(phase) {
  if (phase === "gap" || phase === "stable") return initial;
  if (phase === "recreated") return recreated;
  throw new Error("Chatwoot provider phase is invalid.");
}

export function chatwootProviderExpectedEffects(phase) {
  return Object.freeze(planFor(phase).flatMap(({ items }) => items.map(({ effect }) => effect)));
}

function matchesItem(entry, expected) {
  return entry.effect === expected.effect
    && (expected.pathname === null || expected.pathname === entry.pathname);
}

// Match the browser lane after independent readiness entries have been assigned.
// No entry is discarded: the returned permutation is checked again below.
function orderedStagePositions(entries, stages) {
  const positions = [];
  let offset = 0;
  for (const [stageIndex, stage] of stages.entries()) {
    const stageEntries = entries.slice(offset, offset + stage.items.length);
    const found = stage.items.map((expected) => {
      const matches = [];
      for (let index = 0; index < stageEntries.length; index += 1) {
        if (matchesItem(stageEntries[index], expected)) matches.push(index);
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
  if (offset !== entries.length) {
    throw new Error("Chatwoot provider lane escaped its exact endpoint contract.");
  }
  return positions;
}

function initialPositions(entries) {
  const readinessItems = readiness.items.slice(1); // Turnstile belongs to login.
  const candidates = readinessItems.map((expected) => entries.flatMap((entry, index) => (
    matchesItem(entry, expected) ? [index] : []
  )));
  // One readiness JWKS fetch and one token-verification fetch have the same
  // endpoint. Try both assignments, not a greedy 'first JWKS is readiness'.
  for (const [index, expected] of readinessItems.entries()) {
    if (candidates[index].length !== (expected.effect === "jwks_read" ? 2 : 1)) {
      throw new Error("Chatwoot readiness lane escaped its exact endpoint contract.");
    }
  }
  const jwksIndex = readinessItems.findIndex(({ effect }) => effect === "jwks_read");
  const valid = [];
  for (const jwksPosition of candidates[jwksIndex]) {
    const readinessPositions = candidates.map((matches, index) => (
      index === jwksIndex ? jwksPosition : matches[0]
    ));
    const used = new Set(readinessPositions);
    const browserPositions = entries.flatMap((_, index) => used.has(index) ? [] : [index]);
    let browserOrder;
    for (const orderedBrowserPositions of cabinetArrivalPositionVariants(entries, browserPositions)) {
      for (const browserStages of initialBrowserStageVariants) {
        try {
          browserOrder = orderedStagePositions(
            orderedBrowserPositions.map((index) => entries[index]),
            browserStages,
          ).map((index) => orderedBrowserPositions[index]);
          break;
        } catch {
          browserOrder = undefined;
        }
      }
      if (browserOrder !== undefined) break;
    }
    if (browserOrder === undefined) {
      continue;
    }
    const firstStage = [browserOrder[0], ...readinessPositions];
    if (readiness.before.some(([left, right]) => firstStage[left] >= firstStage[right])) {
      continue;
    }
    valid.push([...firstStage, ...browserOrder.slice(1)]);
  }
  if (valid.length === 0) {
    throw new Error(
      `Chatwoot provider independent lanes escaped their exact endpoint contract: ${
        compactProviderEffects(entries)
      }`,
    );
  }
  if (valid.length > 1) {
    // The trace cannot distinguish identical JWKS reads. Permit that ambiguity
    // only when the entire compared entry is identical apart from its position.
    // Different payloads, credentials or digests are never silently reassigned.
    const content = (positions) => positions.map((index) => {
      const entry = { ...entries[index] };
      delete entry.sequence;
      return entry;
    });
    if (!valid.every((positions) => isDeepStrictEqual(content(positions), content(valid[0])))) {
      throw new Error("Chatwoot JWKS assignment is ambiguous outside its exact endpoint contract.");
    }
  }
  return valid[0];
}

function cabinetArrivalPositionVariants(entries, browserPositions) {
  const variants = [browserPositions];
  // Profile and referral reads are independent React server-component lanes.
  // Preserve raw arrival order, but also try the one observed interleaving in
  // canonical causal order: profile, referral, profile -> profile, profile,
  // referral. The complete stage matcher below still validates every entry.
  if (browserPositions.length >= 14
    && entries[browserPositions[11]]?.effect === "read_profile"
    && entries[browserPositions[12]]?.effect === "read_referral_program"
    && entries[browserPositions[13]]?.effect === "read_profile") {
    const canonical = [...browserPositions];
    [canonical[12], canonical[13]] = [canonical[13], canonical[12]];
    variants.unshift(canonical);
  }
  return variants;
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
  const initialSize = initial.reduce((sum, { items }) => sum + items.length, 0);
  const positions = initialPositions(entries.slice(0, initialSize));
  if (phase === "recreated") {
    positions.push(...orderedStagePositions(entries.slice(initialSize), recreated.slice(initial.length))
      .map((index) => index + initialSize));
  }
  if (positions.length !== entries.length || new Set(positions).size !== entries.length) {
    throw new Error("Chatwoot provider assignment escaped its exact endpoint contract.");
  }
  return positions;
}

function compactProviderEffects(entries) {
  return entries.map((entry) => {
    const effect = typeof entry.effect === "string" ? entry.effect : "unknown";
    const pathname = typeof entry.pathname === "string" ? entry.pathname : "";
    return pathname === "" ? effect : `${effect}@${pathname}`;
  }).join(",");
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
