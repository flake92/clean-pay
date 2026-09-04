import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const maximumRequests = 256;
const maximumStaticAssetBytes = 128 * 1024 * 1024;
export const PROVIDER_OVERLAP_MAXIMUM_STATIC_RESPONSE_BYTES = 256 * 1024 * 1024;
const maximumStaticDeclarationBodyBytes = 2 * 1024 * 1024;
const maximumResponseBodyLifecycleMs = 10_000;
export const PROVIDER_OVERLAP_REJECTION_PROVENANCE_MAX_PER_ROLE = 16;
const sha256Pattern = /^[a-f0-9]{64}$/;
const providerOverlapResponseBackedAbortFailureSha256 =
  "7ba7a1709a2d7d220e120c927e0a7e90adf45c88b09ba912b237d705090d1d4e";
const providerOverlapResponseBackedAbortKeys = new Set([
  "app-cabinet-action",
  "app-login-root-rsc",
  "app-profile-action",
]);
const opaquePattern = /^[A-Za-z0-9._~-]{1,256}$/;
const nextStaticMediaExtensionExpression = "(?:eot|ico|png|svg|ttf|woff2|woff)";
const nextStaticPathExpression = "\\/_next\\/static\\/(?:chunks"
  + "(?:\\/[A-Za-z0-9._-]{1,100}){0,5}\\/[A-Za-z0-9._-]{1,200}\\.(?:css|js)"
  + `|media\\/[A-Za-z0-9._-]{1,200}\\.${nextStaticMediaExtensionExpression})`;
const nextStaticPattern = new RegExp(`^${nextStaticPathExpression}$`);
const nextStaticMediaPattern = new RegExp(
  `^\\/_next\\/static\\/media\\/[A-Za-z0-9._-]{1,200}\\.${nextStaticMediaExtensionExpression}$`,
);
const nextStaticDeclarationPattern = new RegExp(
  `${nextStaticPathExpression}(?![A-Za-z0-9._-])`,
  "y",
);
const staticKeys = new Set([
  "next-static-css",
  "next-static-font",
  "next-static-image",
  "next-static-js",
]);
const cdpResourceTypeByPlaywrightResourceType = Object.freeze({
  document: "Document",
  eventsource: "EventSource",
  fetch: "Fetch",
  font: "Font",
  image: "Image",
  manifest: "Manifest",
  media: "Media",
  other: "Other",
  script: "Script",
  stylesheet: "Stylesheet",
  texttrack: "TextTrack",
  websocket: "WebSocket",
  xhr: "XHR",
});
const providerOverlapCdpResourceTypes = new Set([
  ...Object.values(cdpResourceTypeByPlaywrightResourceType),
  "CSPViolationReport",
  "FedCM",
  "Ping",
  "Prefetch",
  "Preflight",
  "SignedExchange",
]);
const exactNavigationFlow = Object.freeze([
  "app-login-document",
  "app-telegram-start",
  "telegram-oidc-authorize",
  "app-telegram-callback",
  "app-profile-document",
  "app-cabinet-document",
]);
const semanticKeys = new Set([
  "app-brand-logo", "app-cabinet-action", "app-cabinet-document",
  "app-cabinet-prefetch-blocked", "app-cabinet-rsc", "app-login-action",
  "app-login-document", "app-login-root-rsc", "app-login-rsc", "app-profile-action",
  "app-profile-document", "app-profile-rsc", "app-root-rsc",
  "app-telegram-callback", "app-telegram-start", "app-web-manifest",
  "chatwoot-sdk-script", "chatwoot-widget-conversation-frame",
  "chatwoot-widget-frame", "telegram-oidc-authorize", "turnstile-widget-script",
]);
const exactRedirectEdges = new Set([
  "app-telegram-start:307->telegram-oidc-authorize",
  "telegram-oidc-authorize:302->app-telegram-callback",
  "app-telegram-callback:307->app-profile-document",
  "app-root-rsc:307->app-login-root-rsc",
  "app-login-root-rsc:307->app-login-root-rsc",
  "app-login-rsc:307->app-login-rsc",
]);

const exactStaticDocuments = Object.freeze([
  Object.freeze({ documentKey: "app-login-document", route: "/login/page" }),
  Object.freeze({ documentKey: "app-profile-document", route: "/profile/page" }),
  Object.freeze({ documentKey: "app-cabinet-document", route: "/cabinet/page" }),
]);
const exactStaticDocumentKeys = new Set(exactStaticDocuments.map(({ documentKey }) => documentKey));
const exactCssMediaExtensionCounts = Object.freeze({
  eot: 2,
  svg: 1,
  ttf: 1,
  woff: 1,
  woff2: 3,
});
const providerOverlapRejectionReasonCodes = new Set([
  "request-classification-rejected",
  "request-page-mismatch",
  "request-page-unavailable",
  "route-preparation-missing",
]);

// This function is serialized by Playwright into every new document. Keep it
// self-contained: imported module bindings are not available in page context.
export function installProviderOverlapHistoryInstrumentation() {
  const pending = new Set();
  let historyBindingRejected = false;
  let operationSequence = 0;
  const isNextAppRouterState = (value) => Boolean(
    value && typeof value === "object" && value.__NA === true
    && Object.prototype.hasOwnProperty.call(value, "__PRIVATE_NEXTJS_INTERNALS_TREE"),
  );
  const emit = (record) => {
    const binding = globalThis.__cleanPayProviderHistory(record);
    pending.add(binding);
    void binding.then(
      () => pending.delete(binding),
      () => {
        historyBindingRejected = true;
        pending.delete(binding);
      },
    );
  };
  globalThis.__cleanPayProviderHistoryDrain = async () => {
    const results = await Promise.allSettled([...pending]);
    if (historyBindingRejected || results.some(({ status }) => status === "rejected")) {
      throw new Error("Synthetic history binding rejected an event.");
    }
  };
  for (const kind of ["pushState", "replaceState"]) {
    const original = history[kind].bind(history);
    history[kind] = (...args) => {
      const beforeUrl = location.href;
      const beforeHistoryLength = history.length;
      const beforeNextAppRouterState = isNextAppRouterState(history.state);
      const argumentUrl = args[2] === undefined || args[2] === null
        ? beforeUrl
        : new URL(String(args[2]), beforeUrl).href;
      const result = original(...args);
      operationSequence += 1;
      emit({
        afterNextAppRouterState: isNextAppRouterState(history.state),
        argumentUrl,
        beforeHistoryLength,
        beforeNextAppRouterState,
        beforeUrl,
        historyLength: history.length,
        kind,
        operationSequence,
        url: location.href,
      });
      return result;
    };
  }
  addEventListener("hashchange", () => emit({ kind: "hashchange", url: location.href }));
  addEventListener("popstate", () => emit({ kind: "popstate", url: location.href }));
}

// Playwright serializes this predicate into the synthetic application page.
// Keep it self-contained so the provider proof can wait for the delayed
// Chatwoot identity lifecycle before replacing the profile document.
/**
 * @param {Readonly<{__cleanPayChatwootBoundaryCalls?: unknown}>} [scope]
 */
export function providerOverlapChatwootIdentityBoundarySettled(scope = globalThis) {
  const calls = scope.__cleanPayChatwootBoundaryCalls;
  if (!Array.isArray(calls) || calls.length < 2 || calls.length > 64) {
    return false;
  }
  let setUserSeen = false;
  let identityConfirmationCount = 0;
  for (const entry of calls) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.method !== "string") {
      return false;
    }
    if (entry.method === "setUser") setUserSeen = true;
    if (entry.method === "identity.confirmed") {
      if (!setUserSeen) return false;
      identityConfirmationCount += 1;
    }
  }
  return identityConfirmationCount === 1;
}

