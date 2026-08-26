import {
  validateProductionApplicationRoleEnvironment,
  validateProductionEnvironment,
} from "../../../deploy/prod/production-env-rules.mjs";

type SameSite = "lax" | "strict" | "none";

type AppEnv = {
  databaseUrl: string;
  appUrl: string;
  publicAppUrl: string;
  branding: {
    name: string;
    logoUrl: string;
  };
  remnashopApiBaseUrl: string;
  remnashopAdminApiBaseUrl: string;
  remnashopApiKey: string | null;
  remnashopAuthServiceKey: string | null;
  remnawave: {
    apiBaseUrl: string | null;
    token: string | null;
    subscriptionOrigins: string[];
  };
  webJwtSecret: string;
  webRefreshSecret: string;
  webRefreshKeyring: {
    primary: { id: string; secret: string };
    previous: { id: string; secret: string }[];
  };
  auditIpHashSecret: string;
  trustedProxyHops: number;
  rateLimitIdentitySecret: string;
  authRateLimitCapacity: number;
  authConcurrencyLimit: number;
  cookieSecure: boolean;
  cookieSameSite: SameSite;
  telegramOidc: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    jwksUri: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  telegramBotToken: string | null;
  paymentReturnUrls: {
    success: string;
    fail: string;
    pending: string;
  };
  paymentRedirectOrigins: string[];
  paymentReconciliation: {
    enabled: boolean;
    secret: string | null;
    batchSize: number;
    intervalSeconds: number;
  };
  turnstile: {
    enabled: boolean;
    siteKey: string | null;
    secretKey: string | null;
    verifyUrl: string;
  };
  support: {
    enabled: boolean;
    email: string | null;
    telegramUsername: string | null;
    faqUrl: string | null;
    liveChatEnabled: boolean;
  };
  chatwoot: {
    baseUrl: string;
    websiteToken: string;
    hmacToken: string;
  } | null;
  readiness: {
    internalSecret: string;
    mailpitUrl: string | null;
    remnawaveUrl: string | null;
  };
};

const telegramOidcDefaults = {
  issuer: "https://oauth.telegram.org",
  authorizationEndpoint: "https://oauth.telegram.org/auth",
  tokenEndpoint: "https://oauth.telegram.org/token",
  jwksUri: "https://oauth.telegram.org/.well-known/jwks.json",
} as const;

function required(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function url(name: string) {
  const value = required(name);

  return httpUrlValue(name, value).replace(/\/$/, "");
}

function httpUrlValue(name: string, value: string) {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }

    return parsed.toString();
  } catch {
    throw new Error(`${name} must be a valid http(s) URL`);
  }
}

function bool(name: string, defaultValue: boolean) {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be "true" or "false"`);
}

function sameSite(name: string, defaultValue: SameSite) {
  const value = process.env[name]?.toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (value === "lax" || value === "strict" || value === "none") {
    return value;
  }

  throw new Error(`${name} must be "lax", "strict", or "none"`);
}

function integer(name: string, defaultValue: number, min: number, max: number) {
  const value = process.env[name]?.trim();

  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function joinUrl(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl}/`).toString();
}

function optional(name: string) {
  return process.env[name]?.trim() || null;
}

function webRefreshKeyring() {
  const primary = {
    id: optional("WEB_REFRESH_KEY_ID") ?? "primary",
    secret: required("WEB_REFRESH_SECRET"),
  };
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(primary.id)) {
    throw new Error("WEB_REFRESH_KEY_ID must contain 1 to 32 safe key-id characters");
  }
  const encoded = optional("WEB_REFRESH_PREVIOUS_KEYS");
  if (!encoded) return { primary, previous: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("WEB_REFRESH_PREVIOUS_KEYS must be a JSON object of key ids to secrets");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WEB_REFRESH_PREVIOUS_KEYS must be a JSON object of key ids to secrets");
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > 4) {
    throw new Error("WEB_REFRESH_PREVIOUS_KEYS must contain 1 to 4 previous keys");
  }
  const previous = entries.map(([id, secret]) => {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      throw new Error("WEB_REFRESH_PREVIOUS_KEYS contains an invalid key id");
    }
    if (typeof secret !== "string" || secret.length < 32) {
      throw new Error("WEB_REFRESH_PREVIOUS_KEYS values must be secrets of at least 32 characters");
    }
    return { id, secret };
  });
  if (new Set([primary.secret, ...previous.map(({ secret }) => secret)]).size !== previous.length + 1) {
    throw new Error("WEB_REFRESH_PREVIOUS_KEYS secrets must be distinct from the current key and each other");
  }
  return { primary, previous };
}

