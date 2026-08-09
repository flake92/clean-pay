type RequestSourceValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "untrusted_origin";
      status: 403;
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
