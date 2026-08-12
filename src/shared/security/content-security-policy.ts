function chatwootSources(baseUrl: string | null) {
  if (!baseUrl) {
    return null;
  }

  try {
    const parsed = new URL(baseUrl);

    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }

    return {
      origin: parsed.origin,
      websocketOrigin: `${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`,
    };
  } catch {
    return null;
  }
}

function sources(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}

export function buildContentSecurityPolicy({
  nonce,
  chatwootBaseUrl = null,
}: {
  nonce: string;
  chatwootBaseUrl?: string | null;
}) {
  const chatwoot = chatwootSources(chatwootBaseUrl);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    sources(["img-src 'self' data: blob: https:", chatwoot?.origin ?? null]),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    sources([
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com https://telegram.org`,
      chatwoot?.origin ?? null,
    ]),
    sources([
      "connect-src 'self' https://challenges.cloudflare.com https://telegram.org",
      chatwoot?.origin ?? null,
      chatwoot?.websocketOrigin ?? null,
    ]),
    sources(["frame-src https://challenges.cloudflare.com", chatwoot?.origin ?? null]),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}
