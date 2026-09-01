import { createHash } from "node:crypto";

import {
  assertProviderOverlapRedirect,
  classifyProviderOverlapBrowserRequest,
  createProviderOverlapStaticAssetContract,
  finalizeProviderOverlapBrowserContract,
  finalizeProviderOverlapHistoryContract,
} from "./provider-overlap-browser-contract.mjs";

export const CHATWOOT_PHASE_BROWSER_SCENARIO = "chatwoot-phase-stability-v1";

const maximumRequests = 256;
const sha256Pattern = /^[a-f0-9]{64}$/;
const opaquePattern = /^[A-Za-z0-9._~-]{1,256}$/;
const nextStaticPattern = /^\/_next\/static\/(?:chunks(?:\/[A-Za-z0-9._-]{1,100}){0,5}\/[A-Za-z0-9._-]{1,200}\.(?:css|js)|media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2))$/;
const staticKeys = new Set([
  "next-static-css",
  "next-static-font",
  "next-static-image",
  "next-static-js",
]);
const directNavigationFlow = Object.freeze([
  "app-login-document",
  "app-telegram-start",
  "telegram-oidc-authorize",
  "app-telegram-callback",
  "app-cabinet-document",
]);
const directStaticRoutes = Object.freeze(["/cabinet/page", "/login/page"]);
const directSemanticDescriptorContracts = Object.freeze({
  "app-brand-logo": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
  "app-cabinet-action": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
  "app-cabinet-document": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: true }),
  "app-cabinet-prefetch-blocked": Object.freeze({ disposition: "abort", expectedStatuses: [], navigation: false }),
  "app-cabinet-rsc": Object.freeze({ disposition: "continue", expectedStatuses: [200, 307], navigation: false }),
  "app-login-action": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
  "app-login-document": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: true }),
  "app-login-rsc": Object.freeze({ disposition: "continue", expectedStatuses: [200, 307], navigation: false }),
  "app-telegram-callback": Object.freeze({ disposition: "continue", expectedStatuses: [307], navigation: true }),
  "app-telegram-start": Object.freeze({ disposition: "continue", expectedStatuses: [307], navigation: true }),
  "app-web-manifest": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
  "chatwoot-sdk-script": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
  "chatwoot-widget-conversation-frame": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
  "chatwoot-widget-frame": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
  "telegram-oidc-authorize": Object.freeze({ disposition: "continue", expectedStatuses: [302], navigation: true }),
  "turnstile-widget-script": Object.freeze({ disposition: "continue", expectedStatuses: [200], navigation: false }),
});

export function createChatwootPhaseStaticAssetContract(attestation) {
  const providerContract = createProviderOverlapStaticAssetContract(attestation);
  const directCabinetRouteDeclaredPaths = new Set();
  for (const route of directStaticRoutes) {
    const matches = attestation.inventory.clientReferences.filter((entry) => entry.route === route);
    if (matches.length !== 1 || !Array.isArray(matches[0].declaredStaticChunks)
      || matches[0].declaredStaticChunks.length < 1
      || matches[0].declaredStaticChunks.length > 64) {
      fail("Chatwoot direct-cabinet image route load graph is incomplete.");
    }
    for (const servedPath of matches[0].declaredStaticChunks) {
      if (!Object.hasOwn(providerContract.inventoryByPath, servedPath)) {
        fail("Chatwoot direct-cabinet route references an absent static asset.");
      }
      directCabinetRouteDeclaredPaths.add(servedPath);
    }
  }
  return Object.freeze({
    directCabinetRouteDeclaredPaths: Object.freeze(
      [...directCabinetRouteDeclaredPaths].sort(),
    ),
    providerContract,
  });
}

export function classifyChatwootPhaseBrowserRequest(input, state) {
  exactKeys(state, [
    "cabinetDocumentAllowed",
    "generation",
    "staticAssetContract",
  ], "Chatwoot request state");
  assertStaticAssetContract(state.staticAssetContract);
  if (state.generation === "initial") {
    return classifyProviderOverlapBrowserRequest(input, {
      cabinetDocumentAllowed: state.cabinetDocumentAllowed,
      staticAssetContract: state.staticAssetContract.providerContract,
    });
  }
  if (state.generation !== "recreated") fail("Chatwoot browser generation is invalid.");
  return classifyDirectCabinetRequest(input, state);
}

