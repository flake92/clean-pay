import { projectAllowlistedA11ySemantics } from "./a11y-semantic-projection";
import {
  projectExactJourneyGeneratedValues,
  projectExactJourneyPwaShellCachePair,
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

const STATIC_CHUNK_PATH = /^\/_next\/static\/chunks\/(?:turbopack-)?(?=[A-Za-z0-9_-]{8,}\.(?:css|js)$)(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+\.(?:css|js)$/;
const STATIC_MEDIA_PATH = /^\/_next\/static\/media\/[A-Za-z0-9._-]+\.(?=[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$)(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp|woff2)$/;
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
  projectExactJourneyKeyboardSkipLink(projected);
  projectJourneyCheckpointA11y(projected);
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
  options: { actualApplicationOrigin?: string } = {},
) {
  const fixtureContractPairIsValid = isExactJourneyFixtureContractPair(
    expectedValue,
    actualValue,
  );
  const expectedPrepared = cloneJson(expectedValue);
  const actualPrepared = cloneJson(actualValue);
  if (
    fixtureContractPairIsValid
    && isRecord(expectedPrepared)
    && isRecord(actualPrepared)
  ) {
    projectExactJourneyPwaShellCachePair(expectedPrepared, actualPrepared);
  }
  const expected = projectCharacterizationManifestForComparison(expectedPrepared);
  const actual = projectCharacterizationManifestForComparison(actualPrepared);
  projectExactLocalApplicationHostPair(
    expected,
    actual,
    options.actualApplicationOrigin,
  );
  projectExactRemovedNextJsPoweredBy(expected, actual);
  if (fixtureContractPairIsValid) {
    projectExactJourneyFixtureContract(expected, actual);
  }
  return { expected, actual };
}

function isExactJourneyFixtureContractPair(expected: unknown, actual: unknown) {
  const expectedFixture = exactRawJourneyFixtureContract(expected);
  const actualFixture = exactRawJourneyFixtureContract(actual);
  return expectedFixture?.sha256 === PINNED_JOURNEY_V5_FIXTURE_SHA256
    && actualFixture?.sha256 === currentJourneyFixtureContractSha256();
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
  const retained = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (isExactReadinessLedgerEntry(entry)) continue;
    if (isExactEnrichedReadinessCycle(entries, index)) {
      index += 6;
      continue;
    }
    retained.push(entry);
  }
  providerEffects.entries = retained.map((entry, index) => ({
    ...entry,
    sequence: index + 1,
  }));
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
  options: { actualApplicationOrigin?: string } = {},
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
  actualApplicationOrigin: string | undefined,
) {
  const actualHost = exactIsolatedLocalApplicationHost(actualApplicationOrigin);
  if (
    !actualHost
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
        digestValue(new URL(IMMUTABLE_PUBLIC_BASELINE_APPLICATION_ORIGIN).host),
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

function exactIsolatedLocalApplicationHost(value: string | undefined) {
  if (
    typeof value !== "string"
    || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value)
    || value === IMMUTABLE_PUBLIC_BASELINE_APPLICATION_ORIGIN
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

function projectExactRemovedNextJsPoweredBy(expected: unknown, actual: unknown) {
  if (!isRecord(expected) || !isRecord(actual)) return;
  const expectedNetwork = expected.network;
  const actualNetwork = actual.network;
  if (
    !isRecord(expectedNetwork)
    || !isRecord(actualNetwork)
    || !Array.isArray(expectedNetwork.requests)
    || !Array.isArray(actualNetwork.requests)
    || expectedNetwork.requests.length !== actualNetwork.requests.length
  ) {
    return;
  }

  for (const [position, expectedRequestValue] of expectedNetwork.requests.entries()) {
    const actualRequestValue = actualNetwork.requests[position];
    if (
      !isRecord(expectedRequestValue)
      || !isRecord(actualRequestValue)
      || expectedRequestValue.scope !== "application"
      || actualRequestValue.scope !== "application"
      || !equalExceptKey(expectedRequestValue, actualRequestValue, "response")
      || !isRecord(expectedRequestValue.response)
      || !isRecord(actualRequestValue.response)
      || !equalExceptKey(expectedRequestValue.response, actualRequestValue.response, "headers")
      || !Array.isArray(expectedRequestValue.response.headers)
      || !Array.isArray(actualRequestValue.response.headers)
    ) {
      continue;
    }

    const expectedHeaders = expectedRequestValue.response.headers;
    const actualHeaders = actualRequestValue.response.headers;
    const disclosureIndexes = expectedHeaders.flatMap((header, index) => (
      isExactNextJsPoweredByHeader(header) ? [index] : []
    ));
    if (
      disclosureIndexes.length !== 1
      || actualHeaders.some((header) => (
        isRecord(header) && header.name === "x-powered-by"
      ))
    ) {
      continue;
    }

    const expectedWithoutDisclosure = expectedHeaders.filter(
      (_, index) => index !== disclosureIndexes[0],
    );
    if (JSON.stringify(expectedWithoutDisclosure) !== JSON.stringify(actualHeaders)) {
      continue;
    }
    expectedRequestValue.response.headers = expectedWithoutDisclosure;
  }
}

function isExactNextJsPoweredByHeader(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["name", "value"])
    && value.name === "x-powered-by"
    && isExactDigest(value.value, NEXT_JS_POWERED_BY);
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
    if (isKnownResponseBackedAbort(request)) {
      request.failure = null;
    }
    projectJourneyFailedHashedStaticAsset(manifest, request);
    projectSuccessfulHashedStaticAsset(request);
  }
  for (const actionValue of serverActions) {
    const action = actionValue as Record<string, unknown>;
    action.requestIndex = oldToNewIndex.get(action.requestIndex as number) as number;
  }
  network.requests = retained;
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
    }
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (isRecord(child)) visit(child);
    }
  };

  visit(dom);
}

