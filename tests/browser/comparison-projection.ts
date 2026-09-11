import { projectPairedJourneyInlineStyles } from "./journey-inline-style-pair.mjs";
import { projectAllowlistedA11ySemantics } from "./a11y-semantic-projection";
import {
  projectExactAuthenticatedChatwootGeneratedPair,
  projectExactMergeChatwootGeneratedPair,
  projectExactJourneyGeneratedValues,
  projectExactJourneyPwaShellCachePair,
  projectExactOptionalJourneyServiceWorkerStatePair,
} from "./journey-comparison-projection";
import { projectExactJourneyKeyboardSkipLink } from "./journeys/journey-skip-link-policy";
import {
  PINNED_JOURNEY_V5_FIXTURE_SHA256,
  currentJourneyFixtureContractSha256,
} from "./journeys/journey-fixture-contract";
import { digestValue } from "./redaction";

const IMMUTABLE_PUBLIC_BASELINE_APPLICATION_ORIGIN = "http://127.0.0.1:4000";
const VALIDATED_LOCAL_APPLICATION_HOST = "<validated-local-application-host>";

const DIGEST_OF_ONE = {
  bytes: 1,
  sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
} as const;

const NET_ERR_ABORTED = {
  bytes: 16,
  sha256: "7ba7a1709a2d7d220e120c927e0a7e90adf45c88b09ba912b237d705090d1d4e",
} as const;

const EXACT_CONCURRENT_CABINET_READ_ORDER = [
  "profile",
  "referral-program",
  "subscription",
  "offers",
  "devices",
  "remnawave-user",
] as const;

const CSP_REQUEST_FAILURE = {
  bytes: 3,
  sha256: "438ced67d76cf3c3bf3e9781a9640ab685b2c877f7cc93b6758cc641efd51bc6",
} as const;

const OFFLINE_RESOURCE_FAILURE = {
  bytes: 30,
  sha256: "4b47ef4954a96234348ce9b1a492377dca3fd6bb69b657049ce6cf31071e69a3",
} as const;

const NEXT_JS_POWERED_BY = {
  bytes: 7,
  sha256: "30b7f8482c4f570c063e4dff04b91ddc9b2b5f535ac70fedffb1cf34e0d23ec6",
} as const;

const WINDOWS_CHROMIUM_TRANSPORT_IDENTITY = {
  "sec-ch-ua-platform": {
    bytes: 9,
    sha256: "0b1d1e9a36456a50dec652d22d95df7908422c429f91c65e9906ce500aaa2d8b",
  },
  "user-agent": {
    bytes: 123,
    sha256: "3caf269ff15e9469bb7f47985b75b52aa4c2fd24dbe3118b40ca31edb48c9178",
  },
} as const;

const LINUX_CHROMIUM_TRANSPORT_IDENTITY = {
  "sec-ch-ua-platform": {
    bytes: 7,
    sha256: "1ca133af50fd8cbddcc9d46be6688e37475554a0232ccd9fa0d0c7a2dee2c05a",
  },
  "user-agent": {
    bytes: 113,
    sha256: "0f34eb7ad038e5b57298b9e4dad50c722158f41844142c1e5b6ce6140cbfba26",
  },
} as const;

const CHROMIUM_TRANSPORT_IDENTITY_HEADER_NAMES = [
  "sec-ch-ua-platform",
  "user-agent",
] as const;

const STATIC_CHUNK_PATH = /^\/_next\/static\/chunks\/(?:turbopack-)?(?=[A-Za-z0-9_-]{8,}\.(?:css|js)$)(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+\.(?:css|js)$/;
const STATIC_MEDIA_PATH = /^\/_next\/static\/media\/[A-Za-z0-9._-]+\.(?=[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$)(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp|woff2)$/;
const EXACT_PWA_SHELL_CACHE_NAME = /^clean-pay-shell-(?:[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
/**
 * Projects only explicitly classified browser noise out of a raw manifest.
 * The raw artifact remains the evidence file; this copy is used exclusively
 * for the immutable equality gate.
 */
export function projectCharacterizationManifestForComparison(value: unknown) {
  const projected = cloneJson(value);
  if (!isRecord(projected)) return projected;

  projectExactJourneyGeneratedValues(projected);
  projectJourneySourceProvenance(projected);
  projectConsecutiveDuplicateNavigations(projected);
  projectExactJourneyKeyboardSkipLink(projected);
  projectJourneyCheckpointA11y(projected);
  projectJourneyPaymentOperationAria(projected);
  projectJourneyProviderReadinessNoise(projected);
  projectJourneyOfflineFallbackConsole(projected);
  projectAllowlistedA11ySemantics(projected);
  projectStaticDomAssetReferences(projected);
  projectNetwork(projected);
  return projected;
}

/**
 * Applies exceptions that require evidence from both raw sides. Local Host
 * digests are projected only after each side proves its pinned/runtime origin;
 * the one-directional X-Powered-By exception applies only to its exact removal.
 * Every other header value, direction, duplicate, order, or adjacent difference
 * remains observable.
 */
export function projectCharacterizationManifestPairForComparison(
  expectedValue: unknown,
  actualValue: unknown,
  options: {
    actualApplicationOrigin?: string;
    expectedApplicationOrigin?: string;
  } = {},
) {
  const fixtureContractPairIsValid = isExactJourneyFixtureContractPair(
    expectedValue,
    actualValue,
  );
  const expectedPrepared = cloneJson(expectedValue);
  const actualPrepared = cloneJson(actualValue);
  projectExactChromiumTransportIdentityPair(
    expectedPrepared,
    actualPrepared,
    fixtureContractPairIsValid,
  );
  if (
    fixtureContractPairIsValid
    && isRecord(expectedPrepared)
    && isRecord(actualPrepared)
  ) {
    projectExactAuthenticatedChatwootGeneratedPair(expectedPrepared, actualPrepared);
    projectExactAuthenticatedChatwootBoundaryRetryPair(expectedPrepared, actualPrepared);
    projectExactJourneyPwaShellCachePair(expectedPrepared, actualPrepared);
    projectExactOptionalJourneyServiceWorkerStatePair(expectedPrepared, actualPrepared);
    projectExactMergeChatwootGeneratedPair(expectedPrepared, actualPrepared);
    projectExactAuthenticatedPassiveNetworkPair(expectedPrepared, actualPrepared);
  }
  const expected = projectCharacterizationManifestForComparison(expectedPrepared);
  const actual = projectCharacterizationManifestForComparison(actualPrepared);
  if (
    fixtureContractPairIsValid
    && isRecord(expected)
    && isRecord(actual)
  ) {
    projectExactJourneyPwaShellCachePair(expected, actual);
    projectExactAuthenticatedCheckpointPwaShellCachePair(expected, actual);
    projectExactAuthenticatedSyntheticResetLedgerPair(expected, actual);
    projectExactAuthenticatedChatwootGeneratedPair(expected, actual);
    projectExactMergeChatwootGeneratedPair(expected, actual);
  }
  if (fixtureContractPairIsValid) {
    projectPairedJourneyInlineStyles(expected, actual);
  }
  if (
    fixtureContractPairIsValid
    && isRecord(expected)
    && isRecord(actual)
  ) {
    projectExactConcurrentCabinetReadPair(expected, actual);
    projectExactPassiveProviderEffectOrderPair(expected, actual);
    projectExactTelegramAuthProviderDynamicPair(expected, actual);
    projectExactPasskeySetupPayloadPair(expected, actual);
    projectExactTelegramLoginPayloadBytesPair(expected, actual);
    projectExactActiveServerActionDynamicDigestPair(expected, actual);
    projectExactPassiveProviderEffectMultiplicityPair(expected, actual);
    projectExactAuthenticatedBrowserNoisePair(expected, actual);
  }
  projectExactLocalApplicationHostPair(
    expected,
    actual,
    options.expectedApplicationOrigin,
    options.actualApplicationOrigin,
  );
  projectExactOptionalPublicStaticOriginPair(expected, actual);
  projectExactHashedNextStaticTopologyPair(
    expected,
    actual,
    fixtureContractPairIsValid,
  );
  if (
    fixtureContractPairIsValid
    && isRecord(expected)
    && isRecord(actual)
  ) {
    projectExactHashedStaticDocumentLinkPair(expected, actual);
    projectExactProjectedAuthenticatedPassiveNetworkPair(expected, actual);
  }
  if (
    fixtureContractPairIsValid
    && isRecord(expected)
    && isRecord(actual)
  ) {
    projectExactAuthenticatedPassiveNetworkPair(expected, actual);
  }
  projectExactRemovedNextJsPoweredBy(expected, actual);
  if (isRecord(expected) && isRecord(actual)) {
    projectExactHashedStaticDocumentLinkPair(expected, actual);
  }
  projectExactRemovedNextJsPoweredBy(expected, actual);
  projectExactOptionalZeroContentLengthPair(expected, actual);
  if (fixtureContractPairIsValid) {
    projectExactJourneyFixtureContract(expected, actual);
  }
  return { expected, actual };
}

function projectExactAuthenticatedChatwootBoundaryRetryPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || expected.project !== actual.project
    || expected.journey !== "telegram-oidc-cabinet-profile-link-referral-passkey"
    || actual.journey !== expected.journey
  ) {
    return;
  }
  const expectedBoundary = exactAuthenticatedChatwootBoundaryRetry(expected);
  const actualBoundary = exactAuthenticatedChatwootBoundaryRetry(actual);
  if (
    !expectedBoundary
    || !actualBoundary
    || !sameJson(expectedBoundary.canonical, actualBoundary.canonical)
  ) {
    return;
  }
  expectedBoundary.boundary.value = structuredClone(expectedBoundary.canonical);
  actualBoundary.boundary.value = structuredClone(actualBoundary.canonical);
}

function exactAuthenticatedChatwootBoundaryRetry(manifest: Record<string, unknown>) {
  if (!Array.isArray(manifest.boundaries)) return null;
  const matches = manifest.boundaries.filter((value) => (
    isRecord(value)
    && hasExactKeys(value, ["label", "value"])
    && value.label === "chatwoot-authenticated"
  ));
  if (matches.length !== 1) return null;
  const boundary = matches[0]!;
  if (!Array.isArray(boundary.value)) return null;
  const calls = boundary.value;
  const run = calls[0];
  const setUser = calls[2];
  if (
    !isRecord(run)
    || !hasExactKeys(run, ["baseUrl", "method", "websiteTokenBytes"])
    || run.method !== "run"
    || run.baseUrl !== "https://chatwoot.browser.clean-pay.dev"
    || run.websiteTokenBytes !== 64
    || !isRecord(setUser)
    || !hasExactKeys(setUser, ["attributeKeys", "identifierBytes", "method"])
    || setUser.method !== "setUser"
    || setUser.identifierBytes !== 25
    || !sameJson(setUser.attributeKeys, [
      "custom_attributes", "email", "identifier_hash", "name",
    ])
  ) {
    return null;
  }
  const hide = { method: "toggleBubbleVisibility", value: "hide" };
  const show = { method: "toggleBubbleVisibility", value: "show" };
  const frameLoaded = { method: "frame.loaded" };
  const removeLabel = { method: "removeLabel", label: "subscription_expired" };
  const identityConfirmed = { method: "identity.confirmed" };
  const canonical = [run, hide, setUser, frameLoaded, show, removeLabel, identityConfirmed];
  const retried = [
    run,
    hide,
    setUser,
    frameLoaded,
    show,
    show,
    setUser,
    frameLoaded,
    show,
    removeLabel,
    identityConfirmed,
  ];
  if (!sameJson(calls, canonical) && !sameJson(calls, retried)) return null;
  return { boundary, canonical };
}

function projectExactHashedNextStaticTopologyPair(
  expected: unknown,
  actual: unknown,
  fixtureContractPairIsValid: boolean,
) {
  if (
    !fixtureContractPairIsValid
    || !isRecord(expected)
    || !isRecord(actual)
    || !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isRecord(expected.network)
    || !isRecord(actual.network)
    || !Array.isArray(expected.network.requests)
    || !Array.isArray(actual.network.requests)
  ) {
    return;
  }
  if (sameJson(expected, actual)) return;

  const expectedTrial = cloneJson(expected);
  const actualTrial = cloneJson(actual);
  if (!isRecord(expectedTrial) || !isRecord(actualTrial)) return;
  const expectedCollapsed = collapseExactProjectedNextStaticTopology(expectedTrial);
  const actualCollapsed = collapseExactProjectedNextStaticTopology(actualTrial);
  const pairCollapsed = collapseExactProjectedNextStaticTopologyPair(
    expectedTrial,
    actualTrial,
  );
  if (
    expectedCollapsed !== null
    && actualCollapsed !== null
    && pairCollapsed !== null
    && (
      expectedCollapsed === true
      || actualCollapsed === true
      || pairCollapsed === true
    )
  ) {
    projectExactHashedStaticDocumentLinkPair(expectedTrial, actualTrial);
    projectExactRemovedNextJsPoweredBy(expectedTrial, actualTrial);
    projectExactJourneyFixtureContract(expectedTrial, actualTrial);
    if (sameJson(expectedTrial, actualTrial)) {
      expected.network = expectedTrial.network;
      actual.network = actualTrial.network;
      return;
    }
  }

  const expectedStaticRemovedTrial = cloneJson(expected);
  const actualStaticRemovedTrial = cloneJson(actual);
  if (!isRecord(expectedStaticRemovedTrial) || !isRecord(actualStaticRemovedTrial)) return;
  const expectedStaticRemoved = removeExactProjectedNextStaticResources(
    expectedStaticRemovedTrial,
  );
  const actualStaticRemoved = removeExactProjectedNextStaticResources(
    actualStaticRemovedTrial,
  );
  if (
    expectedStaticRemoved !== true
    && actualStaticRemoved !== true
  ) {
    return;
  }
  if (expectedStaticRemoved === null || actualStaticRemoved === null) return;

  projectExactAuthenticatedChatwootGeneratedPair(
    expectedStaticRemovedTrial,
    actualStaticRemovedTrial,
  );
  projectExactMergeChatwootGeneratedPair(
    expectedStaticRemovedTrial,
    actualStaticRemovedTrial,
  );
  projectExactHashedStaticDocumentLinkPair(
    expectedStaticRemovedTrial,
    actualStaticRemovedTrial,
  );
  projectExactRemovedNextJsPoweredBy(expectedStaticRemovedTrial, actualStaticRemovedTrial);
  projectExactJourneyFixtureContract(expectedStaticRemovedTrial, actualStaticRemovedTrial);
  if (!sameJson(expectedStaticRemovedTrial, actualStaticRemovedTrial)) return;

  expected.network = expectedStaticRemovedTrial.network;
  actual.network = actualStaticRemovedTrial.network;
}

function projectExactAuthenticatedPassiveNetworkPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
  ) {
    return;
  }

  const expectedTrial = cloneJson(expected);
  const actualTrial = cloneJson(actual);
  if (!isRecord(expectedTrial) || !isRecord(actualTrial)) return;
  const expectedChanged = removeExactAuthenticatedPassiveNetworkRequests(expectedTrial);
  const actualChanged = removeExactAuthenticatedPassiveNetworkRequests(actualTrial);
  if (!expectedChanged && !actualChanged) {
    return;
  }

  const expectedProjectedTrial = projectCharacterizationManifestForComparison(expectedTrial);
  const actualProjectedTrial = projectCharacterizationManifestForComparison(actualTrial);
  if (!isRecord(expectedProjectedTrial) || !isRecord(actualProjectedTrial)) return;
  projectExactConcurrentCabinetReadPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactPassiveProviderEffectOrderPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactTelegramAuthProviderDynamicPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactPasskeySetupPayloadPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactTelegramLoginPayloadBytesPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactActiveServerActionDynamicDigestPair(
    expectedProjectedTrial,
    actualProjectedTrial,
  );
  projectExactServerActionDynamicDigestPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactHashedNextStaticTopologyPair(expectedProjectedTrial, actualProjectedTrial, true);
  projectExactHashedStaticDocumentLinkPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactRemovedNextJsPoweredBy(expectedProjectedTrial, actualProjectedTrial);
  projectExactOptionalZeroContentLengthPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactJourneyFixtureContract(expectedProjectedTrial, actualProjectedTrial);
  projectPairedJourneyInlineStyles(expectedProjectedTrial, actualProjectedTrial);

  if (!sameJson(expectedProjectedTrial, actualProjectedTrial)) {
    return;
  }
  applyExactAuthenticatedPassiveProjection(expected, expectedProjectedTrial);
  applyExactAuthenticatedPassiveProjection(actual, actualProjectedTrial);
}

function projectExactProjectedAuthenticatedPassiveNetworkPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
  ) {
    return;
  }

  const expectedTrial = cloneJson(expected);
  const actualTrial = cloneJson(actual);
  if (!isRecord(expectedTrial) || !isRecord(actualTrial)) return;
  projectExactActiveServerActionDynamicDigestPair(expectedTrial, actualTrial);
  const expectedChanged = removeExactProjectedAuthenticatedPassiveNetworkRequests(expectedTrial);
  const actualChanged = removeExactProjectedAuthenticatedPassiveNetworkRequests(actualTrial);
  const expectedStaticRemoved = removeExactProjectedNextStaticResources(expectedTrial);
  const actualStaticRemoved = removeExactProjectedNextStaticResources(actualTrial);
  if (expectedStaticRemoved === null || actualStaticRemoved === null) return;
  if (
    !expectedChanged
    && !actualChanged
    && expectedStaticRemoved !== true
    && actualStaticRemoved !== true
  ) {
    return;
  }
  removeExactPassiveProviderEffects(expectedTrial);
  removeExactPassiveProviderEffects(actualTrial);

  projectJourneyProviderReadinessNoise(expectedTrial);
  projectJourneyProviderReadinessNoise(actualTrial);
  projectExactJourneyPwaShellCachePair(expectedTrial, actualTrial);
  projectExactAuthenticatedChatwootGeneratedPair(expectedTrial, actualTrial);
  projectExactAuthenticatedCheckpointPwaShellCachePair(expectedTrial, actualTrial);
  projectExactAuthenticatedSyntheticResetLedgerPair(expectedTrial, actualTrial);
  projectExactConcurrentCabinetReadPair(expectedTrial, actualTrial);
  projectExactPassiveProviderEffectOrderPair(expectedTrial, actualTrial);
  projectExactTelegramAuthProviderDynamicPair(expectedTrial, actualTrial);
  projectExactPasskeySetupPayloadPair(expectedTrial, actualTrial);
  projectExactTelegramLoginPayloadBytesPair(expectedTrial, actualTrial);
  projectExactActiveServerActionDynamicDigestPair(expectedTrial, actualTrial);
  projectExactServerActionDynamicDigestPair(expectedTrial, actualTrial);
  projectExactHashedStaticDocumentLinkPair(expectedTrial, actualTrial);
  projectExactRemovedNextJsPoweredBy(expectedTrial, actualTrial);
  projectExactOptionalZeroContentLengthPair(expectedTrial, actualTrial);
  projectExactJourneyFixtureContract(expectedTrial, actualTrial);
  projectPairedJourneyInlineStyles(expectedTrial, actualTrial);

  if (!sameJson(expectedTrial, actualTrial)) return;
  applyExactAuthenticatedPassiveProjection(expected, expectedTrial);
  applyExactAuthenticatedPassiveProjection(actual, actualTrial);
}

function projectExactAuthenticatedCheckpointPwaShellCachePair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
    || !Array.isArray(expected.checkpoints)
    || !Array.isArray(actual.checkpoints)
    || expected.checkpoints.length !== actual.checkpoints.length
  ) {
    return;
  }

  const expectedLocations = exactCheckpointPwaShellCacheLocations(expected.checkpoints);
  const actualLocations = exactCheckpointPwaShellCacheLocations(actual.checkpoints);
  if (
    expectedLocations === null
    || actualLocations === null
    || !sameJson(
      expectedLocations.map(({ key }) => key),
      actualLocations.map(({ key }) => key),
    )
  ) {
    return;
  }

  for (const location of [...expectedLocations, ...actualLocations]) {
    location.cacheNames[location.index] = "<validated:pwa-shell-cache>";
  }
}

