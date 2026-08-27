import {
  validateProductionApplicationRoleEnvironment,
  validateProductionEnvironment,
} from "../../../runtime/production-env-rules.mjs";

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

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const telegramOidcDefaults = {
  issuer: "https://oauth.telegram.org",
  authorizationEndpoint: "https://oauth.telegram.org/auth",
  tokenEndpoint: "https://oauth.telegram.org/token",
  jwksUri: "https://oauth.telegram.org/.well-known/jwks.json",
} as const;

function required(name: string, environment: EnvironmentSource) {
  const value = environment[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function url(name: string, environment: EnvironmentSource) {
  const value = required(name, environment);

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

function bool(
  name: string,
  defaultValue: boolean,
  environment: EnvironmentSource,
) {
  const value = environment[name];

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

function sameSite(
  name: string,
  defaultValue: SameSite,
  environment: EnvironmentSource,
) {
  const value = environment[name]?.toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (value === "lax" || value === "strict" || value === "none") {
    return value;
  }

  throw new Error(`${name} must be "lax", "strict", or "none"`);
}

function integer(
  name: string,
  defaultValue: number,
  min: number,
  max: number,
  environment: EnvironmentSource,
) {
  const value = environment[name]?.trim();

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

function optional(name: string, environment: EnvironmentSource) {
  return environment[name]?.trim() || null;
}

function webRefreshKeyring(environment: EnvironmentSource) {
  const primary = {
    id: optional("WEB_REFRESH_KEY_ID", environment) ?? "primary",
    secret: required("WEB_REFRESH_SECRET", environment),
  };
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(primary.id)) {
    throw new Error("WEB_REFRESH_KEY_ID must contain 1 to 32 safe key-id characters");
  }
  const encoded = optional("WEB_REFRESH_PREVIOUS_KEYS", environment);
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

function optionalUrl(name: string, environment: EnvironmentSource) {
  const value = optional(name, environment);

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

function remnawaveSubscriptionOrigins(environment: EnvironmentSource) {
  const raw = optional("REMNAWAVE_SUBSCRIPTION_ORIGINS", environment);
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

    const developmentLoopbackHttp = environment.NODE_ENV !== "production"
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

function paymentRedirectOrigins(environment: EnvironmentSource) {
  const raw = optional("PAYMENT_REDIRECT_ORIGINS", environment);
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

function chatwootConfig(environment: EnvironmentSource): AppEnv["chatwoot"] {
  const baseUrl = optional("CHATWOOT_BASE_URL", environment);
  const websiteToken = optional("CHATWOOT_WEBSITE_TOKEN", environment);
  const hmacToken = optional("CHATWOOT_HMAC_TOKEN", environment);
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

function optionalPublicPath(
  name: string,
  fallback: string,
  environment: EnvironmentSource,
) {
  const value = optional(name, environment);

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
  environment: EnvironmentSource,
) {
  const value = optional(name, environment);

  if (environment.NODE_ENV !== "production" && value) {
    return httpUrlValue(name, value).replace(/\/$/, "");
  }

  return fallback;
}

function validateEnv(env: AppEnv, environment: EnvironmentSource) {
  const isProduction = environment.NODE_ENV === "production";
  const isBuildPhase = environment.CLEAN_PAY_BUILD_PHASE === "true";

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
    if (environment.CLEAN_PAY_RUNTIME_ROLE === "application") {
      validateProductionApplicationRoleEnvironment(environment);
    } else {
      validateProductionEnvironment(environment);
    }
  }
}

function createEnv(environment: EnvironmentSource): AppEnv {
  const appUrl = url("APP_URL", environment);
  const remnashopApiBaseUrl = url("REMNASHOP_API_BASE_URL", environment);
  const remnashopAdminApiBaseUrl =
    optionalUrl("REMNASHOP_ADMIN_API_BASE_URL", environment)?.replace(/\/$/, "")
    ?? deriveRemnashopAdminApiBaseUrl(remnashopApiBaseUrl);

  const chatwoot = chatwootConfig(environment);
  const refreshKeyring = webRefreshKeyring(environment);
  const env = {
    databaseUrl: required("DATABASE_URL", environment),
    appUrl,
    publicAppUrl: url("NEXT_PUBLIC_APP_URL", environment),
    branding: {
      name: optional("NEXT_PUBLIC_BRAND_NAME", environment) ?? "Clean Pay",
      logoUrl: optionalPublicPath(
        "NEXT_PUBLIC_BRAND_LOGO_URL",
        "/clean-pay-logo.png",
        environment,
      ),
    },
    remnashopApiBaseUrl,
    remnashopAdminApiBaseUrl,
    remnashopApiKey: optional("REMNASHOP_API_KEY", environment),
    remnashopAuthServiceKey: optional("REMNASHOP_AUTH_SERVICE_KEY", environment),
    remnawave: {
      apiBaseUrl: optionalUrl("REMNAWAVE_API_BASE_URL", environment),
      token: optional("REMNAWAVE_TOKEN", environment),
      subscriptionOrigins: remnawaveSubscriptionOrigins(environment),
    },
    webJwtSecret: required("WEB_JWT_SECRET", environment),
    webRefreshSecret: refreshKeyring.primary.secret,
    webRefreshKeyring: refreshKeyring,
    auditIpHashSecret: optional("AUDIT_IP_HASH_SECRET", environment)
      ?? required("WEB_JWT_SECRET", environment),
    trustedProxyHops: integer("TRUSTED_PROXY_HOPS", 0, 0, 8, environment),
    rateLimitIdentitySecret: required("RATE_LIMIT_IDENTITY_SECRET", environment),
    authRateLimitCapacity: integer(
      "AUTH_RATE_LIMIT_CAPACITY",
      1000,
      100,
      1_000_000,
      environment,
    ),
    authConcurrencyLimit: integer(
      "AUTH_CONCURRENCY_LIMIT",
      64,
      1,
      10_000,
      environment,
    ),
    cookieSecure: bool("COOKIE_SECURE", true, environment),
    cookieSameSite: sameSite("COOKIE_SAMESITE", "lax", environment),
    telegramOidc: {
      issuer: telegramOidcUrl(
        "TELEGRAM_OIDC_ISSUER",
        telegramOidcDefaults.issuer,
        environment,
      ),
      authorizationEndpoint: telegramOidcUrl(
        "TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT",
        telegramOidcDefaults.authorizationEndpoint,
        environment,
      ),
      tokenEndpoint: telegramOidcUrl(
        "TELEGRAM_OIDC_TOKEN_ENDPOINT",
        telegramOidcDefaults.tokenEndpoint,
        environment,
      ),
      jwksUri: telegramOidcUrl(
        "TELEGRAM_OIDC_JWKS_URI",
        telegramOidcDefaults.jwksUri,
        environment,
      ),
      clientId: required("TELEGRAM_OIDC_CLIENT_ID", environment),
      clientSecret: required("TELEGRAM_OIDC_CLIENT_SECRET", environment),
      redirectUri: joinUrl(appUrl, "/auth/telegram/callback"),
    },
    telegramBotToken: optional("TELEGRAM_BOT_TOKEN", environment),
    paymentReturnUrls: {
      success: joinUrl(appUrl, "/payment/success"),
      fail: joinUrl(appUrl, "/payment/fail"),
      pending: joinUrl(appUrl, "/payment/pending"),
    },
    paymentRedirectOrigins: paymentRedirectOrigins(environment),
    paymentReconciliation: {
      enabled: bool("PAYMENT_RECONCILIATION_ENABLED", true, environment),
      secret: optional("PAYMENT_RECONCILIATION_SECRET", environment),
      batchSize: integer(
        "PAYMENT_RECONCILIATION_BATCH_SIZE",
        10,
        1,
        100,
        environment,
      ),
      intervalSeconds: integer(
        "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
        30,
        5,
        3_600,
        environment,
      ),
    },
    turnstile: {
      enabled: bool("TURNSTILE_ENABLED", false, environment),
      siteKey: optional("TURNSTILE_SITE_KEY", environment),
      secretKey: optional("TURNSTILE_SECRET_KEY", environment),
      verifyUrl: optionalUrl("TURNSTILE_VERIFY_URL", environment)
        ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    },
    support: {
      enabled: bool("SUPPORT_ENABLED", false, environment),
      email: optional("SUPPORT_EMAIL", environment),
      telegramUsername: optional("SUPPORT_TELEGRAM_USERNAME", environment),
      faqUrl: optionalUrl("SUPPORT_FAQ_URL", environment),
      liveChatEnabled: Boolean(chatwoot),
    },
    chatwoot,
    readiness: {
      internalSecret: required("READINESS_INTERNAL_SECRET", environment),
      mailpitUrl: optionalUrl("CLEAN_PAY_READINESS_MAILPIT_URL", environment),
      remnawaveUrl: optionalUrl("CLEAN_PAY_READINESS_REMNAWAVE_URL", environment),
    },
  };

  validateEnv(env, environment);

  return env;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

const testOnlyRuntime = process.env.NODE_ENV === "test";

function assertTestEnvironment(operation: string) {
  if (!testOnlyRuntime) {
    throw new Error(`${operation} is available only when NODE_ENV=test`);
  }
}

let cachedEnv: AppEnv | undefined;
let cachedTestRefreshKeyringFingerprint: string | undefined;

function testRefreshKeyringFingerprint(environment: EnvironmentSource) {
  return JSON.stringify([
    environment.WEB_REFRESH_KEY_ID ?? null,
    environment.WEB_REFRESH_SECRET ?? null,
    environment.WEB_REFRESH_PREVIOUS_KEYS ?? null,
  ]);
}

export function getEnv(): AppEnv {
  if (testOnlyRuntime) {
    const fingerprint = testRefreshKeyringFingerprint(process.env);
    if (
      cachedEnv
      && cachedTestRefreshKeyringFingerprint !== fingerprint
    ) {
      cachedEnv = undefined;
    }

    cachedEnv ??= deepFreeze(createEnv(process.env));
    cachedTestRefreshKeyringFingerprint = fingerprint;
    return cachedEnv;
  }

  cachedEnv ??= deepFreeze(createEnv(process.env));
  return cachedEnv;
}

export function createEnvForTests(
  environment: EnvironmentSource = process.env,
): AppEnv {
  assertTestEnvironment("createEnvForTests");
  return deepFreeze(createEnv(environment));
}

export function resetEnvForTests() {
  assertTestEnvironment("resetEnvForTests");
  cachedEnv = undefined;
  cachedTestRefreshKeyringFingerprint = undefined;
}