export function assertChatwootPhaseRedirect(input, generation) {
  if (generation === "initial") return assertProviderOverlapRedirect(input);
  if (generation !== "recreated") fail("Chatwoot redirect generation is invalid.");
  exactKeys(input, ["from", "location", "status", "to"], "Chatwoot redirect");
  exactKeys(input.from, ["classification", "url"], "Chatwoot redirect source");
  exactKeys(input.to, ["classification", "url"], "Chatwoot redirect target");
  if (!Number.isSafeInteger(input.status)) fail("Chatwoot redirect status is invalid.");
  const resolved = new URL(input.location, input.from.url);
  if (resolved.href !== input.to.url || resolved.hash) {
    fail("Chatwoot redirect location does not match its exact successor.");
  }
  const edge = `${input.from.classification.key}:${input.status}->${input.to.classification.key}`;
  if (!new Set([
    "app-telegram-start:307->telegram-oidc-authorize",
    "telegram-oidc-authorize:302->app-telegram-callback",
    "app-telegram-callback:307->app-cabinet-document",
  ]).has(edge)) fail("Chatwoot redirect escaped the exact direct-cabinet flow.");
  return edge;
}

/**
 * @param {unknown[]} records
 * @param {"initial" | "recreated"} generation
 * @param {unknown} [finalFrame]
 */
export function finalizeChatwootPhaseHistoryContract(records, generation, finalFrame = null) {
  if (!isDenseArray(records)) {
    fail("Chatwoot history ledger must be a dense own-index array.");
  }
  if (generation === "initial") {
    return finalizeProviderOverlapHistoryContract(records, finalFrame);
  }
  if (finalFrame !== null) {
    fail("Chatwoot direct-cabinet history cannot accept an initial frame receipt.");
  }
  if (generation !== "recreated" || records.length !== 2) {
    fail("Chatwoot direct-cabinet history ledger is outside its exact bound.");
  }
  const ledger = records.map((rawRecord, index) => {
    const record = /** @type {{historyLength: unknown, kind: unknown, url: unknown}} */ (
      rawRecord
    );
    exactKeys(record, ["historyLength", "kind", "url"], `Chatwoot history record ${index}`);
    const historyLength = record.historyLength;
    if (record.kind !== "checkpoint" || typeof historyLength !== "number"
      || !Number.isSafeInteger(historyLength)
      || historyLength < 1 || historyLength > 32) {
      fail("Chatwoot direct-cabinet history checkpoint is invalid.");
    }
    const url = exactUrl(record.url);
    const expected = index === 0
      ? "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet"
      : "https://pay.ci.clean-pay.dev/cabinet";
    if (url.href !== expected) fail("Chatwoot direct-cabinet history location is not exact.");
    const exactHistoryLength = /** @type {number} */ (historyLength);
    return Object.freeze({
      historyLength: exactHistoryLength,
      kind: record.kind,
      location: index === 0 ? "app-login-direct-cabinet" : "app-cabinet",
    });
  });
  if (ledger[1].historyLength < ledger[0].historyLength
    || ledger[1].historyLength > ledger[0].historyLength + 1) {
    fail("Chatwoot direct-cabinet history length relation is invalid.");
  }
  return Object.freeze({
    historyContractSha256: sha256(JSON.stringify(ledger)),
    historyCount: ledger.length,
    historyLedger: Object.freeze(ledger),
  });
}

export function finalizeChatwootPhaseBrowserContract(records, loadGraph) {
  exactKeys(loadGraph, [
    "cssMediaReferences",
    "generation",
    "referenceStaticContract",
    "responseDeclarationsByDocument",
    "staticAssetContract",
  ], "Chatwoot browser load graph");
  assertStaticAssetContract(loadGraph.staticAssetContract);
  if (loadGraph.generation === "initial") {
    if (loadGraph.referenceStaticContract !== null) {
      fail("Chatwoot initial browser contract cannot accept a prior static reference.");
    }
    const finalized = finalizeProviderOverlapBrowserContract(records, {
      cssMediaReferences: loadGraph.cssMediaReferences,
      responseDeclarationsByDocument: loadGraph.responseDeclarationsByDocument,
      staticAssetContract: loadGraph.staticAssetContract.providerContract,
    });
    const responseDeclarationLedger = sanitizeResponseDeclarationLedger(
      loadGraph.responseDeclarationsByDocument,
      ["app-login-document", "app-profile-document", "app-cabinet-document"],
      loadGraph.staticAssetContract.providerContract,
      "Chatwoot initial response declaration",
    );
    deepEqual(
      declarationDigestUnion(responseDeclarationLedger),
      finalized.staticLoadGraph.declaredPathSha256s,
      "Chatwoot initial response declaration union",
    );
    return Object.freeze({
      ...finalized,
      responseDeclarationContractSha256: sha256(JSON.stringify(responseDeclarationLedger)),
      responseDeclarationLedger,
    });
  }
  if (loadGraph.generation !== "recreated") fail("Chatwoot browser generation is invalid.");
  return finalizeDirectCabinetBrowserContract(records, loadGraph);
}