export function createProviderOverlapEventSeal(maximumEvents = 1_024) {
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 32 || maximumEvents > 4_096) {
    fail("Browser event seal bound is invalid.");
  }
  let eventCount = 0;
  let inFlight = 0;
  let lateEventCount = 0;
  let overflow = false;
  let sealed = false;
  let version = 0;
  const record = () => {
    version += 1;
    if (sealed) lateEventCount += 1;
    else eventCount += 1;
    if (eventCount > maximumEvents || lateEventCount > maximumEvents) overflow = true;
  };
  return Object.freeze({
    begin() {
      record();
      if (sealed) return () => undefined;
      inFlight += 1;
      let finished = false;
      return () => {
        if (finished) fail("Browser event operation completed more than once.");
        finished = true;
        inFlight -= 1;
        version += 1;
      };
    },
    record,
    async drainAndSeal(isIdle, {
      pollMs = 10,
      quietMs = 200,
      timeoutMs = 5_000,
    } = {}) {
      if (typeof isIdle !== "function" || sealed
        || ![pollMs, quietMs, timeoutMs].every(Number.isSafeInteger)
        || pollMs < 1 || quietMs < pollMs || timeoutMs < quietMs || timeoutMs > 30_000) {
        fail("Browser event drain contract is invalid.");
      }
      const deadline = Date.now() + timeoutMs;
      let quietSince = Date.now();
      let observedVersion = version;
      while (Date.now() <= deadline) {
        if (overflow) fail("Browser event ledger overflowed before sealing.");
        if (version !== observedVersion || inFlight !== 0 || !isIdle()) {
          observedVersion = version;
          quietSince = Date.now();
        } else if (Date.now() - quietSince >= quietMs) {
          sealed = true;
          return Object.freeze({ eventCount, status: "drained-and-sealed" });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      fail("Browser event sources did not drain within their bounded lifecycle.");
    },
    assertClean() {
      if (!sealed || overflow || lateEventCount !== 0 || inFlight !== 0) {
        fail("Browser event source changed after the sealed drain barrier.");
      }
      return Object.freeze({ eventCount, lateEventCount, status: "sealed-clean" });
    },
  });
}

export function createProviderOverlapPendingRequestSeal(maximumRequestCount = maximumRequests) {
  if (!Number.isSafeInteger(maximumRequestCount)
    || maximumRequestCount < 1 || maximumRequestCount > maximumRequests) {
    fail("Browser pending request seal bound is invalid.");
  }
  const pending = new Set();
  const completed = new WeakSet();
  let completedRequestCount = 0;
  let duplicateCompletionCount = 0;
  let lateRequestEventCount = 0;
  let observedRequestCount = 0;
  let quietOperationActive = false;
  let overflow = false;
  let sealed = false;
  let version = 0;
  const waitForQuietState = async ({
    pollMs = 10,
    quietMs = 200,
    timeoutMs = 5_000,
  } = {}, sealOnSuccess, excludedRequest = null) => {
    const excludesCurrentRequest = excludedRequest !== null;
    const operation = sealOnSuccess
      ? "drain"
      : excludesCurrentRequest ? "navigation checkpoint" : "checkpoint";
    if (sealed || quietOperationActive
      || (excludesCurrentRequest
        && (!excludedRequest || typeof excludedRequest !== "object"
          || !pending.has(excludedRequest)))
      || ![pollMs, quietMs, timeoutMs].every(Number.isSafeInteger)
      || pollMs < 1 || quietMs < pollMs || timeoutMs < quietMs || timeoutMs > 30_000) {
      fail(`Browser pending request ${operation} contract is invalid.`);
    }
    quietOperationActive = true;
    try {
      const deadline = Date.now() + timeoutMs;
      let observedVersion = version;
      let quietSince = Date.now();
      while (Date.now() <= deadline) {
        if (overflow || duplicateCompletionCount !== 0 || lateRequestEventCount !== 0) {
          fail("Browser pending request ledger became invalid before sealing.");
        }
        if (excludesCurrentRequest && !pending.has(excludedRequest)) {
          fail("Browser navigation request changed before its pending request checkpoint.");
        }
        const priorPendingRequestCount = pending.size - (excludesCurrentRequest ? 1 : 0);
        if (version !== observedVersion || priorPendingRequestCount !== 0) {
          observedVersion = version;
          quietSince = Date.now();
        } else if (Date.now() - quietSince >= quietMs) {
          if (sealOnSuccess) sealed = true;
          return Object.freeze({
            completedRequestCount,
            observedRequestCount,
            status: sealOnSuccess
              ? "drained-and-sealed"
              : excludesCurrentRequest ? "prior-requests-quiet" : "quiet-checkpoint",
          });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      fail(sealOnSuccess
        ? "Browser pending requests did not drain within their bounded lifecycle."
        : "Browser pending requests did not reach their bounded quiet checkpoint.");
    } finally {
      quietOperationActive = false;
    }
  };
  return Object.freeze({
    assertClean() {
      if (!sealed || overflow || pending.size !== 0
        || lateRequestEventCount !== 0 || duplicateCompletionCount !== 0
        || observedRequestCount !== completedRequestCount) {
        fail("Browser pending request source changed after its sealed drain barrier.");
      }
      return Object.freeze({
        completedRequestCount,
        lateRequestEventCount,
        observedRequestCount,
        status: "sealed-clean",
      });
    },
    complete(request) {
      if (!request || typeof request !== "object") {
        fail("Browser pending request completion identity is invalid.");
      }
      version += 1;
      if (sealed) {
        lateRequestEventCount += 1;
        return;
      }
      if (!pending.delete(request)) {
        duplicateCompletionCount += 1;
        return;
      }
      completed.add(request);
      completedRequestCount += 1;
    },
    async drainAndSeal(options = {}) {
      return waitForQuietState(options, true, null);
    },
    observe(request) {
      if (!request || typeof request !== "object") {
        fail("Browser pending request identity is invalid.");
      }
      version += 1;
      if (sealed || completed.has(request)) {
        lateRequestEventCount += 1;
        return;
      }
      if (pending.has(request)) return;
      pending.add(request);
      observedRequestCount += 1;
      if (observedRequestCount > maximumRequestCount) overflow = true;
    },
    pendingCount() {
      return pending.size;
    },
    async waitForQuiet(options = {}) {
      return waitForQuietState(options, false, null);
    },
    async waitForPriorRequests(request, options = {}) {
      return waitForQuietState(options, false, request);
    },
  });
}

export function resolveProviderOverlapResponseRequestEntry(input) {
  exactKeys(input, [
    "preparationByIdentity", "prepare", "request", "requestByIdentity",
  ], "browser response request resolver");
  if (!(input.preparationByIdentity instanceof Map)
    || !(input.requestByIdentity instanceof Map)
    || typeof input.prepare !== "function"
    || !input.request || typeof input.request !== "object") {
    fail("Browser response request resolver input is invalid.");
  }
  const preparationAlreadyExisted = input.preparationByIdentity.has(input.request);
  const preparation = preparationAlreadyExisted
    ? input.preparationByIdentity.get(input.request)
    : input.prepare(input.request);
  if (!preparation || typeof preparation !== "object" || preparation.entry === null) {
    fail(preparationAlreadyExisted
      ? "Browser response belongs to an explicitly rejected request preparation."
      : "Browser response request preparation failed closed.");
  }
  const entry = preparation.entry;
  if (!entry || typeof entry !== "object" || entry.request !== input.request
    || input.preparationByIdentity.get(input.request) !== preparation
    || input.requestByIdentity.get(input.request) !== entry) {
    fail("Browser response escaped its exact request identity ledger.");
  }
  return entry;
}

export function createProviderOverlapRejectedRequestProvenance(input) {
  exactKeys(input, [
    "reasonCode", "rejectionMessage", "requestEnvelope",
  ], "provider rejected request provenance input");
  if (!providerOverlapRejectionReasonCodes.has(input.reasonCode)) {
    fail("Provider rejected request reason code is invalid.");
  }
  const envelope = input.requestEnvelope;
  exactKeys(envelope, [
    "isMainFrame", "isNavigation", "method", "resourceType", "url",
  ], "provider rejected request envelope");
  if (typeof envelope.url !== "string" || envelope.url.length < 1
    || envelope.url.length > 8_192
    || typeof envelope.method !== "string" || envelope.method.length < 1
    || envelope.method.length > 64
    || typeof envelope.resourceType !== "string" || envelope.resourceType.length < 1
    || envelope.resourceType.length > 64
    || typeof envelope.isNavigation !== "boolean"
    || typeof envelope.isMainFrame !== "boolean") {
    fail("Provider rejected request envelope is invalid.");
  }
  const url = exactUrl(envelope.url);
  const queryKeys = [...url.searchParams.keys()];
  const queryKeySha256s = queryKeys
    .slice(0, 64)
    .map(sha256)
    .sort();
  const pathSha256 = sha256(url.pathname);
  const canonicalEnvelope = {
    isMainFrame: envelope.isMainFrame,
    isNavigation: envelope.isNavigation,
    methodSha256: sha256(envelope.method),
    originSha256: sha256(url.origin),
    pathSha256,
    queryKeyCount: Math.min(queryKeys.length, 65),
    queryKeySha256s,
    queryKeysTruncated: queryKeys.length > 64,
    resourceTypeSha256: sha256(envelope.resourceType),
  };
  const rejectionMessage = typeof input.rejectionMessage === "string"
    && input.rejectionMessage.length <= 4_096
    ? input.rejectionMessage
    : "unreadable-or-oversized-provider-rejection";
  return Object.freeze({
    reasonCode: input.reasonCode,
    rejectionMessageSha256: sha256(rejectionMessage),
    requestEnvelopeSha256: sha256(JSON.stringify(canonicalEnvelope)),
    requestPathSha256: pathSha256,
  });
}

export function createProviderOverlapPendingRequestEvidence(input) {
  exactKeys(input, [
    "isNavigation", "method", "resourceType", "url",
  ], "provider pending request evidence input");
  if (typeof input.isNavigation !== "boolean"
    || typeof input.method !== "string" || input.method.length < 1 || input.method.length > 64
    || typeof input.resourceType !== "string" || input.resourceType.length < 1
    || input.resourceType.length > 64
    || typeof input.url !== "string" || input.url.length < 1 || input.url.length > 8_192) {
    fail("Provider pending request evidence input is invalid.");
  }
  const url = exactUrl(input.url);
  return Object.freeze({
    isNavigation: input.isNavigation,
    methodSha256: sha256(input.method),
    originSha256: sha256(url.origin),
    pathSha256: sha256(url.pathname),
    resourceTypeSha256: sha256(input.resourceType),
  });
}

export function createProviderOverlapPendingRequestEvidenceDocument(input) {
  const maximumEntriesPerRole = 16;
  exactKeys(input, ["baseline", "candidate"], "provider pending request evidence roles");
  const roles = {};
  let hasEvidence = false;
  for (const role of ["baseline", "candidate"]) {
    const state = input[role];
    exactKeys(state, [
      "entries", "trackedPendingCount", "truncated",
    ], `${role} provider pending request evidence`);
    if (!Array.isArray(state.entries)
      || !Number.isSafeInteger(state.trackedPendingCount) || state.trackedPendingCount < 0
      || state.trackedPendingCount > maximumRequests
      || state.entries.length !== Math.min(state.trackedPendingCount, maximumEntriesPerRole)
      || typeof state.truncated !== "boolean"
      || (state.trackedPendingCount > maximumEntriesPerRole && !state.truncated)) {
      fail(`${role} provider pending request evidence is outside its bound.`);
    }
    const entries = state.entries.map((entry) => {
      exactKeys(entry, [
        "isNavigation", "methodSha256", "originSha256", "pathSha256", "resourceTypeSha256",
      ], `${role} provider pending request evidence entry`);
      if (typeof entry.isNavigation !== "boolean"
        || !sha256Pattern.test(entry.methodSha256 ?? "")
        || !sha256Pattern.test(entry.originSha256 ?? "")
        || !sha256Pattern.test(entry.pathSha256 ?? "")
        || !sha256Pattern.test(entry.resourceTypeSha256 ?? "")) {
        fail(`${role} provider pending request evidence entry is invalid.`);
      }
      return Object.freeze({ ...entry });
    });
    hasEvidence ||= state.trackedPendingCount > 0 || state.truncated;
    roles[role] = Object.freeze({
      entries: Object.freeze(entries),
      trackedPendingCount: state.trackedPendingCount,
      truncated: state.truncated,
    });
  }
  if (!hasEvidence) fail("Provider pending request evidence is unexpectedly empty.");
  return Object.freeze({
    maximumEntriesPerRole,
    roles: Object.freeze(roles),
    schemaVersion: 1,
  });
}

export function createProviderOverlapRejectionProvenanceDocument(input) {
  exactKeys(input, ["baseline", "candidate"], "provider rejection provenance roles");
  const roles = {};
  for (const role of ["baseline", "candidate"]) {
    const state = input[role];
    exactKeys(state, ["entries", "truncated"], `${role} provider rejection provenance`);
    if (!Array.isArray(state.entries)
      || state.entries.length > PROVIDER_OVERLAP_REJECTION_PROVENANCE_MAX_PER_ROLE
      || typeof state.truncated !== "boolean") {
      fail(`${role} provider rejection provenance is outside its bound.`);
    }
    const entries = state.entries.map((entry) => {
      exactKeys(entry, [
        "reasonCode", "rejectionMessageSha256", "requestEnvelopeSha256",
        "requestPathSha256",
      ], `${role} provider rejection provenance entry`);
      if (!providerOverlapRejectionReasonCodes.has(entry.reasonCode)
        || !sha256Pattern.test(entry.rejectionMessageSha256 ?? "")
        || !sha256Pattern.test(entry.requestEnvelopeSha256 ?? "")
        || !sha256Pattern.test(entry.requestPathSha256 ?? "")) {
        fail(`${role} provider rejection provenance entry is invalid.`);
      }
      return Object.freeze({ ...entry });
    });
    roles[role] = Object.freeze({
      entries: Object.freeze(entries),
      truncated: state.truncated,
    });
  }
  return Object.freeze({
    maximumEntriesPerRole: PROVIDER_OVERLAP_REJECTION_PROVENANCE_MAX_PER_ROLE,
    roles: Object.freeze(roles),
    schemaVersion: 1,
  });
}

export function createJourneyBrowserRequestEnvelope(request, mainFrame) {
  if (!request || typeof request !== "object" || !mainFrame || typeof mainFrame !== "object"
    || typeof request.url !== "function" || typeof request.method !== "function"
    || typeof request.resourceType !== "function"
    || typeof request.isNavigationRequest !== "function" || typeof request.frame !== "function") {
    fail("Browser request envelope source is invalid.");
  }
  const isNavigation = request.isNavigationRequest();
  if (typeof isNavigation !== "boolean") {
    fail("Browser request navigation flag is invalid.");
  }
  return Object.freeze({
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    isNavigation,
    // Playwright Request.frame() is the initiating frame. It identifies the
    // navigation target only for navigation requests; main-page resources must
    // therefore remain non-main-frame in the classifier envelope.
    isMainFrame: isNavigation && request.frame() === mainFrame,
  });
}

export async function finalizeProviderOverlapEventLifecycle(input) {
  exactKeys(input, [
    "assertUnchanged", "close", "detach", "eventSeal", "finish", "isIdle", "snapshot",
  ], "browser event lifecycle finalizer");
  for (const name of ["assertUnchanged", "close", "detach", "finish", "isIdle", "snapshot"]) {
    if (typeof input[name] !== "function") fail(`Browser event lifecycle ${name} is invalid.`);
  }
  if (!input.eventSeal || typeof input.eventSeal.drainAndSeal !== "function"
    || typeof input.eventSeal.assertClean !== "function") {
    fail("Browser event lifecycle seal is invalid.");
  }
  const drained = await input.eventSeal.drainAndSeal(input.isIdle);
  // Freeze every routed/evented source first. The projection is intentionally
  // built only after this barrier so no allowed request can arrive between the
  // projected ledger and the sealed raw ledger.
  const value = await boundedLifecycleOperation(input.finish(), 15_000, "browser projection");
  const snapshot = await boundedLifecycleOperation(input.snapshot(), 5_000, "browser snapshot");
  await boundedLifecycleOperation(input.close(), 15_000, "browser close");
  // Let close-triggered request, frame, console, popup and error callbacks run
  // while every listener is still attached to the sealed ledger.
  await new Promise((resolve) => setTimeout(resolve, 25));
  await boundedLifecycleOperation(
    input.assertUnchanged(snapshot),
    5_000,
    "browser source revalidation",
  );
  await boundedLifecycleOperation(input.detach(), 5_000, "browser listener detach");
  const sealed = input.eventSeal.assertClean();
  if (sealed.eventCount !== drained.eventCount) {
    fail("Browser event count changed across its close barrier.");
  }
  return Object.freeze({
    eventLifecycle: Object.freeze({
      drainedEventCount: drained.eventCount,
      lateEventCount: sealed.lateEventCount,
      status: sealed.status,
    }),
    snapshot,
    value,
  });
}

async function boundedLifecycleOperation(operation, timeoutMs, label) {
  const promise = Promise.resolve(operation);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded its bounded lifecycle.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createProviderOverlapStaticAssetContract(attestation) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)
    || !sha256Pattern.test(attestation.attestationSha256 ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(attestation.source?.configDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(attestation.source?.imageDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(attestation.source?.manifestDigest ?? "")
    || attestation.source.configDigest === attestation.source.manifestDigest
    || attestation.source.configDigest === attestation.source.imageDigest
    || !sha256Pattern.test(attestation.inventory?.inventorySha256 ?? "")
    || !Array.isArray(attestation.inventory?.staticChunks)
    || !Array.isArray(attestation.inventory?.clientReferences)) {
    fail("Production image static asset attestation is invalid.");
  }
  const inventoryByPath = {};
  const inventoryMetadataByPath = {};
  let inventoryBytes = 0;
  for (const asset of attestation.inventory.staticChunks) {
    if (!asset || !nextStaticPattern.test(asset.servedPath ?? "")
      || !sha256Pattern.test(asset.sha256 ?? "")
      || !Number.isSafeInteger(asset.size) || asset.size < 1
      || asset.size > maximumStaticAssetBytes
      || Object.hasOwn(inventoryByPath, asset.servedPath)) {
      fail("Production image static asset inventory is invalid.");
    }
    inventoryBytes += asset.size;
    if (!Number.isSafeInteger(inventoryBytes)
      || inventoryBytes > PROVIDER_OVERLAP_MAXIMUM_STATIC_RESPONSE_BYTES) {
      fail("Production image static asset inventory exceeds its byte bound.");
    }
    inventoryByPath[asset.servedPath] = asset.sha256;
    inventoryMetadataByPath[asset.servedPath] = Object.freeze({
      assetBytes: asset.size,
      extension: staticExtension(asset.servedPath),
    });
  }
  const routeDeclaredPaths = new Set();
  const documentRouteContracts = [];
  for (const { documentKey, route } of exactStaticDocuments) {
    const matches = attestation.inventory.clientReferences.filter((entry) => entry.route === route);
    if (matches.length !== 1 || !Array.isArray(matches[0].declaredStaticChunks)
      || matches[0].declaredStaticChunks.length < 1 || matches[0].declaredStaticChunks.length > 64) {
      fail("Production image route load graph is incomplete.");
    }
    const documentRouteDeclaredPaths = [...matches[0].declaredStaticChunks].sort();
    if (new Set(documentRouteDeclaredPaths).size !== documentRouteDeclaredPaths.length) {
      fail("Production image route load graph contains duplicate chunks.");
    }
    for (const servedPath of documentRouteDeclaredPaths) {
      if (!Object.hasOwn(inventoryByPath, servedPath)) {
        fail("Production image route load graph references an absent static asset.");
      }
      if (!servedPath.startsWith("/_next/static/chunks/")) {
        fail("Production image route load graph contains a non-chunk asset.");
      }
      routeDeclaredPaths.add(servedPath);
    }
    documentRouteContracts.push(Object.freeze({
      documentKey,
      routeDeclaredPaths: Object.freeze(documentRouteDeclaredPaths),
    }));
  }
  const inventoryLedger = Object.entries(inventoryByPath)
    .map(([servedPath, assetSha256]) => ({
      assetBytes: inventoryMetadataByPath[servedPath].assetBytes,
      assetSha256,
      extension: inventoryMetadataByPath[servedPath].extension,
      pathSha256: sha256(servedPath),
    }))
    .sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
  const documentRouteLedger = documentRouteContracts.map(({ documentKey, routeDeclaredPaths }) => ({
    documentKey,
    routeDeclaredPathSha256s: routeDeclaredPaths.map(sha256).sort(),
  }));
  return Object.freeze({
    attestationSha256: attestation.attestationSha256,
    configDigest: attestation.source.configDigest,
    documentRouteContracts: Object.freeze(documentRouteContracts),
    imageDigest: attestation.source.imageDigest,
    inventoryByPath: Object.freeze({ ...inventoryByPath }),
    inventoryMetadataByPath: Object.freeze({ ...inventoryMetadataByPath }),
    inventoryLedgerContractSha256: sha256(JSON.stringify(inventoryLedger)),
    inventorySha256: attestation.inventory.inventorySha256,
    manifestDigest: attestation.source.manifestDigest,
    routeDeclaredPaths: Object.freeze([...routeDeclaredPaths].sort()),
    routeDeclaredPathContractSha256: sha256(JSON.stringify(documentRouteLedger)),
  });
}

export function createProviderOverlapRepeatableStaticResponseUrls(staticAssetContract) {
  assertStaticAssetContract(staticAssetContract);
  const urls = Object.keys(staticAssetContract.inventoryByPath)
    .sort()
    .map((servedPath) => {
      if (!nextStaticPattern.test(servedPath)) {
        fail("Repeatable static response path is outside the attested inventory contract.");
      }
      return new URL(servedPath, "https://pay.ci.clean-pay.dev").href;
    });
  if (urls.length < 1 || urls.length > maximumRequests
    || new Set(urls).size !== urls.length) {
    fail("Repeatable static response URL inventory is invalid.");
  }
  return Object.freeze(urls);
}

export function classifyProviderOverlapBrowserRequest(input, state) {
  exactKeys(input, ["isMainFrame", "isNavigation", "method", "resourceType", "url"], "request");
  exactKeys(state, ["cabinetDocumentAllowed", "staticAssetContract"], "request state");
  assertStaticAssetContract(state.staticAssetContract);
  const url = exactUrl(input.url);
  if (url.hash || url.username || url.password || url.port) fail("Browser request URL is not exact.");
  const descriptor = {
    disposition: "continue",
    expectedStatuses: [200],
    key: undefined,
    navigation: false,
    staticAssetSha256: null,
    staticPath: null,
  };

  if (url.origin === "https://pay.ci.clean-pay.dev") {
    classifyApplicationRequest(descriptor, input, url, state);
  } else if (url.origin === "https://oauth.telegram.org") {
    classifyOidcRequest(descriptor, input, url);
  } else if (url.origin === "https://challenges.cloudflare.com") {
    exactRequest(input, "GET", "script", false, false);
    exactQuery(url, [["render", "explicit"]]);
    equal(url.pathname, "/turnstile/v0/api.js", "Turnstile browser path");
    descriptor.key = "turnstile-widget-script";
  } else if (url.origin === "https://chatwoot.browser.clean-pay.dev") {
    classifyChatwootRequest(descriptor, input, url);
  } else {
    fail("Browser request origin is outside the exact provider-overlap contract.");
  }

  return Object.freeze({
    disposition: descriptor.disposition,
    expectedStatuses: Object.freeze([...descriptor.expectedStatuses]),
    key: descriptor.key,
    navigation: descriptor.navigation,
    staticAssetSha256: descriptor.staticAssetSha256,
    staticPath: descriptor.staticPath,
  });
}

export function attestProviderOverlapStaticResponse(input, staticAssetContract) {
  exactKeys(input, [
    "body", "classification", "responseContentType", "responseStatus",
  ], "static response observation");
  assertStaticAssetContract(staticAssetContract);
  const classification = input.classification;
  if (!classification || !staticKeys.has(classification.key)
    || !nextStaticPattern.test(classification.staticPath ?? "")
    || !(input.body instanceof Uint8Array)
    || input.responseStatus !== 200) {
    fail("Static response observation is incomplete.");
  }
  const metadata = staticAssetContract.inventoryMetadataByPath[classification.staticPath];
  const expectedSha256 = staticAssetContract.inventoryByPath[classification.staticPath];
  if (!metadata || !sha256Pattern.test(expectedSha256 ?? "")
    || input.body.byteLength < 1 || input.body.byteLength > maximumStaticAssetBytes
    || input.body.byteLength !== metadata.assetBytes) {
    fail("Static response byte length differs from its attested image asset.");
  }
  const observedSha256 = sha256Bytes(input.body);
  if (observedSha256 !== expectedSha256) {
    fail("Static response bytes differ from their attested image asset.");
  }
  if (!expectedStaticContentTypes(metadata.extension).includes(input.responseContentType)) {
    fail("Static response content type differs from its exact asset extension contract.");
  }
  return Object.freeze({
    staticResponseBytes: input.body.byteLength,
    staticResponseSha256: observedSha256,
  });
}

export function createProviderOverlapCdpResponseBodyCapture(input) {
  const hasRepeatableStaticResponseUrls = Boolean(
    input && typeof input === "object" && !Array.isArray(input)
      && Object.hasOwn(input, "repeatableStaticResponseUrls"),
  );
  exactKeys(
    input,
    hasRepeatableStaticResponseUrls
      ? ["repeatableStaticResponseUrls", "send"]
      : ["send"],
    "CDP response body capture",
  );
  if (typeof input.send !== "function") {
    fail("CDP response body capture sender is invalid.");
  }
  const repeatableStaticResponseUrls = new Set(input.repeatableStaticResponseUrls ?? []);
  if ((hasRepeatableStaticResponseUrls && !Array.isArray(input.repeatableStaticResponseUrls))
    || repeatableStaticResponseUrls.size !== (input.repeatableStaticResponseUrls?.length ?? 0)
    || repeatableStaticResponseUrls.size > maximumRequests) {
    fail("CDP repeatable static response URL inventory is invalid.");
  }
  for (const rawUrl of repeatableStaticResponseUrls) {
    if (typeof rawUrl !== "string" || rawUrl.length > 8_192) {
      fail("CDP repeatable static response URL is invalid.");
    }
    const url = exactUrl(rawUrl);
    if (url.href !== rawUrl || url.origin !== "https://pay.ci.clean-pay.dev"
      || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== ""
      || !nextStaticPattern.test(url.pathname)) {
      fail("CDP repeatable static response URL is outside its exact contract.");
    }
  }
  const entryByRequestId = new Map();
  const unclaimedEntryByKey = new Map();
  const waitingClaimByKey = new Map();
  let bodyClaimCount = 0;
  let bodySettledCount = 0;
  let bodylessClaimCount = 0;
  let fatalError = null;
  let observedResponseCount = 0;
  let responseClaimCount = 0;
  let responseFailureCount = 0;
  let responseSettledCount = 0;

  const rejectClaim = (claim, error) => {
    if (!claim || claim.settled) return;
    claim.settled = true;
    responseFailureCount += 1;
    responseSettledCount += 1;
    if (claim.bodyExpected) bodySettledCount += 1;
    claim.reject(error);
  };
  const enterFatalState = (message) => {
    if (fatalError) return fatalError;
    fatalError = new Error(message);
    const claims = new Set([...waitingClaimByKey.values()].flat());
    for (const entry of entryByRequestId.values()) {
      if (entry.claim && !entry.claim.settled) claims.add(entry.claim);
    }
    waitingClaimByKey.clear();
    unclaimedEntryByKey.clear();
    for (const claim of claims) rejectClaim(claim, fatalError);
    return fatalError;
  };
  const throwFatal = (message) => {
    throw enterFatalState(message);
  };
  const assertActive = () => {
    if (fatalError) throw fatalError;
  };
  const safeContractFailure = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    return /^(?:Browser request URL|CDP response)/.test(message)
      ? message
      : `CDP response body capture failed: failureSha256=${sha256(message)}.`;
  };
  const resolveClaim = (claim, value) => {
    if (fatalError || claim.settled) return;
    claim.settled = true;
    responseSettledCount += 1;
    if (claim.bodyExpected) bodySettledCount += 1;
    claim.resolve(value);
  };
  const settleFinishedEntry = (entry) => {
    if (!entry.claim || entry.claim.settled || entry.readStarted || entry.terminal === null) return;
    entry.readStarted = true;
    const claim = entry.claim;
    if (entry.terminal.kind === "failed") {
      enterFatalState(
        "Durable browser response did not finish cleanly: "
          + `failureSha256=${entry.terminal.failureSha256}.`,
      );
      return;
    }
    if (!claim.bodyExpected) {
      resolveClaim(claim, null);
      return;
    }
    const operation = Promise.resolve().then(() => input.send(
      "Network.getResponseBody",
      { requestId: entry.requestId },
    ));
    void boundedLifecycleOperation(
      operation,
      maximumResponseBodyLifecycleMs,
      "durable browser response body",
    ).then(
      (result) => {
        if (fatalError || claim.settled) return;
        try {
          const body = decodeProviderOverlapCdpResponseBody(
            result,
            claim.maximumBodyBytes,
          );
          resolveClaim(claim, body);
        } catch (error) {
          enterFatalState(safeContractFailure(error));
        }
      },
      (error) => {
        if (fatalError || claim.settled) return;
        const failureMessage = error instanceof Error ? error.message : String(error);
        enterFatalState(
          "Durable browser response body read failed: "
            + `failureSha256=${sha256(failureMessage)}.`,
        );
      },
    );
  };
  const bind = (entry, claim) => {
    entry.claim = claim;
    settleFinishedEntry(entry);
  };
  const queueSize = (queueByKey) => [...queueByKey.values()]
    .reduce((total, queue) => total + queue.length, 0);
  const enqueue = (queueByKey, key, value) => {
    const queue = queueByKey.get(key);
    if (queue) queue.push(value);
    else queueByKey.set(key, [value]);
  };
  const dequeue = (queueByKey, key) => {
    const queue = queueByKey.get(key);
    if (!queue) return undefined;
    const value = queue.shift();
    if (queue.length === 0) queueByKey.delete(key);
    return value;
  };
  const createClaim = (claimInput, maximumBodyBytes) => {
    responseClaimCount += 1;
    if (responseClaimCount > maximumRequests) {
      throwFatal("CDP response body capture exceeded its response claim bound.");
    }
    const key = providerOverlapCdpResponseKey(claimInput, "playwright");
    const repeatableStatic = repeatableStaticResponseUrls.has(claimInput.url);
    if (waitingClaimByKey.has(key) && !repeatableStatic) {
      throwFatal("CDP response body claim is ambiguous.");
    }
    let resolve;
    let reject;
    const promise = new Promise((resolveResponse, rejectResponse) => {
      resolve = resolveResponse;
      reject = rejectResponse;
    });
    // A response or fatal event may settle before the outer Playwright capture
    // attaches its own observer.
    void promise.catch(() => undefined);
    const bodyExpected = maximumBodyBytes !== null;
    const claim = {
      bodyExpected,
      maximumBodyBytes,
      promise,
      reject,
      resolve,
      settled: false,
    };
    if (bodyExpected) bodyClaimCount += 1;
    else bodylessClaimCount += 1;
    const entry = dequeue(unclaimedEntryByKey, key);
    if (entry) {
      bind(entry, claim);
    } else {
      enqueue(waitingClaimByKey, key, claim);
    }
    return promise;
  };
  const terminalEntry = (event, terminal) => {
    let requestId;
    try {
      requestId = providerOverlapCdpRequestId(event, "CDP response terminal event");
    } catch (error) {
      throw enterFatalState(safeContractFailure(error));
    }
    const entry = entryByRequestId.get(requestId);
    // A request can fail before responseReceived. It has no response identity
    // to claim and remains governed by the Playwright requestfailed path.
    if (!entry) return;
    if (entry.terminal !== null) {
      throwFatal("CDP response reached a terminal event more than once.");
    }
    entry.terminal = terminal;
    settleFinishedEntry(entry);
  };

  return Object.freeze({
    assertClean() {
      if (fatalError) throw fatalError;
      const unsettledResponseCount = [...entryByRequestId.values()]
        .filter((entry) => entry.claim && !entry.claim.settled).length;
      if (queueSize(waitingClaimByKey) !== 0 || queueSize(unclaimedEntryByKey) !== 0
        || unsettledResponseCount !== 0 || responseFailureCount !== 0
        || responseClaimCount !== observedResponseCount
        || responseClaimCount !== responseSettledCount
        || responseClaimCount !== bodyClaimCount + bodylessClaimCount
        || bodyClaimCount !== bodySettledCount) {
        throw enterFatalState("CDP response body capture did not settle cleanly.");
      }
      return Object.freeze({
        bodyClaimCount,
        bodySettledCount,
        bodylessClaimCount,
        observedResponseCount,
        responseClaimCount,
        responseSettledCount,
        status: "cdp-response-bodies-clean",
      });
    },
    observeLoadingFailed(event) {
      assertActive();
      if (!event || typeof event !== "object" || Array.isArray(event)
        || typeof event.errorText !== "string" || event.errorText.length < 1
        || event.errorText.length > 8_192) {
        throwFatal("CDP failed response terminal event is invalid.");
      }
      terminalEntry(event, Object.freeze({
        failureSha256: sha256(event.errorText),
        kind: "failed",
      }));
    },
    observeLoadingFinished(event) {
      assertActive();
      if (!event || typeof event !== "object" || Array.isArray(event)
        || typeof event.encodedDataLength !== "number"
        || !Number.isFinite(event.encodedDataLength) || event.encodedDataLength < 0) {
        throwFatal("CDP finished response terminal event is invalid.");
      }
      terminalEntry(event, Object.freeze({ kind: "finished" }));
    },
    observeResponseReceived(event) {
      assertActive();
      if (!event || typeof event !== "object" || Array.isArray(event)
        || !event.response || typeof event.response !== "object"
        || Array.isArray(event.response)) {
        throwFatal("CDP response event is invalid.");
      }
      let requestId;
      let key;
      try {
        requestId = providerOverlapCdpRequestId(event, "CDP response event");
        key = providerOverlapCdpResponseKey({
          resourceType: event.type,
          status: event.response.status,
          url: event.response.url,
        }, "cdp");
      } catch (error) {
        throw enterFatalState(safeContractFailure(error));
      }
      if (entryByRequestId.has(requestId)) {
        throwFatal("CDP response request identity was observed more than once.");
      }
      const repeatableStatic = repeatableStaticResponseUrls.has(event.response.url);
      if (unclaimedEntryByKey.has(key) && !repeatableStatic) {
        throwFatal("CDP response body identity is ambiguous.");
      }
      observedResponseCount += 1;
      if (observedResponseCount > maximumRequests) {
        throwFatal("CDP response body capture exceeded its request bound.");
      }
      const entry = {
        claim: null,
        key,
        readStarted: false,
        requestId,
        terminal: null,
      };
      entryByRequestId.set(requestId, entry);
      const claim = dequeue(waitingClaimByKey, key);
      if (claim) {
        bind(entry, claim);
      } else {
        enqueue(unclaimedEntryByKey, key, entry);
      }
    },
    readBody(readInput) {
      assertActive();
      try {
        exactKeys(readInput, [
          "maximumBodyBytes", "resourceType", "status", "url",
        ], "CDP response body claim");
        if (!Number.isSafeInteger(readInput.maximumBodyBytes)
          || readInput.maximumBodyBytes < 1
          || readInput.maximumBodyBytes > maximumStaticAssetBytes) {
          throw new Error("CDP response body claim byte bound is invalid.");
        }
        return createClaim(readInput, readInput.maximumBodyBytes);
      } catch (error) {
        if (fatalError) throw fatalError;
        throw enterFatalState(safeContractFailure(error));
      }
    },
    skipResponseBody(skipInput) {
      assertActive();
      try {
        exactKeys(skipInput, [
          "resourceType", "status", "url",
        ], "CDP bodyless response claim");
        return createClaim(skipInput, null);
      } catch (error) {
        if (fatalError) throw fatalError;
        throw enterFatalState(safeContractFailure(error));
      }
    },
    snapshot() {
      const pendingResponseCount = [...entryByRequestId.values()]
        .filter((entry) => entry.claim && !entry.claim.settled).length
        + queueSize(waitingClaimByKey);
      return Object.freeze({
        bodyClaimCount,
        bodySettledCount,
        bodylessClaimCount,
        fatal: fatalError !== null,
        observedResponseCount,
        pendingResponseCount,
        responseClaimCount,
        responseFailureCount,
        responseSettledCount,
        unclaimedResponseCount: queueSize(unclaimedEntryByKey),
      });
    },
  });
}

export function isProviderOverlapPlaywrightBodyCdpResponse(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)
    || !event.response || typeof event.response !== "object" || Array.isArray(event.response)
    || typeof event.response.url !== "string") {
    return false;
  }
  let url;
  try {
    url = new URL(event.response.url);
  } catch {
    return false;
  }
  if (url.origin === "https://pay.ci.clean-pay.dev") {
    if (event.type !== "Fetch" || event.response.status !== 200
      || url.username !== "" || url.password !== "" || url.hash !== "" || url.port !== "") {
      return false;
    }
    if (url.pathname === "/cabinet") return url.search === "";
    return url.pathname === "/login"
      && JSON.stringify([...url.searchParams.keys()])
        === JSON.stringify(["redirect_to", "_rsc"])
      && url.searchParams.get("redirect_to") === "/"
      && opaquePattern.test(url.searchParams.get("_rsc") ?? "");
  }
  if (url.origin !== "https://chatwoot.browser.clean-pay.dev"
    || url.pathname !== "/widget" || url.username !== "" || url.password !== ""
    || url.hash !== "") {
    return false;
  }
  const hasConversation = url.searchParams.has("cw_conversation");
  const expectedKeys = hasConversation
    ? ["cw_conversation", "website_token"]
    : ["website_token"];
  if (JSON.stringify([...url.searchParams.keys()].sort()) !== JSON.stringify(expectedKeys)) {
    return false;
  }
  if (!sha256Pattern.test(url.searchParams.get("website_token") ?? "")) return false;
  return !hasConversation
    || opaquePattern.test(url.searchParams.get("cw_conversation") ?? "");
}

export async function captureProviderOverlapResponseEvidence(input) {
  const hasReadBody = Boolean(input && typeof input === "object" && !Array.isArray(input)
    && Object.hasOwn(input, "readBody"));
  const hasTerminal = Boolean(input && typeof input === "object" && !Array.isArray(input)
    && Object.hasOwn(input, "terminal"));
  const inputKeys = ["classification", "request", "response"];
  if (hasReadBody) inputKeys.push("readBody");
  if (hasTerminal) inputKeys.push("terminal");
  exactKeys(input, inputKeys, "browser response capture");
  const { classification, readBody, request, response } = input;
  exactKeys(classification, [
    "disposition", "expectedStatuses", "key", "navigation", "staticAssetSha256", "staticPath",
  ], "browser response capture classification");
  if (!request || typeof request !== "object" || !response || typeof response !== "object"
    || typeof response.request !== "function" || response.request() !== request
    || typeof response.status !== "function" || typeof response.headers !== "function"
    || typeof response.body !== "function" || typeof response.finished !== "function") {
    fail("Browser response capture identity is invalid.");
  }
  const terminal = input.terminal ?? Promise.resolve(Object.freeze({
    failureSha256: null,
    finished: true,
  }));
  if (!terminal || typeof terminal.then !== "function") {
    fail("Browser response capture terminal gate is invalid.");
  }
  if (hasReadBody && typeof readBody !== "function") {
    fail("Browser response capture body reader is invalid.");
  }
  const responseStatus = response.status();
  // Playwright's synchronous headers() view may still contain provisional
  // redirect headers. Pre-arm only the exact raw Content-Type lookup at the
  // response event and settle it after the matching request terminal event.
  const responseContentTypePromise = typeof response.headerValue === "function"
    ? Promise.resolve(response.headerValue("content-type"))
    : Promise.resolve(response.headers()["content-type"] ?? null);
  void responseContentTypePromise.catch(() => undefined);
  const isRedirectResponse = responseStatus >= 300 && responseStatus <= 399;
  const bodyKind = responseStatus === 200 && classification.staticPath !== null
    ? "static"
    : responseStatus === 200 && classification.disposition === "continue"
        && expectedContentTypes(classification.key, responseStatus)
          .some((value) => new Set(["text/html", "text/x-component"]).has(value))
      ? "declaration"
      : null;
  const maximumBodyBytes = bodyKind === "declaration"
    ? maximumStaticDeclarationBodyBytes
    : bodyKind === "static"
      ? maximumStaticAssetBytes
      : null;
  // Redirect responses are represented by requestWillBeSent in CDP and do
  // not have a standalone responseReceived event that could satisfy a claim.
  // Every other Playwright response is pre-claimed at the response event,
  // including bodyless responses, before another identical response can race.
  const bodyPromise = hasReadBody && !isRedirectResponse
    ? Promise.resolve(readBody(Object.freeze({
        maximumBodyBytes,
        readPlaywrightBody: () => response.body(),
      })))
    : bodyKind === null
      ? null
      : Promise.resolve(response.body());
  // The live harness supplies the exact requestfinished/requestfailed result,
  // which is Playwright's underlying terminal event. Keep response.finished()
  // only for import-compatible direct callers that have no terminal gate.
  const finishedPromise = bodyKind === null || hasTerminal
    ? null
    : Promise.resolve(response.finished());
  void bodyPromise?.catch(() => undefined);
  void finishedPromise?.catch(() => undefined);

  const terminalResult = await terminal;
  if (!terminalResult || typeof terminalResult !== "object" || Array.isArray(terminalResult)) {
    fail("Browser response capture terminal result is invalid.");
  }
  exactKeys(terminalResult, ["failureSha256", "finished"], "browser response terminal result");
  if (typeof terminalResult.finished !== "boolean"
    || (terminalResult.finished
      ? terminalResult.failureSha256 !== null
      : !sha256Pattern.test(terminalResult.failureSha256 ?? ""))) {
    fail("Browser response capture terminal result is invalid.");
  }
  const rawResponseContentType = await boundedLifecycleOperation(
    responseContentTypePromise,
    5_000,
    "browser response content type",
  );
  const responseContentType = normalizeProviderOverlapObservedResponseContentType({
    key: classification.key,
    rawContentType: rawResponseContentType,
    status: responseStatus,
  });
  if (!terminalResult.finished) {
    const isExactResponseBackedAbort = providerOverlapResponseBackedAbortKeys.has(
      classification.key,
    )
      && responseStatus === 200
      && responseContentType === "text/x-component"
      && terminalResult.failureSha256 === providerOverlapResponseBackedAbortFailureSha256;
    if (!isExactResponseBackedAbort) {
      fail(bodyKind === "static"
        ? "Attested static browser response did not finish cleanly."
        : `Browser response did not finish cleanly: key=${classification.key}; `
          + `status=${String(responseStatus)}; `
          + `failureSha256=${terminalResult.failureSha256}.`);
    }
    return Object.freeze({
      body: null,
      classification,
      request,
      response,
      responseContentType,
      responseFailureSha256: terminalResult.failureSha256,
      responseStatus,
    });
  }
  if (bodyKind === null) {
    if (bodyPromise !== null) {
      const skippedBody = await boundedLifecycleOperation(
        bodyPromise,
        maximumResponseBodyLifecycleMs,
        "bodyless browser response identity",
      );
      if (skippedBody !== null) {
        fail("Bodyless browser response capture returned an unexpected body.");
      }
    }
    return Object.freeze({
      body: null,
      classification,
      request,
      response,
      responseContentType,
      responseFailureSha256: null,
      responseStatus,
    });
  }

  // Body retrieval is registered above at the response event. Its unchanged
  // settlement bound begins only after the exact request terminal gate, while
  // the caller retains the independent 15-second request-lifecycle bound.
  const boundedBodyPromise = boundedLifecycleOperation(
    bodyPromise,
    maximumResponseBodyLifecycleMs,
    bodyKind === "static" ? "attested static response body" : "static declaration response body",
  );
  const boundedFinishedPromise = hasTerminal
    ? Promise.resolve(null)
    : boundedLifecycleOperation(
        finishedPromise,
        5_000,
        bodyKind === "static" ? "static response completion" : "browser response completion",
      );
  const [body, responseFailure] = await Promise.all([boundedBodyPromise, boundedFinishedPromise]);
  if (responseFailure !== null) {
    fail(bodyKind === "static"
      ? "Attested static browser response did not finish cleanly."
      : "Browser declaration response did not finish cleanly.");
  }
  if (!(body instanceof Uint8Array)
    || body.byteLength < 1 || body.byteLength > maximumBodyBytes) {
    fail("Browser response capture body is outside its bounded contract.");
  }
  return Object.freeze({
    body,
    classification,
    request,
    response,
    responseContentType,
    responseFailureSha256: null,
    responseStatus,
  });
}

export function normalizeProviderOverlapResponseContentType(value) {
  if (value === undefined) return null;
  const normalized = String(value).split(";", 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)) {
    fail("Synthetic browser response content type is invalid.");
  }
  return normalized;
}

