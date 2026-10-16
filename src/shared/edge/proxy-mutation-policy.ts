export const serverActionBodyLimitBytes = 64 * 1024;

export type RequestSourceValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "untrusted_origin";
      status: 403;
    };

export type BrowserMutationPolicyResult =
  | RequestSourceValidationResult
  | {
      ok: false;
      reason: "request_body_too_large";
      status: 413;
    };

function parseOrigin(value: string | null | undefined) {
  if (!value || value === "null") {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

// Extra public origins of the same installation (for example a second domain
// in front of the same deployment). The Next.js standalone adapter exposes an
// internal container origin to middleware, while Host and forwarding headers
// are ingress metadata and must not expand the CSRF trust boundary, so every
// alias has to be listed explicitly. Callers pass NEXT_PUBLIC_APP_ALIAS_ORIGINS,
// which is inlined at build time and keeps this gate identical to Next's own
// Server Action origin check (next.config.ts derives allowedOrigins from it).
export function parseAliasOrigins(value: string | null | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => parseOrigin(entry.trim()))
    .filter((origin): origin is string => origin !== null);
}

function isTrustedRequestOrigin(
  requestOrigin: string,
  configuredOrigin: string,
  aliasOrigins: readonly string[],
) {
  return requestOrigin === configuredOrigin
    || aliasOrigins.includes(requestOrigin);
}

export function validateRequestSource({
  headers,
  trustedAppUrl,
  trustedAliasOrigins,
}: {
  headers: Headers;
  trustedAppUrl: string | undefined;
  trustedAliasOrigins?: string | undefined;
}): RequestSourceValidationResult {
  const trustedOrigin = parseOrigin(trustedAppUrl);
  const originHeader = headers.get("origin");
  const requestOrigin = originHeader === null
    ? parseOrigin(headers.get("referer"))
    : parseOrigin(originHeader);

  if (
    !trustedOrigin
    || !requestOrigin
    || !isTrustedRequestOrigin(
      requestOrigin,
      trustedOrigin,
      parseAliasOrigins(trustedAliasOrigins),
    )
  ) {
    return { ok: false, reason: "untrusted_origin", status: 403 };
  }

  return { ok: true };
}

export function isServerActionRequest(method: string, headers: Headers) {
  if (method !== "POST") return false;

  const contentType = headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return headers.has("next-action")
    || contentType === "application/x-www-form-urlencoded"
    || contentType === "multipart/form-data";
}

export function declaredServerActionBodyExceedsLimit(
  contentLength: string | null,
  limit = serverActionBodyLimitBytes,
) {
  const normalized = contentLength?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return false;

  const declaredLength = Number(normalized);
  return !Number.isSafeInteger(declaredLength) || declaredLength > limit;
}

export async function serverActionBodyExceedsLimit({
  headers,
  cloneBody,
  limit = serverActionBodyLimitBytes,
}: {
  headers: Headers;
  cloneBody: () => ReadableStream<Uint8Array> | null;
  limit?: number;
}) {
  if (declaredServerActionBodyExceedsLimit(headers.get("content-length"), limit)) {
    return true;
  }

  const body = cloneBody();
  if (!body) return false;
  const reader = body.getReader();
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        return false;
      }
      total += value.byteLength;
      if (total > limit) return true;
    }
  } finally {
    // A cloned Request body is a tee. Awaiting cancellation can wait for the
    // untouched branch that Next still needs, so signal cancellation without
    // coupling the policy response to downstream consumption.
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function browserMutationPolicy({
  method,
  pathname,
  headers,
  trustedAppUrl,
  trustedAliasOrigins,
  hasAccessCookie,
  hasRefreshCookie,
  cloneBody,
}: {
  method: string;
  pathname: string;
  headers: Headers;
  trustedAppUrl: string | undefined;
  trustedAliasOrigins?: string | undefined;
  hasAccessCookie: boolean;
  hasRefreshCookie: boolean;
  cloneBody: () => ReadableStream<Uint8Array> | null;
}): Promise<BrowserMutationPolicyResult> {
  if (isServerActionRequest(method, headers)) {
    const source = validateRequestSource({ headers, trustedAppUrl, trustedAliasOrigins });
    if (!source.ok) return source;
    if (await serverActionBodyExceedsLimit({ headers, cloneBody })) {
      return {
        ok: false,
        reason: "request_body_too_large",
        status: 413,
      };
    }
    return { ok: true };
  }

  if (pathname === "/auth/telegram/callback" && method === "POST") {
    return validateRequestSource({ headers, trustedAppUrl, trustedAliasOrigins });
  }

  if (pathname === "/auth/telegram/start") {
    if (!hasAccessCookie && !hasRefreshCookie) {
      return { ok: true };
    }

    return validateRequestSource({ headers, trustedAppUrl, trustedAliasOrigins });
  }

  return { ok: true };
}