function classifyDirectCabinetRequest(input, state) {
  exactKeys(input, ["isMainFrame", "isNavigation", "method", "resourceType", "url"], "request");
  const url = exactUrl(input.url);
  if (url.hash || url.username || url.password || url.port) fail("Chatwoot request URL is not exact.");
  if (url.origin !== "https://pay.ci.clean-pay.dev") {
    return classifyProviderOverlapBrowserRequest(input, {
      cabinetDocumentAllowed: state.cabinetDocumentAllowed,
      staticAssetContract: state.staticAssetContract.providerContract,
    });
  }
  const descriptor = baseDescriptor();
  if (input.method === "GET" && input.isNavigation && input.isMainFrame) {
    exactResourceType(input.resourceType, ["document"]);
    if (url.pathname === "/login") {
      exactQuery(url, [["redirect_to", "/cabinet"]]);
      descriptor.key = "app-login-document";
    } else if (url.pathname === "/auth/telegram/start") {
      exactQueryKeys(url, ["redirect_to", "turnstile_token"]);
      equal(url.searchParams.get("redirect_to"), "/cabinet", "Telegram start redirect");
      assertTurnstile(url.searchParams.get("turnstile_token"));
      descriptor.key = "app-telegram-start";
      descriptor.expectedStatuses = [307];
    } else if (url.pathname === "/auth/telegram/callback") {
      exactQueryKeys(url, ["code", "state"]);
      for (const name of ["code", "state"]) assertOpaque(url.searchParams.get(name), name);
      descriptor.key = "app-telegram-callback";
      descriptor.expectedStatuses = [307];
    } else if (url.pathname === "/cabinet") {
      exactQuery(url, []);
      if (!state.cabinetDocumentAllowed) fail("Cabinet document was requested before authorization.");
      descriptor.key = "app-cabinet-document";
    } else {
      fail("Application navigation escaped the exact Chatwoot direct-cabinet flow.");
    }
    descriptor.navigation = true;
    return freezeDescriptor(descriptor);
  }
  if (input.method === "GET" && url.pathname === "/login" && !input.isNavigation) {
    exactResourceType(input.resourceType, ["fetch"]);
    if (input.isMainFrame) fail("Chatwoot login resource unexpectedly targets the main frame.");
    exactQueryKeys(url, url.searchParams.has("_rsc")
      ? ["redirect_to", "_rsc"]
      : ["redirect_to"]);
    equal(url.searchParams.get("redirect_to"), "/cabinet", "login RSC redirect");
    if (url.searchParams.has("_rsc")) assertOpaque(url.searchParams.get("_rsc"), "login RSC");
    descriptor.key = "app-login-rsc";
    descriptor.expectedStatuses = [200, 307];
    return freezeDescriptor(descriptor);
  }
  if (["/", "/profile"].includes(url.pathname)) {
    fail("Chatwoot direct-cabinet resource attempted the provider-profile path.");
  }
  return classifyProviderOverlapBrowserRequest(input, {
    cabinetDocumentAllowed: state.cabinetDocumentAllowed,
    staticAssetContract: state.staticAssetContract.providerContract,
  });
}