function optionalUrl(name: string) {
  const value = optional(name);

  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }

    return parsed.toString();
  } catch {
    throw new Error(`${name} must be a valid http(s) URL`);
  }
}

function originUrl(name: string, value: string) {
  const normalized = httpUrlValue(name, value);
  const parsed = new URL(normalized);

  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must contain only an http(s) origin`);
  }

  return parsed.origin;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const octets = normalized.split(".");
  const ipv4Loopback = octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);

  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "::1"
    || ipv4Loopback;
}

function remnawaveSubscriptionOrigins() {
  const raw = optional("REMNAWAVE_SUBSCRIPTION_ORIGINS");
  if (!raw) return [];

  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => !value) || values.length > 32) {
    throw new Error("REMNAWAVE_SUBSCRIPTION_ORIGINS must contain 1 to 32 comma-separated origins");
  }

  const origins = values.map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("REMNAWAVE_SUBSCRIPTION_ORIGINS must contain valid URL origins");
    }

    if (
      parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      throw new Error("REMNAWAVE_SUBSCRIPTION_ORIGINS must contain only URL origins without credentials");
    }

    const developmentLoopbackHttp = process.env.NODE_ENV !== "production"
      && parsed.protocol === "http:"
      && isLoopbackHostname(parsed.hostname);
    if (parsed.protocol !== "https:" && !developmentLoopbackHttp) {
      throw new Error("REMNAWAVE_SUBSCRIPTION_ORIGINS must use HTTPS (loopback HTTP is development-only)");
    }

    return parsed.origin;
  });

  if (new Set(origins).size !== origins.length) {
    throw new Error("REMNAWAVE_SUBSCRIPTION_ORIGINS must not contain duplicate origins");
  }

  return origins;
}

function paymentRedirectOrigins() {
  const raw = optional("PAYMENT_REDIRECT_ORIGINS");
  if (!raw) {
    // Keep the first strict allowlist rollout compatible with the immediately
    // previous production image during zero-downtime rollback. Operators may
    // override this closed default only with exact validated HTTPS origins.
    return ["https://yoomoney.ru", "https://pay.platega.io"];
  }

  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => !value) || values.length > 32) {
    throw new Error(
      "PAYMENT_REDIRECT_ORIGINS must contain 1 to 32 comma-separated HTTPS origins",
    );
  }

  const origins = values.map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("PAYMENT_REDIRECT_ORIGINS must contain valid HTTPS origins");
    }

    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      throw new Error(
        "PAYMENT_REDIRECT_ORIGINS must contain only HTTPS URL origins without credentials",
      );
    }

    return parsed.origin;
  });

  if (new Set(origins).size !== origins.length) {
    throw new Error("PAYMENT_REDIRECT_ORIGINS must not contain duplicate origins");
  }

  return origins;
}

function chatwootToken(name: string, value: string) {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(value)) {
    throw new Error(`${name} must be a complete Chatwoot token`);
  }

  return value;
}

function chatwootConfig(): AppEnv["chatwoot"] {
  const baseUrl = optional("CHATWOOT_BASE_URL");
  const websiteToken = optional("CHATWOOT_WEBSITE_TOKEN");
  const hmacToken = optional("CHATWOOT_HMAC_TOKEN");
  const configuredCount = [baseUrl, websiteToken, hmacToken].filter(Boolean).length;

  if (configuredCount === 0) {
    return null;
  }

  if (configuredCount !== 3) {
    throw new Error(
      "CHATWOOT_BASE_URL, CHATWOOT_WEBSITE_TOKEN and CHATWOOT_HMAC_TOKEN must be configured together",
    );
  }

  return {
    baseUrl: originUrl("CHATWOOT_BASE_URL", baseUrl!),
    websiteToken: chatwootToken("CHATWOOT_WEBSITE_TOKEN", websiteToken!),
    hmacToken: chatwootToken("CHATWOOT_HMAC_TOKEN", hmacToken!),
  };
}

function deriveRemnashopAdminApiBaseUrl(publicApiBaseUrl: string) {
  const parsed = new URL(publicApiBaseUrl);
  const publicSuffix = "/api/v1/public";

  if (!parsed.pathname.endsWith(publicSuffix)) {
    throw new Error(
      "REMNASHOP_API_BASE_URL must end with /api/v1/public to derive the admin API URL",
    );
  }

  parsed.pathname = `${parsed.pathname.slice(0, -publicSuffix.length)}/api/v1/admin`;
  return parsed.toString().replace(/\/$/, "");
}

function optionalPublicPath(name: string, fallback: string) {
  const value = optional(name);

  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${name} must be a root-relative public path like /brand/logo.png`);
  }

  return value;
}