export function normalizeProviderOverlapObservedResponseContentType(input) {
  exactKeys(input, ["key", "rawContentType", "status"], "browser response content type");
  const normalized = normalizeProviderOverlapResponseContentType(
    input.rawContentType ?? undefined,
  );
  // A bodyless Next.js redirect may omit Content-Type on the wire. The pinned
  // sanitized HAR contract canonically represents that exact empty response as
  // application/octet-stream, so use the same representation for only the two
  // fixed Telegram 307 redirect classes. The semantic allowlist stays exact.
  if (normalized === null && input.status === 307
    && new Set(["app-telegram-start", "app-telegram-callback"]).has(input.key)) {
    return "application/octet-stream";
  }
  return normalized;
}

export async function readProviderOverlapStaticResponseEvidence(input, staticAssetContract) {
  exactKeys(input, [
    "classification", "response", "responseContentType",
  ], "static response reader");
  const response = input.response;
  if (!response || typeof response.finished !== "function"
    || typeof response.body !== "function" || typeof response.status !== "function") {
    fail("Attested static browser request has no readable response.");
  }
  const responseFailure = await boundedLifecycleOperation(
    response.finished(),
    5_000,
    "static response completion",
  );
  if (responseFailure !== null) {
    fail("Attested static browser response did not finish cleanly.");
  }
  const body = await boundedLifecycleOperation(
    response.body(),
    5_000,
    "attested static response body",
  );
  return Object.freeze({
    body,
    observation: attestProviderOverlapStaticResponse({
      body,
      classification: input.classification,
      responseContentType: input.responseContentType,
      responseStatus: response.status(),
    }, staticAssetContract),
  });
}