function finalizeDirectCabinetBrowserContract(records, loadGraph) {
  if (!isDenseArray(records) || records.length === 0 || records.length > maximumRequests
    || !isDenseArray(loadGraph.cssMediaReferences)
    || loadGraph.cssMediaReferences.length > maximumRequests
    || !isDenseArray(loadGraph.responseDeclarationsByDocument)
    || loadGraph.responseDeclarationsByDocument.length !== 2) {
    fail("Chatwoot direct-cabinet request ledger is outside its exact bound.");
  }
  const provider = loadGraph.staticAssetContract.providerContract;
  const reference = assertSharedStaticReference(loadGraph.referenceStaticContract, provider);
  const directDocumentKeys = ["app-login-document", "app-cabinet-document"];
  const responseDeclarationLedger = sanitizeResponseDeclarationLedger(
    loadGraph.responseDeclarationsByDocument,
    directDocumentKeys,
    provider,
    "Chatwoot recreated response declaration",
  );
  const referenceResponseDeclarationLedger = reference.responseDeclarationLedger.filter(
    ({ documentKey }) => directDocumentKeys.includes(documentKey),
  );
  deepEqual(
    responseDeclarationLedger,
    referenceResponseDeclarationLedger,
    "Chatwoot recreated per-document response declaration closure",
  );
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail(`Chatwoot browser request record ${index} is invalid.`);
    }
    assertClassification(record.classification, `Chatwoot request classification ${index}`);
    assertDirectClassificationContract(
      record.classification,
      `Chatwoot request classification ${index}`,
    );
  }
  const navigationFlow = records
    .filter(({ classification }) => classification.navigation)
    .map(({ classification }) => classification.key);
  deepEqual(navigationFlow, directNavigationFlow, "Chatwoot direct-cabinet navigation flow");
  const counts = {};
  const semanticLedger = [];
  const staticLedger = [];
  const requestOrderLedger = [];
  const requestOccurrences = { semantic: 0, static: 0 };
  const observedByDocument = new Map(directDocumentKeys.map((documentKey) => [
    documentKey,
    { chunks: new Set(), media: new Set(), paths: new Set() },
  ]));
  const redirects = [];
  let activeDocumentKey = null;
  for (const [index, record] of records.entries()) {
    exactKeys(record, [
      "classification",
      "documentKey",
      "redirectEdge",
      "responseContentType",
      "responseFailureSha256",
      "responseStatus",
      "staticResponseBytes",
      "staticResponseSha256",
    ], `Chatwoot browser request record ${index}`);
    const classification = record.classification;
    assertClassification(classification, `Chatwoot request classification ${index}`);
    assertDirectClassificationContract(
      classification,
      `Chatwoot request classification ${index}`,
    );
    if (directDocumentKeys.includes(classification.key)) activeDocumentKey = classification.key;
    if (record.documentKey !== activeDocumentKey
      || !directDocumentKeys.includes(record.documentKey)) {
      fail("Chatwoot request escaped its exact direct-cabinet document generation.");
    }
    if (staticKeys.has(classification.key)) {
      const metadata = provider.inventoryMetadataByPath[classification.staticPath];
      if (!nextStaticPattern.test(classification.staticPath ?? "")
        || !sha256Pattern.test(record.staticResponseSha256 ?? "")
        || !Number.isSafeInteger(record.staticResponseBytes)
        || record.staticResponseBytes < 1
        || provider.inventoryByPath[classification.staticPath]
          !== classification.staticAssetSha256
        || record.staticResponseSha256 !== classification.staticAssetSha256
        || record.staticResponseBytes !== metadata?.assetBytes
        || !expectedStaticContentTypes(metadata?.extension).includes(
          record.responseContentType,
        )) {
        fail("Chatwoot static request path is invalid or duplicated.");
      }
      const documentObservation = observedByDocument.get(record.documentKey);
      if (documentObservation.paths.has(classification.staticPath)) {
        fail("Chatwoot static request path is invalid or duplicated.");
      }
      documentObservation.paths.add(classification.staticPath);
      if (classification.staticPath.startsWith("/_next/static/chunks/")) {
        documentObservation.chunks.add(classification.staticPath);
      } else {
        documentObservation.media.add(classification.staticPath);
      }
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
      fail("Chatwoot non-static request contains static provenance.");
    } else {
      if (record.staticResponseBytes !== null || record.staticResponseSha256 !== null) {
        fail("Chatwoot non-static request contains static response evidence.");
      }
      semanticLedger.push({
        disposition: classification.disposition,
        key: classification.key,
        redirectEdge: record.redirectEdge,
        responseContentType: record.responseContentType,
        responseFailureSha256: record.responseFailureSha256,
        responseStatus: record.responseStatus,
      });
      requestOccurrences.semantic += 1;
      requestOrderLedger.push({ kind: "semantic", occurrence: requestOccurrences.semantic });
    }
    counts[classification.key] = (counts[classification.key] ?? 0) + 1;
    if (classification.disposition === "abort") {
      equal(record.responseStatus, null, `Chatwoot blocked response ${index}`);
      equal(record.responseContentType, null, `Chatwoot blocked content type ${index}`);
      equal(record.responseFailureSha256, null, `Chatwoot blocked response failure ${index}`);
    } else if (!classification.expectedStatuses.includes(record.responseStatus)) {
      fail(`Chatwoot response ${index} status is outside its exact contract.`);
    } else if (!expectedContentTypes(classification.key, record.responseStatus)
      .includes(record.responseContentType)) {
      fail(`Chatwoot response ${index} content type is outside its exact contract.`);
    }
    equal(record.responseFailureSha256, null, `Chatwoot response failure ${index}`);
    if (record.redirectEdge !== null) redirects.push(record.redirectEdge);
  }
  for (const key of directNavigationFlow) equal(counts[key], 1, `Chatwoot navigation count ${key}`);
  deepEqual(redirects, [
    "app-telegram-start:307->telegram-oidc-authorize",
    "telegram-oidc-authorize:302->app-telegram-callback",
    "app-telegram-callback:307->app-cabinet-document",
  ], "Chatwoot direct-cabinet redirects");
  for (const key of ["next-static-css", "next-static-font", "next-static-js"]) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 1) {
      fail(`Chatwoot direct-cabinet contract requires ${key}.`);
    }
  }
  if ((counts["turnstile-widget-script"] ?? 0) < 1
    || (counts["chatwoot-sdk-script"] ?? 0) < 1) {
    fail("Chatwoot direct-cabinet browser dependencies are incomplete.");
  }
  equal(
    counts["chatwoot-widget-frame"],
    counts["chatwoot-sdk-script"],
    "Chatwoot direct-cabinet fresh widget relation",
  );
  if ((counts["chatwoot-widget-conversation-frame"] ?? 0) > counts["chatwoot-sdk-script"]) {
    fail("Chatwoot direct-cabinet replacement widget count is invalid.");
  }
  const referenceStaticLedger = reference.staticRequestLedger.filter(({ documentKey }) => (
    directDocumentKeys.includes(documentKey)
  ));
  deepEqual(staticLedger, referenceStaticLedger, "Chatwoot recreated static response occurrences");
  const cssMediaReferenceLedger = loadGraph.cssMediaReferences.map((entry, index) => {
    exactKeys(entry, ["sourcePath", "targetPath"], `Chatwoot CSS media reference ${index}`);
    if (!/^\/_next\/static\/chunks(?:\/[A-Za-z0-9._-]{1,100}){0,5}\/[A-Za-z0-9._-]{1,200}\.css$/.test(
      entry.sourcePath ?? "",
    ) || !/^\/_next\/static\/media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2)$/.test(
      entry.targetPath ?? "",
    ) || !Object.hasOwn(provider.inventoryByPath, entry.sourcePath)
      || !Object.hasOwn(provider.inventoryByPath, entry.targetPath)) {
      fail("Chatwoot CSS media reference escaped its attested static contract.");
    }
    return { sourcePath: entry.sourcePath, targetPath: entry.targetPath };
  }).sort((left, right) => (
    left.sourcePath.localeCompare(right.sourcePath)
      || left.targetPath.localeCompare(right.targetPath)
  )).map((entry, index) => ({
    occurrence: index + 1,
    sourcePathSha256: sha256(entry.sourcePath),
    targetPathSha256: sha256(entry.targetPath),
  }));
  deepEqual(
    cssMediaReferenceLedger,
    reference.staticLoadGraph.cssMediaReferenceLedger,
    "Chatwoot recreated CSS media fallback closure",
  );
  const documentLoadLedger = directDocumentKeys.map((documentKey) => {
    const referenceDocument = reference.staticLoadGraph.documentLoadLedger.find((entry) => (
      entry.documentKey === documentKey
    ));
    const observation = observedByDocument.get(documentKey);
    if (!referenceDocument || !observation) {
      fail("Chatwoot recreated static document reference is incomplete.");
    }
    deepEqual(
      [...observation.chunks].map(sha256).sort(),
      referenceDocument.expectedChunkPathSha256s,
      `Chatwoot recreated ${documentKey} chunk closure`,
    );
    deepEqual(
      [...observation.media].map(sha256).sort(),
      referenceDocument.expectedMediaPathSha256s,
      `Chatwoot recreated ${documentKey} negotiated media closure`,
    );
    return Object.freeze({ ...referenceDocument });
  });
  const declaredPathSha256s = declarationDigestUnion(responseDeclarationLedger);
  const staticLoadGraph = Object.freeze({
    assetAttestationSha256: provider.attestationSha256,
    assetInventorySha256: provider.inventorySha256,
    cssMediaReferenceLedger: Object.freeze(cssMediaReferenceLedger.map(Object.freeze)),
    declaredPathSha256s,
    documentLoadLedger: Object.freeze(documentLoadLedger),
    inventoryLedgerContractSha256: provider.inventoryLedgerContractSha256,
    referenceStaticLoadGraphContractSha256: reference.staticLoadGraphContractSha256,
    routeDeclaredPathContractSha256: provider.routeDeclaredPathContractSha256,
  });
  const summary = {
    version: 1,
    scenario: CHATWOOT_PHASE_BROWSER_SCENARIO,
    semanticLedger,
    staticClasses: [...staticKeys].filter((key) => counts[key] > 0).sort(),
  };
  return Object.freeze({
    requestCount: records.length,
    requestContractSha256: sha256(JSON.stringify(summary)),
    requestOrderContractSha256: sha256(JSON.stringify(requestOrderLedger)),
    requestOrderLedger: Object.freeze(requestOrderLedger.map(Object.freeze)),
    responseDeclarationContractSha256: sha256(JSON.stringify(responseDeclarationLedger)),
    responseDeclarationLedger,
    semanticRequestLedger: Object.freeze(semanticLedger.map(Object.freeze)),
    staticLoadGraph,
    staticLoadGraphContractSha256: sha256(JSON.stringify(staticLoadGraph)),
    staticRequestContractSha256: sha256(JSON.stringify(staticLedger)),
    staticRequestCount: staticLedger.length,
    staticRequestLedger: Object.freeze(staticLedger.map(Object.freeze)),
  });
}