function exactCheckpointPwaShellCacheLocations(checkpoints: unknown[]) {
  const locations: Array<{
    cacheNames: unknown[];
    index: number;
    key: string;
  }> = [];
  for (const [checkpointIndex, checkpointValue] of checkpoints.entries()) {
    if (!isRecord(checkpointValue) || typeof checkpointValue.label !== "string") {
      return null;
    }
    const storage = checkpointValue.storage;
    if (
      !isRecord(storage)
      || !hasExactKeys(storage, ["cacheNames", "local", "serviceWorkerScopes", "session"])
      || !Array.isArray(storage.cacheNames)
      || !Array.isArray(storage.local)
      || !Array.isArray(storage.serviceWorkerScopes)
      || !Array.isArray(storage.session)
      || storage.cacheNames.length > 1
    ) {
      return null;
    }
    if (storage.cacheNames.length === 0) {
      if (storage.serviceWorkerScopes.length !== 0) return null;
      continue;
    }
    if (
      typeof storage.cacheNames[0] !== "string"
      || !EXACT_PWA_SHELL_CACHE_NAME.test(storage.cacheNames[0])
      || storage.serviceWorkerScopes.length !== 1
      || !sameJson(storage.serviceWorkerScopes[0], {
        origin: "<app-origin>",
        pathname: "/",
        query: [],
        fragment: null,
      })
    ) {
      return null;
    }
    locations.push({
      cacheNames: storage.cacheNames,
      index: 0,
      key: `${checkpointIndex}:${checkpointValue.label}`,
    });
  }
  return locations.length > 0 ? locations : null;
}

function projectExactAuthenticatedSyntheticResetLedgerPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
    || !isRecord(expected.syntheticReset)
    || !isRecord(actual.syntheticReset)
  ) {
    return;
  }
  const expectedState = expected.syntheticReset.state;
  const actualState = actual.syntheticReset.state;
  if (!isRecord(expectedState) || !isRecord(actualState)) return;

  const expectedComparable = {
    ...expectedState,
    ledger: 0,
    sequence: 0,
  };
  const actualComparable = {
    ...actualState,
    ledger: 0,
    sequence: 0,
  };
  if (
    !sameJson(expectedComparable, actualComparable)
    || !isExactSyntheticProviderResetTick(expectedState)
    || !isExactSyntheticProviderResetTick(actualState)
  ) {
    return;
  }
  expectedState.ledger = "<dynamic:synthetic-reset-ledger>";
  actualState.ledger = "<dynamic:synthetic-reset-ledger>";
  expectedState.sequence = "<dynamic:synthetic-reset-sequence>";
  actualState.sequence = "<dynamic:synthetic-reset-sequence>";
}

function isExactSyntheticProviderResetTick(state: Record<string, unknown>) {
  return (
    (
      state.ledger === 0
      && state.sequence === 0
    )
    || (
      state.ledger === 1
      && state.sequence === 1
    )
  );
}

function removeExactPassiveProviderEffects(manifest: Record<string, unknown>) {
  const providerEffects = manifest.providerEffects;
  if (!isRecord(providerEffects) || !Array.isArray(providerEffects.entries)) return false;

  const retainedEntries: Record<string, unknown>[] = [];
  for (const [index, entryValue] of providerEffects.entries.entries()) {
    if (
      !isRecord(entryValue)
      || entryValue.sequence !== index + 1
    ) {
      return false;
    }
    const comparableEntry = { ...entryValue, sequence: 0 };
    if (isExactPassiveProviderEffect(comparableEntry)) continue;
    retainedEntries.push(entryValue);
  }
  if (retainedEntries.length === providerEffects.entries.length) return false;

  providerEffects.entries = retainedEntries.map((entry, index) => ({
    ...entry,
    sequence: index + 1,
  }));
  return true;
}

function removeExactProjectedAuthenticatedPassiveNetworkRequests(
  manifest: Record<string, unknown>,
) {
  const network = exactProjectedNetwork(manifest);
  if (network === null) return false;

  const removedIndexes = new Set<number>();
  let removedContextualPassiveRequest = false;
  const retainedRequests = network.requests.filter((requestValue) => {
    if (!isRecord(requestValue)) return true;
    const contextualPassive = isExactPwaControlledDocumentRequest(manifest, requestValue)
      || isExactProjectedPassiveRefreshServerActionRequest(manifest, requestValue)
      || isExactAuthenticatedChatwootTransportNoise(manifest, requestValue);
    if (
      isExactProjectedRemovableStaticResource(requestValue)
      || contextualPassive
    ) {
      if (contextualPassive) removedContextualPassiveRequest = true;
      removedIndexes.add(requestValue.index as number);
      return false;
    }
    return true;
  });
  if (!removedContextualPassiveRequest) return false;

  return reindexExactProjectedNetworkWithRemovedActions(
    network,
    retainedRequests,
    removedIndexes,
  );
}

function isExactProjectedPassiveRefreshServerActionRequest(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(manifest)
    || !exactJourneyFixtureContract(manifest)
    || (
      request.failure !== null
      && !isExactResponseBackedAbortFailure(request.failure)
    )
    || !isRecord(request.postData)
    || request.postData.bytes !== 29
    || !isRecord(request.response)
    || request.response.status !== 200
    || !responseHasContentType(request.response, "text/x-component")
    || !isRecord(request.url)
    || ![
      "/cabinet",
      "/extend",
      "/link-account",
      "/payment/fail",
      "/payment/pending",
      "/payment/success",
      "/profile",
      "/referral",
      "/tariffs",
      "/verify-email",
    ].includes(String(request.url.pathname))
  ) {
    return false;
  }

  const network = exactProjectedNetwork(manifest);
  if (network === null) return false;
  const actions = network.serverActions.filter((actionValue) => (
    isRecord(actionValue)
    && actionValue.requestIndex === request.index
  ));
  if (actions.length !== 1) return false;
  const action = actions[0]!;
  return isRecord(action)
    && hasExactKeys(action, [
      "identifier",
      "method",
      "order",
      "payload",
      "requestIndex",
      "status",
      "url",
    ])
    && isExactResponseBackedProjectedServerAction(request, action)
    && isExactJourneyActionDigest(action.identifier, "server-action-id")
    && isExactJourneyActionDigest(action.payload, "server-action-payload")
    && hasExactJourneyNextActionHeader(request.requestHeaders, action.identifier);
}

function applyExactAuthenticatedPassiveProjection(
  target: Record<string, unknown>,
  projected: Record<string, unknown>,
) {
  for (const key of Object.keys(projected)) {
    if (key === "source") continue;
    target[key] = projected[key];
  }
}

function projectExactTelegramAuthProviderDynamicPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
    || !isRecord(expected.providerEffects)
    || !isRecord(actual.providerEffects)
    || !Array.isArray(expected.providerEffects.entries)
    || !Array.isArray(actual.providerEffects.entries)
    || expected.providerEffects.entries.length !== actual.providerEffects.entries.length
  ) {
    return;
  }

  for (let index = 0; index < expected.providerEffects.entries.length; index += 1) {
    const expectedEntry = expected.providerEffects.entries[index];
    const actualEntry = actual.providerEffects.entries[index];
    if (!isRecord(expectedEntry) || !isRecord(actualEntry)) return;
    if (!isExactGeneratedProviderEntryPair(expectedEntry, actualEntry)) continue;
    projectDynamicContractSha256ByLocalShape(expectedEntry);
    projectDynamicContractSha256ByLocalShape(actualEntry);
  }
}

function isExactGeneratedProviderEntryPair(
  expectedEntry: Record<string, unknown>,
  actualEntry: Record<string, unknown>,
) {
  const expectedComparable = cloneJson(expectedEntry);
  const actualComparable = cloneJson(actualEntry);
  if (!isRecord(expectedComparable) || !isRecord(actualComparable)) return false;
  projectDynamicContractSha256ByLocalShape(expectedComparable);
  projectDynamicContractSha256ByLocalShape(actualComparable);
  return sameJson(expectedComparable, actualComparable);
}

function projectDynamicContractSha256ByLocalShape(value: unknown) {
  let order = 0;
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    if (
      hasExactKeys(candidate, ["bytes", "format", "kind", "sha256"])
      && candidate.kind === "dynamic"
      && typeof candidate.format === "string"
      && Number.isSafeInteger(candidate.bytes)
      && typeof candidate.sha256 === "string"
      && (
        /^[a-f0-9]{64}$/.test(candidate.sha256)
        || /^<dynamic:[a-z0-9-]+:[1-9][0-9]*>$/.test(candidate.sha256)
      )
    ) {
      order += 1;
      candidate.sha256 = `<dynamic:provider-entry-${candidate.format}:${order}>`;
      return;
    }
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(value);
}

function projectExactPasskeySetupPayloadPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || expected.journey !== "telegram-oidc-cabinet-profile-link-referral-passkey"
    || !isRecord(expected.network)
    || !isRecord(actual.network)
    || !Array.isArray(expected.network.requests)
    || !Array.isArray(actual.network.requests)
    || !Array.isArray(expected.network.serverActions)
    || !Array.isArray(actual.network.serverActions)
    || expected.network.serverActions.length !== actual.network.serverActions.length
  ) {
    return;
  }

  for (let index = 0; index < expected.network.serverActions.length; index += 1) {
    const expectedAction = expected.network.serverActions[index];
    const actualAction = actual.network.serverActions[index];
    if (
      !isRecord(expectedAction)
      || !isRecord(actualAction)
      || !isExactPasskeySetupAction(expectedAction)
      || !isExactPasskeySetupAction(actualAction)
    ) {
      continue;
    }
    const expectedRequest = expected.network.requests[expectedAction.requestIndex as number];
    const actualRequest = actual.network.requests[actualAction.requestIndex as number];
    if (
      !isRecord(expectedRequest)
      || !isRecord(actualRequest)
      || !isExactPasskeySetupRequest(expectedRequest, expectedAction)
      || !isExactPasskeySetupRequest(actualRequest, actualAction)
    ) {
      continue;
    }

    const expectedComparable = cloneJson({ action: expectedAction, request: expectedRequest });
    const actualComparable = cloneJson({ action: actualAction, request: actualRequest });
    projectPasskeySetupPayloadDigest(expectedComparable);
    projectPasskeySetupPayloadDigest(actualComparable);
    if (!sameJson(expectedComparable, actualComparable)) continue;
    projectPasskeySetupPayloadDigest({ action: expectedAction, request: expectedRequest });
    projectPasskeySetupPayloadDigest({ action: actualAction, request: actualRequest });
  }
}

function projectExactTelegramLoginPayloadBytesPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || expected.journey !== "telegram-oidc-cabinet-profile-link-referral-passkey"
    || !isRecord(expected.network)
    || !isRecord(actual.network)
    || !Array.isArray(expected.network.requests)
    || !Array.isArray(actual.network.requests)
    || !Array.isArray(expected.network.serverActions)
    || !Array.isArray(actual.network.serverActions)
    || expected.network.serverActions.length !== actual.network.serverActions.length
  ) {
    return;
  }

  for (let index = 0; index < expected.network.serverActions.length; index += 1) {
    const expectedAction = expected.network.serverActions[index];
    const actualAction = actual.network.serverActions[index];
    if (
      !isRecord(expectedAction)
      || !isRecord(actualAction)
      || !Number.isSafeInteger(expectedAction.requestIndex)
      || !Number.isSafeInteger(actualAction.requestIndex)
    ) {
      continue;
    }

    const expectedRequest = expected.network.requests[expectedAction.requestIndex as number];
    const actualRequest = actual.network.requests[actualAction.requestIndex as number];
    if (
      !isRecord(expectedRequest)
      || !isRecord(actualRequest)
      || !isExactTelegramLoginPayloadByteDriftPair(
        expected,
        expectedRequest,
        expectedAction,
        actualRequest,
        actualAction,
      )
    ) {
      continue;
    }

    const expectedComparable = cloneJson({ action: expectedAction, request: expectedRequest });
    const actualComparable = cloneJson({ action: actualAction, request: actualRequest });
    if (
      !isRecord(expectedComparable)
      || !isRecord(actualComparable)
      || !isRecord(expectedComparable.action)
      || !isRecord(expectedComparable.request)
      || !isRecord(actualComparable.action)
      || !isRecord(actualComparable.request)
    ) {
      continue;
    }

    projectTelegramLoginPayloadBytes(expectedComparable.request, expectedComparable.action);
    projectTelegramLoginPayloadBytes(actualComparable.request, actualComparable.action);
    if (!sameJson(expectedComparable, actualComparable)) continue;
    projectTelegramLoginPayloadBytes(expectedRequest, expectedAction);
    projectTelegramLoginPayloadBytes(actualRequest, actualAction);
  }
}

function projectExactServerActionDynamicDigestPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
    || !isRecord(expected.network)
    || !isRecord(actual.network)
    || !Array.isArray(expected.network.requests)
    || !Array.isArray(actual.network.requests)
    || !Array.isArray(expected.network.serverActions)
    || !Array.isArray(actual.network.serverActions)
    || expected.network.serverActions.length !== actual.network.serverActions.length
  ) {
    return;
  }

  const plans: Array<{
    actualAction: Record<string, unknown>;
    actualRequest: Record<string, unknown>;
    expectedAction: Record<string, unknown>;
    expectedRequest: Record<string, unknown>;
    order: number;
    projectTelegramLoginPayloadBytes: boolean;
  }> = [];
  for (let order = 0; order < expected.network.serverActions.length; order += 1) {
    const expectedAction = expected.network.serverActions[order];
    const actualAction = actual.network.serverActions[order];
    if (
      !isRecord(expectedAction)
      || !isRecord(actualAction)
      || !Number.isSafeInteger(expectedAction.requestIndex)
      || !Number.isSafeInteger(actualAction.requestIndex)
    ) {
      return;
    }
    const expectedRequest = expected.network.requests[expectedAction.requestIndex as number];
    const actualRequest = actual.network.requests[actualAction.requestIndex as number];
    if (!isRecord(expectedRequest) || !isRecord(actualRequest)) return;

    const dynamicTelegramLoginPayload = isExactTelegramLoginPayloadByteDriftPair(
      expected,
      expectedRequest,
      expectedAction,
      actualRequest,
      actualAction,
    );
    const expectedComparable = cloneJson({ action: expectedAction, request: expectedRequest });
    const actualComparable = cloneJson({ action: actualAction, request: actualRequest });
    if (!isRecord(expectedComparable) || !isRecord(actualComparable)) return;
    if (
      !isRecord(expectedComparable.action)
      || !isRecord(expectedComparable.request)
      || !isRecord(actualComparable.action)
      || !isRecord(actualComparable.request)
      || !projectServerActionDigestEntry(
        expectedComparable.request,
        expectedComparable.action,
        order,
      )
      || !projectServerActionDigestEntry(
        actualComparable.request,
        actualComparable.action,
        order,
      )
    ) {
      return;
    }
    if (dynamicTelegramLoginPayload) {
      projectTelegramLoginPayloadBytes(expectedComparable.request, expectedComparable.action);
      projectTelegramLoginPayloadBytes(actualComparable.request, actualComparable.action);
    }
    if (!sameJson(expectedComparable, actualComparable)) return;
    plans.push({
      actualAction,
      actualRequest,
      expectedAction,
      expectedRequest,
      projectTelegramLoginPayloadBytes: dynamicTelegramLoginPayload,
      order,
    });
  }

  for (const plan of plans) {
    projectServerActionDigestEntry(plan.expectedRequest, plan.expectedAction, plan.order);
    projectServerActionDigestEntry(plan.actualRequest, plan.actualAction, plan.order);
    if (plan.projectTelegramLoginPayloadBytes) {
      projectTelegramLoginPayloadBytes(plan.expectedRequest, plan.expectedAction);
      projectTelegramLoginPayloadBytes(plan.actualRequest, plan.actualAction);
    }
  }
}

function projectExactActiveServerActionDynamicDigestPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
  ) {
    return;
  }

  const expectedEntries = exactActiveServerActionDigestEntries(expected);
  const actualEntries = exactActiveServerActionDigestEntries(actual);
  if (
    expectedEntries === null
    || actualEntries === null
    || expectedEntries.length === 0
    || expectedEntries.length !== actualEntries.length
  ) {
    return;
  }

  const plans: Array<{
    actualAction: Record<string, unknown>;
    actualRequest: Record<string, unknown>;
    expectedAction: Record<string, unknown>;
    expectedRequest: Record<string, unknown>;
    order: number;
    projectTelegramLoginPayloadBytes: boolean;
  }> = [];
  for (let order = 0; order < expectedEntries.length; order += 1) {
    const expectedEntry = expectedEntries[order]!;
    const actualEntry = actualEntries[order]!;
    const dynamicTelegramLoginPayload = isExactTelegramLoginPayloadByteDriftPair(
      expected,
      expectedEntry.request,
      expectedEntry.action,
      actualEntry.request,
      actualEntry.action,
    );
    const expectedComparable = comparableActiveServerActionDigestEntry(
      expectedEntry.request,
      expectedEntry.action,
      order,
    );
    const actualComparable = comparableActiveServerActionDigestEntry(
      actualEntry.request,
      actualEntry.action,
      order,
    );
    if (expectedComparable === null || actualComparable === null) return;
    if (dynamicTelegramLoginPayload) {
      projectTelegramLoginPayloadBytes(expectedComparable.request, expectedComparable.action);
      projectTelegramLoginPayloadBytes(actualComparable.request, actualComparable.action);
    }
    if (!sameJson(expectedComparable, actualComparable)) return;
    plans.push({
      actualAction: actualEntry.action,
      actualRequest: actualEntry.request,
      expectedAction: expectedEntry.action,
      expectedRequest: expectedEntry.request,
      order,
      projectTelegramLoginPayloadBytes: dynamicTelegramLoginPayload,
    });
  }

  for (const plan of plans) {
    projectServerActionDigestEntry(plan.expectedRequest, plan.expectedAction, plan.order);
    projectServerActionDigestEntry(plan.actualRequest, plan.actualAction, plan.order);
    if (plan.projectTelegramLoginPayloadBytes) {
      projectTelegramLoginPayloadBytes(plan.expectedRequest, plan.expectedAction);
      projectTelegramLoginPayloadBytes(plan.actualRequest, plan.actualAction);
    }
  }
}

function exactActiveServerActionDigestEntries(manifest: Record<string, unknown>) {
  const network = exactProjectedNetwork(manifest);
  if (network === null) return null;

  const entries: Array<{
    action: Record<string, unknown>;
    request: Record<string, unknown>;
  }> = [];
  for (const actionValue of network.serverActions) {
    if (
      !isRecord(actionValue)
      || !Number.isSafeInteger(actionValue.requestIndex)
    ) {
      return null;
    }
    const requestValue = network.requests[actionValue.requestIndex as number];
    if (!isRecord(requestValue)) return null;
    if (isExactPassiveRefreshServerActionRequest(manifest, requestValue)) {
      continue;
    }
    if (!isExactResponseBackedProjectedServerAction(requestValue, actionValue)) {
      return null;
    }
    entries.push({ action: actionValue, request: requestValue });
  }
  return entries;
}

function comparableActiveServerActionDigestEntry(
  request: Record<string, unknown>,
  action: Record<string, unknown>,
  order: number,
) {
  const comparable = cloneJson({ action, request });
  if (
    !isRecord(comparable)
    || !isRecord(comparable.action)
    || !isRecord(comparable.request)
    || !projectServerActionDigestEntry(
      comparable.request,
      comparable.action,
      order,
    )
  ) {
    return null;
  }
  comparable.request.index = order;
  comparable.action.order = order;
  comparable.action.requestIndex = order;
  return {
    action: comparable.action,
    request: comparable.request,
  };
}

