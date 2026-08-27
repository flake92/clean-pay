export type NormalizedStaticRouteCspViolation = {
  type: "error";
  kind: "blocked-static-chunk" | "blocked-inline-script";
  messageTemplate: string;
  blockedResource: "<inline>" | {
    origin: "<app-origin>";
    pathname: "/_next/static/chunks/<opaque>.js";
    query: [];
    fragment: null;
  };
  directive: {
    name: "script-src";
    sources: Array<
      | "'self'"
      | "'nonce-<volatile>'"
      | "'strict-dynamic'"
      | "https://challenges.cloudflare.com"
      | "https://telegram.org"
      | "https://chatwoot.browser.clean-pay.dev"
    >;
  };
};

const allowedStaticCspRoutes = new Set(["/install", "/offline"]);
const basePolicy = "script-src 'self' 'nonce-";
const policyAfterNonce = "' 'strict-dynamic' https://challenges.cloudflare.com https://telegram.org";
const journeyChatwootSource = "https://chatwoot.browser.clean-pay.dev";
const loadPrefix = "Loading the script '";
const loadSeparator = "' violates the following Content Security Policy directive: \"";
const loadSuffix = "\". Note that 'strict-dynamic' is present, so host-based allowlisting is disabled. Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.";
const inlinePrefix = "Executing inline script violates the following Content Security Policy directive '";
const inlineSeparator = "'. Either the 'unsafe-inline' keyword, a hash ('sha256-";
const inlineSuffix = "'), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.";

const baseDirectiveSources = [
    "'self'",
    "'nonce-<volatile>'",
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
    "https://telegram.org",
] as const;

const loadMessageTemplate = [
  "Loading the script '<app-origin>/_next/static/chunks/<opaque>.js' ",
  "violates the following Content Security Policy directive: \"script-src ",
  "'self' 'nonce-<volatile>' 'strict-dynamic' ",
  "https://challenges.cloudflare.com https://telegram.org\". ",
  "Note that 'strict-dynamic' is present, so host-based allowlisting is disabled. ",
  "Note that 'script-src-elem' was not explicitly set, so 'script-src' is used ",
  "as a fallback. The action has been blocked.",
].join("");

const inlineMessageTemplate = [
  "Executing inline script violates the following Content Security Policy ",
  "directive 'script-src 'self' 'nonce-<volatile>' 'strict-dynamic' ",
  "https://challenges.cloudflare.com https://telegram.org'. Either the ",
  "'unsafe-inline' keyword, a hash ('sha256-<volatile>'), or a nonce ",
  "('nonce-...') is required to enable inline execution. The action has been blocked.",
].join("");

export function normalizeStaticRouteCspConsole(options: {
  applicationOrigin: string;
  pageUrl: string;
  type: string;
  text: string;
}): NormalizedStaticRouteCspViolation | null {
  if (options.type !== "error") return null;

  let pageUrl: URL;
  try {
    pageUrl = new URL(options.pageUrl);
  } catch {
    return null;
  }
  if (
    pageUrl.origin !== options.applicationOrigin
    || !allowedStaticCspRoutes.has(pageUrl.pathname)
  ) {
    return null;
  }

  const loadedChunk = normalizeBlockedChunk(options.text, options.applicationOrigin);
  if (loadedChunk) return loadedChunk;
  return normalizeBlockedInlineScript(options.text);
}

function normalizeBlockedChunk(
  text: string,
  applicationOrigin: string,
): NormalizedStaticRouteCspViolation | null {
  if (!text.startsWith(loadPrefix) || !text.endsWith(loadSuffix)) return null;
  const separatorIndex = text.indexOf(loadSeparator, loadPrefix.length);
  if (separatorIndex === -1) return null;

  const scriptValue = text.slice(loadPrefix.length, separatorIndex);
  const policyStart = separatorIndex + loadSeparator.length;
  const policy = text.slice(policyStart, -loadSuffix.length);
  const directiveSources = normalizeDirectiveSources(policy);
  if (!directiveSources) return null;

  let scriptUrl: URL;
  try {
    scriptUrl = new URL(scriptValue);
  } catch {
    return null;
  }
  if (
    scriptUrl.origin !== applicationOrigin
    || scriptUrl.username
    || scriptUrl.password
    || scriptUrl.search
    || scriptUrl.hash
    || !/^\/_next\/static\/chunks\/[A-Za-z0-9._-]+\.js$/.test(scriptUrl.pathname)
  ) {
    return null;
  }

  return {
    type: "error",
    kind: "blocked-static-chunk",
    messageTemplate: loadMessageTemplate,
    blockedResource: {
      origin: "<app-origin>",
      pathname: "/_next/static/chunks/<opaque>.js",
      query: [],
      fragment: null,
    },
    directive: {
      name: "script-src",
      sources: directiveSources,
    },
  };
}

function normalizeBlockedInlineScript(
  text: string,
): NormalizedStaticRouteCspViolation | null {
  if (!text.startsWith(inlinePrefix) || !text.endsWith(inlineSuffix)) return null;
  const separatorIndex = text.indexOf(inlineSeparator, inlinePrefix.length);
  if (separatorIndex === -1) return null;

  const policy = text.slice(inlinePrefix.length, separatorIndex);
  const hashStart = separatorIndex + inlineSeparator.length;
  const hash = text.slice(hashStart, -inlineSuffix.length);
  const directiveSources = normalizeDirectiveSources(policy);
  if (!directiveSources || !/^[A-Za-z0-9+/]{43}=$/.test(hash)) {
    return null;
  }

  return {
    type: "error",
    kind: "blocked-inline-script",
    messageTemplate: inlineMessageTemplate,
    blockedResource: "<inline>",
    directive: {
      name: "script-src",
      sources: directiveSources,
    },
  };
}

function normalizeDirectiveSources(
  policy: string,
): NormalizedStaticRouteCspViolation["directive"]["sources"] | null {
  if (!policy.startsWith(basePolicy)) return null;
  const nonceEnd = policy.indexOf("'", basePolicy.length);
  if (nonceEnd === -1) return null;
  const nonce = policy.slice(basePolicy.length, nonceEnd);
  if (!/^[a-f0-9]{32}$/.test(nonce)) return null;

  const suffix = policy.slice(nonceEnd);
  if (suffix === policyAfterNonce) return [...baseDirectiveSources];
  if (suffix === `${policyAfterNonce} ${journeyChatwootSource}`) {
    return [...baseDirectiveSources, journeyChatwootSource];
  }
  return null;
}