function assertSharedStaticReference(value, provider) {
  exactKeys(value, [
    "requestContractSha256",
    "requestCount",
    "requestOrderContractSha256",
    "requestOrderLedger",
    "responseDeclarationContractSha256",
    "responseDeclarationLedger",
    "semanticRequestLedger",
    "staticLoadGraph",
    "staticLoadGraphContractSha256",
    "staticRequestContractSha256",
    "staticRequestCount",
    "staticRequestLedger",
  ], "Chatwoot shared static reference");
  for (const name of [
    "requestContractSha256",
    "requestOrderContractSha256",
    "responseDeclarationContractSha256",
    "staticLoadGraphContractSha256",
    "staticRequestContractSha256",
  ]) {
    if (!sha256Pattern.test(value[name] ?? "")) fail("Chatwoot shared static reference is invalid.");
  }
  if (!Number.isSafeInteger(value.requestCount) || value.requestCount < 1
    || value.requestCount > maximumRequests
    || !isDenseArray(value.requestOrderLedger)
    || value.requestOrderLedger.length !== value.requestCount
    || !isDenseArray(value.semanticRequestLedger)
    || !isDenseArray(value.staticRequestLedger)
    || value.staticRequestLedger.length !== value.staticRequestCount
    || value.semanticRequestLedger.length + value.staticRequestLedger.length !== value.requestCount
    || value.requestOrderContractSha256 !== sha256(JSON.stringify(value.requestOrderLedger))
    || value.responseDeclarationContractSha256
      !== sha256(JSON.stringify(value.responseDeclarationLedger))
    || value.staticRequestContractSha256 !== sha256(JSON.stringify(value.staticRequestLedger))) {
    fail("Chatwoot shared static reference is invalid.");
  }
  const graph = value.staticLoadGraph;
  const responseDeclarationLedger = assertResponseDeclarationLedger(
    value.responseDeclarationLedger,
    ["app-login-document", "app-profile-document", "app-cabinet-document"],
    "Chatwoot shared response declaration",
  );
  exactKeys(graph, [
    "assetAttestationSha256",
    "assetInventorySha256",
    "cssMediaReferenceLedger",
    "declaredPathLedger",
    "declaredPathSha256s",
    "documentLoadLedger",
    "expectedChunkPathSha256s",
    "inventoryLedger",
    "inventoryLedgerContractSha256",
    "routeDeclaredPathContractSha256",
    "routeDeclaredPathSha256s",
  ], "Chatwoot shared static load graph");
  if (graph.assetAttestationSha256 !== provider.attestationSha256
    || graph.assetInventorySha256 !== provider.inventorySha256
    || graph.inventoryLedgerContractSha256 !== provider.inventoryLedgerContractSha256
    || graph.routeDeclaredPathContractSha256 !== provider.routeDeclaredPathContractSha256
    || value.staticLoadGraphContractSha256 !== sha256(JSON.stringify(graph))
    || !isDenseArray(graph.cssMediaReferenceLedger)
    || graph.cssMediaReferenceLedger.length !== 8
    || !isDenseArray(graph.declaredPathSha256s)
    || !isDenseArray(graph.documentLoadLedger)
    || graph.documentLoadLedger.length !== 3
    || !isDenseArray(graph.inventoryLedger)
    || !isDenseArray(value.staticRequestLedger)) {
    fail("Chatwoot shared static load graph is invalid.");
  }
  deepEqual(
    declarationDigestUnion(responseDeclarationLedger),
    graph.declaredPathSha256s,
    "Chatwoot shared response declaration union",
  );
  for (const [index, entry] of value.staticRequestLedger.entries()) {
    exactKeys(entry, [
      "assetBytes", "assetSha256", "class", "contentType", "documentKey", "pathSha256",
    ], `Chatwoot shared static response ${index}`);
  }
  for (const [index, entry] of graph.documentLoadLedger.entries()) {
    exactKeys(entry, [
      "documentKey", "expectedChunkPathSha256s", "expectedMediaPathSha256s",
      "routeDeclaredPathSha256s",
    ], `Chatwoot shared static document ${index}`);
    if (!["app-login-document", "app-profile-document", "app-cabinet-document"][index]
      || entry.documentKey
        !== ["app-login-document", "app-profile-document", "app-cabinet-document"][index]
      || !isDenseArray(entry.expectedChunkPathSha256s)
      || !isDenseArray(entry.expectedMediaPathSha256s)
      || !isDenseArray(entry.routeDeclaredPathSha256s)) {
      fail("Chatwoot shared static document reference is invalid.");
    }
  }
  return value;
}