function isExactTelegramLoginPayloadByteDriftPair(
  manifest: Record<string, unknown>,
  expectedRequest: Record<string, unknown>,
  expectedAction: Record<string, unknown>,
  actualRequest: Record<string, unknown>,
  actualAction: Record<string, unknown>,
) {
  if (
    manifest.journey !== "telegram-oidc-cabinet-profile-link-referral-passkey"
    || !isExactResponseBackedProjectedServerAction(expectedRequest, expectedAction)
    || !isExactResponseBackedProjectedServerAction(actualRequest, actualAction)
    || !isRecord(expectedAction.url)
    || !isRecord(actualAction.url)
    || expectedAction.url.origin !== "<app-origin>"
    || actualAction.url.origin !== "<app-origin>"
    || expectedAction.url.pathname !== "/login"
    || actualAction.url.pathname !== "/login"
    || !Array.isArray(expectedAction.url.query)
    || !Array.isArray(actualAction.url.query)
    || expectedAction.url.query.length !== 0
    || actualAction.url.query.length !== 0
    || expectedAction.url.fragment !== null
    || actualAction.url.fragment !== null
    || !isRecord(expectedAction.payload)
    || !isRecord(actualAction.payload)
    || !Number.isSafeInteger(expectedAction.payload.bytes)
    || !Number.isSafeInteger(actualAction.payload.bytes)
    || expectedAction.payload.bytes === actualAction.payload.bytes
  ) {
    return false;
  }

  return isBoundedTelegramLoginPayloadBytes(expectedAction.payload.bytes)
    && isBoundedTelegramLoginPayloadBytes(actualAction.payload.bytes);
}

function isBoundedTelegramLoginPayloadBytes(value: unknown) {
  return Number.isSafeInteger(value)
    && Number(value) >= 512
    && Number(value) <= 1024;
}

function projectTelegramLoginPayloadBytes(
  requestValue: Record<string, unknown>,
  actionValue: Record<string, unknown>,
) {
  if (!isRecord(actionValue.payload) || !isRecord(requestValue.postData)) return;
  actionValue.payload = {
    ...actionValue.payload,
    bytes: "<dynamic:telegram-login-payload-bytes>",
  };
  requestValue.postData = {
    ...requestValue.postData,
    bytes: "<dynamic:telegram-login-payload-bytes>",
  };
}

function projectServerActionDigestEntry(
  requestValue: Record<string, unknown>,
  actionValue: Record<string, unknown>,
  order: number,
) {
  if (!isExactResponseBackedProjectedServerAction(requestValue, actionValue)) {
    return false;
  }
  const nextActionHeader = exactJourneyNextActionHeader(
    requestValue.requestHeaders,
    actionValue.identifier,
  );
  if (!nextActionHeader) return false;
  const identifier = {
    ...(actionValue.identifier as Record<string, unknown>),
    sha256: `<dynamic:server-action-id:${order + 1}>`,
  };
  const payload = {
    ...(actionValue.payload as Record<string, unknown>),
    sha256: `<dynamic:server-action-payload:${order + 1}>`,
  };
  actionValue.identifier = identifier;
  actionValue.payload = payload;
  requestValue.serverAction = { present: true, identifier: { ...identifier } };
  requestValue.postData = { ...payload };
  nextActionHeader.value = { ...identifier };
  return true;
}

function exactJourneyNextActionHeader(
  headers: unknown,
  identifier: unknown,
): (Record<string, unknown> & { value: unknown }) | null {
  if (!Array.isArray(headers)) return null;
  const matches = headers.filter((header) => (
    isRecord(header) && header.name === "next-action"
  ));
  if (matches.length !== 1) return null;
  const header = matches[0];
  return isRecord(header)
    && hasExactKeys(header, ["name", "value"])
    && sameJson(header.value, identifier)
    ? header as Record<string, unknown> & { value: unknown }
    : null;
}

function isExactResponseBackedProjectedServerAction(
  request: Record<string, unknown>,
  action: Record<string, unknown>,
) {
  return hasExactKeys(request, [
    "externalTransport",
    "failure",
    "index",
    "method",
    "navigation",
    "postData",
    "redirectedFrom",
    "requestHeaders",
    "resourceType",
    "response",
    "scope",
    "serverAction",
    "url",
  ])
    && hasExactKeys(action, [
      "identifier",
      "method",
      "order",
      "payload",
      "requestIndex",
      "status",
      "url",
    ])
    && request.index === action.requestIndex
    && request.scope === "application"
    && request.method === "POST"
    && request.resourceType === "fetch"
    && request.navigation === false
    && request.redirectedFrom === null
    && request.externalTransport === null
    && isRecord(request.serverAction)
    && request.serverAction.present === true
    && sameJson(request.serverAction.identifier, action.identifier)
    && sameJson(request.postData, action.payload)
    && sameJson(request.url, action.url)
    && action.method === request.method
    && isRecord(request.response)
    && request.response.status === action.status
    && responseHasContentType(request.response, "text/x-component")
    && isExactJourneyActionDigest(action.identifier, "server-action-id")
    && isExactJourneyActionDigest(action.payload, "server-action-payload")
    && hasExactJourneyNextActionHeader(request.requestHeaders, action.identifier) !== null;
}

function isExactPasskeySetupAction(action: Record<string, unknown>) {
  return hasExactKeys(action, [
    "identifier",
    "method",
    "order",
    "payload",
    "requestIndex",
    "status",
    "url",
  ])
    && action.method === "POST"
    && action.status === 200
    && Number.isSafeInteger(action.requestIndex)
    && isExactJourneyActionDigest(action.identifier, "server-action-id")
    && isExactJourneyActionDigest(action.payload, "server-action-payload")
    && isRecord(action.url)
    && action.url.origin === "<app-origin>"
    && action.url.pathname === "/passkey/setup"
    && Array.isArray(action.url.query)
    && action.url.query.length === 1
    && isRecord(action.url.query[0])
    && action.url.query[0].key === "redirect_to"
    && typeof action.url.query[0].value === "string"
    && action.url.fragment === null;
}

function isExactPasskeySetupRequest(
  request: Record<string, unknown>,
  action: Record<string, unknown>,
) {
  return hasExactKeys(request, [
    "externalTransport",
    "failure",
    "index",
    "method",
    "navigation",
    "postData",
    "redirectedFrom",
    "requestHeaders",
    "resourceType",
    "response",
    "scope",
    "serverAction",
    "url",
  ])
    && request.index === action.requestIndex
    && request.scope === "application"
    && request.method === "POST"
    && request.resourceType === "fetch"
    && request.navigation === false
    && request.redirectedFrom === null
    && request.externalTransport === null
    && isRecord(request.serverAction)
    && request.serverAction.present === true
    && sameJson(request.serverAction.identifier, action.identifier)
    && sameJson(request.postData, action.payload)
    && sameJson(request.url, action.url)
    && isRecord(request.response)
    && request.response.status === 200
    && responseHasContentType(request.response, "text/x-component")
    && hasExactJourneyNextActionHeader(request.requestHeaders, action.identifier);
}

function projectPasskeySetupPayloadDigest(value: unknown) {
  if (!isRecord(value) || !isRecord(value.action) || !isRecord(value.request)) return;
  const payload = {
    bytes: "<dynamic:passkey-setup-payload-bytes>",
    sha256: "<dynamic:passkey-setup-payload>",
  };
  value.action.payload = { ...payload };
  value.request.postData = { ...payload };
}

function projectExactAuthenticatedBrowserNoisePair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
  ) {
    return;
  }

  const expectedTrial = cloneJson(expected);
  const actualTrial = cloneJson(actual);
  if (!isRecord(expectedTrial) || !isRecord(actualTrial)) return;
  projectSuccessfulHashedStaticRequests(expectedTrial);
  projectSuccessfulHashedStaticRequests(actualTrial);
  const expectedChanged = removeExactAuthenticatedBrowserNoiseRequests(expectedTrial);
  const actualChanged = removeExactAuthenticatedBrowserNoiseRequests(actualTrial);
  if (!expectedChanged && !actualChanged) return;

  const expectedProjectedTrial = projectCharacterizationManifestForComparison(expectedTrial);
  const actualProjectedTrial = projectCharacterizationManifestForComparison(actualTrial);
  if (!isRecord(expectedProjectedTrial) || !isRecord(actualProjectedTrial)) return;
  projectExactConcurrentCabinetReadPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactPassiveProviderEffectOrderPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactTelegramAuthProviderDynamicPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactPasskeySetupPayloadPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactTelegramLoginPayloadBytesPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactActiveServerActionDynamicDigestPair(
    expectedProjectedTrial,
    actualProjectedTrial,
  );
  projectExactServerActionDynamicDigestPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactHashedStaticDocumentLinkPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactRemovedNextJsPoweredBy(expectedProjectedTrial, actualProjectedTrial);
  projectExactOptionalZeroContentLengthPair(expectedProjectedTrial, actualProjectedTrial);
  projectExactJourneyFixtureContract(expectedProjectedTrial, actualProjectedTrial);
  projectPairedJourneyInlineStyles(expectedProjectedTrial, actualProjectedTrial);
  if (!sameJson(expectedProjectedTrial, actualProjectedTrial)) {
    return;
  }
  applyExactAuthenticatedPassiveProjection(expected, expectedProjectedTrial);
  applyExactAuthenticatedPassiveProjection(actual, actualProjectedTrial);
}

function projectSuccessfulHashedStaticRequests(manifest: Record<string, unknown>) {
  const network = exactProjectedNetwork(manifest);
  if (network === null) return;
  for (const requestValue of network.requests) {
    if (!isRecord(requestValue)) return;
    projectSuccessfulHashedStaticAsset(requestValue);
  }
}

function removeExactAuthenticatedBrowserNoiseRequests(
  manifest: Record<string, unknown>,
) {
  const network = exactProjectedNetwork(manifest);
  if (network === null) return false;

  const removedIndexes = new Set<number>();
  let removedContextualBrowserNoiseRequest = false;
  const retained = network.requests.filter((requestValue) => {
    if (!isRecord(requestValue)) return true;
    const contextualBrowserNoise = isAutomaticNextRscPrefetch(requestValue)
      || isAutomaticNextRscPrefetchRedirectTail(requestValue, removedIndexes)
      || isExactAuthenticatedPassiveRscNavigationRequest(requestValue)
      || isExactPwaControlledDocumentRequest(manifest, requestValue)
      || isExactAuthenticatedChatwootTransportNoise(manifest, requestValue)
      || isExactPassiveRefreshServerActionRequest(manifest, requestValue);
    if (
      contextualBrowserNoise
      || isExactProjectedRemovableStaticResource(requestValue)
    ) {
      if (contextualBrowserNoise) removedContextualBrowserNoiseRequest = true;
      removedIndexes.add(requestValue.index as number);
      return false;
    }
    return true;
  });
  if (!removedContextualBrowserNoiseRequest) return false;
  return reindexExactProjectedNetworkWithRemovedActions(
    network,
    retained,
    removedIndexes,
  );
}

function isExactAuthenticatedPassiveRscNavigationRequest(
  request: Record<string, unknown>,
) {
  if (
    !hasExactKeys(request, [
      "externalTransport",
      "failure",
      "index",
      "method",
      "navigation",
      "postData",
      "redirectedFrom",
      "requestHeaders",
      "resourceType",
      "response",
      "scope",
      "serverAction",
      "url",
    ])
    || request.scope !== "application"
    || request.method !== "GET"
    || request.resourceType !== "fetch"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.externalTransport !== null
    || !isRecord(request.url)
    || request.url.origin !== "<app-origin>"
    || typeof request.url.pathname !== "string"
    || !Array.isArray(request.url.query)
    || request.url.fragment !== null
    || !Array.isArray(request.requestHeaders)
  ) {
    return false;
  }

  const queryKeys = request.url.query.map((entry) => (
    isRecord(entry) ? entry.key : null
  ));
  const rscRoute = (
    request.url.pathname === "/"
    || request.url.pathname === "/login"
    || request.url.pathname === "/cabinet"
  ) && queryKeys.includes("_rsc");
  const redirectLoginRoute = request.url.pathname === "/login"
    && queryKeys.includes("redirect_to");
  const orphanRootFetch = request.url.pathname === "/"
    && request.response === null
    && request.failure === null;
  const responseBackedAbort = isRecord(request.response)
    && request.response.status === 200
    && responseHasContentType(request.response, "text/x-component")
    && isExactResponseBackedAbortFailure(request.failure);
  return (
    rscRoute
    || redirectLoginRoute
    || orphanRootFetch
    || responseBackedAbort
  );
}

function removeExactAuthenticatedPassiveNetworkRequests(manifest: Record<string, unknown>) {
  const network = exactProjectedNetwork(manifest);
  if (network === null) return false;

  const removedIndexes = new Set<number>();
  let removedContextualPassiveRequest = false;
  const retainedRequests = network.requests.filter((requestValue) => {
    if (!isRecord(requestValue)) return true;
    const contextualPassive = isExactPwaControlledDocumentRequest(manifest, requestValue)
      || isExactPassiveRefreshServerActionRequest(manifest, requestValue)
      || isExactAuthenticatedChatwootTransportNoise(manifest, requestValue);
    if (
      isExactProjectedRemovableStaticResource(requestValue)
      || contextualPassive
    ) {
      if (contextualPassive) removedContextualPassiveRequest = true;
      removedIndexes.add(requestValue.index as number);
      return false;
    }
    return true;
  });
  if (!removedContextualPassiveRequest) return false;

  return reindexExactProjectedNetworkWithRemovedActions(
    network,
    retainedRequests,
    removedIndexes,
  );
}

function reindexExactProjectedNetworkWithRemovedActions(
  network: ExactProjectedNetwork,
  retainedRequests: unknown[],
  removedIndexes: Set<number>,
) {
  const oldToNewIndex = new Map<number, number>();
  retainedRequests.forEach((request, newIndex) => {
    oldToNewIndex.set((request as Record<string, unknown>).index as number, newIndex);
  });

  if (
    retainedRequests.some((request) => redirectCannotBeReindexed(
      request as Record<string, unknown>,
      removedIndexes,
      oldToNewIndex,
    ))
  ) {
    return false;
  }

  const retainedActions = network.serverActions.filter((actionValue) => {
    if (!isRecord(actionValue) || !Number.isSafeInteger(actionValue.requestIndex)) {
      return true;
    }
    return !removedIndexes.has(actionValue.requestIndex as number);
  });
  if (
    retainedActions.some((action) => actionCannotBeReindexed(
      action,
      removedIndexes,
      oldToNewIndex,
    ))
  ) {
    return false;
  }

  for (const [newIndex, requestValue] of retainedRequests.entries()) {
    const request = requestValue as Record<string, unknown>;
    request.index = newIndex;
    if (typeof request.redirectedFrom === "number") {
      request.redirectedFrom = oldToNewIndex.get(request.redirectedFrom) as number;
    }
  }
  for (const [order, actionValue] of retainedActions.entries()) {
    const action = actionValue as Record<string, unknown>;
    action.order = order;
    action.requestIndex = oldToNewIndex.get(action.requestIndex as number) as number;
  }
  network.requests = retainedRequests;
  network.serverActions = retainedActions;
  network.serverActionCount = retainedActions.length;
  return true;
}

function isAuthenticatedJourneyWithPassiveBrowserNoise(journey: unknown) {
  return [
    "email-account-links-and-merges-telegram",
    "email-register-verify-and-login",
    "tariffs-payment-returns-extend-idempotency",
    "telegram-oidc-cabinet-profile-link-referral-passkey",
    "telegram-webapp-browser-boundary",
  ].includes(String(journey));
}

function isExactPwaControlledDocumentRequest(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  if (
    !isExactProjectedApplicationDocument(request)
    || request.redirectedFrom !== null
  ) {
    return false;
  }
  if (
    isRecord(request.response)
    && request.response.status === 200
    && request.response.fromServiceWorker === true
    && isRecord(request.url)
    && typeof request.url.pathname === "string"
    && responseHasContentType(request.response, "text/html; charset=utf-8")
  ) {
    return manifestHasCheckpointPath(manifest, request.url.pathname)
      || isExactAuthenticatedPwaDocumentRoute(manifest, request.url.pathname);
  }
  return false;
}

function isExactAuthenticatedPwaDocumentRoute(
  manifest: Record<string, unknown>,
  pathname: string,
) {
  return hasExactJourneyManifestEnvelope(manifest)
    && exactJourneyFixtureContract(manifest) !== null
    && isAuthenticatedJourneyWithPassiveBrowserNoise(manifest.journey)
    && [
      "/cabinet",
      "/link-account",
    ].includes(pathname);
}

function manifestHasCheckpointPath(
  manifest: Record<string, unknown>,
  pathname: string,
) {
  return Array.isArray(manifest.checkpoints)
    && manifest.checkpoints.some((checkpoint) => (
      isRecord(checkpoint)
      && isRecord(checkpoint.url)
      && checkpoint.url.origin === "<app-origin>"
      && checkpoint.url.pathname === pathname
    ));
}

function isExactPassiveRefreshServerActionRequest(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  return isExactResponseBackedJourneyServerAction(manifest, request)
    && (
      request.failure === null
      || isExactResponseBackedAbortFailure(request.failure)
    )
    && isRecord(request.postData)
    && request.postData.bytes === 29
    && isRecord(request.response)
    && request.response.status === 200
    && responseHasContentType(request.response, "text/x-component")
    && isRecord(request.url)
    && [
      "/cabinet",
      "/extend",
      "/link-account",
      "/payment/fail",
      "/payment/pending",
      "/payment/success",
      "/profile",
      "/referral",
      "/tariffs",
      "/verify-email",
    ].includes(String(request.url.pathname));
}

function isExactResponseBackedAbortFailure(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["errorText"])
    && isExactDigest(value.errorText, NET_ERR_ABORTED);
}

function responseHasContentType(
  response: Record<string, unknown>,
  contentType: string,
) {
  return Array.isArray(response.headers)
    && response.headers.some((header) => (
      isRecord(header)
      && header.name === "content-type"
      && header.value === contentType
    ));
}

function collapseExactProjectedNextStaticTopologyPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  const expectedNetwork = exactProjectedNetwork(expected);
  const actualNetwork = exactProjectedNetwork(actual);
  if (expectedNetwork === null || actualNetwork === null) return null;

  const expectedGroups = splitExactProjectedNextStaticTopologyGroups(
    expectedNetwork.requests,
  );
  const actualGroups = splitExactProjectedNextStaticTopologyGroups(
    actualNetwork.requests,
  );
  if (
    expectedGroups === null
    || actualGroups === null
    || expectedGroups.length !== actualGroups.length
  ) {
    return null;
  }

  let projected = false;
  const plans: Array<{
    expected: ExactProjectedNextStaticTopologyGroup;
    actual: ExactProjectedNextStaticTopologyGroup;
    staticSignatures: string[];
  }> = [];
  for (const [index, expectedGroup] of expectedGroups.entries()) {
    const actualGroup = actualGroups[index]!;
    if (expectedGroup.document === null || actualGroup.document === null) {
      if (expectedGroup.document !== actualGroup.document) return null;
      plans.push({ expected: expectedGroup, actual: actualGroup, staticSignatures: [] });
      continue;
    }
    if (
      !sameJson(
        { ...expectedGroup.document, index: 0, response: null },
        { ...actualGroup.document, index: 0, response: null },
      )
      || !isRecord(expectedGroup.document.response)
      || !isRecord(actualGroup.document.response)
      || !equalExceptKey(
        expectedGroup.document.response,
        actualGroup.document.response,
        "headers",
      )
    ) {
      return null;
    }
    const expectedStaticSignatures = exactProjectedNextStaticSignatures(
      expectedGroup.staticRequests,
    );
    const actualStaticSignatures = exactProjectedNextStaticSignatures(
      actualGroup.staticRequests,
    );
    if (expectedStaticSignatures === null || actualStaticSignatures === null) return null;
    if (expectedStaticSignatures.length === 0 && actualStaticSignatures.length === 0) {
      plans.push({ expected: expectedGroup, actual: actualGroup, staticSignatures: [] });
      continue;
    }
    if (
      expectedStaticSignatures.length === 0
      || actualStaticSignatures.length === 0
      || !sameJson(expectedStaticSignatures, actualStaticSignatures)
    ) {
      return null;
    }
    const expectedTopology = exactProjectedNextStaticTopologyShape(expectedGroup);
    const actualTopology = exactProjectedNextStaticTopologyShape(actualGroup);
    if (!sameJson(expectedTopology, actualTopology)) projected = true;
    plans.push({
      expected: expectedGroup,
      actual: actualGroup,
      staticSignatures: expectedStaticSignatures,
    });
  }
  if (!projected) return false;

  const expectedRetained = collapseExactProjectedNextStaticTopologyGroups(
    plans.map((plan) => ({
      group: plan.expected,
      staticSignatures: plan.staticSignatures,
    })),
  );
  const actualRetained = collapseExactProjectedNextStaticTopologyGroups(
    plans.map((plan) => ({
      group: plan.actual,
      staticSignatures: plan.staticSignatures,
    })),
  );
  return reindexExactProjectedNetwork(expectedNetwork, expectedRetained)
    && reindexExactProjectedNetwork(actualNetwork, actualRetained)
    ? true
    : null;
}