function projectSuccessfulHashedStaticAsset(request: Record<string, unknown>) {
  if (!isSuccessfulHashedStaticAsset(request)) return;
  const url = request.url as Record<string, unknown>;
  url.pathname = projectHashedStaticPath(url.pathname as string) as string;

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
  const route = manifest.route;
  const requested = isRecord(route) ? route.requested : null;
  if (
    !isRecord(requested)
    || requested.origin !== "<app-origin>"
    || (requested.pathname !== "/install" && requested.pathname !== "/offline")
    || request.scope !== "application"
    || request.method !== "GET"
    || request.resourceType !== "script"
    || request.navigation !== false
    || !isNoServerAction(request.serverAction)
    || request.postData !== null
    || request.redirectedFrom !== null
    || request.externalTransport !== null
    || !isRecord(request.url)
    || request.url.origin !== "<app-origin>"
    || typeof request.url.pathname !== "string"
    || !/^\/_next\/static\/chunks\/[A-Za-z0-9._-]+\.js$/.test(request.url.pathname)
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

  const exactCspFailure = request.response === null
    && isRecord(request.failure)
    && hasExactKeys(request.failure, ["errorText"])
    && isExactDigest(request.failure.errorText, CSP_REQUEST_FAILURE);
  const completedBeforeCspCancellation = request.failure === null
    && isRecord(request.response)
    && request.response.status === 200;
  return exactCspFailure || completedBeforeCspCancellation;
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

function isKnownResponseBackedAbort(request: Record<string, unknown>) {
  if (
    request.scope !== "application"
    || request.method !== "GET"
    || request.navigation !== false
    || request.resourceType === "document"
    || typeof request.resourceType !== "string"
    || !isNoServerAction(request.serverAction)
    || !isRecord(request.response)
    || !Number.isInteger(request.response.status)
    || !isRecord(request.failure)
    || !hasExactKeys(request.failure, ["errorText"])
  ) {
    return false;
  }
  return isExactDigest(request.failure.errorText, NET_ERR_ABORTED);
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