function sanitizeResponseDeclarationLedger(entries, documentKeys, provider, label) {
  if (!isDenseArray(entries) || entries.length !== documentKeys.length) {
    fail(`${label} ledger is invalid.`);
  }
  return Object.freeze(entries.map((entry, index) => {
    exactKeys(entry, ["documentKey", "paths"], `${label} ${index}`);
    if (entry.documentKey !== documentKeys[index] || !isDenseArray(entry.paths)
      || entry.paths.length < 1 || entry.paths.length > maximumRequests
      || new Set(entry.paths).size !== entry.paths.length
      || JSON.stringify([...entry.paths].sort()) !== JSON.stringify(entry.paths)
      || entry.paths.some((servedPath) => !nextStaticPattern.test(servedPath)
        || !Object.hasOwn(provider.inventoryByPath, servedPath))) {
      fail(`${label} graph is invalid.`);
    }
    return Object.freeze({
      documentKey: entry.documentKey,
      pathSha256s: Object.freeze(entry.paths.map(sha256).sort()),
    });
  }));
}

function assertResponseDeclarationLedger(value, documentKeys, label) {
  if (!isDenseArray(value) || value.length !== documentKeys.length) {
    fail(`${label} ledger is invalid.`);
  }
  return Object.freeze(value.map((entry, index) => {
    exactKeys(entry, ["documentKey", "pathSha256s"], `${label} ${index}`);
    if (entry.documentKey !== documentKeys[index]
      || !isDenseArray(entry.pathSha256s)
      || entry.pathSha256s.length < 1 || entry.pathSha256s.length > maximumRequests
      || entry.pathSha256s.some((digest) => !sha256Pattern.test(digest ?? ""))
      || new Set(entry.pathSha256s).size !== entry.pathSha256s.length
      || JSON.stringify([...entry.pathSha256s].sort()) !== JSON.stringify(entry.pathSha256s)) {
      fail(`${label} graph is invalid.`);
    }
    return Object.freeze({
      documentKey: entry.documentKey,
      pathSha256s: Object.freeze([...entry.pathSha256s]),
    });
  }));
}