export function extractProviderOverlapResponseStaticDeclarations(body, staticAssetContract) {
  assertStaticAssetContract(staticAssetContract);
  if (!(body instanceof Uint8Array)
    || body.byteLength < 1 || body.byteLength > maximumStaticDeclarationBodyBytes) {
    fail("Static response declaration body is outside its bounded byte contract.");
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    fail("Static response declaration body is not valid UTF-8.");
  }
  const declarations = [];
  const nonModuleDeclarationEncodings = new Set();
  let nonModuleDeclarationPath = null;
  let cursor = 0;
  while (cursor < source.length) {
    const prefixIndex = source.indexOf("/_next/static/", cursor);
    if (prefixIndex === -1) break;
    const openingQuote = source[prefixIndex - 1];
    const openingEscape = source[prefixIndex - 2];
    const escapedQuote = openingQuote === '"' && openingEscape === "\\";
    const rawQuote = openingQuote === '"' && openingEscape !== "\\";
    if ((!rawQuote && !escapedQuote)
      || (escapedQuote && source[prefixIndex - 3] === "\\")) {
      fail("Static response declaration has no exact paired opening quote.");
    }
    nextStaticDeclarationPattern.lastIndex = prefixIndex;
    const match = nextStaticDeclarationPattern.exec(source);
    if (!match || match.index !== prefixIndex) {
      fail("Static response contains an unknown, partial, or unsafe declaration.");
    }
    const servedPath = match[0];
    const declarationEnd = nextStaticDeclarationPattern.lastIndex;
    const hasPairedClosingQuote = escapedQuote
      ? source.slice(declarationEnd, declarationEnd + 2) === '\\"'
      : source[declarationEnd] === '"';
    if (!nextStaticPattern.test(servedPath)
      || new URL(servedPath, "https://pay.ci.clean-pay.dev").pathname !== servedPath
      || !hasPairedClosingQuote
      || !Object.hasOwn(staticAssetContract.inventoryByPath, servedPath)) {
      fail("Static response declaration escaped its paired canonical attested inventory.");
    }
    const declarationEncoding = rawQuote ? "raw" : "escaped";
    const quote = rawQuote ? '"' : '\\"';
    const scriptPrefix = rawQuote ? '<script src="' : '<script src=\\"';
    const tagSuffix = source.slice(declarationEnd);
    const nonModulePrefix = `${quote} noModule=${quote}${quote}`;
    const noNonceSuffix = `${nonModulePrefix}></script>`;
    const noncePrefix = `${nonModulePrefix} nonce=${quote}`;
    const nonceStart = noncePrefix.length;
    const nonce = tagSuffix.slice(nonceStart, nonceStart + 32);
    const nonceSuffix = `${quote}></script>`;
    const exactNonceSuffix = tagSuffix.startsWith(noncePrefix)
      && /^[a-f0-9]{32}$/.test(nonce)
      && tagSuffix.slice(nonceStart + 32, nonceStart + 32 + nonceSuffix.length)
        === nonceSuffix;
    const exactNonModuleScript = source.slice(
      prefixIndex - scriptPrefix.length,
      prefixIndex,
    ) === scriptPrefix && (tagSuffix.startsWith(noNonceSuffix) || exactNonceSuffix);
    if (exactNonModuleScript) {
      if (nonModuleDeclarationEncodings.has(declarationEncoding)
        || (nonModuleDeclarationPath !== null && nonModuleDeclarationPath !== servedPath)) {
        fail("Static response contains an incoherent exact nomodule declaration.");
      }
      nonModuleDeclarationEncodings.add(declarationEncoding);
      nonModuleDeclarationPath = servedPath;
    } else if (declarations.length >= maximumRequests) {
      fail("Static response declaration count exceeds its bound.");
    } else {
      declarations.push(servedPath);
    }
    cursor = declarationEnd + (escapedQuote ? 2 : 1);
  }
  return Object.freeze(declarations);
}

