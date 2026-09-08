import { createHash } from "node:crypto";

const BASELINE_COMMIT = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const JOURNEYS = new Set([
  "public-responsive-keyboard-install-offline-support",
  "email-register-verify-and-login",
  "telegram-oidc-cabinet-profile-link-referral-passkey",
  "email-account-links-and-merges-telegram",
  "tariffs-payment-returns-extend-idempotency",
  "telegram-webapp-browser-boundary",
]);
const CHATWOOT_JOURNEYS = new Set([
  "email-register-verify-and-login",
  "telegram-oidc-cabinet-profile-link-referral-passkey",
  "email-account-links-and-merges-telegram",
  "tariffs-payment-returns-extend-idempotency",
  "telegram-webapp-browser-boundary",
]);
const DYNAMIC_COOKIE_NAMES = new Set([
  "clean_pay_access",
  "clean_pay_refresh",
  "clean_pay_tg_state",
  "clean_pay_tg_nonce",
  "clean_pay_tg_code_verifier",
  "clean_pay_tg_callback_receipt",
  "clean_pay_account_merge",
  "clean_pay_referral",
]);
const CUID = /^c[a-z0-9]{20,40}$/i;
const SHORT_DIGEST = /^<sha256:[a-f0-9]{16}>$/;
const PWA_SHELL_CACHE_UUID_V4 = /^clean-pay-shell-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PROJECTED_PWA_SHELL_CACHE = Object.freeze({
  kind: "<validated:pwa-shell-cache>",
});

/**
 * Normalizes only generated identifiers in the isolated journey schema.
 * Raw evidence retains every digest. Symbols are assigned by first occurrence
 * and repeated values keep the same symbol, preserving referential equality.
 */
export function projectExactJourneyGeneratedValues(manifest: Record<string, unknown>) {
  if (!isExactJourneyManifest(manifest)) return;
  const references = new DynamicReferences();
  projectSyntheticResetScope(manifest.syntheticReset);
  projectProviderLedger(manifest.providerEffects, references);
  projectServerActions(manifest.network, references);
  projectCheckpointCookies(manifest.checkpoints, references);
  projectBoundaryCookies(manifest.boundaries, references);
  projectCanonicalUrls(manifest, references);
}

export function projectExactJourneyPwaShellCachePair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !isExactJourneyManifest(expected)
    || !isExactJourneyManifest(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
  ) {
    return;
  }
  const expectedSource = expected.source as Record<string, unknown>;
  const actualSource = actual.source as Record<string, unknown>;
  if (
    typeof expectedSource.revision !== "string"
    || !/^[a-f0-9]{40}$/.test(expectedSource.revision)
    || typeof actualSource.revision !== "string"
    || !/^[a-f0-9]{40}$/.test(actualSource.revision)
  ) {
    return;
  }

  const expectedLocations = exactPwaShellCacheLocations(expected);
  if (
    !expectedLocations
    || !allLocationsMatch(expectedLocations, (value) => (
      typeof value === "string" && PWA_SHELL_CACHE_UUID_V4.test(value)
    ))
  ) {
    return;
  }
  projectPwaLocations(expectedLocations);

  const actualLocations = exactPwaShellCacheLocations(actual);
  const actualRevisionCache = `clean-pay-shell-${actualSource.revision}`;
  if (
    !actualLocations
    || !sameJson(
      actualLocations.map(({ key }) => key),
      expectedLocations.map(({ key }) => key),
    )
    || !allLocationsMatch(actualLocations, (value) => value === actualRevisionCache)
  ) {
    return;
  }
  projectPwaLocations(actualLocations);
}

export function projectExactOptionalJourneyServiceWorkerStatePair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !isExactJourneyManifest(expected)
    || !isExactJourneyManifest(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
  ) {
    return;
  }
  const expectedSource = expected.source;
  const actualSource = actual.source;
  if (!isRecord(expectedSource) || !isRecord(actualSource)) return;
  const expectedRevision = typeof expectedSource.revision === "string"
    ? expectedSource.revision
    : null;
  const actualRevision = typeof actualSource.revision === "string"
    ? actualSource.revision
    : null;
  if (
    !expectedRevision
    || !/^[a-f0-9]{40}$/.test(expectedRevision)
    || !actualRevision
    || !/^[a-f0-9]{40}$/.test(actualRevision)
  ) {
    return;
  }

  const expectedLocations = exactOptionalServiceWorkerCheckpointStates(
    expected,
    (value) => PWA_SHELL_CACHE_UUID_V4.test(value)
      || value === `clean-pay-shell-${expectedRevision}`,
  );
  const actualLocations = exactOptionalServiceWorkerCheckpointStates(
    actual,
    (value) => value === `clean-pay-shell-${actualRevision}`,
  );
  if (
    !expectedLocations
    || !actualLocations
    || !sameJson(
      expectedLocations.map(({ key }) => key),
      actualLocations.map(({ key }) => key),
    )
  ) {
    return;
  }

  for (const location of [...expectedLocations, ...actualLocations]) {
    location.cacheNames.length = 0;
    location.serviceWorkerScopes.length = 0;
  }
}

