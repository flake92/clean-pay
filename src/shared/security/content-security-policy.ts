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
  allowEval = false,
}: {
  nonce: string;
  chatwootBaseUrl?: string | null;
  /**
   * Next.js development builds evaluate their HMR and React Refresh runtime
   * with eval(), which this policy otherwise blocks -- leaving the client
   * unable to hydrate, so nothing on the page reacts to a click. Only the
   * development server may set this; the production policy never carries
   * 'unsafe-eval', and a production build has no eval to permit.
   */
  allowEval?: boolean;
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
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${allowEval ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com https://telegram.org`,
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