export function extractProviderOverlapCssMediaReferences(
  body,
  sourcePath,
  staticAssetContract,
) {
  assertStaticAssetContract(staticAssetContract);
  if (!(body instanceof Uint8Array)
    || body.byteLength < 1 || body.byteLength > maximumStaticAssetBytes
    || !/^\/_next\/static\/chunks(?:\/[A-Za-z0-9._-]{1,100}){0,5}\/[A-Za-z0-9._-]{1,200}\.css$/.test(
      sourcePath ?? "",
    )) {
    fail("Static CSS declaration source is invalid.");
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    fail("Static CSS response is not valid UTF-8.");
  }
  const references = [];
  const expression = /url\(\s*(?:(['"])([^'"()]*)\1|([^'"()\s][^()]*?))\s*\)/g;
  const declaredUrlCount = [...source.matchAll(/url\s*\(/gi)].length;
  let match;
  while ((match = expression.exec(source)) !== null) {
    if (references.length >= maximumRequests) fail("Static CSS reference count exceeds its bound.");
    const raw = (match[2] ?? match[3] ?? "").trim();
    if (!/^(?:\.\.\/){1,6}media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff2|woff)$/.test(raw)) {
      fail("Static CSS contains a noncanonical, external, or unsafe url() reference.");
    }
    const resolved = new URL(raw, `https://pay.ci.clean-pay.dev${sourcePath}`);
    if (resolved.origin !== "https://pay.ci.clean-pay.dev"
      || resolved.search || resolved.hash || !nextStaticMediaPattern.test(resolved.pathname)
      || !Object.hasOwn(staticAssetContract.inventoryByPath, resolved.pathname)) {
      fail("Static CSS media reference escaped its attested image inventory.");
    }
    references.push(Object.freeze({ sourcePath, targetPath: resolved.pathname }));
  }
  if (references.length !== declaredUrlCount) {
    fail("Static CSS url() declarations were not parsed exactly.");
  }
  return Object.freeze(references);
}

export function assertProviderOverlapRedirect({ from, location, status, to }) {
  exactKeys(from, ["classification", "url"], "redirect source");
  exactKeys(to, ["classification", "url"], "redirect target");
  if (!Number.isSafeInteger(status)) fail("Redirect status is invalid.");
  const resolvedLocation = new URL(location, from.url);
  if (resolvedLocation.href !== to.url || resolvedLocation.hash) {
    fail("Redirect location does not match the exact next request.");
  }
  const edge = `${from.classification.key}:${status}->${to.classification.key}`;
  if (!exactRedirectEdges.has(edge)) {
    fail("Redirect edge is outside the exact provider-overlap contract.");
  }
  return edge;
}

export function normalizeProviderOverlapSemanticEntry(entry, label = "semantic browser request") {
  exactKeys(
    entry,
    [
      "disposition", "key", "redirectEdge", "responseContentType", "responseFailureSha256",
      "responseStatus",
    ],
    label,
  );
  if (!semanticKeys.has(entry.key)) fail(`${label} key is outside the exact contract.`);
  const expectedDisposition = entry.key === "app-cabinet-prefetch-blocked"
    ? "abort"
    : "continue";
  equal(entry.disposition, expectedDisposition, `${label} disposition`);
  const statuses = expectedDisposition === "abort" ? [null]
    : entry.key === "telegram-oidc-authorize" ? [302]
      : ["app-telegram-start", "app-telegram-callback"].includes(entry.key) ? [307]
        : ["app-root-rsc", "app-login-root-rsc", "app-login-rsc"].includes(entry.key)
          ? [200, 307]
          : [200];
  if (!statuses.includes(entry.responseStatus)) fail(`${label} response status is not exact.`);
  const contentTypes = expectedDisposition === "abort"
    ? [null]
    : expectedContentTypes(entry.key, entry.responseStatus);
  if (!contentTypes.includes(entry.responseContentType)) {
    fail(`${label} response content type is not exact.`);
  }
  const isExactResponseBackedAbort = providerOverlapResponseBackedAbortKeys.has(entry.key)
    && entry.responseStatus === 200
    && entry.responseContentType === "text/x-component"
    && entry.responseFailureSha256 === providerOverlapResponseBackedAbortFailureSha256;
  if (entry.responseFailureSha256 !== null && !isExactResponseBackedAbort) {
    fail(`${label} response failure is outside the exact contract.`);
  }
  const mandatoryRedirectByTarget = {
    "telegram-oidc-authorize": "app-telegram-start:307->telegram-oidc-authorize",
    "app-telegram-callback": "telegram-oidc-authorize:302->app-telegram-callback",
    "app-profile-document": "app-telegram-callback:307->app-profile-document",
  };
  const mandatoryRedirect = mandatoryRedirectByTarget[entry.key];
  if (mandatoryRedirect !== undefined) {
    equal(entry.redirectEdge, mandatoryRedirect, `${label} redirect edge`);
  } else if (entry.redirectEdge !== null) {
    if (!["app-login-root-rsc", "app-login-rsc"].includes(entry.key)
      || !exactRedirectEdges.has(entry.redirectEdge)
      || !entry.redirectEdge.endsWith(`->${entry.key}`)) {
      fail(`${label} redirect edge is outside the exact contract.`);
    }
  }
  return Object.freeze({
    disposition: entry.disposition,
    key: entry.key,
    redirectEdge: entry.redirectEdge,
    responseContentType: entry.responseContentType,
    responseFailureSha256: entry.responseFailureSha256,
    responseStatus: entry.responseStatus,
  });
}

export function validateProviderOverlapSemanticLedger(value, label = "semantic browser ledger") {
  if (!Array.isArray(value) || value.length < 9 || value.length > maximumRequests) {
    fail(`${label} is outside its bounded contract.`);
  }
  const ledger = value.map((entry, index) => normalizeProviderOverlapSemanticEntry(
    entry,
    `${label} entry ${index}`,
  ));
  const navigationKeys = new Set(exactNavigationFlow);
  deepEqual(
    ledger.map(({ key }) => key).filter((key) => navigationKeys.has(key)),
    exactNavigationFlow,
    `${label} navigation flow`,
  );
  const counts = Object.create(null);
  const pendingRedirectSources = new Map();
  for (const [index, entry] of ledger.entries()) {
    counts[entry.key] = (counts[entry.key] ?? 0) + 1;
    if (entry.redirectEdge !== null) {
      const match = /^(?<source>[a-z0-9-]+):(?<status>30[1278])->(?<target>[a-z0-9-]+)$/.exec(
        entry.redirectEdge,
      );
      const sourceKey = match ? `${match.groups.source}:${match.groups.status}` : "";
      if (!match || match.groups.target !== entry.key
        || (pendingRedirectSources.get(sourceKey) ?? 0) < 1) {
        fail(`${label} redirect successor ${index} has no exact prior source.`);
      }
      pendingRedirectSources.set(sourceKey, pendingRedirectSources.get(sourceKey) - 1);
    }
    if (Number.isSafeInteger(entry.responseStatus)
      && entry.responseStatus >= 300 && entry.responseStatus <= 399) {
      const sourceKey = `${entry.key}:${entry.responseStatus}`;
      pendingRedirectSources.set(sourceKey, (pendingRedirectSources.get(sourceKey) ?? 0) + 1);
    }
  }
  if ([...pendingRedirectSources.values()].some((count) => count !== 0)) {
    fail(`${label} contains a redirect source without one exact successor.`);
  }
  if ((counts["turnstile-widget-script"] ?? 0) < 1
    || (counts["chatwoot-sdk-script"] ?? 0) < 1
    || counts["chatwoot-widget-frame"] !== counts["chatwoot-sdk-script"]
    || (counts["chatwoot-widget-conversation-frame"] ?? 0)
      > counts["chatwoot-sdk-script"]) {
    fail(`${label} external request relation is invalid.`);
  }
  return Object.freeze(ledger);
}