type ExactProjectedNetwork = Record<string, unknown> & {
  requests: unknown[];
  serverActions: unknown[];
};

type ExactProjectedNextStaticTopologyGroup = {
  document: Record<string, unknown> | null;
  items: Record<string, unknown>[];
  staticRequests: Record<string, unknown>[];
};

function exactProjectedNetwork(
  manifest: Record<string, unknown>,
): ExactProjectedNetwork | null {
  const network = manifest.network;
  if (
    !isRecord(network)
    || !hasExactKeys(network, ["requests", "serverActionCount", "serverActions"])
    || !Array.isArray(network.requests)
    || !Array.isArray(network.serverActions)
    || network.serverActionCount !== network.serverActions.length
    || !hasSafeRequestIndexes(network.requests)
  ) {
    return null;
  }
  return network as ExactProjectedNetwork;
}

function splitExactProjectedNextStaticTopologyGroups(
  requests: unknown[],
): ExactProjectedNextStaticTopologyGroup[] | null {
  const groups: ExactProjectedNextStaticTopologyGroup[] = [];
  let current: ExactProjectedNextStaticTopologyGroup = {
    document: null,
    items: [],
    staticRequests: [],
  };
  for (const requestValue of requests) {
    if (!isRecord(requestValue)) return null;
    if (isExactProjectedApplicationDocument(requestValue)) {
      if (current.items.length > 0) groups.push(current);
      current = {
        document: requestValue,
        items: [requestValue],
        staticRequests: [],
      };
      continue;
    }
    current.items.push(requestValue);
    if (current.document !== null && isExactProjectedNextStaticResource(requestValue)) {
      current.staticRequests.push(requestValue);
    }
  }
  if (current.items.length > 0) groups.push(current);
  return groups;
}

function exactProjectedNextStaticSignatures(
  requests: Record<string, unknown>[],
): string[] | null {
  const signatures = new Set<string>();
  for (const request of requests) {
    if (!isExactProjectedNextStaticResource(request)) return null;
    signatures.add(exactProjectedNextStaticSignature(request));
  }
  return [...signatures].sort();
}

function exactProjectedNextStaticSignature(request: Record<string, unknown>) {
  return JSON.stringify(exactProjectedNextStaticSignatureRequest(request));
}

function exactProjectedNextStaticSignatureRequest(request: Record<string, unknown>) {
  const projected: Record<string, unknown> = { ...request, index: 0 };
  if (Array.isArray(projected.requestHeaders)) {
    projected.requestHeaders = projected.requestHeaders.filter((header: unknown) => (
      !isExactOptionalStaticOriginHeader(header)
    ));
  }
  return projected;
}

function isExactOptionalStaticOriginHeader(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["name", "value"])
    && value.name === "origin"
    && sameJson(value.value, {
      origin: "<app-origin>",
      pathname: "/",
      query: [],
      fragment: null,
    });
}

function exactProjectedNextStaticTopologyShape(
  group: ExactProjectedNextStaticTopologyGroup,
) {
  return group.items.map((request) => (
      isExactProjectedNextStaticResource(request)
        ? exactProjectedNextStaticSignature(request)
        : "<semantic>"
  ));
}

function collapseExactProjectedNextStaticTopologyGroups(
  groups: Array<{
    group: ExactProjectedNextStaticTopologyGroup;
    staticSignatures: string[];
  }>,
) {
  return groups.flatMap(({ group, staticSignatures }) => {
    if (group.document === null || staticSignatures.length === 0) return group.items;
    const staticBySignature = new Map<string, Record<string, unknown>>();
    for (const request of group.staticRequests) {
      const signature = exactProjectedNextStaticSignature(request);
      if (staticSignatures.includes(signature) && !staticBySignature.has(signature)) {
        staticBySignature.set(signature, request);
      }
    }
    if (staticBySignature.size !== staticSignatures.length) return group.items;
    return [
      group.document,
      ...staticSignatures.map((signature) => staticBySignature.get(signature)!),
      ...group.items.filter((request) => (
        request !== group.document && !isExactProjectedNextStaticResource(request)
      )),
    ];
  });
}

function collapseExactProjectedNextStaticTopology(
  manifest: Record<string, unknown>,
) {
  const network = exactProjectedNetwork(manifest);
  if (network === null) return null;

  const removedIndexes = new Set<number>();
  const retained: unknown[] = [];
  let documentEpoch = 0;
  let seen = new Set<string>();
  for (const requestValue of network.requests) {
    const request = requestValue as Record<string, unknown>;
    if (isExactProjectedApplicationDocument(request)) {
      documentEpoch += 1;
      seen = new Set<string>();
    }
    if (documentEpoch > 0 && isExactProjectedNextStaticResource(request)) {
      const signature = JSON.stringify({ ...request, index: 0 });
      if (seen.has(signature)) {
        removedIndexes.add(request.index as number);
        continue;
      }
      seen.add(signature);
    }
    retained.push(request);
  }
  if (removedIndexes.size === 0) return false;

  return reindexExactProjectedNetwork(network, retained) ? true : null;
}

function removeExactProjectedNextStaticResources(
  manifest: Record<string, unknown>,
) {
  const network = exactProjectedNetwork(manifest);
  if (network === null) return null;

  const retained: unknown[] = [];
  for (const requestValue of network.requests) {
    if (!isRecord(requestValue)) return null;
    if (isExactProjectedRemovableStaticResource(requestValue)) continue;
    retained.push(requestValue);
  }
  if (retained.length === network.requests.length) return false;

  return reindexExactProjectedNetwork(network, retained) ? true : null;
}

function reindexExactProjectedNetwork(
  network: ExactProjectedNetwork,
  retained: unknown[],
) {
  const retainedIndexes = new Set(
    retained.map((request) => (request as Record<string, unknown>).index as number),
  );
  const removedIndexes = new Set(
    network.requests.flatMap((request) => {
      const index = (request as Record<string, unknown>).index as number;
      return retainedIndexes.has(index) ? [] : [index];
    }),
  );
  const oldToNewIndex = new Map<number, number>();
  retained.forEach((request, index) => {
    oldToNewIndex.set((request as Record<string, unknown>).index as number, index);
  });
  if (
    retained.some((request) => redirectCannotBeReindexed(
      request as Record<string, unknown>,
      removedIndexes,
      oldToNewIndex,
    ))
    || network.serverActions.some((action) => actionCannotBeReindexed(
      action,
      removedIndexes,
      oldToNewIndex,
    ))
  ) {
    return false;
  }

  for (const [index, requestValue] of retained.entries()) {
    const request = requestValue as Record<string, unknown>;
    request.index = index;
    if (typeof request.redirectedFrom === "number") {
      request.redirectedFrom = oldToNewIndex.get(request.redirectedFrom) as number;
    }
  }
  for (const actionValue of network.serverActions) {
    const action = actionValue as Record<string, unknown>;
    action.requestIndex = oldToNewIndex.get(action.requestIndex as number) as number;
  }
  network.requests = retained;
  return true;
}

function isExactProjectedApplicationDocument(request: Record<string, unknown>) {
  return hasExactKeys(request, [
    "externalTransport",
    "failure",
    "index",
    "method",
    "navigation",
    "postData",
    "redirectedFrom",
    "requestHeaders",
    "resourceType",
    "response",
    "scope",
    "serverAction",
    "url",
  ])
    && request.scope === "application"
    && request.method === "GET"
    && request.resourceType === "document"
    && request.navigation === true
    && isNoServerAction(request.serverAction)
    && request.postData === null
    && request.failure === null
    && request.externalTransport === null
    && isRecord(request.url)
    && request.url.origin === "<app-origin>"
    && Array.isArray(request.url.query)
    && request.url.fragment === null
    && Array.isArray(request.requestHeaders)
    && isRecord(request.response)
    && Number.isInteger(request.response.status);
}

function isExactProjectedNextStaticResource(request: Record<string, unknown>) {
  if (
    !hasExactKeys(request, [
      "externalTransport",
      "failure",
      "index",
      "method",
      "navigation",
      "postData",
      "redirectedFrom",
      "requestHeaders",
      "resourceType",
      "response",
      "scope",
      "serverAction",
      "url",
    ])
    || request.scope !== "application"
    || request.method !== "GET"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.redirectedFrom !== null
    || request.failure !== null
    || request.externalTransport !== null
    || !isRecord(request.url)
    || request.url.origin !== "<app-origin>"
    || !Array.isArray(request.url.query)
    || request.url.query.length !== 0
    || request.url.fragment !== null
    || !Array.isArray(request.requestHeaders)
    || request.requestHeaders.some((header) => (
      isRecord(header)
      && ["authorization", "next-action", "proxy-authorization", "rsc"]
        .includes(String(header.name).toLowerCase())
    ))
    || !isRecord(request.response)
    || request.response.status !== 200
    || !Array.isArray(request.response.headers)
  ) {
    return false;
  }
  const pathname = request.url.pathname;
  const expectedResourceType = pathname === "/_next/static/chunks/<compiled-content-hash>.css"
    ? "stylesheet"
    : /^\/_next\/static\/chunks\/(?:turbopack-)?<compiled-content-hash>\.js$/.test(
      String(pathname),
    )
      ? "script"
      : isExactProjectedNextStaticMediaResource(request, pathname)
        ? request.resourceType
        : null;
  if (request.resourceType !== expectedResourceType) return false;
  return true;
}

function isExactProjectedRemovableStaticResource(request: Record<string, unknown>) {
  return isSuccessfulHashedStaticAsset(request)
    || isExactProjectedNextStaticResource(request)
    || isExactProjectedApplicationStaticImage(request);
}

function isExactProjectedApplicationStaticImage(request: Record<string, unknown>) {
  if (
    !hasExactKeys(request, [
      "externalTransport",
      "failure",
      "index",
      "method",
      "navigation",
      "postData",
      "redirectedFrom",
      "requestHeaders",
      "resourceType",
      "response",
      "scope",
      "serverAction",
      "url",
    ])
    || request.scope !== "application"
    || request.method !== "GET"
    || request.resourceType !== "image"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.redirectedFrom !== null
    || request.failure !== null
    || request.externalTransport !== null
    || !isRecord(request.url)
    || request.url.origin !== "<app-origin>"
    || request.url.pathname !== "/clean-pay-logo.png"
    || !Array.isArray(request.url.query)
    || request.url.query.length !== 0
    || request.url.fragment !== null
    || !Array.isArray(request.requestHeaders)
    || !isRecord(request.response)
    || request.response.status !== 200
    || !Array.isArray(request.response.headers)
  ) {
    return false;
  }
  return request.response.headers.some((header) => (
    isRecord(header)
    && hasExactKeys(header, ["name", "value"])
    && header.name === "content-type"
    && header.value === "image/png"
  ));
}

function isExactProjectedNextStaticMediaResource(
  request: Record<string, unknown>,
  pathname: unknown,
) {
  return (
    request.resourceType === "font"
    || request.resourceType === "image"
  ) && /^\/_next\/static\/media\/[A-Za-z0-9._-]*<compiled-content-hash>[A-Za-z0-9._-]*\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp|woff2)$/.test(
    String(pathname),
  );
}

function projectExactHashedStaticDocumentLinkPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  const expectedNetwork = expected.network;
  const actualNetwork = actual.network;
  if (
    !isRecord(expectedNetwork)
    || !isRecord(actualNetwork)
    || !Array.isArray(expectedNetwork.requests)
    || !Array.isArray(actualNetwork.requests)
  ) {
    return;
  }
  const comparableLength = Math.min(
    expectedNetwork.requests.length,
    actualNetwork.requests.length,
  );
  for (let index = 0; index < comparableLength; index += 1) {
    const expectedValue = expectedNetwork.requests[index];
    const actualValue = actualNetwork.requests[index];
    if (
      !isRecord(expectedValue)
      || !isRecord(actualValue)
      || !isExactProjectedApplicationDocument(expectedValue)
      || !isExactProjectedApplicationDocument(actualValue)
      || !equalExceptKey(expectedValue, actualValue, "response")
      || !isRecord(expectedValue.response)
      || !isRecord(actualValue.response)
      || !equalExceptKey(expectedValue.response, actualValue.response, "headers")
      || !Array.isArray(expectedValue.response.headers)
      || !Array.isArray(actualValue.response.headers)
    ) {
      continue;
    }
    const expectedHeaders = expectedValue.response.headers;
    const actualHeaders = actualValue.response.headers;
    const expectedWithoutDisclosure = expectedHeaders.filter((header) => (
      !isExactNextJsPoweredByHeader(header)
    ));
    if (
      expectedHeaders.length - expectedWithoutDisclosure.length > 1
      || actualHeaders.some((header) => (
        isRecord(header) && header.name === "x-powered-by"
      ))
      || expectedWithoutDisclosure.length !== actualHeaders.length
    ) {
      continue;
    }
    const expectedLinkIndexes = namedHeaderIndexes(expectedWithoutDisclosure, "link");
    const actualLinkIndexes = namedHeaderIndexes(actualHeaders, "link");
    if (
      expectedLinkIndexes.length !== 1
      || actualLinkIndexes.length !== 1
      || expectedLinkIndexes[0] !== actualLinkIndexes[0]
    ) {
      continue;
    }
    const linkIndex = expectedLinkIndexes[0]!;
    const expectedLink = expectedWithoutDisclosure[linkIndex];
    const actualLink = actualHeaders[linkIndex];
    if (
      !isExactBoundedSha256Header(expectedLink, "link")
      || !isExactBoundedSha256Header(actualLink, "link")
      || expectedLink.value.bytes !== actualLink.value.bytes
      || expectedLink.value.sha256 === actualLink.value.sha256
    ) {
      continue;
    }
    const expectedComparable = cloneJson(expectedWithoutDisclosure);
    const actualComparable = cloneJson(actualHeaders);
    if (!Array.isArray(expectedComparable) || !Array.isArray(actualComparable)) continue;
    (expectedComparable[linkIndex] as Record<string, unknown>).value = {
      bytes: expectedLink.value.bytes,
      sha256: "<validated:next-static-link-topology>",
    };
    (actualComparable[linkIndex] as Record<string, unknown>).value = {
      bytes: actualLink.value.bytes,
      sha256: "<validated:next-static-link-topology>",
    };
    if (!sameJson(expectedComparable, actualComparable)) continue;
    expectedLink.value.sha256 = "<validated:next-static-link-topology>";
    actualLink.value.sha256 = "<validated:next-static-link-topology>";
  }
}

function isExactBoundedSha256Header(
  value: unknown,
  name: string,
): value is { name: string; value: { bytes: number; sha256: string } } {
  return isRecord(value)
    && hasExactKeys(value, ["name", "value"])
    && value.name === name
    && isRecord(value.value)
    && hasExactKeys(value.value, ["bytes", "sha256"])
    && Number.isSafeInteger(value.value.bytes)
    && Number(value.value.bytes) > 0
    && Number(value.value.bytes) <= 8_192
    && typeof value.value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.value.sha256);
}

function projectExactChromiumTransportIdentityPair(
  expected: unknown,
  actual: unknown,
  fixtureContractPairIsValid: boolean,
) {
  if (
    !isExactChromiumTransportIdentityEnvelopePair(
      expected,
      actual,
      fixtureContractPairIsValid,
    )
  ) {
    return;
  }

  const expectedNetwork = (expected as Record<string, unknown>).network as Record<string, unknown>;
  const actualNetwork = (actual as Record<string, unknown>).network as Record<string, unknown>;
  const expectedRequests = expectedNetwork.requests as unknown[];
  const actualRequests = actualNetwork.requests as unknown[];
  const replacements: Array<{
    actual: Record<string, unknown>;
    expected: Record<string, unknown>;
  }> = [];

  const comparableLength = Math.min(
    expectedRequests.length,
    actualRequests.length,
  );
  for (let position = 0; position < comparableLength; position += 1) {
    const expectedRequestValue = expectedRequests[position];
    const actualRequestValue = actualRequests[position];
    if (
      !isRecord(expectedRequestValue)
      || !isRecord(actualRequestValue)
      || expectedRequestValue.index !== position
      || actualRequestValue.index !== position
    ) {
      return;
    }
    const expectedHeaders = expectedRequestValue.requestHeaders;
    const actualHeaders = actualRequestValue.requestHeaders;
    if (
      !Array.isArray(expectedHeaders)
      || !Array.isArray(actualHeaders)
      || expectedHeaders.length !== actualHeaders.length
    ) {
      return;
    }

    for (const name of CHROMIUM_TRANSPORT_IDENTITY_HEADER_NAMES) {
      const expectedIndexes = namedHeaderIndexes(expectedHeaders, name);
      const actualIndexes = namedHeaderIndexes(actualHeaders, name);
      if (expectedIndexes.length === 0 && actualIndexes.length === 0) continue;
      if (
        expectedIndexes.length !== 1
        || actualIndexes.length !== 1
        || expectedIndexes[0] !== actualIndexes[0]
      ) {
        return;
      }

      const expectedHeader = expectedHeaders[expectedIndexes[0]!] as Record<string, unknown>;
      const actualHeader = actualHeaders[actualIndexes[0]!] as Record<string, unknown>;
      if (!isExactSanitizedHeader(
        expectedHeader,
        name,
        WINDOWS_CHROMIUM_TRANSPORT_IDENTITY[name],
      )) {
        return;
      }
      if (isExactSanitizedHeader(
        actualHeader,
        name,
        WINDOWS_CHROMIUM_TRANSPORT_IDENTITY[name],
      )) {
        continue;
      }
      if (!isExactSanitizedHeader(
        actualHeader,
        name,
        LINUX_CHROMIUM_TRANSPORT_IDENTITY[name],
      )) {
        return;
      }
      replacements.push({ actual: actualHeader, expected: expectedHeader });
    }
  }

  for (const replacement of replacements) {
    replacement.actual.value = cloneJson(replacement.expected.value);
  }
}

function isExactChromiumTransportIdentityEnvelopePair(
  expected: unknown,
  actual: unknown,
  fixtureContractPairIsValid: boolean,
) {
  if (!isRecord(expected) || !isRecord(actual)) return false;
  if (isExactPublicCharacterizationPair(expected, actual)) return true;
  if (
    !fixtureContractPairIsValid
    || !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isRecord(expected.network)
    || !isRecord(actual.network)
    || !hasExactKeys(expected.network, [
      "requests",
      "serverActionCount",
      "serverActions",
    ])
    || !hasExactKeys(actual.network, [
      "requests",
      "serverActionCount",
      "serverActions",
    ])
    || !Array.isArray(expected.network.requests)
    || !Array.isArray(actual.network.requests)
    || !Array.isArray(expected.network.serverActions)
    || !Array.isArray(actual.network.serverActions)
    || !Number.isSafeInteger(expected.network.serverActionCount)
    || !Number.isSafeInteger(actual.network.serverActionCount)
  ) {
    return false;
  }
  return true;
}