export function projectExactAuthenticatedChatwootGeneratedPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !isExactJourneyManifest(expected)
    || !isExactJourneyManifest(actual)
    || expected.project !== actual.project
    || actual.journey !== expected.journey
  ) {
    return;
  }
  if (expected.journey !== "email-register-verify-and-login") {
    projectExactJourneyChatwootGeneratedPair(expected, actual);
    return;
  }

  const expectedState = exactAuthenticatedChatwootGeneratedState(expected);
  const actualState = exactAuthenticatedChatwootGeneratedState(actual);
  if (expectedState && actualState) {
    if (
      !sameJson(expectedState.presence, actualState.presence)
      || !exactChatwootIdentityCookiesMatch(
        expectedState.identityCookies,
        actualState.identityCookies,
      )
      || expectedState.conversationBytes !== actualState.conversationBytes
    ) {
      return;
    }

    for (const state of [expectedState, actualState]) {
      for (const digest of state.conversationDigests) {
        digest.sha256 = "<dynamic:chatwoot-conversation:1>";
      }
      for (const digest of state.ownershipDigests) {
        digest.bytes = "<dynamic:chatwoot-ownership-bytes>" as unknown as number;
        digest.sha256 = "<dynamic:chatwoot-ownership:1>";
      }
      for (const identity of state.identityCookies) {
        if (identity) {
          identity.name = "cw_user_<dynamic:chatwoot-website-token:1>";
        }
      }
    }
    return;
  }

  if (
    expectedState
    || actualState
  ) {
    return;
  }
  projectExactJourneyChatwootGeneratedPair(expected, actual);
}

function projectExactJourneyChatwootGeneratedPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !isExactJourneyManifest(expected)
    || !isExactJourneyManifest(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !CHATWOOT_JOURNEYS.has(String(expected.journey))
  ) {
    return;
  }
  const expectedState = exactJourneyChatwootGeneratedState(expected);
  const actualState = exactJourneyChatwootGeneratedState(actual);
  if (!expectedState || !actualState) {
    return;
  }
  if (
    sameDigestOccurrenceShape(
      expectedState.conversations,
      actualState.conversations,
      true,
    )
  ) {
    projectDigestOccurrences(expectedState.conversations, "chatwoot-conversation");
    projectDigestOccurrences(actualState.conversations, "chatwoot-conversation");
  }
  if (sameDigestOccurrenceShape(expectedState.ownership, actualState.ownership, false)) {
    projectDigestOccurrences(expectedState.ownership, "chatwoot-ownership", true);
    projectDigestOccurrences(actualState.ownership, "chatwoot-ownership", true);
  }
  if (sameIdentityOccurrenceShape(expectedState.identities, actualState.identities)) {
    projectIdentityOccurrences(expectedState.identities);
    projectIdentityOccurrences(actualState.identities);
  }
}

/** The merge journey retains the same generated local actor/conversation while
 * its support-context ownership fingerprint changes after the merge. Scope the
 * exception to exactly this two-checkpoint, completed-merge contract. Raw evidence
 * is never changed; cookie attributes, sizes, identity cookie bytes, storage keys,
 * provider effects and the intra-run equality pattern remain strict. */
export function projectExactMergeChatwootGeneratedPair(
  expected: Record<string, unknown>, actual: Record<string, unknown>,
) {
  if (!isExactJourneyManifest(expected) || !isExactJourneyManifest(actual)
    || expected.project !== actual.project
    || expected.journey !== "email-account-links-and-merges-telegram"
    || actual.journey !== expected.journey) return;
  const collect = (manifest: Record<string, unknown>) => {
    if (!Array.isArray(manifest.checkpoints) || manifest.checkpoints.length !== 2
      || !Array.isArray(manifest.boundaries) || !isRecord(manifest.providerEffects)
      || !Array.isArray(manifest.providerEffects.entries)) return null;
    const merge = manifest.boundaries.filter((entry) => isRecord(entry)
      && entry.label === "telegram-account-merge");
    if (merge.length !== 1 || !isRecord(merge[0]) || !isRecord(merge[0].value)
      || !sameJson(merge[0].value, {confirmed: true, dryRunCount: 2,
        mergeCount: 1, redirectPath: "/cabinet"})) return null;
    const effects = manifest.providerEffects.entries;
    if (effects.filter((entry) => isRecord(entry) && entry.effect === "users_merged").length !== 1
      || effects.filter((entry) => isRecord(entry) && entry.effect === "users_merge_dry_run").length !== 2) return null;
    const labels = ["link-account-merge-confirmation", "link-account-merged-cabinet"];
    const values = [];
    for (const [index, checkpoint] of manifest.checkpoints.entries()) {
      if (!isRecord(checkpoint) || checkpoint.label !== labels[index]
        || !Array.isArray(checkpoint.cookies) || !isExactCheckpointStorage(checkpoint.storage)) return null;
      const cw = checkpoint.cookies.filter((c) => isRecord(c)
        && typeof c.name === "string" && c.name.startsWith("cw_"));
      const conversation = cw.filter(isExactChatwootConversationCookie);
      const identity = cw.filter(isExactChatwootIdentityCookie);
      const ownership = checkpoint.storage.local.filter(isExactChatwootOwnershipStorage);
      if (cw.length !== 2 || conversation.length !== 1 || identity.length !== 1
        || ownership.length !== 1 || checkpoint.storage.local.length !== 1) return null;
      values.push({conversation: conversation[0].value, ownership: ownership[0].value,
        identity: identity[0]});
    }
    if (!sameJson(values[0].conversation, values[1].conversation)
      || !sameJson(values[0].identity, values[1].identity)) return null;
    return values;
  };
  const a = collect(expected), b = collect(actual);
  if (!a || !b || a.some((v, i) => v.conversation.bytes !== b[i].conversation.bytes
    || v.ownership.bytes !== b[i].ownership.bytes || !sameJson(v.identity, b[i].identity))
    || (a[0].ownership.sha256 === a[1].ownership.sha256)
      !== (b[0].ownership.sha256 === b[1].ownership.sha256)) return;
  for (const side of [a, b]) {
    const refs = new Map<string, string>();
    for (const value of side) {
      value.conversation.sha256 = "<dynamic:merge-chatwoot-conversation:1>";
      if (!refs.has(value.ownership.sha256)) refs.set(value.ownership.sha256,
        `<dynamic:merge-chatwoot-ownership:${refs.size + 1}>`);
      value.ownership.sha256 = refs.get(value.ownership.sha256)!;
    }
  }
}