export function finalizeProviderOverlapHistoryContract(records, finalFrame) {
  if (!Array.isArray(records) || records.length !== 4) {
    fail("Browser history ledger is outside its bounded contract.");
  }
  exactKeys(finalFrame, ["frameId", "loaderId", "url"], "final history frame");
  const [checkpoint, documentNavigation, ...deliveryPair] = records;
  exactKeys(
    checkpoint,
    ["frameId", "historyLength", "kind", "loaderId", "url"],
    "history checkpoint",
  );
  exactKeys(
    documentNavigation,
    ["frameId", "kind", "loaderId", "navigationType", "url"],
    "history document navigation",
  );
  if (checkpoint.kind !== "checkpoint"
    || documentNavigation.kind !== "document-navigation"
    || exactHistoryLocation(checkpoint.url) !== "app-profile"
    || exactHistoryLocation(documentNavigation.url) !== "app-cabinet"
    || documentNavigation.navigationType !== "Navigation"
    || !exactCdpIdentity(checkpoint.frameId) || !exactCdpIdentity(checkpoint.loaderId)
    || !exactCdpIdentity(documentNavigation.frameId)
    || !exactCdpIdentity(documentNavigation.loaderId)
    || checkpoint.frameId !== documentNavigation.frameId
    || checkpoint.loaderId === documentNavigation.loaderId
    || !Number.isSafeInteger(checkpoint.historyLength)
    || checkpoint.historyLength < 1 || checkpoint.historyLength > 128) {
    fail("Browser document history transition is invalid.");
  }
  const replaceState = deliveryPair.find(({ kind }) => kind === "replaceState");
  const sameDocument = deliveryPair.find(({ kind }) => kind === "same-document-navigation");
  if (!replaceState || !sameDocument || new Set(deliveryPair.map(({ kind }) => kind)).size !== 2) {
    fail("Browser history hydration delivery pair is invalid.");
  }
  exactKeys(replaceState, [
    "afterNextAppRouterState", "argumentUrl", "beforeHistoryLength",
    "beforeNextAppRouterState", "beforeUrl", "historyLength", "kind",
    "operationSequence", "url",
  ], "history replaceState operation");
  exactKeys(sameDocument, [
    "frameId", "kind", "navigationType", "url",
  ], "same-document history navigation");
  if (exactHistoryLocation(replaceState.beforeUrl) !== "app-cabinet"
    || exactHistoryLocation(replaceState.url) !== "app-cabinet"
    || exactHistoryLocation(replaceState.argumentUrl) !== "app-cabinet"
    || replaceState.beforeUrl !== replaceState.url
    || replaceState.argumentUrl !== replaceState.url
    || replaceState.operationSequence !== 1
    || !Number.isSafeInteger(replaceState.beforeHistoryLength)
    || replaceState.beforeHistoryLength < 1 || replaceState.beforeHistoryLength > 128
    || replaceState.beforeHistoryLength !== checkpoint.historyLength + 1
    || replaceState.historyLength !== replaceState.beforeHistoryLength
    || replaceState.beforeNextAppRouterState !== false
    || replaceState.afterNextAppRouterState !== true
    || exactHistoryLocation(sameDocument.url) !== "app-cabinet"
    || sameDocument.url !== replaceState.url
    || sameDocument.frameId !== checkpoint.frameId
    || sameDocument.navigationType !== "historyApi") {
    fail("Browser Next hydration history transition is invalid.");
  }
  if (!exactCdpIdentity(finalFrame.frameId) || !exactCdpIdentity(finalFrame.loaderId)
    || exactHistoryLocation(finalFrame.url) !== "app-cabinet"
    || finalFrame.frameId !== checkpoint.frameId
    || finalFrame.loaderId !== documentNavigation.loaderId
    || finalFrame.url !== documentNavigation.url) {
    fail("Final browser frame tree differs from the exact cabinet document transition.");
  }
  const historyLedger = Object.freeze([
    Object.freeze({ kind: "checkpoint", location: "app-profile" }),
    Object.freeze({
      frameRelation: "same-main-frame",
      kind: "document-navigation",
      loaderRelation: "changed",
      location: "app-cabinet",
      navigationType: "Navigation",
    }),
    Object.freeze({
      historyLengthRelation: "unchanged",
      kind: "replaceState",
      location: "app-cabinet",
      operationSequence: 1,
      stateTransition: "unmarked-to-next-app-router",
      urlRelation: "unchanged",
    }),
    Object.freeze({
      frameRelation: "same-main-frame",
      kind: "same-document-navigation",
      location: "app-cabinet",
      navigationType: "historyApi",
      pairedOperationSequence: 1,
    }),
  ]);
  return Object.freeze({
    historyContractSha256: sha256(JSON.stringify(historyLedger)),
    historyCount: historyLedger.length,
    historyLedger,
  });
}

export function finalizeProviderOverlapBrowserContract(records, loadGraph) {
  if (!Array.isArray(records) || records.length === 0 || records.length > maximumRequests) {
    fail("Browser request ledger is outside its bounded contract.");
  }
  exactKeys(loadGraph, [
    "cssMediaReferences", "responseDeclarationsByDocument", "staticAssetContract",
  ], "static load graph");
  assertStaticAssetContract(loadGraph.staticAssetContract);
  if (!Array.isArray(loadGraph.responseDeclarationsByDocument)
    || loadGraph.responseDeclarationsByDocument.length !== exactStaticDocuments.length
    || !Array.isArray(loadGraph.cssMediaReferences)
    || loadGraph.cssMediaReferences.length > maximumRequests) {
    fail("Static response declaration graph is outside its bounded contract.");
  }
  const responseDeclarationsByDocument = new Map();
  for (const [index, entry] of loadGraph.responseDeclarationsByDocument.entries()) {
    exactKeys(entry, ["documentKey", "paths"], `static document declaration ${index}`);
    const expectedDocumentKey = exactStaticDocuments[index].documentKey;
    if (entry.documentKey !== expectedDocumentKey || !Array.isArray(entry.paths)
      || entry.paths.length > maximumRequests
      || new Set(entry.paths).size !== entry.paths.length
      || JSON.stringify([...entry.paths].sort()) !== JSON.stringify(entry.paths)
      || entry.paths.some((servedPath) => !nextStaticPattern.test(servedPath))) {
      fail("Static document response declaration graph is invalid.");
    }
    responseDeclarationsByDocument.set(entry.documentKey, entry.paths);
  }
  const navigationFlow = records
    .filter(({ classification }) => classification.navigation)
    .map(({ classification }) => classification.key);
  deepEqual(navigationFlow, exactNavigationFlow, "browser navigation flow");

  const counts = {};
  const redirects = [];
  const semanticLedger = [];
  const staticLedger = [];
  const requestOrderLedger = [];
  const requestOccurrences = { semantic: 0, static: 0 };
  const observedStaticPaths = new Set();
  const observedByDocument = new Map(exactStaticDocuments.map(({ documentKey }) => [
    documentKey,
    { chunks: new Set(), media: new Set(), paths: new Set() },
  ]));
  let activeDocumentKey = null;
  for (const [index, record] of records.entries()) {
    exactKeys(
      record,
      [
        "classification", "documentKey", "redirectEdge", "responseContentType",
        "responseFailureSha256", "responseStatus", "staticResponseBytes", "staticResponseSha256",
      ],
      `browser request record ${index}`,
    );
    const classification = record.classification;
    if (!classification || typeof classification.key !== "string") {
      fail(`Browser request record ${index} classification is invalid.`);
    }
    if (record.documentKey !== null && !exactStaticDocumentKeys.has(record.documentKey)) {
      fail(`Browser request record ${index} document generation is invalid.`);
    }
    if (exactStaticDocumentKeys.has(classification.key)) activeDocumentKey = classification.key;
    if (record.documentKey !== activeDocumentKey
      || (exactStaticDocumentKeys.has(classification.key)
        && record.documentKey !== classification.key)) {
      fail("Application document request is outside its exact static generation.");
    }
    if (staticKeys.has(classification.key)) {
      if (!nextStaticPattern.test(classification.staticPath ?? "")
        || !exactStaticDocumentKeys.has(record.documentKey)) {
        fail("Static request path or document generation is invalid.");
      }
      const documentObservation = observedByDocument.get(record.documentKey);
      if (documentObservation.paths.has(classification.staticPath)) {
        fail("Static request is duplicated within one document generation.");
      }
      const metadata = loadGraph.staticAssetContract
        .inventoryMetadataByPath[classification.staticPath];
      if (loadGraph.staticAssetContract.inventoryByPath[classification.staticPath]
          !== classification.staticAssetSha256
        || record.staticResponseSha256 !== classification.staticAssetSha256
        || record.staticResponseBytes !== metadata?.assetBytes
        || !expectedStaticContentTypes(metadata?.extension).includes(record.responseContentType)) {
        fail("Static request differs from its attested image inventory.");
      }
      observedStaticPaths.add(classification.staticPath);
      if (classification.staticPath.startsWith("/_next/static/chunks/")) {
        documentObservation.chunks.add(classification.staticPath);
      } else {
        documentObservation.media.add(classification.staticPath);
      }
      documentObservation.paths.add(classification.staticPath);
      staticLedger.push({
        assetBytes: record.staticResponseBytes,
        assetSha256: classification.staticAssetSha256,
        class: classification.key,
        contentType: record.responseContentType,
        documentKey: record.documentKey,
        pathSha256: sha256(classification.staticPath),
      });
      requestOccurrences.static += 1;
      requestOrderLedger.push({ kind: "static", occurrence: requestOccurrences.static });
    } else if (classification.staticPath !== null || classification.staticAssetSha256 !== null) {
      fail("Non-static browser request contains a static asset binding.");
    } else {
      if (record.staticResponseBytes !== null || record.staticResponseSha256 !== null) {
        fail("Non-static browser request contains static response bytes.");
      }
      semanticLedger.push(normalizeProviderOverlapSemanticEntry({
        disposition: classification.disposition,
        key: classification.key,
        redirectEdge: record.redirectEdge,
        responseContentType: record.responseContentType,
        responseFailureSha256: record.responseFailureSha256,
        responseStatus: record.responseStatus,
      }, `browser semantic request ${index}`));
      requestOccurrences.semantic += 1;
      requestOrderLedger.push({ kind: "semantic", occurrence: requestOccurrences.semantic });
    }
    counts[classification.key] = (counts[classification.key] ?? 0) + 1;
    if (classification.disposition === "abort") {
      equal(record.responseStatus, null, `browser blocked response ${index}`);
      equal(record.responseContentType, null, `browser blocked content type ${index}`);
      equal(record.responseFailureSha256, null, `browser blocked response failure ${index}`);
    } else if (!classification.expectedStatuses.includes(record.responseStatus)) {
      fail(`Browser response ${index} status is outside its exact contract.`);
    } else if (!expectedContentTypes(classification.key, record.responseStatus)
      .includes(record.responseContentType)) {
      fail(`Browser response ${index} content type is outside its exact contract.`);
    }
    if (staticKeys.has(classification.key) && record.responseFailureSha256 !== null) {
      fail("Static browser request contains a response failure.");
    }
    if (record.redirectEdge !== null) redirects.push(record.redirectEdge);
  }
  for (const key of exactNavigationFlow) equal(counts[key], 1, `browser navigation count ${key}`);
  for (const key of ["next-static-css", "next-static-font", "next-static-js"]) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 1) {
      fail(`Browser request contract requires ${key}.`);
    }
  }
  if ((counts["turnstile-widget-script"] ?? 0) < 1) {
    fail("Browser request contract requires a Turnstile widget script.");
  }
  if ((counts["chatwoot-sdk-script"] ?? 0) < 1) {
    fail("Browser request contract requires the Chatwoot SDK.");
  }
  equal(
    counts["chatwoot-widget-frame"],
    counts["chatwoot-sdk-script"],
    "Chatwoot fresh widget relation",
  );
  if ((counts["chatwoot-widget-conversation-frame"] ?? 0) > counts["chatwoot-sdk-script"]) {
    fail("Chatwoot replacement widget count is outside its fresh/cache contract.");
  }
  validateProviderOverlapSemanticLedger(semanticLedger, "browser semantic request ledger");
  const inventory = loadGraph.staticAssetContract.inventoryByPath;
  const inventoryMetadata = loadGraph.staticAssetContract.inventoryMetadataByPath;
  const expectedChunks = new Set();
  const declaredPaths = new Set();
  const declaredMedia = new Set();
  const validatedCssMediaReferences = loadGraph.cssMediaReferences.map((entry, index) => {
    exactKeys(entry, ["sourcePath", "targetPath"], `CSS media reference ${index}`);
    if (!/^\/_next\/static\/chunks(?:\/[A-Za-z0-9._-]{1,100}){0,5}\/[A-Za-z0-9._-]{1,200}\.css$/.test(
      entry.sourcePath ?? "",
    ) || !nextStaticMediaPattern.test(entry.targetPath ?? "")
      || !observedStaticPaths.has(entry.sourcePath)
      || !Object.hasOwn(inventory, entry.targetPath)) {
      fail("CSS media reference is outside its observed and attested closure.");
    }
    return { sourcePath: entry.sourcePath, targetPath: entry.targetPath };
  }).sort((left, right) => (
    left.sourcePath.localeCompare(right.sourcePath)
      || left.targetPath.localeCompare(right.targetPath)
  ));
  const cssMediaExtensionCounts = Object.create(null);
  for (const { targetPath } of validatedCssMediaReferences) {
    const extension = staticExtension(targetPath);
    cssMediaExtensionCounts[extension] = (cssMediaExtensionCounts[extension] ?? 0) + 1;
  }
  deepEqual(
    Object.fromEntries(Object.entries(cssMediaExtensionCounts).sort()),
    exactCssMediaExtensionCounts,
    "exact current CSS media fallback extension closure",
  );
  const cssMediaTargets = new Set(validatedCssMediaReferences.map(({ targetPath }) => targetPath));
  const documentLoadLedger = [];
  let negotiatedMediaPaths;
  let sharedResponseChunkPaths;
  for (const documentRoute of loadGraph.staticAssetContract.documentRouteContracts) {
    const responseDeclarations = responseDeclarationsByDocument.get(documentRoute.documentKey);
    const routeDeclaredPaths = new Set(documentRoute.routeDeclaredPaths);
    const documentExpectedChunks = new Set(routeDeclaredPaths);
    const documentDeclaredMedia = new Set();
    for (const servedPath of responseDeclarations) {
      if (!Object.hasOwn(inventory, servedPath)) {
        fail("Static declaration graph escaped the attested image inventory.");
      }
      declaredPaths.add(servedPath);
      if (servedPath.startsWith("/_next/static/chunks/")) {
        documentExpectedChunks.add(servedPath);
      } else {
        documentDeclaredMedia.add(servedPath);
        declaredMedia.add(servedPath);
      }
    }
    for (const servedPath of routeDeclaredPaths) expectedChunks.add(servedPath);
    for (const servedPath of documentExpectedChunks) expectedChunks.add(servedPath);
    const observation = observedByDocument.get(documentRoute.documentKey);
    deepEqual(
      [...observation.chunks].sort(),
      [...documentExpectedChunks].sort(),
      `exact ${documentRoute.documentKey} static chunk load graph`,
    );
    const observedMedia = [...observation.media].sort();
    if (observedMedia.length !== 2 || observedMedia.some((servedPath) => (
      inventoryMetadata[servedPath]?.extension !== "woff2"
      || !documentDeclaredMedia.has(servedPath)
      || !cssMediaTargets.has(servedPath)
    ))) {
      fail("Document negotiated media differs from the exact pinned WOFF2 subset.");
    }
    if (negotiatedMediaPaths === undefined) {
      negotiatedMediaPaths = observedMedia;
    } else {
      deepEqual(observedMedia, negotiatedMediaPaths, "cross-document negotiated media paths");
    }
    const responseOnlyChunks = [...documentExpectedChunks]
      .filter((servedPath) => !routeDeclaredPaths.has(servedPath))
      .sort();
    if (sharedResponseChunkPaths === undefined) {
      sharedResponseChunkPaths = responseOnlyChunks;
    } else {
      deepEqual(
        responseOnlyChunks,
        sharedResponseChunkPaths,
        "cross-document response-declared shared chunk paths",
      );
    }
    documentLoadLedger.push(Object.freeze({
      documentKey: documentRoute.documentKey,
      expectedChunkPathSha256s: Object.freeze([...documentExpectedChunks].map(sha256).sort()),
      expectedMediaPathSha256s: Object.freeze(observedMedia.map(sha256).sort()),
      routeDeclaredPathSha256s: Object.freeze([...routeDeclaredPaths].map(sha256).sort()),
    }));
  }
  const observedChunks = [...observedStaticPaths]
    .filter((servedPath) => servedPath.startsWith("/_next/static/chunks/"))
    .sort();
  deepEqual(observedChunks, [...expectedChunks].sort(), "exact static chunk load graph");
  const observedMedia = [...observedStaticPaths]
    .filter((servedPath) => servedPath.startsWith("/_next/static/media/"))
    .sort();
  if (observedMedia.some((servedPath) => !declaredMedia.has(servedPath))) {
    fail("Observed static media escaped the exact static media declaration closure.");
  }
  const cssMediaReferences = validatedCssMediaReferences.map((entry, index) => ({
    occurrence: index + 1,
    sourcePathSha256: sha256(entry.sourcePath),
    targetPathSha256: sha256(entry.targetPath),
  }));
  if (declaredMedia.size > 0 && cssMediaReferences.length === 0) {
    fail("Static media declarations have no exact CSS reference ledger.");
  }

  const sortedDeclaredPaths = [...declaredPaths].sort();
  const declaredPathLedger = sortedDeclaredPaths.map((servedPath) => ({
    class: servedPath.startsWith("/_next/static/chunks/") ? "chunk" : "media",
    pathSha256: sha256(servedPath),
  })).sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));

  const staticLoadGraph = Object.freeze({
    assetAttestationSha256: loadGraph.staticAssetContract.attestationSha256,
    assetInventorySha256: loadGraph.staticAssetContract.inventorySha256,
    cssMediaReferenceLedger: Object.freeze(cssMediaReferences.map(Object.freeze)),
    declaredPathLedger: Object.freeze(declaredPathLedger.map(Object.freeze)),
    declaredPathSha256s: Object.freeze(declaredPathLedger.map(({ pathSha256 }) => pathSha256)),
    documentLoadLedger: Object.freeze(documentLoadLedger),
    expectedChunkPathSha256s: Object.freeze([...expectedChunks].map(sha256).sort()),
    inventoryLedger: Object.freeze(Object.entries(inventory)
      .map(([servedPath, assetSha256]) => Object.freeze({
        assetBytes: inventoryMetadata[servedPath].assetBytes,
        assetSha256,
        extension: inventoryMetadata[servedPath].extension,
        pathSha256: sha256(servedPath),
      }))
      .sort((left, right) => left.pathSha256.localeCompare(right.pathSha256))),
    inventoryLedgerContractSha256:
      loadGraph.staticAssetContract.inventoryLedgerContractSha256,
    routeDeclaredPathContractSha256:
      loadGraph.staticAssetContract.routeDeclaredPathContractSha256,
    routeDeclaredPathSha256s: Object.freeze(
      loadGraph.staticAssetContract.routeDeclaredPaths.map(sha256).sort(),
    ),
  });

  const summary = {
    version: 1,
    semanticLedger,
    staticClasses: [...staticKeys].filter((key) => counts[key] > 0).sort(),
  };
  return Object.freeze({
    requestCount: records.length,
    requestContractSha256: sha256(JSON.stringify(summary)),
    requestOrderContractSha256: sha256(JSON.stringify(requestOrderLedger)),
    requestOrderLedger: Object.freeze(requestOrderLedger.map(Object.freeze)),
    semanticRequestLedger: Object.freeze(semanticLedger.map(Object.freeze)),
    staticLoadGraph,
    staticLoadGraphContractSha256: sha256(JSON.stringify(staticLoadGraph)),
    staticRequestContractSha256: sha256(JSON.stringify(staticLedger)),
    staticRequestCount: staticLedger.length,
    staticRequestLedger: Object.freeze(staticLedger.map(Object.freeze)),
  });
}