function namedHeaderIndexes(headers: unknown[], name: string) {
  return headers.flatMap((header, index) => (
    isRecord(header) && header.name === name ? [index] : []
  ));
}

function isExactJourneyFixtureContractPair(expected: unknown, actual: unknown) {
  const expectedFixture = exactRawJourneyFixtureContract(expected);
  const actualFixture = exactRawJourneyFixtureContract(actual);
  if (actualFixture?.sha256 !== currentJourneyFixtureContractSha256()) return false;
  return expectedFixture?.sha256 === PINNED_JOURNEY_V5_FIXTURE_SHA256
    || expectedFixture?.sha256 === currentJourneyFixtureContractSha256();
}

function exactRawJourneyFixtureContract(value: unknown) {
  if (!isRecord(value) || !hasExactJourneyManifestEnvelope(value)) return null;
  const source = value.source;
  if (!isExactJourneySourceProvenance(source)) return null;
  return source.fixtureContract;
}

function projectExactJourneyFixtureContract(expected: unknown, actual: unknown) {
  if (!isRecord(expected) || !isRecord(actual)) return;
  const expectedFixture = exactJourneyFixtureContract(expected);
  const actualFixture = exactJourneyFixtureContract(actual);
  if (
    !expectedFixture
    || !actualFixture
    || expectedFixture.sha256 !== PINNED_JOURNEY_V5_FIXTURE_SHA256
    || actualFixture.sha256 !== currentJourneyFixtureContractSha256()
  ) {
    return;
  }
  expectedFixture.sha256 = "<validated-journey-v5-fixture-sha256>";
  actualFixture.sha256 = "<validated-journey-v5-fixture-sha256>";
}

function exactJourneyFixtureContract(manifest: Record<string, unknown>) {
  const source = manifest.source;
  if (
    !hasExactJourneyManifestEnvelope(manifest)
    || !isRecord(source)
    || !isVersionedSha256Contract(source.fixtureContract, "journey-v5")
  ) {
    return null;
  }
  return source.fixtureContract;
}

function hasExactJourneyManifestEnvelope(manifest: Record<string, unknown>) {
  return manifest.schemaVersion === 2
    && manifest.baselineCommit === "f5cb6f543d85256e7733a1ade6a4f451d86cf378"
    && typeof manifest.project === "string"
    && /^journey-(?:390x844|768x1024|1440x900)$/.test(manifest.project)
    && typeof manifest.journey === "string";
}

function projectJourneyOfflineFallbackConsole(manifest: Record<string, unknown>) {
  const source = manifest.source;
  const consoleEvidence = manifest.console;
  if (
    manifest.schemaVersion !== 2
    || manifest.baselineCommit !== "f5cb6f543d85256e7733a1ade6a4f451d86cf378"
    || manifest.journey !== "public-responsive-keyboard-install-offline-support"
    || typeof manifest.project !== "string"
    || !/^journey-(?:390x844|768x1024|1440x900)$/.test(manifest.project)
    || !isRecord(source)
    || !isVersionedSha256Contract(source.fixtureContract, "journey-v5")
    || !isRecord(consoleEvidence)
    || !hasExactKeys(consoleEvidence, [
      "normalizedStaticCspViolations",
      "offlineFallbackResourceFailures",
    ])
    || !Array.isArray(consoleEvidence.normalizedStaticCspViolations)
    || !Array.isArray(consoleEvidence.offlineFallbackResourceFailures)
    || consoleEvidence.offlineFallbackResourceFailures.length !== 5
  ) {
    return;
  }
  const failures = consoleEvidence.offlineFallbackResourceFailures;
  const cssPaths: string[] = [];
  for (const [index, value] of failures.entries()) {
    if (!isRecord(value) || !isRecord(value.diagnostic)) return;
    const diagnostic = value.diagnostic;
    if (!isRecord(diagnostic.message) || !isRecord(diagnostic.location)) return;
    const location = diagnostic.location;
    if (!isRecord(location.url)) return;
    const expectedClass = index < 4 ? "compiled-css" : "logo";
    if (
      !hasExactKeys(value, ["diagnostic", "kind", "order", "resourceClass"])
      || value.kind !== "offline-resource-load-failure"
      || value.order !== index
      || value.resourceClass !== expectedClass
      || !hasExactKeys(diagnostic, ["location", "message", "type"])
      || diagnostic.type !== "error"
      || !hasExactKeys(diagnostic.message, ["bytes", "sha256"])
      || diagnostic.message.bytes !== 55
      || diagnostic.message.sha256
        !== "9432f8effe23a68459f7aa20703ce905a61dcf53282cb8611c650798ff432126"
      || !hasExactKeys(location, ["columnNumber", "lineNumber", "url"])
      || location.columnNumber !== 0
      || location.lineNumber !== 0
      || !hasExactKeys(location.url, ["fragment", "origin", "pathname", "query"])
      || location.url.origin !== "<app-origin>"
      || !Array.isArray(location.url.query)
      || location.url.query.length !== 0
      || location.url.fragment !== null
      || typeof location.url.pathname !== "string"
      || (expectedClass === "compiled-css"
        ? !STATIC_CHUNK_PATH.test(location.url.pathname)
          || !location.url.pathname.endsWith(".css")
        : location.url.pathname !== "/clean-pay-logo.png")
    ) {
      return;
    }
    if (expectedClass === "compiled-css") cssPaths.push(location.url.pathname);
  }
  if (new Set(cssPaths).size !== cssPaths.length) return;
  for (let index = 0; index < 4; index += 1) {
    const value = failures[index] as Record<string, unknown>;
    const diagnostic = value.diagnostic as Record<string, unknown>;
    const location = diagnostic.location as Record<string, unknown>;
    const url = location.url as Record<string, unknown>;
    url.pathname = "/_next/static/chunks/<compiled-content-hash>.css";
  }
}

function projectJourneySourceProvenance(manifest: Record<string, unknown>) {
  const source = manifest.source;
  if (!isExactJourneySourceProvenance(source)) return;
  source.revision = "<source-revision>";
  source.imageDigest = "sha256:<source-image-digest>";
  source.imageTag = "<source-image-tag>";
  source.migrationImageDigest = "sha256:<migration-image-digest>";
  source.migrationImageTag = "<migration-image-tag>";
}

function isExactJourneySourceProvenance(
  source: unknown,
): source is Record<string, unknown> & {
  fixtureContract: { sha256: string; version: string };
} {
  return isRecord(source)
    && hasExactKeys(source, [
      "browser",
      "fixtureContract",
      "imageDigest",
      "imageTag",
      "migrationImageDigest",
      "migrationImageTag",
      "publicBuildContract",
      "revision",
    ])
    && typeof source.revision === "string"
    && /^[a-f0-9]{40}$/.test(source.revision)
    && typeof source.imageDigest === "string"
    && /^sha256:[a-f0-9]{64}$/.test(source.imageDigest)
    && typeof source.imageTag === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(source.imageTag)
    && typeof source.migrationImageDigest === "string"
    && /^sha256:[a-f0-9]{64}$/.test(source.migrationImageDigest)
    && typeof source.migrationImageTag === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(source.migrationImageTag)
    && isVersionedSha256Contract(source.publicBuildContract, "1")
    && isVersionedSha256Contract(source.fixtureContract, "journey-v5")
    && isRecord(source.browser);
}

function isVersionedSha256Contract(
  value: unknown,
  version: string,
): value is { sha256: string; version: string } {
  return isRecord(value)
    && hasExactKeys(value, ["sha256", "version"])
    && value.version === version
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function projectJourneyProviderReadinessNoise(manifest: Record<string, unknown>) {
  const providerEffects = manifest.providerEffects;
  if (!isRecord(providerEffects) || !Array.isArray(providerEffects.entries)) return;
  if (!providerEffects.entries.every((entry) => (
    isRecord(entry) && Number.isSafeInteger(entry.sequence)
  ))) return;

  const entries = providerEffects.entries as Array<Record<string, unknown>>;
  const retained: Array<Record<string, unknown>> = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (isExactReadinessLedgerEntry(entry)) continue;
    if (isExactEnrichedReadinessCycle(entries, index)) {
      index += 6;
      continue;
    }
    retained.push(entry);
  }
  const withoutInterleavedReadiness = removeInterleavedExactEnrichedReadinessCycles(retained);
  canonicalizeExactConcurrentCabinetReads(manifest, withoutInterleavedReadiness);
  providerEffects.entries = withoutInterleavedReadiness.map((entry, index) => ({
    ...entry,
    sequence: index + 1,
  }));
}

function removeInterleavedExactEnrichedReadinessCycles(
  entries: Array<Record<string, unknown>>,
) {
  let retained = [...entries];
  while (true) {
    const positions = interleavedExactEnrichedReadinessCyclePositions(retained);
    if (!positions) return retained;
    const removed = new Set(positions);
    retained = retained.filter((_, index) => !removed.has(index));
  }
}

function interleavedExactEnrichedReadinessCyclePositions(
  entries: Array<Record<string, unknown>>,
) {
  const emailStart = entries.findIndex((entry) => (
    exactEnrichedReadinessKind(entry) === "/api/v1/public/auth/email/start"
  ));
  if (emailStart < 0) return null;
  const identify = findExactReadinessKindAfter(
    entries,
    "/api/v1/public/auth/identify",
    emailStart,
  );
  const serviceSession = findExactReadinessKindAfter(
    entries,
    "/api/v1/public/auth/service-session",
    identify,
  );
  const notificationPreferences = findExactReadinessKindAfter(
    entries,
    "/api/v1/public/auth/notification-preferences",
    serviceSession,
  );
  if (identify < 0 || serviceSession < 0 || notificationPreferences < 0) return null;
  const plans = entries.findIndex((entry, index) => (
    index < emailStart && exactEnrichedReadinessKind(entry) === "plans"
  ));
  if (plans < 0) return null;
  const metadata = entries.findIndex((entry) => (
    exactEnrichedReadinessKind(entry) === "metadata"
  ));
  const jwks = entries.findIndex((entry) => (
    exactEnrichedReadinessKind(entry) === "jwks"
  ));
  if (metadata < 0 || jwks < 0) return null;
  const positions = [
    plans,
    metadata,
    jwks,
    emailStart,
    identify,
    serviceSession,
    notificationPreferences,
  ];
  return new Set(positions).size === positions.length ? positions : null;
}

function findExactReadinessKindAfter(
  entries: Array<Record<string, unknown>>,
  kind: string,
  after: number,
) {
  if (after < 0) return -1;
  return entries.findIndex((entry, index) => (
    index > after && exactEnrichedReadinessKind(entry) === kind
  ));
}

function projectExactConcurrentCabinetReadPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isRecord(expected.providerEffects)
    || !isRecord(actual.providerEffects)
    || !Array.isArray(expected.providerEffects.entries)
    || !Array.isArray(actual.providerEffects.entries)
  ) {
    return;
  }
  const expectedEntries = exactConcurrentCabinetReadCanonicalEntries(
    expected.providerEffects.entries,
  );
  const actualEntries = exactConcurrentCabinetReadCanonicalEntries(
    actual.providerEffects.entries,
  );
  if (
    expectedEntries === null
    || actualEntries === null
    || !sameJson(expectedEntries, actualEntries)
  ) {
    return;
  }
  expected.providerEffects.entries = expectedEntries;
  actual.providerEffects.entries = actualEntries;
}

function projectExactPassiveProviderEffectOrderPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isAuthenticatedJourneyWithPassiveBrowserNoise(expected.journey)
    || !isRecord(expected.providerEffects)
    || !isRecord(actual.providerEffects)
    || !Array.isArray(expected.providerEffects.entries)
    || !Array.isArray(actual.providerEffects.entries)
  ) {
    return;
  }

  const expectedEntries = exactPassiveProviderEffectCanonicalEntries(
    expected.providerEffects.entries,
  );
  const actualEntries = exactPassiveProviderEffectCanonicalEntries(
    actual.providerEffects.entries,
  );
  if (
    expectedEntries === null
    || actualEntries === null
    || !sameJson(expectedEntries, actualEntries)
  ) {
    return;
  }

  expected.providerEffects.entries = expectedEntries;
  actual.providerEffects.entries = actualEntries;
}

function projectExactPassiveProviderEffectMultiplicityPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  if (
    !hasExactJourneyManifestEnvelope(expected)
    || !hasExactJourneyManifestEnvelope(actual)
    || !exactJourneyFixtureContract(expected)
    || !exactJourneyFixtureContract(actual)
    || expected.project !== actual.project
    || expected.journey !== actual.journey
    || !isExactPublicJourneyEnvelope(expected)
  ) {
    return;
  }

  const expectedTrial = cloneJson(expected);
  const actualTrial = cloneJson(actual);
  if (!isRecord(expectedTrial) || !isRecord(actualTrial)) return;
  const expectedChanged = removeExactPassiveProviderEffects(expectedTrial);
  const actualChanged = removeExactPassiveProviderEffects(actualTrial);
  if (!expectedChanged && !actualChanged) return;
  projectJourneyProviderReadinessNoise(expectedTrial);
  projectJourneyProviderReadinessNoise(actualTrial);
  projectExactConcurrentCabinetReadPair(expectedTrial, actualTrial);
  projectExactPassiveProviderEffectOrderPair(expectedTrial, actualTrial);
  projectExactTelegramAuthProviderDynamicPair(expectedTrial, actualTrial);
  projectExactPasskeySetupPayloadPair(expectedTrial, actualTrial);
  projectExactTelegramLoginPayloadBytesPair(expectedTrial, actualTrial);
  projectExactActiveServerActionDynamicDigestPair(expectedTrial, actualTrial);
  projectExactServerActionDynamicDigestPair(expectedTrial, actualTrial);
  projectExactJourneyFixtureContract(expectedTrial, actualTrial);
  projectPairedJourneyInlineStyles(expectedTrial, actualTrial);
  if (!sameJson(expectedTrial, actualTrial)) return;
  applyExactAuthenticatedPassiveProjection(expected, expectedTrial);
  applyExactAuthenticatedPassiveProjection(actual, actualTrial);
}

function exactPassiveProviderEffectCanonicalEntries(entries: unknown[]) {
  const orderedActiveEntries: Record<string, unknown>[] = [];
  const passiveEntries: Record<string, unknown>[] = [];
  for (const [index, entryValue] of entries.entries()) {
    if (
      !isRecord(entryValue)
      || entryValue.sequence !== index + 1
  ) {
      return null;
    }
    const entry = { ...entryValue, sequence: 0 };
    if (isExactPassiveProviderEffect(entry)) {
      passiveEntries.push(entry);
    } else {
      orderedActiveEntries.push(entry);
    }
  }
  const deduped = dedupeExactChatwootContactProbeEffects(passiveEntries);
  deduped.sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
  return [
    ...orderedActiveEntries,
    ...deduped,
  ].map((entry, index) => ({
    ...entry,
    sequence: index + 1,
  }));
}

function dedupeExactChatwootContactProbeEffects(entries: Record<string, unknown>[]) {
  const seenContactProbes = new Set<string>();
  return entries.filter((entry) => {
    if (!isExactChatwootContactProbeEffect(entry)) return true;
    const signature = JSON.stringify({ ...entry, sequence: 0 });
    if (seenContactProbes.has(signature)) return false;
    seenContactProbes.add(signature);
    return true;
  });
}

function isExactPassiveProviderEffect(entry: Record<string, unknown>) {
  return isExactReadinessLedgerEntry(entry)
    || exactEnrichedReadinessKind(entry) !== null
    || exactConcurrentCabinetReadKind(entry) !== null
    || isExactChatwootContactProbeEffect(entry);
}

function isExactChatwootContactProbeEffect(entry: Record<string, unknown>) {
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
    && entry.service === "chatwoot"
    && entry.method === "GET"
    && entry.pathname === "/api/v1/widget/contact"
    && entry.effect === "contact_identity_probed"
    && Array.isArray(entry.query_keys)
    && sameJson(entry.query_keys, ["website_token"])
    && entry.body_bytes === 0
    && entry.body_sha256 === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    && entry.body_contract === null
    && entry.idempotency_key_present === false
    && entry.idempotency_key_sha256 === null
    && entry.idempotency_key_contract === null
    && isRecord(entry.credential_contract)
    && hasExactKeys(entry.credential_contract, [
      "authorization_scheme",
      "cookie_names",
      "header_names",
    ])
    && entry.credential_contract.authorization_scheme === null
    && sameJson(entry.credential_contract.cookie_names, [])
    && sameJson(entry.credential_contract.header_names, ["x-auth-token"]);
}

function exactConcurrentCabinetReadCanonicalEntries(entries: unknown[]) {
  const projected: Record<string, unknown>[] = [];
  const reads: Array<{
    entry: Record<string, unknown>;
    sortKey: string;
  }> = [];
  const readPositions: number[] = [];
  for (const [index, entryValue] of entries.entries()) {
    if (
      !isRecord(entryValue)
      || entryValue.sequence !== index + 1
    ) {
      return null;
    }
    const entry = { ...entryValue };
    const kind = exactConcurrentCabinetReadKind(entry);
    projected.push(entry);
    if (kind === null) continue;
    const comparableEntry = { ...entry, sequence: 0 };
    reads.push({
      entry,
      sortKey: JSON.stringify({
        order: exactConcurrentCabinetReadOrder(kind),
        entry: comparableEntry,
      }),
    });
    readPositions.push(index);
  }
  if (reads.length < 2) return projected;

  reads.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  for (const [offset, position] of readPositions.entries()) {
    projected[position] = reads[offset]!.entry;
  }
  return projected.map((entry, index) => ({
    ...entry,
    sequence: index + 1,
  }));
}

function canonicalizeExactConcurrentCabinetReads(
  manifest: Record<string, unknown>,
  entries: Array<Record<string, unknown>>,
) {
  if (
    !hasExactJourneyManifestEnvelope(manifest)
    || !exactJourneyFixtureContract(manifest)
    || ![
      "email-account-links-and-merges-telegram",
      "email-register-verify-and-login",
      "tariffs-payment-returns-extend-idempotency",
      "telegram-oidc-cabinet-profile-link-referral-passkey",
      "telegram-webapp-browser-boundary",
    ].includes(String(manifest.journey))
  ) {
    return;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const start = index;
    const run: Array<{
      entry: Record<string, unknown>;
      kind: ExactConcurrentCabinetReadKind;
    }> = [];
    while (index < entries.length) {
      const entry = entries[index]!;
      const kind = exactConcurrentCabinetReadKind(entry);
      if (
        kind === null
        || (
          run.length > 0
          && Number(run.at(-1)!.entry.sequence) + 1 !== entry.sequence
        )
      ) {
        break;
      }
      run.push({ entry, kind });
      index += 1;
    }
    if (run.length < 2) {
      index = start;
      continue;
    }
    const sorted = [...run].sort((left, right) => (
      exactConcurrentCabinetReadOrder(left.kind)
      - exactConcurrentCabinetReadOrder(right.kind)
    ));
    for (const [offset, plan] of sorted.entries()) {
      entries[start + offset] = plan.entry;
    }
    index -= 1;
  }
}

type ExactConcurrentCabinetReadKind = typeof EXACT_CONCURRENT_CABINET_READ_ORDER[number];

function exactConcurrentCabinetReadOrder(kind: ExactConcurrentCabinetReadKind) {
  return EXACT_CONCURRENT_CABINET_READ_ORDER.indexOf(kind);
}