function exactChatwootIdentityCookiesMatch(
  expected: ChatwootGeneratedState["identityCookies"],
  actual: ChatwootGeneratedState["identityCookies"],
) {
  return expected.length === actual.length && expected.every((expectedCookie, index) => {
    const actualCookie = actual[index];
    if (expectedCookie === null || actualCookie === null) {
      return expectedCookie === actualCookie;
    }
    return expectedCookie.name === actualCookie.name
      && sameJson(expectedCookie, actualCookie);
  });
}

type JourneyChatwootGeneratedState = {
  conversations: Array<{ bytes: number; sha256: string }>;
  identities: Array<(Record<string, unknown> & {
    name: string;
    value: { bytes: number; sha256: string };
  }) | null>;
  ownership: Array<{ bytes: number; sha256: string }>;
};

function exactJourneyChatwootGeneratedState(
  manifest: Record<string, unknown>,
): JourneyChatwootGeneratedState | null {
  if (!Array.isArray(manifest.checkpoints)) return null;
  const conversations: JourneyChatwootGeneratedState["conversations"] = [];
  const identities: JourneyChatwootGeneratedState["identities"] = [];
  const ownership: JourneyChatwootGeneratedState["ownership"] = [];
  for (const checkpoint of manifest.checkpoints) {
    if (
      !isRecord(checkpoint)
      || !Array.isArray(checkpoint.cookies)
      || !isExactCheckpointStorage(checkpoint.storage)
    ) {
      return null;
    }
    const chatwootCookies = checkpoint.cookies.filter((cookie) => (
      isRecord(cookie)
      && typeof cookie.name === "string"
      && cookie.name.startsWith("cw_")
    ));
    if (chatwootCookies.length === 0) {
      identities.push(null);
      continue;
    }
    const conversation = chatwootCookies.filter(isExactChatwootConversationCookie);
    const identity = chatwootCookies.filter(isExactChatwootIdentityCookie);
    const unexpected = chatwootCookies.filter((cookie) => (
      !isExactChatwootConversationCookie(cookie)
      && !isExactChatwootIdentityCookie(cookie)
    ));
    if (conversation.length !== 1 || identity.length > 1 || unexpected.length !== 0) {
      return null;
    }
    const ownershipValues = checkpoint.storage.local.filter(isExactChatwootOwnershipStorage);
    if (ownershipValues.length > 1) return null;
    conversations.push(conversation[0]!.value);
    if (ownershipValues[0]) ownership.push(ownershipValues[0].value);
    identities.push(identity[0] ?? null);
  }
  return conversations.length > 0 ? { conversations, identities, ownership } : null;
}

function sameDigestOccurrenceShape(
  expected: Array<{ bytes: number; sha256: string }>,
  actual: Array<{ bytes: number; sha256: string }>,
  requireEqualBytes: boolean,
) {
  return expected.length === actual.length
    && expected.every((value, index) => (
      requireEqualBytes
        ? value.bytes === actual[index]!.bytes
        : value.bytes >= 0 && actual[index]!.bytes >= 0
    ))
    && sameDigestEqualityShape(expected, actual);
}

function sameIdentityOccurrenceShape(
  expected: JourneyChatwootGeneratedState["identities"],
  actual: JourneyChatwootGeneratedState["identities"],
) {
  return expected.length === actual.length
    && expected.every((value, index) => {
      const other = actual[index];
      if (value === null || other === null) return value === other;
      return value.domain === other.domain
        && value.name === other.name
        && value.path === other.path
        && value.httpOnly === other.httpOnly
        && value.secure === other.secure
        && value.sameSite === other.sameSite
        && value.value.bytes === other.value.bytes;
    })
    && sameDigestEqualityShape(
      expected.flatMap((value) => value === null ? [] : [value.value]),
      actual.flatMap((value) => value === null ? [] : [value.value]),
    );
}

