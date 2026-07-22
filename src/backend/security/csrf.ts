const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

type RequestSourceValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "untrusted_origin";
      status: 403;
    };

export type CsrfValidationResult =
  | RequestSourceValidationResult
  | {
      ok: false;
      reason: "unsupported_media_type";
      status: 415;
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

function isJsonContentType(value: string | null) {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();

  return (
    mediaType === "application/json" ||
    Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"))
  );
}

export function validateMutationRequest({
  method,
  headers,
  trustedAppUrl,
  requireJson,
}: {
  method: string;
  headers: Headers;
  trustedAppUrl: string | undefined;
  requireJson: boolean;
}): CsrfValidationResult {
  if (safeMethods.has(method.toUpperCase())) {
    return { ok: true };
  }

  const sourceResult = validateRequestSource({ headers, trustedAppUrl });

  if (!sourceResult.ok) {
    return sourceResult;
  }

  if (requireJson && !isJsonContentType(headers.get("content-type"))) {
    return { ok: false, reason: "unsupported_media_type", status: 415 };
  }

  return { ok: true };
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