function exactConcurrentCabinetReadKind(entry: Record<string, unknown>) {
  if (
    !hasExactKeys(entry, [
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
    || !Number.isSafeInteger(entry.sequence)
    || entry.method !== "GET"
    || !Array.isArray(entry.query_keys)
    || entry.query_keys.length !== 0
    || entry.body_bytes !== 0
    || entry.body_sha256
      !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    || entry.body_contract !== null
    || entry.idempotency_key_present !== false
    || entry.idempotency_key_sha256 !== null
    || entry.idempotency_key_contract !== null
  ) {
    return null;
  }
  if (
    entry.pathname === "/api/v1/public/auth/me"
    && entry.effect === "read_profile"
    && isExactCabinetReadCredential(
      entry.credential_contract,
      ["x-remnashop-auth-service-key"],
    )
  ) {
    return "profile";
  }
  if (
    entry.pathname === "/api/v1/public/referral/program"
    && entry.effect === "read_referral_program"
    && isExactCabinetReadCredential(entry.credential_contract, [])
  ) {
    return "referral-program";
  }
  if (
    entry.pathname === "/api/v1/public/subscription/current"
    && entry.effect === "read_subscription"
    && isExactCabinetReadCredential(entry.credential_contract, [])
  ) {
    return "subscription";
  }
  if (
    entry.pathname === "/api/v1/public/subscription/offers"
    && entry.effect === "read_offers"
    && isExactCabinetReadCredential(entry.credential_contract, [])
  ) {
    return "offers";
  }
  if (
    entry.pathname === "/api/v1/public/subscription/devices"
    && entry.effect === "read_devices"
    && isExactCabinetReadCredential(entry.credential_contract, [])
  ) {
    return "devices";
  }
  if (
    entry.service === "remnawave"
    && entry.pathname === "/api/users/rw-browser-1"
    && entry.effect === "read_user_by_uuid"
    && isExactRemnawaveReadCredential(entry.credential_contract)
  ) {
    return "remnawave-user";
  }
  return null;
}

function isExactCabinetReadCredential(value: unknown, headerNames: string[]) {
  return isRecord(value)
    && hasExactKeys(value, ["authorization_scheme", "cookie_names", "header_names"])
    && value.authorization_scheme === null
    && sameJson(value.cookie_names, ["access_token"])
    && sameJson(value.header_names, headerNames);
}

function isExactRemnawaveReadCredential(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["authorization_scheme", "cookie_names", "header_names"])
    && value.authorization_scheme === "Bearer"
    && sameJson(value.cookie_names, [])
    && sameJson(value.header_names, ["authorization"]);
}

function isExactReadinessLedgerEntry(entry: Record<string, unknown>) {
  const legacyKeys = [
    "body_bytes",
    "body_sha256",
    "effect",
    "idempotency_key_present",
    "idempotency_key_sha256",
    "method",
    "pathname",
    "query_keys",
    "sequence",
    "service",
  ];
  if (
    !hasExactKeys(entry, legacyKeys)
    || !Array.isArray(entry.query_keys)
    || entry.query_keys.length !== 0
    || entry.idempotency_key_present !== false
    || entry.idempotency_key_sha256 !== null
  ) {
    return false;
  }

  const emptyBody = entry.body_bytes === 0
    && entry.body_sha256 === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const emptyJsonObject = entry.body_bytes === 2
    && entry.body_sha256 === "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
  const exactRead = entry.method === "GET" && emptyBody && (
    (entry.service === "remnashop"
      && entry.pathname === "/api/v1/public/plans/public"
      && entry.effect === "read_public_plans")
    || (entry.service === "remnawave"
      && entry.pathname === "/api/system/metadata"
      && entry.effect === "read_metadata")
  );
  const exactProbePath = [
    "/api/v1/public/auth/email/start",
    "/api/v1/public/auth/identify",
    "/api/v1/public/auth/service-session",
    "/api/v1/public/auth/notification-preferences",
  ].includes(String(entry.pathname));
  const exactProbe = entry.service === "remnashop"
    && entry.method === "POST"
    && exactProbePath
    && emptyJsonObject
    && entry.effect === "probe_contract";
  return exactRead || exactProbe;
}

function isExactEmptyJsonBodyContract(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["encoding", "value"])
    && value.encoding === "json"
    && isRecord(value.value)
    && Object.keys(value.value).length === 0;
}

function isExactEnrichedReadinessCycle(
  entries: Array<Record<string, unknown>>,
  startIndex: number,
) {
  const cycle = entries.slice(startIndex, startIndex + 7);
  if (cycle.length !== 7) return false;
  const firstSequence = cycle[0]?.sequence;
  if (!Number.isSafeInteger(firstSequence)) return false;
  if (!cycle.every((entry, index) => entry.sequence === Number(firstSequence) + index)) {
    return false;
  }
  const kinds = cycle.map(exactEnrichedReadinessKind);
  return kinds.every((kind): kind is string => kind !== null)
    && new Set(kinds).size === 7;
}

function exactEnrichedReadinessKind(entry: Record<string, unknown>) {
  if (isExactEnrichedReadinessRead(
    entry,
    "remnashop",
    "/api/v1/public/plans/public",
    "read_public_plans",
  )) return "plans";
  if (isExactEnrichedReadinessRead(
    entry,
    "remnawave",
    "/api/system/metadata",
    "read_metadata",
  )) return "metadata";
  if (isExactEnrichedReadinessJwks(entry)) return "jwks";
  for (const pathname of [
    "/api/v1/public/auth/email/start",
    "/api/v1/public/auth/identify",
    "/api/v1/public/auth/service-session",
    "/api/v1/public/auth/notification-preferences",
  ]) {
    if (isExactEnrichedReadinessProbe(entry, pathname)) return pathname;
  }
  return null;
}

function isExactEnrichedReadinessRead(
  entry: Record<string, unknown>,
  service: string,
  pathname: string,
  effect: string,
) {
  return hasExactEnrichedReadinessEnvelope(entry)
    && entry.service === service
    && entry.method === "GET"
    && entry.pathname === pathname
    && entry.body_bytes === 0
    && entry.body_sha256 === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    && entry.body_contract === null
    && entry.effect === effect;
}

function isExactEnrichedReadinessJwks(entry: Record<string, unknown>) {
  return hasExactEnrichedReadinessEnvelope(entry)
    && entry.service === "telegram-oidc"
    && entry.method === "GET"
    && entry.pathname === "/.well-known/jwks.json"
    && entry.body_bytes === 0
    && entry.body_sha256 === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    && entry.body_contract === null
    && entry.effect === "jwks_read";
}

function isExactEnrichedReadinessProbe(
  entry: Record<string, unknown>,
  pathname: string,
) {
  return hasExactEnrichedReadinessEnvelope(entry)
    && entry.service === "remnashop"
    && entry.method === "POST"
    && entry.pathname === pathname
    && entry.body_bytes === 2
    && entry.body_sha256 === "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    && isExactEmptyJsonBodyContract(entry.body_contract)
    && entry.effect === "probe_contract";
}

function hasExactEnrichedReadinessEnvelope(entry: Record<string, unknown>) {
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
    && Array.isArray(entry.query_keys)
    && entry.query_keys.length === 0
    && entry.idempotency_key_present === false
    && entry.idempotency_key_sha256 === null
    && entry.idempotency_key_contract === null
    && isExactReadinessCredentialContract(entry);
}

function isExactReadinessCredentialContract(entry: Record<string, unknown>) {
  const value = entry.credential_contract;
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["authorization_scheme", "cookie_names", "header_names"])
    || !Array.isArray(value.cookie_names)
    || value.cookie_names.length !== 0
    || !Array.isArray(value.header_names)
  ) {
    return false;
  }
  if (entry.service === "remnawave") {
    return value.authorization_scheme === "Bearer"
      && JSON.stringify(value.header_names) === JSON.stringify(["authorization"]);
  }
  const authProbe = typeof entry.pathname === "string" && entry.pathname.startsWith("/api/v1/public/auth/");
  return value.authorization_scheme === null
    && JSON.stringify(value.header_names) === JSON.stringify(
      authProbe ? ["x-remnashop-auth-service-key"] : [],
    );
}

function projectJourneyCheckpointA11y(manifest: Record<string, unknown>) {
  if (!Array.isArray(manifest.checkpoints)) return;
  for (const checkpoint of manifest.checkpoints) {
    if (!isRecord(checkpoint) || !isRecord(checkpoint.url)) continue;
    const checkpointManifest: Record<string, unknown> = {
      route: { requested: checkpoint.url, final: checkpoint.url },
      dom: checkpoint.dom,
      computedStyles: checkpoint.computedStyles,
      interactiveElements: checkpoint.interactiveElements,
      ariaSnapshot: checkpoint.ariaSnapshot,
    };
    projectAllowlistedA11ySemantics(checkpointManifest);
    projectStaticDomAssetReferences(checkpointManifest);
    checkpoint.dom = checkpointManifest.dom;
    checkpoint.computedStyles = checkpointManifest.computedStyles;
    checkpoint.interactiveElements = checkpointManifest.interactiveElements;
    checkpoint.ariaSnapshot = checkpointManifest.ariaSnapshot;
  }
}

function projectConsecutiveDuplicateNavigations(manifest: Record<string, unknown>) {
  if (
    !hasExactJourneyManifestEnvelope(manifest)
    || !exactJourneyFixtureContract(manifest)
    || !Array.isArray(manifest.navigations)
  ) {
    return;
  }

  const retained: unknown[] = [];
  for (const navigation of manifest.navigations) {
    if (!isRecord(navigation) || !isCanonicalUrl(navigation)) return;
    if (retained.length > 0 && sameJson(retained.at(-1), navigation)) continue;
    retained.push(navigation);
  }
  manifest.navigations = retained;
}

function projectJourneyPaymentOperationAria(manifest: Record<string, unknown>) {
  if (
    !hasExactJourneyManifestEnvelope(manifest)
    || !exactJourneyFixtureContract(manifest)
    || manifest.journey !== "tariffs-payment-returns-extend-idempotency"
    || !Array.isArray(manifest.checkpoints)
  ) {
    return;
  }
  const operationPattern = /"origin":"<app-origin>","pathname":"\/payment\/pending","query":\[\{"key":"operation_id","value":"<sha256:[a-f0-9]{16}>"\}\],"fragment":null/g;
  for (const checkpoint of manifest.checkpoints) {
    if (
      !isRecord(checkpoint)
      || !["payment-provider-checkout", "extend-provider-checkout"]
        .includes(String(checkpoint.label))
      || typeof checkpoint.ariaSnapshot !== "string"
    ) {
      continue;
    }
    const matches = checkpoint.ariaSnapshot.match(operationPattern);
    if (matches?.length !== 1) continue;
    checkpoint.ariaSnapshot = checkpoint.ariaSnapshot.replace(
      operationPattern,
      "\"origin\":\"<app-origin>\",\"pathname\":\"/payment/pending\",\"query\":[{\"key\":\"operation_id\",\"value\":\"<dynamic:query-operation_id:1>\"}],\"fragment\":null",
    );
  }
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

export function projectCharacterizationManifestBytesForComparison(
  value: Uint8Array,
) {
  const parsed: unknown = JSON.parse(Buffer.from(value).toString("utf8"));
  return Buffer.from(
    `${JSON.stringify(projectCharacterizationManifestForComparison(parsed), null, 2)}\n`,
  );
}

export function projectCharacterizationManifestPairBytesForComparison(
  expectedValue: Uint8Array,
  actualValue: Uint8Array,
  options: {
    actualApplicationOrigin?: string;
    expectedApplicationOrigin?: string;
  } = {},
) {
  const expectedParsed: unknown = JSON.parse(Buffer.from(expectedValue).toString("utf8"));
  const actualParsed: unknown = JSON.parse(Buffer.from(actualValue).toString("utf8"));
  const projected = projectCharacterizationManifestPairForComparison(
    expectedParsed,
    actualParsed,
    options,
  );
  return {
    expected: Buffer.from(`${JSON.stringify(projected.expected, null, 2)}\n`),
    actual: Buffer.from(`${JSON.stringify(projected.actual, null, 2)}\n`),
  };
}

function projectExactLocalApplicationHostPair(
  expected: unknown,
  actual: unknown,
  expectedApplicationOrigin: string | undefined,
  actualApplicationOrigin: string | undefined,
) {
  const explicitLivePair = expectedApplicationOrigin !== undefined;
  const expectedHost = expectedApplicationOrigin === undefined
    ? new URL(IMMUTABLE_PUBLIC_BASELINE_APPLICATION_ORIGIN).host
    : exactIsolatedLocalApplicationHost(expectedApplicationOrigin, true);
  const actualHost = exactIsolatedLocalApplicationHost(
    actualApplicationOrigin,
    explicitLivePair,
  );
  if (
    !expectedHost
    || !actualHost
    || (expectedApplicationOrigin !== undefined
      && expectedApplicationOrigin === actualApplicationOrigin)
    || !isExactPublicCharacterizationPair(expected, actual)
  ) {
    return;
  }

  const expectedNetwork = (expected as Record<string, unknown>).network as Record<string, unknown>;
  const actualNetwork = (actual as Record<string, unknown>).network as Record<string, unknown>;
  const expectedRequests = expectedNetwork.requests as unknown[];
  const actualRequests = actualNetwork.requests as unknown[];
  const validatedHeaders: Array<{
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
  }> = [];

  for (const [position, expectedRequestValue] of expectedRequests.entries()) {
    const actualRequestValue = actualRequests[position];
    if (!isRecord(expectedRequestValue) || !isRecord(actualRequestValue)) return;
    const expectedHeaders = expectedRequestValue.requestHeaders;
    const actualHeaders = actualRequestValue.requestHeaders;
    if (!Array.isArray(expectedHeaders) || !Array.isArray(actualHeaders)) return;

    const expectedHostHeaders = namedHeaders(expectedHeaders, "host");
    const actualHostHeaders = namedHeaders(actualHeaders, "host");
    if (expectedHostHeaders.length === 0 && actualHostHeaders.length === 0) continue;
    if (
      expectedHostHeaders.length !== 1
      || actualHostHeaders.length !== 1
      || !isExactApplicationRequestPair(expectedRequestValue, actualRequestValue)
    ) {
      return;
    }

    const expectedHeader = expectedHostHeaders[0];
    const actualHeader = actualHostHeaders[0];
    if (
      !isExactSanitizedHeader(
        expectedHeader,
        "host",
        digestValue(expectedHost),
      )
      || !isExactSanitizedHeader(actualHeader, "host", digestValue(actualHost))
      || !headersMatchAfterValidatedHost(
        expectedHeaders,
        actualHeaders,
        expectedHeader,
        actualHeader,
      )
    ) {
      return;
    }
    validatedHeaders.push({ expected: expectedHeader, actual: actualHeader });
  }

  for (const pair of validatedHeaders) {
    pair.expected.value = VALIDATED_LOCAL_APPLICATION_HOST;
    pair.actual.value = VALIDATED_LOCAL_APPLICATION_HOST;
  }
}

function isExactPublicCharacterizationPair(expected: unknown, actual: unknown) {
  if (!isRecord(expected) || !isRecord(actual)) return false;
  if (
    !isExactPublicCharacterizationEnvelope(expected)
    || !isExactPublicCharacterizationEnvelope(actual)
    || expected.project !== actual.project
    || !sameJson(expected.route, actual.route)
  ) {
    return false;
  }
  const expectedNetwork = expected.network as Record<string, unknown>;
  const actualNetwork = actual.network as Record<string, unknown>;
  return (expectedNetwork.requests as unknown[]).length
    === (actualNetwork.requests as unknown[]).length;
}

function isExactPublicCharacterizationEnvelope(value: Record<string, unknown>) {
  if (
    value.schemaVersion !== 1
    || value.baselineCommit !== "f5cb6f543d85256e7733a1ade6a4f451d86cf378"
    || typeof value.project !== "string"
    || !/^chromium-(?:390x844|768x1024|1440x900)$/.test(value.project)
    || !isRecord(value.route)
    || !hasExactKeys(value.route, [
      "final",
      "finalStatus",
      "id",
      "kind",
      "redirects",
      "requested",
    ])
    || !isRecord(value.network)
    || !hasExactKeys(value.network, [
      "requests",
      "serverActionCount",
      "serverActions",
    ])
  ) {
    return false;
  }
  return Array.isArray(value.network.requests)
    && Array.isArray(value.network.serverActions)
    && Number.isSafeInteger(value.network.serverActionCount);
}

function exactIsolatedLocalApplicationHost(
  value: string | undefined,
  allowImmutableBaselineOrigin = false,
) {
  if (
    typeof value !== "string"
    || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value)
    || (!allowImmutableBaselineOrigin
      && value === IMMUTABLE_PUBLIC_BASELINE_APPLICATION_ORIGIN)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== value
      || parsed.protocol !== "http:"
      || parsed.hostname !== "127.0.0.1"
      || !parsed.port
      || Number(parsed.port) > 65_535
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    return parsed.host;
  } catch {
    return null;
  }
}

function isExactApplicationRequestPair(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  const requestKeys = [
    "externalTransport",
    "failure",
    "index",
    "method",
    "navigation",
    "postData",
    "redirectedFrom",
    "requestHeaders",
    "resourceType",
    "response",
    "scope",
    "serverAction",
    "url",
  ];
  if (
    !hasExactKeys(expected, requestKeys)
    || !hasExactKeys(actual, requestKeys)
    || expected.scope !== "application"
    || actual.scope !== "application"
    || !isExactApplicationUrl(expected.url)
    || !isExactApplicationUrl(actual.url)
  ) {
    return false;
  }
  return equalExceptKeys(expected, actual, ["requestHeaders", "response"]);
}

function isExactApplicationUrl(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["fragment", "origin", "pathname", "query"])
    && value.origin === "<app-origin>"
    && typeof value.pathname === "string"
    && value.pathname.startsWith("/")
    && Array.isArray(value.query)
    && (value.fragment === null || typeof value.fragment === "string");
}

function namedHeaders(headers: unknown[], name: string) {
  return headers.filter(
    (header): header is Record<string, unknown> => (
      isRecord(header) && header.name === name
    ),
  );
}

function isExactSanitizedHeader(
  value: Record<string, unknown>,
  name: string,
  digest: { bytes: number; sha256: string },
) {
  return hasExactKeys(value, ["name", "value"])
    && value.name === name
    && isExactDigest(value.value, digest);
}

function headersMatchAfterValidatedHost(
  expectedHeaders: unknown[],
  actualHeaders: unknown[],
  expectedHost: Record<string, unknown>,
  actualHost: Record<string, unknown>,
) {
  if (expectedHeaders.length !== actualHeaders.length) return false;
  const expectedComparable = expectedHeaders.map((header) => (
    header === expectedHost ? { name: "host", value: VALIDATED_LOCAL_APPLICATION_HOST } : header
  ));
  const actualComparable = actualHeaders.map((header) => (
    header === actualHost ? { name: "host", value: VALIDATED_LOCAL_APPLICATION_HOST } : header
  ));
  return sameJson(expectedComparable, actualComparable);
}

function projectExactOptionalPublicStaticOriginPair(expected: unknown, actual: unknown) {
  if (
    !isExactPublicCharacterizationPair(expected, actual)
    && !isExactJourneyFixtureProjectionPair(expected, actual)
  ) {
    return;
  }
  const expectedNetwork = (expected as Record<string, unknown>).network as Record<string, unknown>;
  const actualNetwork = (actual as Record<string, unknown>).network as Record<string, unknown>;
  const expectedRequests = expectedNetwork.requests as unknown[];
  const actualRequests = actualNetwork.requests as unknown[];
  const projections: Array<{
    actual: Record<string, unknown>;
    actualHeaders: unknown[];
    expected: Record<string, unknown>;
    expectedHeaders: unknown[];
  }> = [];

  const comparableLength = Math.min(expectedRequests.length, actualRequests.length);
  for (let position = 0; position < comparableLength; position += 1) {
    const expectedRequestValue = expectedRequests[position];
    const actualRequestValue = actualRequests[position];
    if (!isRecord(expectedRequestValue) || !isRecord(actualRequestValue)) return;
    const projection = exactOptionalPublicStaticOriginProjection(
      expectedRequestValue,
      actualRequestValue,
    );
    if (projection === null) continue;
    projections.push(projection);
  }

  for (const projection of projections) {
    projection.expected.requestHeaders = projection.expectedHeaders;
    projection.actual.requestHeaders = projection.actualHeaders;
  }
}