function sameDigestEqualityShape(
  expected: Array<{ sha256: string }>,
  actual: Array<{ sha256: string }>,
) {
  for (let left = 0; left < expected.length; left += 1) {
    for (let right = left + 1; right < expected.length; right += 1) {
      if ((expected[left]!.sha256 === expected[right]!.sha256)
        !== (actual[left]!.sha256 === actual[right]!.sha256)) {
        return false;
      }
    }
  }
  return true;
}

function projectDigestOccurrences(
  values: Array<{ bytes?: number | string; sha256: string }>,
  label: string,
  projectBytes = false,
) {
  const symbols = new Map<string, string>();
  for (const value of values) {
    const existing = symbols.get(value.sha256);
    if (existing) {
      value.sha256 = existing;
      if (projectBytes) value.bytes = `<dynamic:${label}-bytes>`;
      continue;
    }
    const symbol = `<dynamic:${label}:${symbols.size + 1}>`;
    symbols.set(value.sha256, symbol);
    value.sha256 = symbol;
    if (projectBytes) value.bytes = `<dynamic:${label}-bytes>`;
  }
}

function projectIdentityOccurrences(
  values: JourneyChatwootGeneratedState["identities"],
) {
  const names = new Map<string, string>();
  const cookieValues = values.flatMap((value) => value === null ? [] : [value.value]);
  projectDigestOccurrences(cookieValues, "chatwoot-identity-cookie");
  for (const value of values) {
    if (value === null) continue;
    const digest = value.name.slice("cw_user_".length);
    const existing = names.get(digest);
    if (existing) {
      value.name = existing;
      continue;
    }
    const symbol = `cw_user_<dynamic:chatwoot-website-token:${names.size + 1}>`;
    names.set(digest, symbol);
    value.name = symbol;
  }
}

type ChatwootGeneratedState = {
  conversationBytes: number;
  conversationDigests: Array<{ bytes: number; sha256: string }>;
  identityCookies: Array<(Record<string, unknown> & { name: string }) | null>;
  ownershipBytes: number;
  ownershipDigests: Array<{ bytes: number; sha256: string }>;
  presence: boolean[];
};

function exactAuthenticatedChatwootGeneratedState(
  manifest: Record<string, unknown>,
): ChatwootGeneratedState | null {
  const checkpointValues = manifest.checkpoints;
  if (!Array.isArray(checkpointValues)) return null;
  const labels = ["register-cabinet", "email-login-cabinet"];
  const checkpoints = labels.map((label) => checkpointValues.filter((checkpoint: unknown) => (
    isRecord(checkpoint) && checkpoint.label === label
  )));
  if (checkpoints.some((matches) => matches.length !== 1)) return null;

  const conversationDigests: ChatwootGeneratedState["conversationDigests"] = [];
  const ownershipDigests: ChatwootGeneratedState["ownershipDigests"] = [];
  const identityCookies: ChatwootGeneratedState["identityCookies"] = [];
  const presence: boolean[] = [];
  for (const [checkpoint] of checkpoints) {
    if (
      !isRecord(checkpoint)
      || !Array.isArray(checkpoint.cookies)
      || !isExactCheckpointStorage(checkpoint.storage)
    ) {
      return null;
    }
    const conversations = checkpoint.cookies.filter(isExactChatwootConversationCookie);
    const identities = checkpoint.cookies.filter(isExactChatwootIdentityCookie);
    const ownership = checkpoint.storage.local.filter(isExactChatwootOwnershipStorage);
    const unexpectedChatwootCookies = checkpoint.cookies.filter((cookie) => (
      isRecord(cookie)
      && typeof cookie.name === "string"
      && cookie.name.startsWith("cw_")
      && !isExactChatwootConversationCookie(cookie)
      && !isExactChatwootIdentityCookie(cookie)
    ));
    if (
      conversations.length !== 1
      || identities.length > 1
      || ownership.length !== 1
      || unexpectedChatwootCookies.length !== 0
    ) {
      return null;
    }
    conversationDigests.push(conversations[0]!.value);
    ownershipDigests.push(ownership[0]!.value);
    identityCookies.push(identities[0] ?? null);
    presence.push(identities.length === 1);
  }

  if (
    conversationDigests[0]!.sha256 !== conversationDigests[1]!.sha256
    || ownershipDigests[0]!.sha256 !== ownershipDigests[1]!.sha256
    || conversationDigests[0]!.bytes !== conversationDigests[1]!.bytes
    || ownershipDigests[0]!.bytes !== ownershipDigests[1]!.bytes
    || new Set(identityCookies.flatMap((cookie) => cookie ? [cookie.name] : [])).size > 1
  ) {
    return null;
  }
  return {
    conversationBytes: conversationDigests[0]!.bytes,
    conversationDigests,
    identityCookies,
    ownershipBytes: ownershipDigests[0]!.bytes,
    ownershipDigests,
    presence,
  };
}

function isExactChatwootConversationCookie(value: unknown): value is {
  value: { bytes: number; sha256: string };
} {
  return isRecord(value)
    && hasExactKeys(value, ["domain", "httpOnly", "name", "path", "sameSite", "secure", "value"])
    && value.name === "cw_conversation"
    && value.domain === "<app-host>"
    && value.path === "/"
    && value.httpOnly === false
    && value.secure === true
    && value.sameSite === "Lax"
    && isDigest(value.value)
    && value.value.bytes === 25;
}

