import { createHash } from "node:crypto";

const maximumRequests = 256;
const sha256Pattern = /^[a-f0-9]{64}$/;
const opaquePattern = /^[A-Za-z0-9._~-]{1,256}$/;
const nextStaticPattern = /^\/_next\/static\/(?:chunks(?:\/[A-Za-z0-9._-]{1,100}){0,5}|media)\/[A-Za-z0-9._-]{1,200}\.(?:css|js|woff2|png|svg)$/;
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

const exactStaticRoutes = Object.freeze(["/cabinet/page", "/login/page", "/profile/page"]);

export function createProviderOverlapStaticAssetContract(attestation) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)
    || !sha256Pattern.test(attestation.attestationSha256 ?? "")
    || !sha256Pattern.test(attestation.inventory?.inventorySha256 ?? "")
    || !Array.isArray(attestation.inventory?.staticChunks)
    || !Array.isArray(attestation.inventory?.clientReferences)) {
    fail("Production image static asset attestation is invalid.");
  }
  const inventoryByPath = {};
  for (const asset of attestation.inventory.staticChunks) {
    if (!asset || !nextStaticPattern.test(asset.servedPath ?? "")
      || !asset.servedPath.startsWith("/_next/static/chunks/")
      || !sha256Pattern.test(asset.sha256 ?? "")
      || Object.hasOwn(inventoryByPath, asset.servedPath)) {
      fail("Production image static asset inventory is invalid.");
    }
    inventoryByPath[asset.servedPath] = asset.sha256;
  }
  const routeDeclaredPaths = new Set();
  for (const route of exactStaticRoutes) {
    const matches = attestation.inventory.clientReferences.filter((entry) => entry.route === route);
    if (matches.length !== 1 || !Array.isArray(matches[0].declaredStaticChunks)
      || matches[0].declaredStaticChunks.length < 1 || matches[0].declaredStaticChunks.length > 64) {
      fail("Production image route load graph is incomplete.");
    }
    for (const servedPath of matches[0].declaredStaticChunks) {
      if (!Object.hasOwn(inventoryByPath, servedPath)) {
        fail("Production image route load graph references an absent static asset.");
      }
      routeDeclaredPaths.add(servedPath);
    }
  }
  return Object.freeze({
    attestationSha256: attestation.attestationSha256,
    inventoryByPath: Object.freeze({ ...inventoryByPath }),
    inventorySha256: attestation.inventory.inventorySha256,
    routeDeclaredPaths: Object.freeze([...routeDeclaredPaths].sort()),
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

export function assertProviderOverlapRedirect({ from, location, status, to }) {
  exactKeys(from, ["classification", "url"], "redirect source");
  exactKeys(to, ["classification", "url"], "redirect target");
  if (!Number.isSafeInteger(status)) fail("Redirect status is invalid.");
  const resolvedLocation = new URL(location, from.url);
  if (resolvedLocation.href !== to.url || resolvedLocation.hash) {
    fail("Redirect location does not match the exact next request.");
  }
  const edge = `${from.classification.key}:${status}->${to.classification.key}`;
  if (!new Set([
    "app-telegram-start:307->telegram-oidc-authorize",
    "telegram-oidc-authorize:302->app-telegram-callback",
    "app-telegram-callback:307->app-profile-document",
    "app-root-rsc:307->app-login-rsc",
    "app-login-rsc:307->app-login-rsc",
  ]).has(edge)) {
    fail("Redirect edge is outside the exact provider-overlap contract.");
  }
  return edge;
}

export function finalizeProviderOverlapHistoryContract(records) {
  if (!Array.isArray(records) || records.length < 2 || records.length > 128) {
    fail("Browser history ledger is outside its bounded contract.");
  }
  const allowedKinds = new Set([
    "document", "frame-navigation", "popstate", "pushState", "replaceState",
  ]);
  const historyLedger = records.map((record, index) => {
    exactKeys(record, ["kind", "url"], `history record ${index}`);
    if (!allowedKinds.has(record.kind)) fail("Browser history operation kind is invalid.");
    const location = exactHistoryLocation(record.url);
    if (["popstate", "pushState", "replaceState"].includes(record.kind)
        && !["app-login", "app-profile", "app-cabinet"].includes(location)) {
      fail("Browser history API operation is outside the exact application flow.");
    }
    return Object.freeze({ kind: record.kind, location });
  });
  const locations = historyLedger.map(({ location }) => location);
  const profileIndex = locations.lastIndexOf("app-profile");
  const cabinetIndex = locations.lastIndexOf("app-cabinet");
  if (profileIndex < 0 || cabinetIndex <= profileIndex
    || locations.slice(profileIndex + 1, cabinetIndex).some((value) => value.includes("#"))) {
    fail("Browser history does not preserve the exact profile-to-cabinet transition.");
  }
  return Object.freeze({
    historyContractSha256: sha256(JSON.stringify(historyLedger)),
    historyCount: historyLedger.length,
    historyLedger: Object.freeze(historyLedger),
  });
}

export function finalizeProviderOverlapBrowserContract(records, loadGraph) {
  if (!Array.isArray(records) || records.length === 0 || records.length > maximumRequests) {
    fail("Browser request ledger is outside its bounded contract.");
  }
  exactKeys(loadGraph, ["responseDeclaredStaticPaths", "staticAssetContract"], "static load graph");
  assertStaticAssetContract(loadGraph.staticAssetContract);
  if (!Array.isArray(loadGraph.responseDeclaredStaticPaths)
    || loadGraph.responseDeclaredStaticPaths.length > maximumRequests) {
    fail("Static response declaration graph is outside its bounded contract.");
  }
  const navigationFlow = records
    .filter(({ classification }) => classification.navigation)
    .map(({ classification }) => classification.key);
  deepEqual(navigationFlow, exactNavigationFlow, "browser navigation flow");

  const counts = {};
  const redirects = [];
  const staticLedger = [];
  const observedStaticPaths = new Set();
  for (const [index, record] of records.entries()) {
    exactKeys(
      record,
      ["classification", "redirectEdge", "responseContentType", "responseStatus"],
      `browser request record ${index}`,
    );
    const classification = record.classification;
    if (!classification || typeof classification.key !== "string") {
      fail(`Browser request record ${index} classification is invalid.`);
    }
    if (staticKeys.has(classification.key)) {
      if (!nextStaticPattern.test(classification.staticPath ?? "")
        || observedStaticPaths.has(classification.staticPath)) {
        fail("Static request path is invalid or duplicated.");
      }
      observedStaticPaths.add(classification.staticPath);
      staticLedger.push({
        assetSha256: classification.staticAssetSha256,
        class: classification.key,
        pathSha256: sha256(classification.staticPath),
      });
    } else if (classification.staticPath !== null || classification.staticAssetSha256 !== null) {
      fail("Non-static browser request contains a static asset binding.");
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

  const declaredPaths = [...new Set(loadGraph.responseDeclaredStaticPaths)].sort();
  if (declaredPaths.length !== loadGraph.responseDeclaredStaticPaths.length
    || declaredPaths.some((servedPath) => !nextStaticPattern.test(servedPath))) {
    fail("Static response declaration graph is invalid or duplicated.");
  }
  const inventory = loadGraph.staticAssetContract.inventoryByPath;
  const expectedChunks = new Set(loadGraph.staticAssetContract.routeDeclaredPaths);
  const declaredMedia = new Set();
  for (const servedPath of declaredPaths) {
    if (servedPath.startsWith("/_next/static/chunks/")) {
      if (!Object.hasOwn(inventory, servedPath)) {
        fail("Static declaration graph escaped the attested image inventory.");
      }
      expectedChunks.add(servedPath);
    } else {
      declaredMedia.add(servedPath);
    }
  }
  const observedChunks = [...observedStaticPaths]
    .filter((servedPath) => servedPath.startsWith("/_next/static/chunks/"))
    .sort();
  deepEqual(observedChunks, [...expectedChunks].sort(), "exact static chunk load graph");
  for (const servedPath of observedStaticPaths) {
    if (servedPath.startsWith("/_next/static/media/") && !declaredMedia.has(servedPath)) {
      fail("Static media request is not reachable from an observed stylesheet declaration.");
    }
  }

  const staticLoadGraph = Object.freeze({
    assetAttestationSha256: loadGraph.staticAssetContract.attestationSha256,
    declaredPathSha256s: Object.freeze(declaredPaths.map(sha256)),
    expectedChunkPathSha256s: Object.freeze([...expectedChunks].sort().map(sha256)),
  });

  const semanticCounts = Object.fromEntries(Object.entries(counts)
    .filter(([key]) => !staticKeys.has(key))
    .sort(([left], [right]) => left.localeCompare(right)));
  const summary = {
    version: 1,
    counts: semanticCounts,
    navigationFlow,
    redirects,
    semanticFlow: records
      .map(({ classification }) => classification.key)
      .filter((key) => !staticKeys.has(key)),
    staticClasses: [...staticKeys].filter((key) => counts[key] > 0).sort(),
  };
  return Object.freeze({
    requestCount: records.length,
    requestContractSha256: sha256(JSON.stringify(summary)),
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
      if (!/^synthetic-turnstile-token:login:synthetic-turnstile-[1-9]\d*:[1-9]\d*$/.test(
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
      js: ["script"],
      png: ["image"],
      svg: ["image"],
      woff2: ["font"],
    };
    exactResourceType(input.resourceType, resourceByExtension[extension]);
    exactNonNavigation(input);
    descriptor.key = extension === "woff2" ? "next-static-font"
      : ["png", "svg"].includes(extension) ? "next-static-image"
        : `next-static-${extension}`;
    descriptor.staticPath = url.pathname;
    descriptor.staticAssetSha256 = url.pathname.startsWith("/_next/static/chunks/")
      ? state.staticAssetContract.inventoryByPath[url.pathname] ?? null
      : null;
    if (url.pathname.startsWith("/_next/static/chunks/") && descriptor.staticAssetSha256 === null) {
      fail("Static chunk is absent from the attested production image inventory.");
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
      if (!/^synthetic-turnstile-token:login:synthetic-turnstile-[1-9]\d*:[1-9]\d*$/.test(
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

function assertStaticAssetContract(value) {
  exactKeys(
    value,
    ["attestationSha256", "inventoryByPath", "inventorySha256", "routeDeclaredPaths"],
    "static asset contract",
  );
  if (!sha256Pattern.test(value.attestationSha256 ?? "")
    || !sha256Pattern.test(value.inventorySha256 ?? "")
    || !value.inventoryByPath || typeof value.inventoryByPath !== "object"
    || Array.isArray(value.inventoryByPath) || !Array.isArray(value.routeDeclaredPaths)
    || value.routeDeclaredPaths.length < 1 || value.routeDeclaredPaths.length > maximumRequests) {
    fail("Static asset contract is invalid.");
  }
  const inventoryPaths = Object.keys(value.inventoryByPath).sort();
  if (inventoryPaths.length < 1 || inventoryPaths.length > 4_096
    || inventoryPaths.some((servedPath) => !servedPath.startsWith("/_next/static/chunks/")
      || !nextStaticPattern.test(servedPath)
      || !sha256Pattern.test(value.inventoryByPath[servedPath]))) {
    fail("Static asset inventory contract is invalid.");
  }
  if (JSON.stringify([...value.routeDeclaredPaths].sort())
      !== JSON.stringify(value.routeDeclaredPaths)
    || new Set(value.routeDeclaredPaths).size !== value.routeDeclaredPaths.length
    || value.routeDeclaredPaths.some((servedPath) => !Object.hasOwn(value.inventoryByPath, servedPath))) {
    fail("Static route declaration contract is invalid.");
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
  if (key === "next-static-font") return ["font/woff2"];
  if (key === "next-static-image" || key === "app-brand-logo") {
    return ["image/png", "image/svg+xml"];
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

/** @returns {never} */
function fail(message) {
  throw new Error(message);
}
