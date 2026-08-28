import { createHash } from "node:crypto";

const maximumRequests = 256;
const maximumStaticAssetBytes = 128 * 1024 * 1024;
const maximumStaticAssetTotalBytes = 1024 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const opaquePattern = /^[A-Za-z0-9._~-]{1,256}$/;
const nextStaticPattern = /^\/_next\/static\/(?:chunks(?:\/[A-Za-z0-9._-]{1,100}){0,5}\/[A-Za-z0-9._-]{1,200}\.(?:css|js)|media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2))$/;
const nextStaticMediaPattern = /^\/_next\/static\/media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2)$/;
const staticKeys = new Set([
  "next-static-css",
  "next-static-font",
  "next-static-image",
  "next-static-js",
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
  "app-login-document", "app-login-rsc", "app-profile-action",
  "app-profile-document", "app-profile-rsc", "app-root-rsc",
  "app-telegram-callback", "app-telegram-start", "app-web-manifest",
  "chatwoot-sdk-script", "chatwoot-widget-conversation-frame",
  "chatwoot-widget-frame", "telegram-oidc-authorize", "turnstile-widget-script",
]);
const exactRedirectEdges = new Set([
  "app-telegram-start:307->telegram-oidc-authorize",
  "telegram-oidc-authorize:302->app-telegram-callback",
  "app-telegram-callback:307->app-profile-document",
  "app-root-rsc:307->app-login-rsc",
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
      || inventoryBytes > maximumStaticAssetTotalBytes) {
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
    if (!/^(?:\.\.\/){1,6}media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2)$/.test(raw)) {
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
    ["disposition", "key", "redirectEdge", "responseContentType", "responseStatus"],
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
        : ["app-root-rsc", "app-login-rsc"].includes(entry.key) ? [200, 307]
          : [200];
  if (!statuses.includes(entry.responseStatus)) fail(`${label} response status is not exact.`);
  const contentTypes = expectedDisposition === "abort"
    ? [null]
    : expectedContentTypes(entry.key, entry.responseStatus);
  if (!contentTypes.includes(entry.responseContentType)) {
    fail(`${label} response content type is not exact.`);
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
    if (entry.key !== "app-login-rsc" || !exactRedirectEdges.has(entry.redirectEdge)
      || !entry.redirectEdge.endsWith(`->${entry.key}`)) {
      fail(`${label} redirect edge is outside the exact contract.`);
    }
  }
  return Object.freeze({
    disposition: entry.disposition,
    key: entry.key,
    redirectEdge: entry.redirectEdge,
    responseContentType: entry.responseContentType,
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
        "classification", "documentKey", "redirectEdge", "responseContentType", "responseStatus",
        "staticResponseBytes", "staticResponseSha256",
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
        responseStatus: record.responseStatus,
      }, `browser semantic request ${index}`));
      requestOccurrences.semantic += 1;
      requestOrderLedger.push({ kind: "semantic", occurrence: requestOccurrences.semantic });
    }
    counts[classification.key] = (counts[classification.key] ?? 0) + 1;
    if (classification.disposition === "abort") {
      equal(record.responseStatus, null, `browser blocked response ${index}`);
      equal(record.responseContentType, null, `browser blocked content type ${index}`);
    } else if (!classification.expectedStatuses.includes(record.responseStatus)) {
      fail(`Browser response ${index} status is outside its exact contract.`);
    } else if (!expectedContentTypes(classification.key, record.responseStatus)
      .includes(record.responseContentType)) {
      fail(`Browser response ${index} content type is outside its exact contract.`);
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
        equal(url.searchParams.get("redirect_to"), "/profile", "login RSC redirect");
      } else {
        exactQueryKeys(url, ["_rsc"]);
      }
      if (url.searchParams.has("_rsc")) assertRsc(url.searchParams.get("_rsc"));
      descriptor.key = "app-login-rsc";
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
    || inventoryBytes > maximumStaticAssetTotalBytes) {
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
  if (key.endsWith("-rsc")) {
    return status === 307 ? ["application/octet-stream"] : ["text/x-component"];
  }
  if (key.endsWith("-action")) return ["text/x-component"];
  fail("Browser response content-type class is unknown.");
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