function isExactChatwootIdentityCookie(
  value: unknown,
): value is Record<string, unknown> & {
  name: string;
  value: { bytes: number; sha256: string };
} {
  return isRecord(value)
    && hasExactKeys(value, ["domain", "httpOnly", "name", "path", "sameSite", "secure", "value"])
    && typeof value.name === "string"
    && /^cw_user_[a-f0-9]{64}$/.test(value.name)
    && value.domain === "<app-host>"
    && value.path === "/"
    && value.httpOnly === false
    && value.secure === true
    && value.sameSite === "Lax"
    && isDigest(value.value)
    && value.value.bytes === 23;
}

function isExactChatwootOwnershipStorage(value: unknown): value is {
  value: { bytes: number; sha256: string };
} {
  return isRecord(value)
    && hasExactKeys(value, ["key", "value"])
    && value.key === "clean-pay:chatwoot-ownership:v1"
    && isDigest(value.value)
    && value.value.bytes >= 80
    && value.value.bytes <= 96;
}

type PwaCacheLocation = {
  key: string;
  values: unknown[];
  index: number;
};

function exactPwaShellCacheLocations(
  manifest: Record<string, unknown>,
): PwaCacheLocation[] | null {
  if (!Array.isArray(manifest.checkpoints)) return null;
  const locations: PwaCacheLocation[] = [];
  for (const [checkpointIndex, checkpoint] of manifest.checkpoints.entries()) {
    if (!isRecord(checkpoint) || !isExactCheckpointStorage(checkpoint.storage)) return null;
    const cacheNames = checkpoint.storage.cacheNames;
    const serviceWorkerScopes = checkpoint.storage.serviceWorkerScopes;
    if (cacheNames.length > 1) return null;
    if (
      cacheNames.length === 0
        ? serviceWorkerScopes.length !== 0
        : (
          serviceWorkerScopes.length > 1
          || (
            serviceWorkerScopes.length === 1
            && !isExactRootServiceWorkerScope(serviceWorkerScopes[0])
          )
        )
    ) {
      return null;
    }
    if (cacheNames.length === 1) {
      locations.push({
        key: `checkpoint:${checkpointIndex}`,
        values: cacheNames,
        index: 0,
      });
    }
  }

  if (manifest.journey !== "public-responsive-keyboard-install-offline-support") {
    return locations.length > 0 ? locations : null;
  }
  if (!Array.isArray(manifest.boundaries) || locations.length !== 2) return null;
  const pwaBoundaries = manifest.boundaries.filter((entry) => (
    isRecord(entry) && entry.label === "pwa-service-worker-offline"
  ));
  if (pwaBoundaries.length !== 1) return null;
  const boundary = pwaBoundaries[0] as Record<string, unknown>;
  if (!isExactPwaBoundary(boundary)) return null;
  locations.push({
    key: "boundary:pwa-service-worker-offline:online",
    values: boundary.value.online.cacheNames,
    index: 0,
  });
  return locations;
}

function allLocationsMatch(
  locations: PwaCacheLocation[],
  predicate: (value: unknown) => boolean,
) {
  const values = locations.map(({ values, index }) => values[index]);
  return values.every(predicate) && new Set(values).size === 1;
}

function projectPwaLocations(locations: PwaCacheLocation[]) {
  for (const location of locations) {
    location.values[location.index] = PROJECTED_PWA_SHELL_CACHE;
  }
}

function isExactCheckpointStorage(value: unknown): value is Record<string, unknown> & {
  cacheNames: unknown[];
  local: unknown[];
  serviceWorkerScopes: unknown[];
} {
  return isRecord(value)
    && hasExactKeys(value, ["cacheNames", "local", "serviceWorkerScopes", "session"])
    && Array.isArray(value.cacheNames)
    && Array.isArray(value.local)
    && Array.isArray(value.session)
    && Array.isArray(value.serviceWorkerScopes);
}

function exactOptionalServiceWorkerCheckpointStates(
  manifest: Record<string, unknown>,
  cacheNameMatches: (value: string) => boolean,
) {
  if (!Array.isArray(manifest.checkpoints)) return null;
  const locations: Array<{
    cacheNames: unknown[];
    key: string;
    serviceWorkerScopes: unknown[];
  }> = [];
  for (const [index, checkpoint] of manifest.checkpoints.entries()) {
    if (!isRecord(checkpoint) || !isExactCheckpointStorage(checkpoint.storage)) {
      return null;
    }
    const { cacheNames, serviceWorkerScopes } = checkpoint.storage;
    if (cacheNames.length === 0 && serviceWorkerScopes.length === 0) {
      locations.push({ cacheNames, key: `checkpoint:${index}`, serviceWorkerScopes });
      continue;
    }
    if (
      cacheNames.length !== 1
      || serviceWorkerScopes.length !== 1
      || typeof cacheNames[0] !== "string"
      || !cacheNameMatches(cacheNames[0])
      || !isExactRootServiceWorkerScope(serviceWorkerScopes[0])
    ) {
      return null;
    }
    locations.push({ cacheNames, key: `checkpoint:${index}`, serviceWorkerScopes });
  }
  return locations;
}