function isExactJourneyFixtureProjectionPair(expected: unknown, actual: unknown) {
  return isRecord(expected)
    && isRecord(actual)
    && hasExactJourneyManifestEnvelope(expected)
    && hasExactJourneyManifestEnvelope(actual)
    && exactJourneyFixtureContract(expected) !== null
    && exactJourneyFixtureContract(actual) !== null
    && expected.project === actual.project
    && expected.journey === actual.journey
    && isRecord(expected.network)
    && isRecord(actual.network)
    && Array.isArray(expected.network.requests)
    && Array.isArray(actual.network.requests);
}

function exactOptionalPublicStaticOriginProjection(
  expectedRequest: Record<string, unknown>,
  actualRequest: Record<string, unknown>,
) {
  if (
    !isExactProjectedNextStaticResource(expectedRequest)
    || !isExactProjectedNextStaticResource(actualRequest)
    || !equalExceptKey(expectedRequest, actualRequest, "requestHeaders")
  ) {
    return null;
  }
  const expectedHeaders = withoutExactOptionalOriginHeader(
    expectedRequest.requestHeaders as unknown[],
  );
  const actualHeaders = withoutExactOptionalOriginHeader(
    actualRequest.requestHeaders as unknown[],
  );
  if (
    expectedHeaders === null
    || actualHeaders === null
    || expectedHeaders.removed === actualHeaders.removed
    || !sameJson(expectedHeaders.headers, actualHeaders.headers)
  ) {
    return null;
  }
  return {
    actual: actualRequest,
    actualHeaders: actualHeaders.headers,
    expected: expectedRequest,
    expectedHeaders: expectedHeaders.headers,
  };
}

function withoutExactOptionalOriginHeader(headers: unknown[]) {
  let removed = false;
  const retained: unknown[] = [];
  for (const header of headers) {
    if (!isRecord(header) || header.name !== "origin") {
      retained.push(header);
      continue;
    }
    if (removed || !isExactApplicationOriginHeader(header)) return null;
    removed = true;
  }
  return { headers: retained, removed };
}

function isExactApplicationOriginHeader(value: Record<string, unknown>) {
  return hasExactKeys(value, ["name", "value"])
    && value.name === "origin"
    && sameJson(value.value, {
      origin: "<app-origin>",
      pathname: "/",
      query: [],
      fragment: null,
    });
}

function projectExactRemovedNextJsPoweredBy(expected: unknown, actual: unknown) {
  if (!isRecord(expected) || !isRecord(actual)) return;
  const expectedNetwork = expected.network;
  const actualNetwork = actual.network;
  projectExactRemovedNextJsPoweredByRequests(
    isRecord(expectedNetwork) ? expectedNetwork.requests : undefined,
    isRecord(actualNetwork) ? actualNetwork.requests : undefined,
    true,
  );
  const expectedLog = expected.log;
  const actualLog = actual.log;
  projectExactRemovedNextJsPoweredByRequests(
    isRecord(expectedLog) ? expectedLog.entries : undefined,
    isRecord(actualLog) ? actualLog.entries : undefined,
    false,
  );
}

function projectExactOptionalZeroContentLengthPair(expected: unknown, actual: unknown) {
  if (!isRecord(expected) || !isRecord(actual)) return;
  const expectedNetwork = expected.network;
  const actualNetwork = actual.network;
  projectExactOptionalZeroContentLengthRequests(
    isRecord(expectedNetwork) ? expectedNetwork.requests : undefined,
    isRecord(actualNetwork) ? actualNetwork.requests : undefined,
  );
}

function projectExactOptionalZeroContentLengthRequests(
  expectedRequests: unknown,
  actualRequests: unknown,
) {
  if (!Array.isArray(expectedRequests) || !Array.isArray(actualRequests)) return;
  const requestCount = Math.min(expectedRequests.length, actualRequests.length);
  for (let position = 0; position < requestCount; position += 1) {
    const expectedRequestValue = expectedRequests[position];
    const actualRequestValue = actualRequests[position];
    if (
      !isRecord(expectedRequestValue)
      || !isRecord(actualRequestValue)
      || expectedRequestValue.scope !== "application"
      || actualRequestValue.scope !== "application"
      || !equalExceptKey(expectedRequestValue, actualRequestValue, "response")
      || !isRecord(expectedRequestValue.response)
      || !isRecord(actualRequestValue.response)
      || expectedRequestValue.response.status !== 307
      || actualRequestValue.response.status !== 307
      || !equalExceptKey(expectedRequestValue.response, actualRequestValue.response, "headers")
    ) {
      continue;
    }
    projectExactOptionalZeroContentLengthHeaders(
      expectedRequestValue.response,
      actualRequestValue.response,
    );
  }
}

function projectExactOptionalZeroContentLengthHeaders(
  expectedResponse: Record<string, unknown>,
  actualResponse: Record<string, unknown>,
) {
  const expectedHeaders = expectedResponse.headers;
  const actualHeaders = actualResponse.headers;
  if (!Array.isArray(expectedHeaders) || !Array.isArray(actualHeaders)) return;

  if (removeExactOptionalZeroContentLengthHeader(expectedHeaders, actualHeaders)) {
    expectedResponse.headers = expectedHeaders.filter((header) => (
      !isExactZeroContentLengthHeader(header)
    ));
    return;
  }
  if (removeExactOptionalZeroContentLengthHeader(actualHeaders, expectedHeaders)) {
    actualResponse.headers = actualHeaders.filter((header) => (
      !isExactZeroContentLengthHeader(header)
    ));
  }
}

function removeExactOptionalZeroContentLengthHeader(
  sourceHeaders: unknown[],
  targetHeaders: unknown[],
) {
  const contentLengthIndexes = sourceHeaders.flatMap((header, index) => (
    isExactZeroContentLengthHeader(header) ? [index] : []
  ));
  if (
    contentLengthIndexes.length !== 1
    || targetHeaders.some((header) => (
      isRecord(header) && header.name === "content-length"
    ))
  ) {
    return false;
  }

  const sourceWithoutContentLength = sourceHeaders.filter(
    (_, index) => index !== contentLengthIndexes[0],
  );
  return sameJson(sourceWithoutContentLength, targetHeaders);
}

function isExactZeroContentLengthHeader(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["name", "value"])
    && value.name === "content-length"
    && value.value === "0";
}

function projectExactRemovedNextJsPoweredByRequests(
  expectedRequests: unknown,
  actualRequests: unknown,
  requireApplicationScope: boolean,
) {
  if (
    !Array.isArray(expectedRequests)
    || !Array.isArray(actualRequests)
  ) {
    return;
  }

  const requestCount = Math.min(
    expectedRequests.length,
    actualRequests.length,
  );
  for (let position = 0; position < requestCount; position += 1) {
    const expectedRequestValue = expectedRequests[position];
    const actualRequestValue = actualRequests[position];
    if (
      !isRecord(expectedRequestValue)
      || !isRecord(actualRequestValue)
      || (
        requireApplicationScope
        && (
          expectedRequestValue.scope !== "application"
          || actualRequestValue.scope !== "application"
        )
      )
      || !equalExceptKey(expectedRequestValue, actualRequestValue, "response")
      || !isRecord(expectedRequestValue.response)
      || !isRecord(actualRequestValue.response)
      || !equalExceptKey(expectedRequestValue.response, actualRequestValue.response, "headers")
      || !Array.isArray(expectedRequestValue.response.headers)
      || !Array.isArray(actualRequestValue.response.headers)
    ) {
      continue;
    }

    projectExactRemovedNextJsPoweredByHeaders(
      expectedRequestValue.response,
      actualRequestValue.response,
    );
  }
}

function projectExactRemovedNextJsPoweredByHeaders(
  expectedResponse: Record<string, unknown>,
  actualResponse: Record<string, unknown>,
) {
  const expectedHeaders = expectedResponse.headers;
  const actualHeaders = actualResponse.headers;
  if (!Array.isArray(expectedHeaders) || !Array.isArray(actualHeaders)) return;

  if (removeExactNextJsPoweredByHeader(expectedHeaders, actualHeaders)) {
    expectedResponse.headers = expectedHeaders.filter((header) => (
      !isExactNextJsPoweredByHeader(header)
    ));
    return;
  }
  if (removeExactNextJsPoweredByHeader(actualHeaders, expectedHeaders)) {
    actualResponse.headers = actualHeaders.filter((header) => (
      !isExactNextJsPoweredByHeader(header)
    ));
  }
}

function removeExactNextJsPoweredByHeader(
  sourceHeaders: unknown[],
  targetHeaders: unknown[],
) {
  const disclosureIndexes = sourceHeaders.flatMap((header, index) => (
    isExactNextJsPoweredByHeader(header) ? [index] : []
  ));
  if (
    disclosureIndexes.length !== 1
    || targetHeaders.some((header) => (
      isRecord(header) && header.name === "x-powered-by"
    ))
  ) {
    return false;
  }

  const sourceWithoutDisclosure = sourceHeaders.filter(
    (_, index) => index !== disclosureIndexes[0],
  );
  return sameJson(sourceWithoutDisclosure, targetHeaders);
}

function isExactNextJsPoweredByHeader(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["name", "value"])
    && value.name === "x-powered-by"
    && (
      isExactDigest(value.value, NEXT_JS_POWERED_BY)
      || value.value === JSON.stringify(NEXT_JS_POWERED_BY)
    );
}

function equalExceptKey(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  excludedKey: string,
) {
  return equalExceptKeys(left, right, [excludedKey]);
}

function equalExceptKeys(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  excludedKeys: string[],
) {
  const excluded = new Set(excludedKeys);
  const withoutExcludedKeys = (value: Record<string, unknown>) => Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  );
  return sameJson(withoutExcludedKeys(left), withoutExcludedKeys(right));
}

function projectNetwork(manifest: Record<string, unknown>) {
  const network = manifest.network;
  if (!isRecord(network) || !Array.isArray(network.requests)) return;

  const requests = network.requests;
  if (!hasSafeRequestIndexes(requests)) return;

  const removedIndexes = new Set<number>();
  const retained = requests.filter((request) => {
    if (!isRecord(request)) return true;
    if (
      isAutomaticNextRscPrefetch(request)
      || isAutomaticNextRscPrefetchRedirectTail(request, removedIndexes)
      || isExactAuthenticatedChatwootTransportNoise(manifest, request)
      || isStaticPwaCspChunkRequest(manifest, request)
    ) {
      removedIndexes.add(request.index as number);
      return false;
    }
    return true;
  });
  sortSuccessfulFontSubset(retained);
  const serverActions = network.serverActions;
  if (!Array.isArray(serverActions)) return;

  const oldToNewIndex = new Map<number, number>();
  retained.forEach((request, newIndex) => {
    oldToNewIndex.set((request as Record<string, unknown>).index as number, newIndex);
  });

  if (
    retained.some((request) => redirectCannotBeReindexed(
      request as Record<string, unknown>,
      removedIndexes,
      oldToNewIndex,
    ))
    || serverActions.some((action) => actionCannotBeReindexed(
      action,
      removedIndexes,
      oldToNewIndex,
    ))
  ) {
    return;
  }

  for (const [newIndex, requestValue] of retained.entries()) {
    const request = requestValue as Record<string, unknown>;
    request.index = newIndex;
    if (typeof request.redirectedFrom === "number") {
      request.redirectedFrom = oldToNewIndex.get(request.redirectedFrom) as number;
    }
  }
  for (const actionValue of serverActions) {
    const action = actionValue as Record<string, unknown>;
    action.requestIndex = oldToNewIndex.get(action.requestIndex as number) as number;
  }
  network.requests = retained;

  for (const requestValue of retained) {
    const request = requestValue as Record<string, unknown>;
    if (isKnownResponseBackedAbort(manifest, request)) {
      request.failure = null;
    }
    projectJourneyFailedHashedStaticAsset(manifest, request);
    projectSuccessfulHashedStaticAsset(request);
  }
}

function isExactAuthenticatedChatwootTransportNoise(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  if (
    hasExactJourneyManifestEnvelope(manifest)
    && exactJourneyFixtureContract(manifest)
    && [
      "email-account-links-and-merges-telegram",
      "email-register-verify-and-login",
      "tariffs-payment-returns-extend-idempotency",
      "telegram-oidc-cabinet-profile-link-referral-passkey",
      "telegram-webapp-browser-boundary",
    ].includes(String(manifest.journey))
    && isExactPassiveChatwootDocumentAbortRequest(manifest, request)
  ) {
    return true;
  }

  if (
    !hasExactJourneyManifestEnvelope(manifest)
    || !exactJourneyFixtureContract(manifest)
    || ![
      "email-account-links-and-merges-telegram",
      "email-register-verify-and-login",
      "tariffs-payment-returns-extend-idempotency",
      "telegram-oidc-cabinet-profile-link-referral-passkey",
      "telegram-webapp-browser-boundary",
    ].includes(String(manifest.journey))
    || !hasExactKeys(request, [
      "externalTransport",
      "failure",
      "index",
      "method",
      "navigation",
      "postData",
      "redirectedFrom",
      "requestHeaders",
      "resourceType",
      "response",
      "scope",
      "serverAction",
      "url",
    ])
    || request.scope !== "external"
    || request.method !== "GET"
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.redirectedFrom !== null
    || request.failure !== null
    || request.externalTransport !== "<redacted>"
    || !isRecord(request.url)
    || typeof request.url.origin !== "string"
    || !request.url.origin.startsWith("<external-origin:")
    || typeof request.url.pathname !== "string"
    || !Array.isArray(request.url.query)
    || request.url.fragment !== null
    || !Array.isArray(request.requestHeaders)
    || !isExactChatwootTransportHeaders(request.requestHeaders)
  ) {
    return false;
  }

  if (
    request.resourceType === "script"
    && request.navigation === false
    && request.url.pathname === "<external-path:segments=3:extension=js>"
    && (
      request.url.query.length === 0
      || sameJson(request.url.query, [{ key: "render", value: "<redacted>" }])
    )
  ) {
    return request.response === null || isExactChatwootScriptResponse(request.response);
  }

  if (
    request.resourceType === "document"
    && request.navigation === true
    && request.url.pathname === "<external-path:segments=1:extension=none>"
    && (
      sameJson(request.url.query, [{ key: "website_token", value: "<redacted>" }])
      || sameJson(request.url.query, [
        { key: "website_token", value: "<redacted>" },
        { key: "cw_conversation", value: "<redacted>" },
      ])
    )
  ) {
    return isExactChatwootDocumentResponse(request.response);
  }

  return false;
}

function isExactPassiveChatwootDocumentAbortRequest(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  return hasExactJourneyManifestEnvelope(manifest)
    && exactJourneyFixtureContract(manifest) !== null
    && isAuthenticatedJourneyWithPassiveBrowserNoise(manifest.journey)
    && hasExactKeys(request, [
      "externalTransport",
      "failure",
      "index",
      "method",
      "navigation",
      "postData",
      "redirectedFrom",
      "requestHeaders",
      "resourceType",
      "response",
      "scope",
      "serverAction",
      "url",
    ])
    && request.scope === "external"
    && request.method === "GET"
    && request.resourceType === "document"
    && request.navigation === true
    && isNoServerAction(request.serverAction)
    && request.postData === null
    && request.redirectedFrom === null
    && (
      request.response === null
      || isExactChatwootDocumentResponse(request.response)
    )
    && request.externalTransport === "<redacted>"
    && isRecord(request.failure)
    && hasExactKeys(request.failure, ["errorText"])
    && isExactDigest(request.failure.errorText, NET_ERR_ABORTED)
    && isRecord(request.url)
    && typeof request.url.origin === "string"
    && request.url.origin.startsWith("<external-origin:")
    && request.url.pathname === "<external-path:segments=1:extension=none>"
    && Array.isArray(request.url.query)
    && (
      sameJson(request.url.query, [{ key: "website_token", value: "<redacted>" }])
      || sameJson(request.url.query, [
        { key: "website_token", value: "<redacted>" },
        { key: "cw_conversation", value: "<redacted>" },
      ])
    )
    && request.url.fragment === null
    && Array.isArray(request.requestHeaders)
    && (
      isExactChatwootTransportHeaders(request.requestHeaders)
      || isExactChatwootDocumentAbortHeaders(request.requestHeaders)
    );
}

function isExactChatwootTransportHeaders(headers: unknown[]) {
  return headers.length === 2
    && isRecord(headers[0])
    && hasExactKeys(headers[0], ["name", "value"])
    && headers[0].name === "accept"
    && isRecord(headers[0].value)
    && (
      isExactDigest(headers[0].value, {
        bytes: 3,
        sha256: "7994750c119d1c03615dde46677ccae5429cdbfc2687b51224f0ae6c5609a63d",
      })
      || isExactDigest(headers[0].value, {
        bytes: 135,
        sha256: "f2dc86899f6d0ab65c244825bbe60c0d8c267385ccb5204812d5f8b07f79ec6c",
      })
    )
    && isRecord(headers[1])
    && hasExactKeys(headers[1], ["name", "value"])
    && headers[1].name === "referer"
    && sameJson(headers[1].value, {
      origin: "<app-origin>",
      pathname: "/",
      query: [],
      fragment: null,
    });
}

function isExactChatwootDocumentAbortHeaders(headers: unknown[]) {
  return headers.length === 1
    && isRecord(headers[0])
    && hasExactKeys(headers[0], ["name", "value"])
    && headers[0].name === "referer"
    && sameJson(headers[0].value, {
      origin: "<app-origin>",
      pathname: "/",
      query: [],
      fragment: null,
    });
}

function isExactChatwootScriptResponse(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["fromServiceWorker", "headers", "status", "statusText"])
    && value.status === 200
    && value.statusText === ""
    && value.fromServiceWorker === false
    && sameJson(value.headers, [{ name: "content-type", value: "application/javascript" }]);
}

function isExactChatwootDocumentResponse(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["fromServiceWorker", "headers", "status", "statusText"])
    && value.status === 200
    && value.statusText === ""
    && value.fromServiceWorker === false
    && sameJson(value.headers, [{ name: "content-type", value: "text/html" }]);
}

function projectStaticDomAssetReferences(manifest: Record<string, unknown>) {
  const dom = manifest.dom;
  if (!isRecord(dom)) return;

  const visit = (node: Record<string, unknown>) => {
    if (Array.isArray(node.attributes)) {
      for (const attributeValue of node.attributes) {
        if (!isRecord(attributeValue)) continue;
        if (attributeValue.name !== "href" && attributeValue.name !== "src") continue;
        if (typeof attributeValue.value !== "string") continue;
        attributeValue.value = projectHashedStaticPath(attributeValue.value)
          ?? attributeValue.value;
      }
      projectPrimeReactGeneratedAttributeNames(node.attributes);
    }
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (isRecord(child)) visit(child);
    }
  };

  visit(dom);
}

function projectPrimeReactGeneratedAttributeNames(attributes: unknown[]) {
  for (const attributeValue of attributes) {
    if (
      !isRecord(attributeValue)
      || typeof attributeValue.name !== "string"
      || !/^pr_id_\d+$/.test(attributeValue.name)
      || attributeValue.value !== ""
    ) {
      continue;
    }
    attributeValue.name = "pr_id_<generated>";
  }
}

function projectSuccessfulHashedStaticAsset(request: Record<string, unknown>) {
  if (!isSuccessfulHashedStaticAsset(request)) return;
  const url = request.url as Record<string, unknown>;
  url.pathname = projectHashedStaticPath(url.pathname as string) as string;
  projectHashedStaticRequestHeaderReferences(request.requestHeaders as unknown[]);

  const response = request.response as Record<string, unknown>;
  const headers = response.headers as unknown[];
  for (const headerValue of headers) {
    if (!isRecord(headerValue)) continue;
    if (headerValue.name === "content-length") {
      headerValue.value = "<compiled-static-content-length>";
    } else if (headerValue.name === "etag") {
      headerValue.value = "<compiled-static-etag>";
    }
  }
}