function classifyApplicationRequest(descriptor, input, url, state) {
  if (input.method === "GET" && input.isNavigation && input.isMainFrame) {
    exactResourceType(input.resourceType, ["document"]);
    if (url.pathname === "/login") {
      exactQuery(url, [["redirect_to", "/profile"]]);
      descriptor.key = "app-login-document";
    } else if (url.pathname === "/auth/telegram/start") {
      exactQueryKeys(url, ["redirect_to", "turnstile_token"]);
      equal(url.searchParams.get("redirect_to"), "/profile", "Telegram start redirect");
      if (!/^synthetic-turnstile-token:auth_login:synthetic-turnstile-[1-9]\d*:[1-9]\d*$/.test(
        url.searchParams.get("turnstile_token") ?? "",
      )) fail("Telegram start Turnstile token is invalid.");
      descriptor.key = "app-telegram-start";
      descriptor.expectedStatuses = [307];
    } else if (url.pathname === "/auth/telegram/callback") {
      exactQueryKeys(url, ["code", "state"]);
      for (const name of ["code", "state"]) {
        if (!opaquePattern.test(url.searchParams.get(name) ?? "")) {
          fail(`Telegram callback ${name} is invalid.`);
        }
      }
      descriptor.key = "app-telegram-callback";
      descriptor.expectedStatuses = [307];
    } else if (url.pathname === "/profile") {
      exactQuery(url, []);
      descriptor.key = "app-profile-document";
    } else if (url.pathname === "/cabinet") {
      exactQuery(url, []);
      if (!state.cabinetDocumentAllowed) fail("Cabinet document was requested before the barrier.");
      descriptor.key = "app-cabinet-document";
    } else {
      fail("Application navigation path is outside the exact provider-overlap flow.");
    }
    descriptor.navigation = true;
    return;
  }

  if (input.method === "GET" && nextStaticPattern.test(url.pathname)) {
    exactQuery(url, []);
    const extension = url.pathname.slice(url.pathname.lastIndexOf(".") + 1);
    const resourceByExtension = {
      css: ["stylesheet"],
      eot: ["font"],
      ico: ["image"],
      js: ["script"],
      png: ["image"],
      svg: ["image"],
      ttf: ["font"],
      woff: ["font"],
      woff2: ["font"],
    };
    exactResourceType(input.resourceType, resourceByExtension[extension]);
    exactNonNavigation(input);
    descriptor.key = ["eot", "ttf", "woff", "woff2"].includes(extension)
      ? "next-static-font"
      : ["ico", "png", "svg"].includes(extension) ? "next-static-image"
        : `next-static-${extension}`;
    descriptor.staticPath = url.pathname;
    descriptor.staticAssetSha256 = state.staticAssetContract.inventoryByPath[url.pathname] ?? null;
    if (descriptor.staticAssetSha256 === null) {
      fail("Static asset is absent from the attested production image inventory.");
    }
    return;
  }
  if (input.method === "GET" && url.pathname === "/clean-pay-logo.png") {
    exactQuery(url, []);
    exactRequest(input, "GET", "image", false, false);
    descriptor.key = "app-brand-logo";
    return;
  }
  if (input.method === "GET" && url.pathname === "/manifest.webmanifest") {
    exactQuery(url, []);
    exactResourceType(input.resourceType, ["manifest", "other"]);
    exactNonNavigation(input);
    descriptor.key = "app-web-manifest";
    return;
  }
  if (input.method === "GET" && ["/", "/login", "/profile", "/cabinet"].includes(url.pathname)) {
    exactResourceType(input.resourceType, ["fetch"]);
    exactNonNavigation(input);
    if (url.pathname === "/login") {
      const keys = [...url.searchParams.keys()];
      if (keys.includes("redirect_to")) {
        exactQueryKeys(url, url.searchParams.has("_rsc")
          ? ["redirect_to", "_rsc"]
          : ["redirect_to"]);
        const redirectTo = url.searchParams.get("redirect_to");
        if (redirectTo === "/profile") {
          descriptor.key = "app-login-rsc";
        } else if (redirectTo === "/") {
          descriptor.key = "app-login-root-rsc";
        } else {
          fail("login RSC redirect does not match.");
        }
      } else {
        exactQueryKeys(url, ["_rsc"]);
        descriptor.key = "app-login-rsc";
      }
      if (url.searchParams.has("_rsc")) assertRsc(url.searchParams.get("_rsc"));
    } else {
      exactQueryKeys(url, ["_rsc"]);
      assertRsc(url.searchParams.get("_rsc"));
      descriptor.key = url.pathname === "/" ? "app-root-rsc"
        : url.pathname === "/profile" ? "app-profile-rsc"
          : "app-cabinet-rsc";
      descriptor.expectedStatuses = [200, 307];
      if (url.pathname === "/cabinet" && !state.cabinetDocumentAllowed) {
        descriptor.disposition = "abort";
        descriptor.expectedStatuses = [];
        descriptor.key = "app-cabinet-prefetch-blocked";
      }
    }
    descriptor.expectedStatuses = descriptor.disposition === "abort" ? [] : [200, 307];
    return;
  }
  if (input.method === "POST" && ["/login", "/profile", "/cabinet"].includes(url.pathname)) {
    exactQuery(url, []);
    exactResourceType(input.resourceType, ["fetch"]);
    exactNonNavigation(input);
    descriptor.key = url.pathname === "/login" ? "app-login-action"
      : url.pathname === "/profile" ? "app-profile-action"
        : "app-cabinet-action";
    return;
  }
  fail("Application resource path, query, method, or type is outside the exact contract.");
}

function classifyOidcRequest(descriptor, input, url) {
  exactRequest(input, "GET", "document", true, true);
  equal(url.pathname, "/auth", "OIDC authorization path");
  exactQueryKeys(url, [
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "nonce",
    "code_challenge",
    "code_challenge_method",
  ]);
  equal(url.searchParams.get("response_type"), "code", "OIDC response type");
  equal(url.searchParams.get("client_id"), "7654321098", "OIDC client id");
  equal(
    url.searchParams.get("redirect_uri"),
    "https://pay.ci.clean-pay.dev/auth/telegram/callback",
    "OIDC redirect URI",
  );
  equal(url.searchParams.get("scope"), "openid profile", "OIDC scope");
  equal(url.searchParams.get("code_challenge_method"), "S256", "OIDC PKCE method");
  for (const name of ["state", "nonce", "code_challenge"]) {
    if (!opaquePattern.test(url.searchParams.get(name) ?? "")) fail(`OIDC ${name} is invalid.`);
  }
  descriptor.key = "telegram-oidc-authorize";
  descriptor.navigation = true;
  descriptor.expectedStatuses = [302];
}

function classifyChatwootRequest(descriptor, input, url) {
  if (url.pathname === "/packs/js/sdk.js") {
    exactQuery(url, []);
    exactRequest(input, "GET", "script", false, false);
    descriptor.key = "chatwoot-sdk-script";
    return;
  }
  if (url.pathname === "/widget") {
    const hasConversation = url.searchParams.has("cw_conversation");
    exactQueryKeys(url, hasConversation
      ? ["website_token", "cw_conversation"]
      : ["website_token"]);
    if (!sha256Pattern.test(url.searchParams.get("website_token") ?? "")) {
      fail("Chatwoot website token shape is invalid.");
    }
    exactResourceType(input.resourceType, ["document"]);
    if (!input.isNavigation || input.isMainFrame) fail("Chatwoot widget must be a subframe document.");
    if (hasConversation && !opaquePattern.test(url.searchParams.get("cw_conversation") ?? "")) {
      fail("Chatwoot conversation shape is invalid.");
    }
    descriptor.key = hasConversation
      ? "chatwoot-widget-conversation-frame"
      : "chatwoot-widget-frame";
    return;
  }
  fail("Chatwoot browser path is outside the exact provider-overlap contract.");
}

function exactRequest(input, method, resourceType, isNavigation, isMainFrame) {
  equal(input.method, method, "browser request method");
  equal(input.resourceType, resourceType, "browser request resource type");
  equal(input.isNavigation, isNavigation, "browser request navigation flag");
  equal(input.isMainFrame, isMainFrame, "browser request main-frame flag");
}