function isExactRootServiceWorkerScope(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["fragment", "origin", "pathname", "query"])
    && value.origin === "<app-origin>"
    && value.pathname === "/"
    && Array.isArray(value.query)
    && value.query.length === 0
    && value.fragment === null;
}

function isExactPwaBoundary(value: Record<string, unknown>): value is Record<string, unknown> & {
  value: {
    online: { cacheNames: unknown[] };
  };
} {
  if (
    !hasExactKeys(value, ["label", "value"])
    || value.label !== "pwa-service-worker-offline"
    || !isRecord(value.value)
    || !hasExactKeys(value.value, ["offline", "online", "reason", "registrationMode"])
    || value.value.registrationMode !== "playwright-explicit-production-sw"
    || value.value.reason !== "pristine-static-csp-blocks-install-page-hydration"
    || !isRecord(value.value.online)
    || !hasExactKeys(value.value.online, ["cacheNames", "scopePath", "scriptPath"])
    || value.value.online.scriptPath !== "/sw.js"
    || value.value.online.scopePath !== "/"
    || !Array.isArray(value.value.online.cacheNames)
    || value.value.online.cacheNames.length !== 1
    || !isRecord(value.value.offline)
    || !hasExactKeys(value.value.offline, ["controlled", "pathname", "queryKeys"])
    || value.value.offline.controlled !== true
    || value.value.offline.pathname !== "/offline"
    || !Array.isArray(value.value.offline.queryKeys)
    || !sameJson(value.value.offline.queryKeys, ["journey_offline"])
  ) {
    return false;
  }
  return true;
}

function projectSyntheticResetScope(value: unknown) {
  if (!isRecord(value) || !isRecord(value.database)) return;
  const database = value.database;
  if (
    !hasExactKeys(database, [
      "redis",
      "resetSequence",
      "schemaSha256",
      "sequenceCount",
      "scopeContract",
      "scopeSha256",
      "status",
      "tableCount",
      "transaction",
    ])
    || database.status !== "reset"
    || database.scopeContract !== "exact-compose-project-label"
    || typeof database.scopeSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(database.scopeSha256)
    || typeof database.schemaSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(database.schemaSha256)
    || !Number.isSafeInteger(database.tableCount)
    || Number(database.tableCount) <= 0
    || database.sequenceCount !== 0
    || !Number.isSafeInteger(database.resetSequence)
    || Number(database.resetSequence) <= 0
    || database.transaction
      !== "truncate-public-application-tables-cascade-no-sequences"
    || database.redis !== "flush-owned-db-0"
  ) {
    return;
  }
  database.scopeSha256 = "<exact-compose-project-label-sha256>";
}

class DynamicReferences {
  readonly #values = new Map<string, string>();
  #sequence = 0;

  symbol(format: string, digest: string) {
    const key = `${format}:${digest}`;
    const existing = this.#values.get(key);
    if (existing) return existing;
    const value = `<dynamic:${format}:${++this.#sequence}>`;
    this.#values.set(key, value);
    return value;
  }
}

function isExactJourneyManifest(manifest: Record<string, unknown>) {
  const source = manifest.source;
  return manifest.schemaVersion === 2
    && manifest.baselineCommit === BASELINE_COMMIT
    && typeof manifest.project === "string"
    && /^journey-(?:390x844|768x1024|1440x900)$/.test(manifest.project)
    && typeof manifest.journey === "string"
    && JOURNEYS.has(manifest.journey)
    && isRecord(source)
    && isRecord(source.fixtureContract)
    && source.fixtureContract.version === "journey-v5"
    && typeof source.fixtureContract.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(source.fixtureContract.sha256);
}

function projectProviderLedger(value: unknown, references: DynamicReferences) {
  if (!isRecord(value) || !Array.isArray(value.entries)) return;
  for (const entryValue of value.entries) {
    if (!isRecord(entryValue) || !isExactLedgerEnvelope(entryValue)) continue;
    const bodyContract = entryValue.body_contract;
    if (hasValidDynamicContract(bodyContract)) {
      projectDynamicContracts(bodyContract, references);
      entryValue.body_sha256 = "<derived-from-redacted-body-contract>";
    }
    const idempotencyContract = entryValue.idempotency_key_contract;
    if (
      entryValue.idempotency_key_present === true
      && isDynamicContract(idempotencyContract)
      && idempotencyContract.format === "idempotency-key"
      && typeof entryValue.idempotency_key_sha256 === "string"
      && entryValue.idempotency_key_sha256 === idempotencyContract.sha256
    ) {
      const symbol = references.symbol(
        idempotencyContract.format,
        idempotencyContract.sha256,
      );
      idempotencyContract.sha256 = symbol;
      entryValue.idempotency_key_sha256 = symbol;
    }
  }
}

