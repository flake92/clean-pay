import { projectAllowlistedA11ySemantics } from "./a11y-semantic-projection";
import { projectExactJourneyGeneratedValues } from "./journey-comparison-projection";
import { projectExactJourneyKeyboardSkipLink } from "./journeys/journey-skip-link-policy";

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

  projectJourneySourceProvenance(projected);
  projectExactJourneyGeneratedValues(projected);
  projectExactJourneyKeyboardSkipLink(projected);
  projectJourneyCheckpointA11y(projected);
  projectJourneyProviderReadinessNoise(projected);
  projectJourneyOfflineFallbackConsole(projected);
  projectAllowlistedA11ySemantics(projected);
  projectStaticDomAssetReferences(projected);
  projectNetwork(projected);
  return projected;
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
  if (
    !isRecord(source)
    || !hasExactKeys(source, [
      "browser",
      "fixtureContract",
      "imageDigest",
      "imageTag",
      "migrationImageDigest",
      "migrationImageTag",
      "publicBuildContract",
      "revision",
    ])
    || typeof source.revision !== "string"
    || !/^[a-f0-9]{40}$/.test(source.revision)
    || typeof source.imageDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(source.imageDigest)
    || typeof source.imageTag !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(source.imageTag)
    || typeof source.migrationImageDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(source.migrationImageDigest)
    || typeof source.migrationImageTag !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(source.migrationImageTag)
    || !isVersionedSha256Contract(source.publicBuildContract, "1")
    || !isVersionedSha256Contract(source.fixtureContract, "journey-v5")
    || !isRecord(source.browser)
  ) {
    return;
  }
  source.revision = "<source-revision>";
  source.imageDigest = "sha256:<source-image-digest>";
  source.imageTag = "<source-image-tag>";
  source.migrationImageDigest = "sha256:<migration-image-digest>";
  source.migrationImageTag = "<migration-image-tag>";
}

function isVersionedSha256Contract(value: unknown, version: string) {
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

  providerEffects.entries = providerEffects.entries
    .filter((entry) => !isExactReadinessLedgerEntry(entry as Record<string, unknown>))
    .map((entry, index) => ({
      ...(entry as Record<string, unknown>),
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
  const journeyKeys = [
    ...legacyKeys,
    "body_contract",
    "credential_contract",
    "idempotency_key_contract",
  ];
  if (
    (!hasExactKeys(entry, legacyKeys) && !(
      hasExactKeys(entry, journeyKeys)
      && entry.body_contract === null
      && entry.idempotency_key_contract === null
      && isExactReadinessCredentialContract(entry)
    ))
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
  const paths = fonts.map((request) => (
    (request.url as Record<string, unknown>).pathname as string
  ));
  if (new Set(paths).size !== paths.length) return;
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
        && (header.name === "rsc" || header.name === "next-router-prefetch"),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