function declarationDigestUnion(ledger) {
  return Object.freeze([...new Set(ledger.flatMap(({ pathSha256s }) => pathSha256s))].sort());
}

function baseDescriptor() {
  return {
    disposition: "continue",
    expectedStatuses: [200],
    key: undefined,
    navigation: false,
    staticAssetSha256: null,
    staticPath: null,
  };
}

function freezeDescriptor(value) {
  return Object.freeze({
    disposition: value.disposition,
    expectedStatuses: Object.freeze([...value.expectedStatuses]),
    key: value.key,
    navigation: value.navigation,
    staticAssetSha256: value.staticAssetSha256,
    staticPath: value.staticPath,
  });
}

function assertStaticAssetContract(value) {
  exactKeys(value, ["directCabinetRouteDeclaredPaths", "providerContract"], "Chatwoot static contract");
  // Reuse the shared fail-closed decoder before any Chatwoot-only application
  // path can return early. The fixed logo request has no static provenance of
  // its own; its sole purpose here is to exercise the complete nested asset
  // contract (digests, inventory graph, and projection hashes).
  classifyProviderOverlapBrowserRequest({
    isMainFrame: false,
    isNavigation: false,
    method: "GET",
    resourceType: "image",
    url: "https://pay.ci.clean-pay.dev/clean-pay-logo.png",
  }, {
    cabinetDocumentAllowed: false,
    staticAssetContract: value.providerContract,
  });
  if (!isDenseArray(value.directCabinetRouteDeclaredPaths)
    || value.directCabinetRouteDeclaredPaths.length < 1
    || value.directCabinetRouteDeclaredPaths.length > maximumRequests
    || JSON.stringify([...value.directCabinetRouteDeclaredPaths].sort())
      !== JSON.stringify(value.directCabinetRouteDeclaredPaths)
    || new Set(value.directCabinetRouteDeclaredPaths).size
      !== value.directCabinetRouteDeclaredPaths.length
    || value.directCabinetRouteDeclaredPaths.some((servedPath) => (
      !Object.hasOwn(value.providerContract.inventoryByPath ?? {}, servedPath)
    ))) fail("Chatwoot direct-cabinet static route contract is invalid.");
}