function isExactLedgerEnvelope(entry: Record<string, unknown>) {
  return hasExactKeys(entry, [
    "body_bytes",
    "body_contract",
    "body_sha256",
    "credential_contract",
    "effect",
    "idempotency_key_contract",
    "idempotency_key_present",
    "idempotency_key_sha256",
    "method",
    "pathname",
    "query_keys",
    "sequence",
    "service",
  ])
    && Number.isSafeInteger(entry.sequence)
    && typeof entry.service === "string"
    && typeof entry.method === "string"
    && typeof entry.pathname === "string"
    && Array.isArray(entry.query_keys)
    && entry.query_keys.every((key) => typeof key === "string")
    && Number.isSafeInteger(entry.body_bytes)
    && typeof entry.body_sha256 === "string"
    && /^[a-f0-9]{64}$/.test(entry.body_sha256)
    && typeof entry.idempotency_key_present === "boolean"
    && (entry.idempotency_key_sha256 === null
      || (typeof entry.idempotency_key_sha256 === "string"
        && /^[a-f0-9]{64}$/.test(entry.idempotency_key_sha256)))
    && isCredentialContract(entry.credential_contract)
    && typeof entry.effect === "string";
}

function isCredentialContract(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["authorization_scheme", "cookie_names", "header_names"])
    && (value.authorization_scheme === null
      || value.authorization_scheme === "Bearer"
      || value.authorization_scheme === "Basic")
    && Array.isArray(value.cookie_names)
    && value.cookie_names.every((name) => typeof name === "string" && /^[A-Za-z0-9_.-]+$/.test(name))
    && Array.isArray(value.header_names)
    && value.header_names.every((name) => [
      "authorization", "x-api-key", "x-auth-token", "x-remnashop-auth-service-key",
    ].includes(String(name)));
}

function projectBoundaryCookies(value: unknown, references: DynamicReferences) {
  if (!Array.isArray(value)) return;
  const lifecycle = value.find((entry) => (
    isRecord(entry) && entry.label === "telegram-oidc-cookie-lifecycle"
  ));
  if (!isRecord(lifecycle) || !isRecord(lifecycle.value)) return;
  const contract = lifecycle.value;
  if (!Array.isArray(contract.preCallback) || !isRecord(contract.final)) return;
  const receipt = contract.final.callbackReceipt;
  const cookies = [...contract.preCallback, receipt];
  for (const cookie of cookies) {
    if (!isBoundaryCookie(cookie)) return;
  }
  for (const cookie of cookies) {
    const record = cookie as Record<string, unknown>;
    record.valueSha256 = references.symbol(
      `cookie-${String(record.name)}`,
      String(record.valueSha256),
    );
    (record.expiry as Record<string, unknown>).epochSeconds = "<bounded-cookie-expiry>";
  }
}

function isBoundaryCookie(value: unknown) {
  if (!isRecord(value) || !isRecord(value.expiry)) return false;
  return hasExactKeys(value, [
    "domain", "expiry", "httpOnly", "name", "path", "sameSite", "secure",
    "valueBytes", "valueSha256",
  ])
    && typeof value.name === "string"
    && DYNAMIC_COOKIE_NAMES.has(value.name)
    && value.domain === "pay.ci.clean-pay.dev"
    && ["/", "/auth/telegram/callback"].includes(String(value.path))
    && value.httpOnly === true
    && value.secure === true
    && value.sameSite === "Lax"
    && Number.isSafeInteger(value.valueBytes)
    && Number(value.valueBytes) >= 16
    && Number(value.valueBytes) <= 4096
    && typeof value.valueSha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.valueSha256)
    && hasExactKeys(value.expiry, ["boundedSeconds", "epochSeconds"])
    && ["1700..1950", "60..150"].includes(String(value.expiry.boundedSeconds))
    && typeof value.expiry.epochSeconds === "number"
    && Number.isFinite(value.expiry.epochSeconds)
    && value.expiry.epochSeconds > 0;
}

function hasValidDynamicContract(value: unknown) {
  let found = false;
  let valid = true;
  visit(value, (candidate) => {
    if (!isRecord(candidate) || candidate.kind !== "dynamic") return;
    found = true;
    valid &&= isDynamicContract(candidate);
  });
  return found && valid;
}

function projectDynamicContracts(value: unknown, references: DynamicReferences) {
  visit(value, (candidate) => {
    if (!isDynamicContract(candidate)) return;
    candidate.sha256 = references.symbol(candidate.format, candidate.sha256);
  });
}