function projectHashedStaticRequestHeaderReferences(headers: unknown[]) {
  for (const header of headers) {
    if (
      !isRecord(header)
      || !hasExactKeys(header, ["name", "value"])
      || header.name !== "referer"
      || !isRecord(header.value)
      || !hasExactKeys(header.value, ["fragment", "origin", "pathname", "query"])
      || header.value.origin !== "<app-origin>"
      || typeof header.value.pathname !== "string"
      || !Array.isArray(header.value.query)
      || header.value.query.length !== 0
      || header.value.fragment !== null
    ) {
      continue;
    }
    const projected = projectHashedStaticPath(header.value.pathname);
    if (projected !== null) header.value.pathname = projected;
  }
}

function projectJourneyFailedHashedStaticAsset(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  if (!isExactPublicJourneyEnvelope(manifest) || !isExactFailedStaticRequest(request)) return;
  const url = request.url as Record<string, unknown>;
  url.pathname = projectHashedStaticPath(url.pathname as string) as string;
}

function isExactPublicJourneyEnvelope(manifest: Record<string, unknown>) {
  const source = manifest.source;
  return manifest.schemaVersion === 2
    && manifest.baselineCommit === "f5cb6f543d85256e7733a1ade6a4f451d86cf378"
    && manifest.journey === "public-responsive-keyboard-install-offline-support"
    && typeof manifest.project === "string"
    && /^journey-(?:390x844|768x1024|1440x900)$/.test(manifest.project)
    && isRecord(source)
    && isVersionedSha256Contract(source.fixtureContract, "journey-v5");
}

function isExactFailedStaticRequest(request: Record<string, unknown>) {
  if (
    !hasExactKeys(request, [
      "externalTransport",
      "failure",
      "index",
      "method",
      "navigation",
      "postData",
      "redirectedFrom",
      "requestHeaders",
      "resourceType",
      "response",
      "scope",
      "serverAction",
      "url",
    ])
    || request.scope !== "application"
    || request.method !== "GET"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.redirectedFrom !== null
    || request.response !== null
    || request.externalTransport !== null
    || !isRecord(request.url)
    || request.url.origin !== "<app-origin>"
    || typeof request.url.pathname !== "string"
    || !projectHashedStaticPath(request.url.pathname)
    || !Array.isArray(request.url.query)
    || request.url.query.length !== 0
    || request.url.fragment !== null
    || !Array.isArray(request.requestHeaders)
    || !isRecord(request.failure)
    || !hasExactKeys(request.failure, ["errorText"])
  ) {
    return false;
  }

  if (request.resourceType === "script") {
    return request.url.pathname.endsWith(".js")
      && isExactDigest(request.failure.errorText, CSP_REQUEST_FAILURE)
      && isExactFailedScriptHeaders(request.requestHeaders);
  }
  return request.resourceType === "stylesheet"
    && request.url.pathname.endsWith(".css")
    && isExactDigest(request.failure.errorText, OFFLINE_RESOURCE_FAILURE)
    && isExactOfflineStylesheetHeaders(request.requestHeaders);
}

function isExactFailedScriptHeaders(headers: unknown[]) {
  if (headers.length !== 1 && headers.length !== 2) return false;
  const referer = headers.at(-1);
  if (!isExactRefererHeader(referer)) return false;
  return headers.length === 1 || isExactOriginHeader(headers[0]);
}

function isExactOriginHeader(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["name", "value"])
    && value.name === "origin"
    && sameJson(value.value, {
      origin: "<app-origin>",
      pathname: "/",
      query: [],
      fragment: null,
    });
}

function isExactRefererHeader(value: unknown) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["name", "value"])
    || value.name !== "referer"
    || !isRecord(value.value)
    || !hasExactKeys(value.value, ["fragment", "origin", "pathname", "query"])
    || value.value.origin !== "<app-origin>"
    || value.value.fragment !== null
    || !Array.isArray(value.value.query)
  ) {
    return false;
  }
  if (value.value.pathname === "/install") {
    return value.value.query.length === 0 || sameJson(value.value.query, [{
      key: "platform",
      value: "<sha256:48ee046028069a9c>",
    }]);
  }
  return value.value.pathname === "/offline"
    && (value.value.query.length === 0 || sameJson(value.value.query, [{
      key: "journey_offline",
      value: "<sha256:6b86b273ff34fce1>",
    }]));
}

function isExactOfflineStylesheetHeaders(headers: unknown[]) {
  return sameJson(headers, [
    { name: "accept", value: { bytes: 18, sha256: "c2ad092018fde14a52b5febd6b403e12f11001eed0aff58f453ab8b621a255d3" } },
    { name: "accept-language", value: { bytes: 5, sha256: "d3555b890eb35b88d3cb9ce38d8e64de37a39fcb9d8930fa297f454996543a54" } },
    {
      name: "referer",
      value: {
        origin: "<app-origin>",
        pathname: "/offline",
        query: [{ key: "journey_offline", value: "<sha256:6b86b273ff34fce1>" }],
        fragment: null,
      },
    },
    { name: "sec-ch-ua", value: { bytes: 66, sha256: "27e6edc326b21eb663888a7317cfd4710d559fc9e6c8093ff5016c7aa469d4fd" } },
    { name: "sec-ch-ua-mobile", value: { bytes: 2, sha256: "36100dcc5adbcee0b8d9480dda9be2a0cd192e33af3a6933caad3a09fd50c1c0" } },
    { name: "sec-ch-ua-platform", value: { bytes: 9, sha256: "0b1d1e9a36456a50dec652d22d95df7908422c429f91c65e9906ce500aaa2d8b" } },
    { name: "user-agent", value: { bytes: 123, sha256: "3caf269ff15e9469bb7f47985b75b52aa4c2fd24dbe3118b40ca31edb48c9178" } },
  ]);
}

function isSuccessfulHashedStaticAsset(request: Record<string, unknown>) {
  if (
    request.scope !== "application"
    || request.method !== "GET"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.redirectedFrom !== null
    || request.failure !== null
    || request.externalTransport !== null
    || !isRecord(request.url)
    || request.url.origin !== "<app-origin>"
    || typeof request.url.pathname !== "string"
    || !projectHashedStaticPath(request.url.pathname)
    || !Array.isArray(request.url.query)
    || request.url.query.length !== 0
    || request.url.fragment !== null
    || !Array.isArray(request.requestHeaders)
    || request.requestHeaders.some(
      (header) => isRecord(header)
        && (header.name === "rsc" || header.name === "next-action"),
    )
    || !isRecord(request.response)
    || request.response.status !== 200
    || !Array.isArray(request.response.headers)
  ) {
    return false;
  }

  const pathname = request.url.pathname;
  const extension = pathname.slice(pathname.lastIndexOf(".") + 1).toLowerCase();
  return (request.resourceType === "script" && extension === "js")
    || (request.resourceType === "stylesheet" && extension === "css")
    || (request.resourceType === "font" && extension === "woff2")
    || (request.resourceType === "image"
      && ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]
        .includes(extension));
}

function projectHashedStaticPath(pathname: string) {
  if (STATIC_CHUNK_PATH.test(pathname)) {
    const extension = pathname.endsWith(".css") ? "css" : "js";
    const kind = pathname.includes("/turbopack-") ? "turbopack-" : "";
    return `/_next/static/chunks/${kind}<compiled-content-hash>.${extension}`;
  }
  if (!STATIC_MEDIA_PATH.test(pathname)) return null;
  const match = /^(\/_next\/static\/media\/.+)\.([A-Za-z0-9_-]{8,})(\.[A-Za-z0-9]+)$/.exec(pathname);
  if (!match) return null;
  return `${match[1]}.<compiled-content-hash>${match[3]}`;
}

function sortSuccessfulFontSubset(requests: unknown[]) {
  const positions: number[] = [];
  const fonts: Array<Record<string, unknown>> = [];
  requests.forEach((request, position) => {
    if (isSuccessfulFontResource(request)) {
      positions.push(position);
      fonts.push(request);
    }
  });
  const firstByPath = new Map<string, Record<string, unknown>>();
  for (const request of fonts) {
    const pathname = (request.url as Record<string, unknown>).pathname as string;
    const first = firstByPath.get(pathname);
    if (first && !equalExceptKey(first, request, "index")) return;
    firstByPath.set(pathname, request);
  }
  fonts.sort((left, right) => (
    ((left.url as Record<string, unknown>).pathname as string)
      .localeCompare((right.url as Record<string, unknown>).pathname as string)
  ));
  positions.forEach((position, index) => {
    requests[position] = fonts[index];
  });
}

function isSuccessfulFontResource(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return value.scope === "application"
    && value.method === "GET"
    && value.resourceType === "font"
    && value.navigation === false
    && isNoServerAction(value.serverAction)
    && value.postData === null
    && value.redirectedFrom === null
    && value.failure === null
    && value.externalTransport === null
    && isRecord(value.response)
    && value.response.status === 200
    && isRecord(value.url)
    && value.url.origin === "<app-origin>"
    && typeof value.url.pathname === "string"
    && /^\/_next\/static\/media\/[A-Za-z0-9._-]+\.woff2$/.test(value.url.pathname)
    && Array.isArray(value.url.query)
    && value.url.query.length === 0
    && value.url.fragment === null
    && Array.isArray(value.requestHeaders)
    && !value.requestHeaders.some(
      (header) => isRecord(header)
        && [
          "authorization",
          "cookie",
          "next-router-prefetch",
          "proxy-authorization",
          "rsc",
        ].includes(String(header.name).toLowerCase()),
    );
}

function isStaticPwaCspChunkRequest(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  const requestedPathname = exactStaticPwaRequestPathname(manifest, request);
  if (
    requestedPathname === null
    || request.scope !== "application"
    || request.method !== "GET"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.redirectedFrom !== null
    || request.externalTransport !== null
    || !isRecord(request.url)
    || request.url.origin !== "<app-origin>"
    || typeof request.url.pathname !== "string"
    || !/^\/_next\/static\/chunks\/[A-Za-z0-9._-]+\.(?:css|js)$/.test(request.url.pathname)
    || !Array.isArray(request.url.query)
    || request.url.query.length !== 0
    || request.url.fragment !== null
    || !Array.isArray(request.requestHeaders)
    || request.requestHeaders.some(
      (header) => isRecord(header)
        && (header.name === "rsc" || header.name === "next-router-prefetch"),
    )
  ) {
    return false;
  }

  const extension = request.url.pathname.endsWith(".css") ? "css" : "js";
  if (
    extension === "css"
    && request.resourceType !== "stylesheet"
  ) {
    return false;
  }
  if (
    extension === "js"
    && request.resourceType !== "script"
  ) {
    return false;
  }

  const completedBeforeStaticCancellation = request.failure === null
    && isRecord(request.response)
    && request.response.status === 200;
  if (completedBeforeStaticCancellation) return true;

  if (
    !isRecord(request.failure)
    || !hasExactKeys(request.failure, ["errorText"])
    || request.response !== null
  ) {
    return false;
  }
  return extension === "js"
    ? isExactDigest(request.failure.errorText, CSP_REQUEST_FAILURE)
    : requestedPathname === "/offline"
      && isExactDigest(request.failure.errorText, OFFLINE_RESOURCE_FAILURE);
}

function exactStaticPwaRequestPathname(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  const route = manifest.route;
  const requested = isRecord(route) ? route.requested : null;
  if (
    isRecord(requested)
    && requested.origin === "<app-origin>"
    && (requested.pathname === "/install" || requested.pathname === "/offline")
  ) {
    return requested.pathname as "/install" | "/offline";
  }
  if (
    !isExactPublicJourneyEnvelope(manifest)
    || !Array.isArray(request.requestHeaders)
  ) {
    return null;
  }
  const referers = request.requestHeaders.filter((header) => (
    isRecord(header)
    && hasExactKeys(header, ["name", "value"])
    && header.name === "referer"
    && isRecord(header.value)
    && hasExactKeys(header.value, ["fragment", "origin", "pathname", "query"])
    && header.value.origin === "<app-origin>"
    && (header.value.pathname === "/install" || header.value.pathname === "/offline")
    && header.value.fragment === null
    && Array.isArray(header.value.query)
  ));
  if (referers.length !== 1) return null;
  const referer = referers[0] as { value: { pathname: unknown } };
  return referer.value.pathname as "/install" | "/offline";
}

function hasSafeRequestIndexes(requests: unknown[]) {
  const indexes = new Set<number>();
  for (const [position, request] of requests.entries()) {
    if (
      !isRecord(request)
      || !Number.isSafeInteger(request.index)
      || request.index !== position
      || indexes.has(request.index as number)
    ) {
      return false;
    }
    indexes.add(request.index as number);
  }
  return true;
}

function redirectCannotBeReindexed(
  request: Record<string, unknown>,
  removedIndexes: Set<number>,
  oldToNewIndex: Map<number, number>,
) {
  const redirectedFrom = request.redirectedFrom;
  if (redirectedFrom === null) return false;
  return !Number.isSafeInteger(redirectedFrom)
    || removedIndexes.has(redirectedFrom as number)
    || !oldToNewIndex.has(redirectedFrom as number);
}

function actionCannotBeReindexed(
  value: unknown,
  removedIndexes: Set<number>,
  oldToNewIndex: Map<number, number>,
) {
  if (!isRecord(value) || !Number.isSafeInteger(value.requestIndex)) return true;
  return removedIndexes.has(value.requestIndex as number)
    || !oldToNewIndex.has(value.requestIndex as number);
}

function isAutomaticNextRscPrefetch(request: Record<string, unknown>) {
  if (
    request.scope !== "application"
    || request.method !== "GET"
    || request.resourceType !== "fetch"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || !Array.isArray(request.requestHeaders)
  ) {
    return false;
  }

  return hasExactlyOneHeaderWithDigest(
    request.requestHeaders,
    "next-router-prefetch",
    DIGEST_OF_ONE,
  ) && hasExactlyOneHeaderWithDigest(
    request.requestHeaders,
    "rsc",
    DIGEST_OF_ONE,
  );
}

function isAutomaticNextRscPrefetchRedirectTail(
  request: Record<string, unknown>,
  removedIndexes: Set<number>,
) {
  return request.scope === "application"
    && request.method === "GET"
    && request.resourceType === "fetch"
    && request.navigation === false
    && isNoServerAction(request.serverAction)
    && request.postData === null
    && Number.isSafeInteger(request.redirectedFrom)
    && removedIndexes.has(request.redirectedFrom as number)
    && request.response === null
    && request.failure === null
    && request.externalTransport === null
    && isRecord(request.url)
    && request.url.origin === "<app-origin>"
    && request.url.pathname === "/"
    && sameJson(request.url.query, [{ key: "_rsc", value: "<opaque>" }])
    && request.url.fragment === null
    && sameJson(request.requestHeaders, [{
      name: "<header-read-error>",
      value: {
        bytes: 27,
        sha256: "870509317b49032de4cf9012617dfb66bf0d0122e6a2f5b789ba242a4a81c07d",
      },
    }]);
}

function hasExactlyOneHeaderWithDigest(
  headers: unknown[],
  expectedName: string,
  expectedValue: typeof DIGEST_OF_ONE,
) {
  const matching = headers.filter(
    (header) => isRecord(header) && header.name === expectedName,
  );
  if (matching.length !== 1) return false;
  const header = matching[0];
  if (!isRecord(header) || !hasExactKeys(header, ["name", "value"])) return false;
  return isExactDigest(header.value, expectedValue);
}

function isKnownResponseBackedAbort(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  if (
    request.scope !== "application"
    || request.navigation !== false
    || request.resourceType === "document"
    || typeof request.resourceType !== "string"
    || !isRecord(request.response)
    || !Number.isInteger(request.response.status)
    || !isRecord(request.failure)
    || !hasExactKeys(request.failure, ["errorText"])
  ) {
    return false;
  }
  if (!isExactDigest(request.failure.errorText, NET_ERR_ABORTED)) return false;
  if (request.method === "GET" && isNoServerAction(request.serverAction)) return true;
  return isExactResponseBackedJourneyServerAction(manifest, request);
}

function isExactResponseBackedJourneyServerAction(
  manifest: Record<string, unknown>,
  request: Record<string, unknown>,
) {
  const network = manifest.network;
  if (
    !hasExactJourneyManifestEnvelope(manifest)
    || !exactJourneyFixtureContract(manifest)
    || !isRecord(network)
    || !hasExactKeys(network, ["requests", "serverActionCount", "serverActions"])
    || !Array.isArray(network.requests)
    || !Array.isArray(network.serverActions)
    || network.serverActionCount !== network.serverActions.length
    || request.method !== "POST"
    || request.resourceType !== "fetch"
    || !isRecord(request.serverAction)
    || request.serverAction.present !== true
  ) {
    return false;
  }

  for (const [order, actionValue] of network.serverActions.entries()) {
    if (
      !isRecord(actionValue)
      || actionValue.requestIndex !== request.index
    ) {
      continue;
    }
    if (
      !hasExactKeys(actionValue, [
        "identifier",
        "method",
        "order",
        "payload",
        "requestIndex",
        "status",
        "url",
      ])
      || actionValue.order !== order
      || !Number.isInteger(actionValue.status)
      || !isExactJourneyActionDigest(actionValue.identifier, "server-action-id")
      || !isExactJourneyActionDigest(actionValue.payload, "server-action-payload")
    ) {
      return false;
    }
    const matchingActionRequests = network.requests.filter((candidate) => (
      isRecord(candidate) && candidate.index === actionValue.requestIndex
    ));
    if (matchingActionRequests.length !== 1) return false;
    const actionRequest = matchingActionRequests[0];
    if (
      !isRecord(actionRequest)
      || !hasExactKeys(actionRequest, [
        "externalTransport",
        "failure",
        "index",
        "method",
        "navigation",
        "postData",
        "redirectedFrom",
        "requestHeaders",
        "resourceType",
        "response",
        "scope",
        "serverAction",
        "url",
      ])
      || actionRequest.index !== actionValue.requestIndex
      || actionRequest.scope !== "application"
      || actionRequest.method !== "POST"
      || actionRequest.resourceType !== "fetch"
      || actionRequest.navigation !== false
      || actionRequest.redirectedFrom !== null
      || actionRequest.externalTransport !== null
      || !isRecord(actionRequest.serverAction)
      || actionRequest.serverAction.present !== true
      || !sameJson(actionRequest.serverAction.identifier, actionValue.identifier)
      || !sameJson(actionRequest.postData, actionValue.payload)
      || !sameJson(actionRequest.url, actionValue.url)
      || actionValue.method !== actionRequest.method
      || !isRecord(actionRequest.response)
      || actionRequest.response.status !== actionValue.status
      || !hasExactJourneyNextActionHeader(
        actionRequest.requestHeaders,
        actionValue.identifier,
      )
    ) {
      return false;
    }
    return actionRequest === request;
  }
  return false;
}

function isExactJourneyActionDigest(value: unknown, format: string) {
  return isRecord(value)
    && hasExactKeys(value, ["bytes", "sha256"])
    && Number.isSafeInteger(value.bytes)
    && Number(value.bytes) >= 0
    && typeof value.sha256 === "string"
    && (
      /^[a-f0-9]{64}$/.test(value.sha256)
      || new RegExp(`^<dynamic:${format}:[1-9][0-9]*>$`).test(value.sha256)
    );
}

function hasExactJourneyNextActionHeader(headers: unknown, identifier: unknown) {
  if (!Array.isArray(headers)) return false;
  const matches = headers.filter((header) => (
    isRecord(header) && header.name === "next-action"
  ));
  return matches.length === 1
    && isRecord(matches[0])
    && hasExactKeys(matches[0], ["name", "value"])
    && sameJson(matches[0].value, identifier);
}

function isNoServerAction(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["identifier", "present"])
    && value.present === false
    && value.identifier === null;
}

function isExactDigest(
  value: unknown,
  expected: { bytes: number; sha256: string },
) {
  return isRecord(value)
    && hasExactKeys(value, ["bytes", "sha256"])
    && value.bytes === expected.bytes
    && value.sha256 === expected.sha256;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