function telegramOidcUrl(
  name:
    | "TELEGRAM_OIDC_ISSUER"
    | "TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT"
    | "TELEGRAM_OIDC_TOKEN_ENDPOINT"
    | "TELEGRAM_OIDC_JWKS_URI",
  fallback: string,
) {
  const value = optional(name);

  if (process.env.NODE_ENV !== "production" && value) {
    return httpUrlValue(name, value).replace(/\/$/, "");
  }

  return fallback;
}

function validateEnv(env: AppEnv) {
  const isProduction = process.env.NODE_ENV === "production";
  const isBuildPhase = process.env.CLEAN_PAY_BUILD_PHASE === "true";

  if (env.turnstile.enabled) {
    if (!env.turnstile.siteKey) {
      throw new Error("TURNSTILE_SITE_KEY is required when TURNSTILE_ENABLED=true");
    }

    if (!env.turnstile.secretKey && !isBuildPhase) {
      throw new Error("TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true");
    }
  }

  if (env.cookieSameSite === "none" && !env.cookieSecure) {
    throw new Error('COOKIE_SECURE must be "true" when COOKIE_SAMESITE="none"');
  }

  if (env.branding.name.length > 80) {
    throw new Error("NEXT_PUBLIC_BRAND_NAME must be 80 characters or less");
  }

  if (
    env.paymentReconciliation.enabled &&
    (!env.paymentReconciliation.secret ||
      env.paymentReconciliation.secret.length < 32)
  ) {
    throw new Error(
      "PAYMENT_RECONCILIATION_SECRET must be at least 32 characters when PAYMENT_RECONCILIATION_ENABLED=true",
    );
  }

  if (isProduction && (!env.remnawave.apiBaseUrl || !env.remnawave.token)) {
    throw new Error("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN are required in production");
  }

  if (Boolean(env.remnawave.apiBaseUrl) !== Boolean(env.remnawave.token)) {
    throw new Error("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN must be configured together");
  }

  if (env.telegramBotToken) {
    const botId = env.telegramBotToken.split(":")[0];

    if (botId && botId !== env.telegramOidc.clientId) {
      throw new Error("TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN");
    }
  }

  if (isProduction && !isBuildPhase) {
    if (process.env.CLEAN_PAY_RUNTIME_ROLE === "application") {
      validateProductionApplicationRoleEnvironment(process.env);
    } else {
      validateProductionEnvironment(process.env);
    }
  }
}

