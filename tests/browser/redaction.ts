import { sha256 } from "./baseline-policy";

const credentialHeaderNames = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

const volatileHeaderNames = new Set([
  "content-security-policy",
  "date",
  "etag",
  "last-modified",
  "server-timing",
  "traceparent",
  "x-clean-pay-trace-id",
  "x-nonce",
  "x-request-id",
]);

const categoricalHeaderNames = new Set([
  "accept-ranges",
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "origin-agent-cluster",
  "pragma",
  "referrer-policy",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "strict-transport-security",
  "upgrade-insecure-requests",
  "vary",
  "x-content-type-options",
  "x-frame-options",
  "x-nextjs-cache",
]);

const opaqueQueryKeys = new Set([
  "_rsc",
  "code",
  "id_token",
  "state",
  "token",
]);

export type SanitizedValue = {
  bytes: number;
  sha256: string;
};

export function digestValue(value: string | Uint8Array): SanitizedValue {
  return {
    bytes: typeof value === "string"
      ? Buffer.byteLength(value, "utf8")
      : value.byteLength,
    sha256: sha256(value),
  };
}

export function requireBrowserBaseUrl() {
  const raw = process.env.CLEAN_PAY_BROWSER_BASE_URL?.trim();
  if (!raw) {
    throw new Error(
      "CLEAN_PAY_BROWSER_BASE_URL must point to the isolated production runner.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CLEAN_PAY_BROWSER_BASE_URL must be an absolute HTTP(S) URL.");
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("CLEAN_PAY_BROWSER_BASE_URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("CLEAN_PAY_BROWSER_BASE_URL must not contain credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("CLEAN_PAY_BROWSER_BASE_URL must not contain a query or fragment.");
  }

  return parsed;
}

export function canonicalizeUrl(value: string, applicationOrigin: string) {
  let url: URL;
  try {
    url = new URL(value, applicationOrigin);
  } catch {
    return `<invalid-url:${shortDigest(value)}>`;
  }

  const sameApplication = url.origin === applicationOrigin;
  const origin = sameApplication
    ? "<app-origin>"
    : `<external-origin:${shortDigest(url.origin)}>`;
  const pathname = sameApplication
    ? canonicalizeApplicationPath(url.pathname)
    : externalPathShape(url.pathname);
  const query = Array.from(url.searchParams.entries()).map(([key, queryValue]) => ({
    key,
    value: !sameApplication
      ? "<redacted>"
      : opaqueQueryKeys.has(key.toLowerCase())
      ? "<opaque>"
      : `<sha256:${shortDigest(queryValue)}>`,
  }));
  const fragment = url.hash
    ? sameApplication
      ? `<sha256:${shortDigest(url.hash.slice(1))}>`
      : "<redacted>"
    : null;

  return { origin, pathname, query, fragment };
}

export function sanitizeHeaders(
  headers: Record<string, string>,
  applicationOrigin: string,
  networkUrl?: string,
) {
  const external = networkUrl !== undefined
    && new URL(networkUrl, applicationOrigin).origin !== applicationOrigin;
  const externalHeaderNames = new Set([
    "accept",
    "content-type",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
  ]);
  return Object.entries(headers)
    .filter(([rawName]) => !external || externalHeaderNames.has(rawName.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rawName, rawValue]) => {
      const name = rawName.toLowerCase();
      if (credentialHeaderNames.has(name)) {
        return { name, value: "<redacted>" };
      }
      if (volatileHeaderNames.has(name)) {
        return { name, value: "<volatile>" };
      }
      if (name.startsWith("cf-") || name === ":path") {
        return { name, value: "<volatile>" };
      }
      if (name === "location" || name === "origin" || name === "referer") {
        return { name, value: canonicalizeUrl(rawValue, applicationOrigin) };
      }
      if (categoricalHeaderNames.has(name)) {
        return {
          name,
          value: name === "content-type"
            ? rawValue.replace(/;\s*boundary=[^;]+/i, "; boundary=<redacted>")
            : rawValue,
        };
      }
      return { name, value: digestValue(rawValue) };
    });
}

export function sanitizeStorageKey(key: string) {
  if (
    key.length <= 80
    && /^[A-Za-z0-9_.:-]+$/.test(key)
    && !/(?:auth|credential|email|jwt|secret|session|token|user)/i.test(key)
  ) {
    return key;
  }
  return `<sha256:${shortDigest(key)}>`;
}

export function shortDigest(value: string) {
  return sha256(value).slice(0, 16);
}

function canonicalizeApplicationPath(pathname: string) {
  if (!pathname.startsWith("/_next/static/")) return pathname;

  return pathname
    .split("/")
    .map((segment) => segment
      .replace(/[a-f0-9]{16,}/gi, "<hash>")
      .replace(/(?<=-)\d{5,}(?=[.-])/g, "<chunk>"))
    .join("/");
}

function externalPathShape(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const extensionMatch = segments.at(-1)?.match(/\.([a-z0-9]{1,8})$/i);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "none";
  return `<external-path:segments=${segments.length}:extension=${extension}>`;
}