function exactHistoryLocation(raw) {
  if (raw === "about:blank") return "about-blank";
  const url = exactUrl(raw);
  if (url.hash) fail("Browser history contains a transient hash.");
  if (url.origin === "https://pay.ci.clean-pay.dev") {
    if (url.pathname === "/login") {
      exactQuery(url, [["redirect_to", "/profile"]]);
      return "app-login";
    }
    if (url.pathname === "/auth/telegram/start") {
      exactQueryKeys(url, ["redirect_to", "turnstile_token"]);
      equal(url.searchParams.get("redirect_to"), "/profile", "history Telegram redirect");
      if (!/^synthetic-turnstile-token:auth_login:synthetic-turnstile-[1-9]\d*:[1-9]\d*$/.test(
        url.searchParams.get("turnstile_token") ?? "",
      )) fail("History Telegram Turnstile token is invalid.");
      return "app-telegram-start";
    }
    if (url.pathname === "/auth/telegram/callback") {
      exactQueryKeys(url, ["code", "state"]);
      for (const name of ["code", "state"]) {
        if (!opaquePattern.test(url.searchParams.get(name) ?? "")) fail("History OIDC value is invalid.");
      }
      return "app-telegram-callback";
    }
    if (url.pathname === "/profile" || url.pathname === "/cabinet") {
      exactQuery(url, []);
      return url.pathname === "/profile" ? "app-profile" : "app-cabinet";
    }
  }
  if (url.origin === "https://oauth.telegram.org" && url.pathname === "/auth") {
    exactQueryKeys(url, [
      "response_type", "client_id", "redirect_uri", "scope", "state", "nonce",
      "code_challenge", "code_challenge_method",
    ]);
    equal(url.searchParams.get("response_type"), "code", "history OIDC response type");
    equal(url.searchParams.get("client_id"), "7654321098", "history OIDC client id");
    equal(
      url.searchParams.get("redirect_uri"),
      "https://pay.ci.clean-pay.dev/auth/telegram/callback",
      "history OIDC redirect URI",
    );
    equal(url.searchParams.get("scope"), "openid profile", "history OIDC scope");
    equal(url.searchParams.get("code_challenge_method"), "S256", "history OIDC PKCE method");
    for (const name of ["state", "nonce", "code_challenge"]) {
      if (!opaquePattern.test(url.searchParams.get(name) ?? "")) {
        fail("History OIDC dynamic value is invalid.");
      }
    }
    return "telegram-oidc-authorize";
  }
  fail("Browser history location is outside the exact provider-overlap flow.");
}

function exactCdpIdentity(value) {
  return typeof value === "string" && /^[^\s]{1,256}$/.test(value);
}

function assertStaticAssetContract(value) {
  exactKeys(
    value,
    [
      "attestationSha256",
      "configDigest",
      "documentRouteContracts",
      "imageDigest",
      "inventoryByPath",
      "inventoryMetadataByPath",
      "inventoryLedgerContractSha256",
      "inventorySha256",
      "manifestDigest",
      "routeDeclaredPaths",
      "routeDeclaredPathContractSha256",
    ],
    "static asset contract",
  );
  if (!sha256Pattern.test(value.attestationSha256 ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.configDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.imageDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.manifestDigest ?? "")
    || value.configDigest === value.manifestDigest
    || value.configDigest === value.imageDigest
    || !sha256Pattern.test(value.inventoryLedgerContractSha256 ?? "")
    || !sha256Pattern.test(value.inventorySha256 ?? "")
    || !sha256Pattern.test(value.routeDeclaredPathContractSha256 ?? "")
    || !value.inventoryByPath || typeof value.inventoryByPath !== "object"
    || Array.isArray(value.inventoryByPath)
    || !value.inventoryMetadataByPath || typeof value.inventoryMetadataByPath !== "object"
    || Array.isArray(value.inventoryMetadataByPath) || !Array.isArray(value.routeDeclaredPaths)
    || value.routeDeclaredPaths.length < 1 || value.routeDeclaredPaths.length > maximumRequests
    || !Array.isArray(value.documentRouteContracts)
    || value.documentRouteContracts.length !== exactStaticDocuments.length) {
    fail("Static asset contract is invalid.");
  }
  const inventoryPaths = Object.keys(value.inventoryByPath).sort();
  const metadataPaths = Object.keys(value.inventoryMetadataByPath).sort();
  if (inventoryPaths.length < 1 || inventoryPaths.length > 4_096
    || JSON.stringify(metadataPaths) !== JSON.stringify(inventoryPaths)
    || inventoryPaths.some((servedPath) => !nextStaticPattern.test(servedPath)
      || !sha256Pattern.test(value.inventoryByPath[servedPath])
      || !exactStaticMetadata(value.inventoryMetadataByPath[servedPath], servedPath))) {
    fail("Static asset inventory contract is invalid.");
  }
  const inventoryBytes = inventoryPaths.reduce((total, servedPath) => (
    total + value.inventoryMetadataByPath[servedPath].assetBytes
  ), 0);
  if (!Number.isSafeInteger(inventoryBytes)
    || inventoryBytes > PROVIDER_OVERLAP_MAXIMUM_STATIC_RESPONSE_BYTES) {
    fail("Static asset inventory contract exceeds its aggregate byte bound.");
  }
  if (JSON.stringify([...value.routeDeclaredPaths].sort())
      !== JSON.stringify(value.routeDeclaredPaths)
    || new Set(value.routeDeclaredPaths).size !== value.routeDeclaredPaths.length
    || value.routeDeclaredPaths.some((servedPath) => !Object.hasOwn(value.inventoryByPath, servedPath))) {
    fail("Static route declaration contract is invalid.");
  }
  const routePathUnion = new Set();
  const documentRouteLedger = value.documentRouteContracts.map((entry, index) => {
    exactKeys(entry, ["documentKey", "routeDeclaredPaths"], "static document route contract");
    const expectedDocumentKey = exactStaticDocuments[index].documentKey;
    if (entry.documentKey !== expectedDocumentKey || !Array.isArray(entry.routeDeclaredPaths)
      || entry.routeDeclaredPaths.length < 1 || entry.routeDeclaredPaths.length > 64
      || new Set(entry.routeDeclaredPaths).size !== entry.routeDeclaredPaths.length
      || JSON.stringify([...entry.routeDeclaredPaths].sort())
        !== JSON.stringify(entry.routeDeclaredPaths)
      || entry.routeDeclaredPaths.some((servedPath) => (
        !servedPath.startsWith("/_next/static/chunks/")
        || !value.routeDeclaredPaths.includes(servedPath)
        || !Object.hasOwn(value.inventoryByPath, servedPath)
      ))) {
      fail("Static document route contract is invalid.");
    }
    for (const servedPath of entry.routeDeclaredPaths) routePathUnion.add(servedPath);
    return {
      documentKey: entry.documentKey,
      routeDeclaredPathSha256s: entry.routeDeclaredPaths.map(sha256).sort(),
    };
  });
  if (JSON.stringify([...routePathUnion].sort()) !== JSON.stringify(value.routeDeclaredPaths)) {
    fail("Static document route contracts do not close over the route union.");
  }
  const inventoryLedger = inventoryPaths.map((servedPath) => ({
    assetBytes: value.inventoryMetadataByPath[servedPath].assetBytes,
    assetSha256: value.inventoryByPath[servedPath],
    extension: value.inventoryMetadataByPath[servedPath].extension,
    pathSha256: sha256(servedPath),
  })).sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
  if (value.inventoryLedgerContractSha256 !== sha256(JSON.stringify(inventoryLedger))
    || value.routeDeclaredPathContractSha256
      !== sha256(JSON.stringify(documentRouteLedger))) {
    fail("Static asset projection hash differs from its attested graph.");
  }
}

function exactNonNavigation(input) {
  if (input.isNavigation || input.isMainFrame) fail("Browser resource unexpectedly navigates a frame.");
}

function exactResourceType(actual, expected) {
  if (!Array.isArray(expected) || !expected.includes(actual)) {
    fail("Browser request resource type is outside its exact contract.");
  }
}

function exactQuery(url, pairs) {
  exactQueryKeys(url, pairs.map(([name]) => name));
  for (const [name, value] of pairs) equal(url.searchParams.get(name), value, `query ${name}`);
}

function exactQueryKeys(url, expected) {
  const entries = [...url.searchParams.keys()];
  if (new Set(entries).size !== entries.length) fail("Browser query contains duplicate keys.");
  deepEqual(entries, expected, "browser query key order");
}

function assertRsc(value) {
  if (!opaquePattern.test(value ?? "")) fail("Next RSC query is invalid.");
}

function expectedContentTypes(key, status) {
  if (key.startsWith("app-") && key.endsWith("-document")) return ["text/html"];
  if (["app-telegram-start", "app-telegram-callback"].includes(key)) {
    return ["application/octet-stream"];
  }
  if (key === "telegram-oidc-authorize") return [null];
  if (key === "next-static-js" || key === "chatwoot-sdk-script"
    || key === "turnstile-widget-script") return ["application/javascript", "text/javascript"];
  if (key === "next-static-css") return ["text/css"];
  if (key === "next-static-font") {
    return ["application/vnd.ms-fontobject", "font/ttf", "font/woff", "font/woff2"];
  }
  if (key === "next-static-image" || key === "app-brand-logo") {
    return ["image/png", "image/svg+xml", "image/vnd.microsoft.icon", "image/x-icon"];
  }
  if (key === "app-web-manifest") return ["application/manifest+json"];
  if (key.startsWith("chatwoot-widget-")) return ["text/html"];
  if (status === 307 && ["app-root-rsc", "app-login-root-rsc"].includes(key)) {
    return [null];
  }
  if (key.endsWith("-rsc")) {
    return status === 307 ? ["application/octet-stream"] : ["text/x-component"];
  }
  if (key.endsWith("-action")) return ["text/x-component"];
  fail("Browser response content-type class is unknown.");
}

function decodeProviderOverlapCdpResponseBody(value, maximumBodyBytes) {
  exactKeys(value, ["base64Encoded", "body"], "CDP response body result");
  if (typeof value.base64Encoded !== "boolean" || typeof value.body !== "string") {
    fail("CDP response body result is invalid.");
  }
  let body;
  if (value.base64Encoded) {
    const maximumBase64Length = Math.ceil(maximumBodyBytes / 3) * 4;
    if (value.body.length < 4 || value.body.length > maximumBase64Length
      || value.body.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value.body,
      )) {
      fail("CDP response body base64 encoding is invalid or oversized.");
    }
    body = Buffer.from(value.body, "base64");
    if (body.toString("base64") !== value.body) {
      fail("CDP response body base64 encoding is not canonical.");
    }
  } else {
    const byteLength = Buffer.byteLength(value.body, "utf8");
    if (byteLength < 1 || byteLength > maximumBodyBytes) {
      fail("CDP response body text is empty or oversized.");
    }
    body = Buffer.from(value.body, "utf8");
  }
  if (body.byteLength < 1 || body.byteLength > maximumBodyBytes) {
    fail("CDP response body is outside its byte bound.");
  }
  return body;
}

function providerOverlapCdpRequestId(event, label) {
  if (!event || typeof event !== "object" || Array.isArray(event)
    || typeof event.requestId !== "string"
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(event.requestId)) {
    fail(`${label} request identity is invalid.`);
  }
  return event.requestId;
}

function providerOverlapCdpResponseKey(input, source) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || typeof input.url !== "string" || input.url.length < 1 || input.url.length > 8_192
    || !Number.isSafeInteger(input.status) || input.status < 100 || input.status > 599
    || typeof input.resourceType !== "string") {
    fail("CDP response body identity is invalid.");
  }
  const url = exactUrl(input.url);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    fail("CDP response body URL protocol is invalid.");
  }
  const resourceType = source === "playwright"
    ? cdpResourceTypeByPlaywrightResourceType[input.resourceType]
    : source === "cdp" && providerOverlapCdpResourceTypes.has(input.resourceType)
      ? input.resourceType
      : undefined;
  if (!resourceType) {
    fail("CDP response body resource type is invalid.");
  }
  return JSON.stringify([input.url, input.status, resourceType]);
}

function exactUrl(raw) {
  if (typeof raw !== "string" || raw !== raw.trim()) fail("Browser request URL is invalid.");
  try {
    return new URL(raw);
  } catch {
    fail("Browser request URL is invalid.");
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} field set`);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match.`);
}

function deepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} does not match.`);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function staticExtension(servedPath) {
  const extension = servedPath.slice(servedPath.lastIndexOf(".") + 1);
  if (!new Set(["css", "eot", "ico", "js", "png", "svg", "ttf", "woff", "woff2"])
    .has(extension)) {
    fail("Static asset extension is outside its exact contract.");
  }
  return extension;
}

function exactStaticMetadata(value, servedPath) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["assetBytes", "extension"])
    && Number.isSafeInteger(value.assetBytes) && value.assetBytes >= 1
    && value.assetBytes <= maximumStaticAssetBytes
    && value.extension === staticExtension(servedPath));
}

function expectedStaticContentTypes(extension) {
  const values = {
    css: ["text/css"],
    eot: ["application/vnd.ms-fontobject"],
    ico: ["image/vnd.microsoft.icon", "image/x-icon"],
    js: ["application/javascript", "text/javascript"],
    png: ["image/png"],
    svg: ["image/svg+xml"],
    ttf: ["font/ttf"],
    woff: ["font/woff"],
    woff2: ["font/woff2"],
  }[extension];
  if (!values) fail("Static response extension has no content-type contract.");
  return values;
}

/** @returns {never} */
function fail(message) {
  throw new Error(message);
}