export function getEnv(): AppEnv {
  const appUrl = url("APP_URL");
  const remnashopApiBaseUrl = url("REMNASHOP_API_BASE_URL");
  const remnashopAdminApiBaseUrl =
    optionalUrl("REMNASHOP_ADMIN_API_BASE_URL")?.replace(/\/$/, "")
    ?? deriveRemnashopAdminApiBaseUrl(remnashopApiBaseUrl);

  const chatwoot = chatwootConfig();
  const refreshKeyring = webRefreshKeyring();
  const env = {
    databaseUrl: required("DATABASE_URL"),
    appUrl,
    publicAppUrl: url("NEXT_PUBLIC_APP_URL"),
    branding: {
      name: optional("NEXT_PUBLIC_BRAND_NAME") ?? "Clean Pay",
      logoUrl: optionalPublicPath("NEXT_PUBLIC_BRAND_LOGO_URL", "/clean-pay-logo.png"),
    },
    remnashopApiBaseUrl,
    remnashopAdminApiBaseUrl,
    remnashopApiKey: optional("REMNASHOP_API_KEY"),
    remnashopAuthServiceKey: optional("REMNASHOP_AUTH_SERVICE_KEY"),
    remnawave: {
      apiBaseUrl: optionalUrl("REMNAWAVE_API_BASE_URL"),
      token: optional("REMNAWAVE_TOKEN"),
      subscriptionOrigins: remnawaveSubscriptionOrigins(),
    },
    webJwtSecret: required("WEB_JWT_SECRET"),
    webRefreshSecret: refreshKeyring.primary.secret,
    webRefreshKeyring: refreshKeyring,
    auditIpHashSecret: optional("AUDIT_IP_HASH_SECRET") ?? required("WEB_JWT_SECRET"),
    trustedProxyHops: integer("TRUSTED_PROXY_HOPS", 0, 0, 8),
    rateLimitIdentitySecret: required("RATE_LIMIT_IDENTITY_SECRET"),
    authRateLimitCapacity: integer("AUTH_RATE_LIMIT_CAPACITY", 1000, 100, 1_000_000),
    authConcurrencyLimit: integer("AUTH_CONCURRENCY_LIMIT", 64, 1, 10_000),
    cookieSecure: bool("COOKIE_SECURE", true),
    cookieSameSite: sameSite("COOKIE_SAMESITE", "lax"),
    telegramOidc: {
      issuer: telegramOidcUrl("TELEGRAM_OIDC_ISSUER", telegramOidcDefaults.issuer),
      authorizationEndpoint: telegramOidcUrl(
        "TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT",
        telegramOidcDefaults.authorizationEndpoint,
      ),
      tokenEndpoint: telegramOidcUrl("TELEGRAM_OIDC_TOKEN_ENDPOINT", telegramOidcDefaults.tokenEndpoint),
      jwksUri: telegramOidcUrl("TELEGRAM_OIDC_JWKS_URI", telegramOidcDefaults.jwksUri),
      clientId: required("TELEGRAM_OIDC_CLIENT_ID"),
      clientSecret: required("TELEGRAM_OIDC_CLIENT_SECRET"),
      redirectUri: joinUrl(appUrl, "/auth/telegram/callback"),
    },
    telegramBotToken: optional("TELEGRAM_BOT_TOKEN"),
    paymentReturnUrls: {
      success: joinUrl(appUrl, "/payment/success"),
      fail: joinUrl(appUrl, "/payment/fail"),
      pending: joinUrl(appUrl, "/payment/pending"),
    },
    paymentRedirectOrigins: paymentRedirectOrigins(),
    paymentReconciliation: {
      enabled: bool("PAYMENT_RECONCILIATION_ENABLED", true),
      secret: optional("PAYMENT_RECONCILIATION_SECRET"),
      batchSize: integer("PAYMENT_RECONCILIATION_BATCH_SIZE", 10, 1, 100),
      intervalSeconds: integer(
        "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
        30,
        5,
        3_600,
      ),
    },
    turnstile: {
      enabled: bool("TURNSTILE_ENABLED", false),
      siteKey: optional("TURNSTILE_SITE_KEY"),
      secretKey: optional("TURNSTILE_SECRET_KEY"),
      verifyUrl: optionalUrl("TURNSTILE_VERIFY_URL") ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    },
    support: {
      enabled: bool("SUPPORT_ENABLED", false),
      email: optional("SUPPORT_EMAIL"),
      telegramUsername: optional("SUPPORT_TELEGRAM_USERNAME"),
      faqUrl: optionalUrl("SUPPORT_FAQ_URL"),
      liveChatEnabled: Boolean(chatwoot),
    },
    chatwoot,
    readiness: {
      internalSecret: required("READINESS_INTERNAL_SECRET"),
      mailpitUrl: optionalUrl("CLEAN_PAY_READINESS_MAILPIT_URL"),
      remnawaveUrl: optionalUrl("CLEAN_PAY_READINESS_REMNAWAVE_URL"),
    },
  };

  validateEnv(env);

  return env;
}
