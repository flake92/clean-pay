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

export function validateRequestSource({
  headers,
  trustedAppUrl,
}: {
  headers: Headers;
  trustedAppUrl: string | undefined;
}): RequestSourceValidationResult {
  const trustedOrigin = parseOrigin(trustedAppUrl);
  const originHeader = headers.get("origin");
  const requestOrigin = originHeader === null
    ? parseOrigin(headers.get("referer"))
    : parseOrigin(originHeader);

  if (!trustedOrigin || requestOrigin !== trustedOrigin) {
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
  hasAccessCookie,
  hasRefreshCookie,
  cloneBody,
}: {
  method: string;
  pathname: string;
  headers: Headers;
  trustedAppUrl: string | undefined;
  hasAccessCookie: boolean;
  hasRefreshCookie: boolean;
  cloneBody: () => ReadableStream<Uint8Array> | null;
}): Promise<BrowserMutationPolicyResult> {
  if (isServerActionRequest(method, headers)) {
    const source = validateRequestSource({ headers, trustedAppUrl });
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
    return validateRequestSource({ headers, trustedAppUrl });
  }

  if (pathname === "/auth/telegram/start") {
    if (!hasAccessCookie && !hasRefreshCookie) {
      return { ok: true };
    }

    return validateRequestSource({ headers, trustedAppUrl });
  }

  return { ok: true };
}