function isDynamicContract(value: unknown): value is Record<string, unknown> & {
  format: string;
  sha256: string;
} {
  return isRecord(value)
    && hasExactKeys(value, ["bytes", "format", "kind", "sha256"])
    && value.kind === "dynamic"
    && typeof value.format === "string"
    && /^[a-z][a-z0-9-]{0,40}$/.test(value.format)
    && Number.isSafeInteger(value.bytes)
    && (value.bytes as number) > 0
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function projectServerActions(value: unknown, references: DynamicReferences) {
  if (!isRecord(value) || !Array.isArray(value.requests) || !Array.isArray(value.serverActions)) {
    return;
  }
  if (value.serverActionCount !== value.serverActions.length) return;
  for (const [order, actionValue] of value.serverActions.entries()) {
    if (!isRecord(actionValue) || actionValue.order !== order) return;
    const requestIndex = actionValue.requestIndex;
    if (!Number.isSafeInteger(requestIndex)) return;
    const request = value.requests[requestIndex as number];
    if (!isRecord(request) || request.index !== requestIndex || !isRecord(request.serverAction)) return;
    if (
      request.scope !== "application"
      || request.method !== "POST"
      || request.resourceType !== "fetch"
      || request.navigation !== false
      || request.serverAction.present !== true
      || !sameJson(request.serverAction.identifier, actionValue.identifier)
      || !sameJson(request.postData, actionValue.payload)
      || !isDigest(request.serverAction.identifier)
      || !isDigest(request.postData)
      || !exactNextActionHeader(request.requestHeaders, request.serverAction.identifier)
    ) {
      return;
    }
  }

  const actionIds = new Map<string, string>();
  const payloads = new Map<string, string>();
  for (const actionValue of value.serverActions) {
    const action = actionValue as Record<string, unknown>;
    const request = value.requests[action.requestIndex as number] as Record<string, unknown>;
    const identifier = action.identifier as Record<string, unknown>;
    const payload = action.payload as Record<string, unknown>;
    const nextActionHeader = exactNextActionHeader(request.requestHeaders, identifier);
    if (!nextActionHeader) return;
    const idSymbol = sequenceSymbol(actionIds, "server-action-id", identifier.sha256 as string);
    const payloadSymbol = sequenceSymbol(payloads, "server-action-payload", payload.sha256 as string);
    identifier.sha256 = idSymbol;
    payload.sha256 = payloadSymbol;
    (request.serverAction as Record<string, unknown>).identifier = { ...identifier };
    request.postData = { ...payload };
    nextActionHeader.value = { ...identifier };
  }

  function sequenceSymbol(values: Map<string, string>, format: string, digest: string) {
    const existing = values.get(digest);
    if (existing) return existing;
    const symbol = references.symbol(format, digest);
    values.set(digest, symbol);
    return symbol;
  }
}

function exactNextActionHeader(
  value: unknown,
  identifier: unknown,
): (Record<string, unknown> & { value: unknown }) | null {
  if (!Array.isArray(value) || !isDigest(identifier)) return null;
  const matches = value.filter((header) => (
    isRecord(header) && header.name === "next-action"
  ));
  if (matches.length !== 1) return null;
  const header = matches[0];
  return isRecord(header)
    && hasExactKeys(header, ["name", "value"])
    && isDigest(header.value)
    && sameJson(header.value, identifier)
    ? header as Record<string, unknown> & { value: unknown }
    : null;
}

function projectCheckpointCookies(value: unknown, references: DynamicReferences) {
  if (!Array.isArray(value)) return;
  for (const checkpoint of value) {
    if (!isRecord(checkpoint) || !Array.isArray(checkpoint.cookies)) continue;
    for (const cookie of checkpoint.cookies) {
      if (!isExactDynamicCookie(cookie)) continue;
      cookie.value.sha256 = references.symbol(`cookie-${cookie.name}`, cookie.value.sha256);
    }
  }
}

function isExactDynamicCookie(value: unknown): value is Record<string, unknown> & {
  name: string;
  value: { bytes: number; sha256: string };
} {
  return isRecord(value)
    && hasExactKeys(value, ["domain", "httpOnly", "name", "path", "sameSite", "secure", "value"])
    && typeof value.name === "string"
    && DYNAMIC_COOKIE_NAMES.has(value.name)
    && value.domain === "<app-host>"
    && (value.name === "clean_pay_tg_callback_receipt"
      ? value.path === "/auth/telegram/callback" && value.httpOnly === true && value.sameSite === "Lax"
      : value.path === "/")
    && value.secure === true
    && typeof value.httpOnly === "boolean"
    && ["Lax", "Strict", "None"].includes(String(value.sameSite))
    && isDigest(value.value)
    && value.value.bytes >= 16
    && value.value.bytes <= 4096;
}

function projectCanonicalUrls(manifest: Record<string, unknown>, references: DynamicReferences) {
  visit(manifest, (value) => {
    if (!isCanonicalUrl(value)) return;
    const segments = value.pathname.split("/");
    value.pathname = segments.map((segment) => {
      if (!CUID.test(segment)) return segment;
      return references.symbol("cuid", sha256(segment));
    }).join("/");

    for (const queryValue of value.query) {
      if (!isRecord(queryValue) || typeof queryValue.key !== "string") continue;
      if (
        !["code", "operation_id", "state", "return_to", "redirect_to"].includes(queryValue.key)
        || typeof queryValue.value !== "string"
        || !SHORT_DIGEST.test(queryValue.value)
      ) {
        continue;
      }
      queryValue.value = references.symbol(
        `query-${queryValue.key}`,
        queryValue.value.slice(8, -1),
      );
    }
  });
}

function isCanonicalUrl(value: Record<string, unknown>): value is Record<string, unknown> & {
  pathname: string;
  query: unknown[];
} {
  return hasExactKeys(value, ["fragment", "origin", "pathname", "query"])
    && typeof value.origin === "string"
    && typeof value.pathname === "string"
    && Array.isArray(value.query)
    && (value.fragment === null || typeof value.fragment === "string");
}

function isDigest(value: unknown): value is { bytes: number; sha256: string } {
  return isRecord(value)
    && hasExactKeys(value, ["bytes", "sha256"])
    && Number.isSafeInteger(value.bytes)
    && (value.bytes as number) >= 0
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function visit(value: unknown, callback: (value: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, callback);
    return;
  }
  if (!isRecord(value)) return;
  callback(value);
  for (const entry of Object.values(value)) visit(entry, callback);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === keys[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