function assertClassification(value, label) {
  exactKeys(value, [
    "disposition",
    "expectedStatuses",
    "key",
    "navigation",
    "staticAssetSha256",
    "staticPath",
  ], label);
  if (!new Set(["abort", "continue"]).has(value.disposition)
    || !isDenseArray(value.expectedStatuses)
    || value.expectedStatuses.some((status) => (
      !Number.isSafeInteger(status) || status < 100 || status > 599
    ))
    || typeof value.key !== "string" || typeof value.navigation !== "boolean"
    || (value.staticAssetSha256 !== null && !sha256Pattern.test(value.staticAssetSha256))
    || (value.staticPath !== null && !nextStaticPattern.test(value.staticPath))) {
    fail(`${label} is invalid.`);
  }
}

function assertDirectClassificationContract(value, label) {
  if (staticKeys.has(value.key)) {
    if (value.disposition !== "continue" || value.navigation !== false
      || JSON.stringify(value.expectedStatuses) !== "[200]"
      || value.staticPath === null || value.staticAssetSha256 === null) {
      fail(`${label} differs from its exact static descriptor.`);
    }
    return;
  }
  const expected = directSemanticDescriptorContracts[value.key];
  if (!expected || value.disposition !== expected.disposition
    || value.navigation !== expected.navigation
    || JSON.stringify(value.expectedStatuses) !== JSON.stringify(expected.expectedStatuses)
    || value.staticPath !== null || value.staticAssetSha256 !== null) {
    fail(`${label} differs from its exact direct-cabinet descriptor.`);
  }
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
  fail("Chatwoot response content-type class is unknown.");
}

function expectedStaticContentTypes(extension) {
  if (extension === "js") return ["application/javascript", "text/javascript"];
  if (extension === "css") return ["text/css"];
  if (extension === "eot") return ["application/vnd.ms-fontobject"];
  if (extension === "ttf") return ["font/ttf"];
  if (extension === "woff") return ["font/woff"];
  if (extension === "woff2") return ["font/woff2"];
  if (extension === "png") return ["image/png"];
  if (extension === "svg") return ["image/svg+xml"];
  if (extension === "ico") return ["image/vnd.microsoft.icon", "image/x-icon"];
  return [];
}

function assertTurnstile(value) {
  if (!/^synthetic-turnstile-token:auth_login:synthetic-turnstile-[1-9]\d*:[1-9]\d*$/.test(value ?? "")) {
    fail("Chatwoot Telegram start Turnstile token is invalid.");
  }
}

function assertOpaque(value, label) {
  if (!opaquePattern.test(value ?? "")) fail(`Chatwoot ${label} value is invalid.`);
}

function exactResourceType(actual, expected) {
  if (!expected.includes(actual)) fail("Chatwoot request resource type is outside its exact contract.");
}

function exactQuery(url, pairs) {
  exactQueryKeys(url, pairs.map(([name]) => name));
  for (const [name, value] of pairs) equal(url.searchParams.get(name), value, `query ${name}`);
}

function exactQueryKeys(url, expected) {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) fail("Chatwoot query contains duplicate keys.");
  deepEqual(keys, expected, "Chatwoot query key order");
}

function exactUrl(value) {
  if (typeof value !== "string") fail("Chatwoot URL is invalid.");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Chatwoot URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    fail("Chatwoot URL authority is not exact.");
  }
  return url;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(`${label} has unexpected fields.`);
  }
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function deepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} is not exact.`);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match its exact contract.`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}
