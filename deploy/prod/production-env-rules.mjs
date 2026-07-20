const OFFICIAL_TELEGRAM_OIDC_URLS = {
  TELEGRAM_OIDC_ISSUER: "https://oauth.telegram.org",
  TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT: "https://oauth.telegram.org/auth",
  TELEGRAM_OIDC_TOKEN_ENDPOINT: "https://oauth.telegram.org/token",
  TELEGRAM_OIDC_JWKS_URI: "https://oauth.telegram.org/.well-known/jwks.json",
};

const OFFICIAL_TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const KNOWN_TURNSTILE_TEST_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

const COMMON_WEAK_VALUES = new Set([
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "admin",
  "changeme",
  "change-me",
  "clean_pay",
  "default",
  "dummy",
  "letmein",
  "password",
  "password123",
  "qwerty",
  "secret",
  "test",
  "testing",
  "token",
]);

const ALLOWED_DATABASE_QUERY_PARAMETERS = new Set([
  "application_name",
  "connect_timeout",
  "connection_limit",
  "idle_in_transaction_session_timeout",
  "pool_timeout",
  "schema",
  "sslmode",
  "statement_timeout",
]);

const FORBIDDEN_COMPOSE_CONTROL_NAMES = new Set([
  "COMPOSE_ENV_FILES",
  "COMPOSE_FILE",
  "COMPOSE_PROFILES",
]);

export const COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES = Object.freeze([
  "CLEAN_PAY_BIND",
  "CLEAN_PAY_EDGE_NETWORK",
  "CLEAN_PAY_IMAGE",
  "CLEAN_PAY_PORT",
  "COMPOSE_ENV_FILES",
  "COMPOSE_FILE",
  "COMPOSE_PROFILES",
  "COMPOSE_PROJECT_NAME",
  "LOG_LEVEL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_BRAND_LOGO_URL",
  "NEXT_PUBLIC_BRAND_NAME",
  "POSTGRES_DB",
  "POSTGRES_PASSWORD",
  "POSTGRES_USER",
  "REMNASHOP_DOCKER_NETWORK",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SITE_KEY",
]);

export class ProductionEnvironmentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionEnvironmentError";
  }
}

export function parseProductionEnvironmentFile(contents, sourceName = ".env") {
  const environment = Object.create(null);
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator <= 0) {
      fail(`${sourceName}:${index + 1} must be a NAME=value assignment`);
    }

    const name = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      fail(`${sourceName}:${index + 1} contains an invalid variable name`);
    }

    if (FORBIDDEN_COMPOSE_CONTROL_NAMES.has(name)) {
      fail(`${sourceName}:${index + 1} must not set Compose control variable ${name}`);
    }

    if (Object.hasOwn(environment, name)) {
      fail(`${sourceName}:${index + 1} duplicates ${name}`);
    }

    environment[name] = parseEnvValue(rawValue, sourceName, index + 1);
  }

  return environment;
}

export function validateProductionEnvironment(environment) {
  const optional = (name) => {
    const rawValue = environment[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return null;
    }

    if (typeof rawValue !== "string") {
      fail(`${name} must be a string`);
    }

    if (rawValue !== rawValue.trim()) {
      fail(`${name} must not contain surrounding whitespace`);
    }

    return rawValue;
  };
  const required = (name) => {
    const value = optional(name);

    if (!value) {
      fail(`${name} is required`);
    }

    return value;
  };

  if (optional("CLEAN_PAY_BUILD_PHASE") === "true") {
    fail("CLEAN_PAY_BUILD_PHASE is build-only and must not be enabled at runtime");
  }

  const postgresDatabase = simpleDatabaseName("POSTGRES_DB", required("POSTGRES_DB"));
  const postgresUser = simpleDatabaseName("POSTGRES_USER", required("POSTGRES_USER"));
  const postgresPassword = strongSecret(
    "POSTGRES_PASSWORD",
    required("POSTGRES_PASSWORD"),
    24,
  );
  const databaseUrl = parsedUrl(
    "DATABASE_URL",
    required("DATABASE_URL"),
    ["postgresql:", "postgres:"],
  );

  validateDatabaseUrl(
    databaseUrl,
    postgresDatabase,
    postgresUser,
    postgresPassword,
  );
  const redisPassword = validateRedisUrl(
    parsedUrl("REDIS_URL", required("REDIS_URL"), ["redis:", "rediss:"]),
  );

  const appUrl = publicHttpsOrigin("APP_URL", required("APP_URL"));
  const publicAppUrl = publicHttpsOrigin(
    "NEXT_PUBLIC_APP_URL",
    required("NEXT_PUBLIC_APP_URL"),
  );

  if (appUrl.origin !== publicAppUrl.origin) {
    fail("APP_URL and NEXT_PUBLIC_APP_URL must be the same HTTPS origin");
  }

  const bakedPublicAppUrl = optional("CLEAN_PAY_BAKED_PUBLIC_APP_URL");

  if (
    bakedPublicAppUrl &&
    publicHttpsOrigin("CLEAN_PAY_BAKED_PUBLIC_APP_URL", bakedPublicAppUrl).origin !==
      publicAppUrl.origin
  ) {
    fail(
      "CLEAN_PAY_BAKED_PUBLIC_APP_URL must match NEXT_PUBLIC_APP_URL; rebuild the image",
    );
  }

  const remnashopPublicUrl = remnashopBaseUrl(
    "REMNASHOP_API_BASE_URL",
    required("REMNASHOP_API_BASE_URL"),
    "public",
  );
  const remnashopAdminValue = optional("REMNASHOP_ADMIN_API_BASE_URL");
  const expectedAdminPath = remnashopPublicUrl.pathname.replace(
    /\/api\/v1\/public\/?$/,
    "/api/v1/admin",
  );
  const remnashopAdminUrl = remnashopAdminValue
    ? remnashopBaseUrl(
        "REMNASHOP_ADMIN_API_BASE_URL",
        remnashopAdminValue,
        "admin",
      )
    : new URL(remnashopPublicUrl);

  if (!remnashopAdminValue) {
    remnashopAdminUrl.pathname = expectedAdminPath;
  }

  if (
    remnashopAdminUrl.origin !== remnashopPublicUrl.origin ||
    normalizedPath(remnashopAdminUrl.pathname) !== expectedAdminPath
  ) {
    fail(
      "REMNASHOP_ADMIN_API_BASE_URL must use the same origin and API prefix as REMNASHOP_API_BASE_URL",
    );
  }

  const remnawaveUrl = publicHttpsOrigin(
    "REMNAWAVE_API_BASE_URL",
    required("REMNAWAVE_API_BASE_URL"),
  );
  const remnawaveReadinessValue = optional("CLEAN_PAY_READINESS_REMNAWAVE_URL");

  if (remnawaveReadinessValue) {
    const remnawaveReadinessUrl = publicHttpsOrigin(
      "CLEAN_PAY_READINESS_REMNAWAVE_URL",
      remnawaveReadinessValue,
    );

    if (remnawaveReadinessUrl.origin !== remnawaveUrl.origin) {
      fail(
        "CLEAN_PAY_READINESS_REMNAWAVE_URL must use the REMNAWAVE_API_BASE_URL origin",
      );
    }
  }

  const remnashopApiKey = strongSecret(
    "REMNASHOP_API_KEY",
    required("REMNASHOP_API_KEY"),
    24,
  );
  const remnawaveToken = strongSecret(
    "REMNAWAVE_TOKEN",
    required("REMNAWAVE_TOKEN"),
    24,
  );
  const webJwtSecret = strongSecret(
    "WEB_JWT_SECRET",
    required("WEB_JWT_SECRET"),
    32,
  );
  const webRefreshSecret = strongSecret(
    "WEB_REFRESH_SECRET",
    required("WEB_REFRESH_SECRET"),
    32,
  );
  const auditIpHashSecret = strongSecret(
    "AUDIT_IP_HASH_SECRET",
    required("AUDIT_IP_HASH_SECRET"),
    32,
  );
  const rateLimitIdentitySecret = strongSecret(
    "RATE_LIMIT_IDENTITY_SECRET",
    required("RATE_LIMIT_IDENTITY_SECRET"),
    32,
  );
  const readinessInternalSecret = strongSecret(
    "READINESS_INTERNAL_SECRET",
    required("READINESS_INTERNAL_SECRET"),
    32,
  );

  const cookieSecure = bool("COOKIE_SECURE", optional("COOKIE_SECURE"), true);
  sameSite("COOKIE_SAMESITE", optional("COOKIE_SAMESITE"), "lax");

  if (!cookieSecure) {
    fail('COOKIE_SECURE must be "true" in production');
  }

  const telegramClientId = required("TELEGRAM_OIDC_CLIENT_ID");

  if (!/^[1-9]\d{4,19}$/.test(telegramClientId)) {
    fail("TELEGRAM_OIDC_CLIENT_ID must be a numeric Telegram bot id");
  }

  const telegramClientSecret = strongSecret(
    "TELEGRAM_OIDC_CLIENT_SECRET",
    required("TELEGRAM_OIDC_CLIENT_SECRET"),
    24,
  );
  const telegramBotToken = required("TELEGRAM_BOT_TOKEN");
  const botTokenMatch = /^([1-9]\d{4,19}):([A-Za-z0-9_-]{20,})$/.exec(
    telegramBotToken,
  );

  if (!botTokenMatch) {
    fail("TELEGRAM_BOT_TOKEN must be a complete Telegram bot token");
  }

  if (botTokenMatch[1] !== telegramClientId) {
    fail("TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN");
  }

  strongSecret("TELEGRAM_BOT_TOKEN", telegramBotToken, 32);

  for (const [name, expectedValue] of Object.entries(
    OFFICIAL_TELEGRAM_OIDC_URLS,
  )) {
    const configuredValue = optional(name);

    if (configuredValue && canonicalUrl(name, configuredValue) !== expectedValue) {
      fail(`${name} must use the official Telegram OIDC endpoint in production`);
    }
  }

  const paymentReconciliationEnabled = bool(
    "PAYMENT_RECONCILIATION_ENABLED",
    optional("PAYMENT_RECONCILIATION_ENABLED"),
    false,
  );
  boundedInteger(
    "PAYMENT_RECONCILIATION_BATCH_SIZE",
    optional("PAYMENT_RECONCILIATION_BATCH_SIZE"),
    10,
    1,
    100,
  );
  boundedInteger(
    "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
    optional("PAYMENT_RECONCILIATION_INTERVAL_SECONDS"),
    30,
    5,
    3_600,
  );
  boundedInteger(
    "AUTH_STATE_RETENTION_DAYS",
    optional("AUTH_STATE_RETENTION_DAYS"),
    7,
    1,
    30,
  );
  boundedInteger(
    "SESSION_RETENTION_DAYS",
    optional("SESSION_RETENTION_DAYS"),
    90,
    30,
    365,
  );
  const auditInfoRetentionDays = boundedInteger(
    "AUDIT_INFO_RETENTION_DAYS",
    optional("AUDIT_INFO_RETENTION_DAYS"),
    180,
    30,
    730,
  );
  const auditSecurityRetentionDays = boundedInteger(
    "AUDIT_SECURITY_RETENTION_DAYS",
    optional("AUDIT_SECURITY_RETENTION_DAYS"),
    365,
    90,
    2_555,
  );
  boundedInteger(
    "RATE_LIMIT_RETENTION_DAYS",
    optional("RATE_LIMIT_RETENTION_DAYS"),
    30,
    1,
    180,
  );
  boundedInteger(
    "DATA_RETENTION_INTERVAL_SECONDS",
    optional("DATA_RETENTION_INTERVAL_SECONDS"),
    21_600,
    300,
    86_400,
  );

  if (auditSecurityRetentionDays < auditInfoRetentionDays) {
    fail("AUDIT_SECURITY_RETENTION_DAYS must be at least AUDIT_INFO_RETENTION_DAYS");
  }

  const paymentSecretValue = optional("PAYMENT_RECONCILIATION_SECRET");
  const paymentSecret = paymentSecretValue
    ? strongSecret("PAYMENT_RECONCILIATION_SECRET", paymentSecretValue, 32)
    : null;
  const internalUrlValue = optional("PAYMENT_RECONCILIATION_INTERNAL_URL");

  if (internalUrlValue) {
    internalReconciliationUrl(internalUrlValue);
  }

  if (paymentReconciliationEnabled) {
    if (!paymentSecret) {
      fail(
        "PAYMENT_RECONCILIATION_SECRET is required when PAYMENT_RECONCILIATION_ENABLED=true",
      );
    }

    if (!internalUrlValue) {
      fail(
        "PAYMENT_RECONCILIATION_INTERNAL_URL is required when PAYMENT_RECONCILIATION_ENABLED=true",
      );
    }
  }

  const turnstileEnabled = bool(
    "TURNSTILE_ENABLED",
    optional("TURNSTILE_ENABLED"),
    false,
  );
  const turnstileSiteKey = optional("TURNSTILE_SITE_KEY");
  const turnstileSecretValue = optional("TURNSTILE_SECRET_KEY");
  const turnstileVerifyValue = optional("TURNSTILE_VERIFY_URL");

  if (turnstileSiteKey) {
    if (looksLikePlaceholder(turnstileSiteKey)) {
      fail("TURNSTILE_SITE_KEY must not use a placeholder value");
    }

    if (KNOWN_TURNSTILE_TEST_KEYS.has(turnstileSiteKey)) {
      fail("TURNSTILE_SITE_KEY must not use a Cloudflare test key in production");
    }

    if (turnstileSiteKey.length < 20) {
      fail("TURNSTILE_SITE_KEY must be a complete Cloudflare site key");
    }
  }

  if (
    turnstileSecretValue &&
    KNOWN_TURNSTILE_TEST_KEYS.has(turnstileSecretValue)
  ) {
    fail("TURNSTILE_SECRET_KEY must not use a Cloudflare test key in production");
  }

  const turnstileSecret = turnstileSecretValue
    ? strongSecret("TURNSTILE_SECRET_KEY", turnstileSecretValue, 24)
    : null;

  if (turnstileVerifyValue) {
    const configuredVerifyUrl = canonicalUrl(
      "TURNSTILE_VERIFY_URL",
      turnstileVerifyValue,
    );

    if (configuredVerifyUrl !== OFFICIAL_TURNSTILE_VERIFY_URL) {
      fail("TURNSTILE_VERIFY_URL must use the official Cloudflare endpoint in production");
    }
  }

  if (turnstileEnabled) {
    if (!turnstileSiteKey) {
      fail("TURNSTILE_SITE_KEY is required when TURNSTILE_ENABLED=true");
    }

    if (!turnstileSecret) {
      fail("TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true");
    }

  }

  bool(
    "SUPPORT_ENABLED",
    optional("SUPPORT_ENABLED"),
    false,
  );
  const supportEmail = optional("SUPPORT_EMAIL");
  const supportTelegram = optional("SUPPORT_TELEGRAM_USERNAME");
  const supportFaqUrl = optional("SUPPORT_FAQ_URL");

  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
    fail("SUPPORT_EMAIL must be a valid email address");
  }

  if (supportTelegram && !/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(supportTelegram)) {
    fail("SUPPORT_TELEGRAM_USERNAME must be a valid Telegram username");
  }

  if (supportFaqUrl) {
    publicHttpsUrl("SUPPORT_FAQ_URL", supportFaqUrl);
  }

  const mailpitReadinessValue = optional("CLEAN_PAY_READINESS_MAILPIT_URL");

  if (mailpitReadinessValue) {
    serviceOrigin("CLEAN_PAY_READINESS_MAILPIT_URL", mailpitReadinessValue);
  }

  const brandName = optional("NEXT_PUBLIC_BRAND_NAME");

  if (brandName && brandName.length > 80) {
    fail("NEXT_PUBLIC_BRAND_NAME must be 80 characters or less");
  }

  const brandLogo = optional("NEXT_PUBLIC_BRAND_LOGO_URL");

  if (brandLogo) {
    publicPath("NEXT_PUBLIC_BRAND_LOGO_URL", brandLogo);
  }

  const bindAddress = optional("CLEAN_PAY_BIND");

  if (bindAddress && bindAddress !== "127.0.0.1" && bindAddress !== "::1") {
    fail("CLEAN_PAY_BIND must be a loopback address in production");
  }

  boundedInteger("CLEAN_PAY_PORT", optional("CLEAN_PAY_PORT"), 4000, 1, 65_535);
  bool("RUN_MIGRATIONS", optional("RUN_MIGRATIONS"), true);

  const secretEntries = [
    ["POSTGRES_PASSWORD", postgresPassword],
    ["REMNASHOP_API_KEY", remnashopApiKey],
    ["REMNAWAVE_TOKEN", remnawaveToken],
    ["WEB_JWT_SECRET", webJwtSecret],
    ["WEB_REFRESH_SECRET", webRefreshSecret],
    ["AUDIT_IP_HASH_SECRET", auditIpHashSecret],
    ["RATE_LIMIT_IDENTITY_SECRET", rateLimitIdentitySecret],
    ["READINESS_INTERNAL_SECRET", readinessInternalSecret],
    ["TELEGRAM_OIDC_CLIENT_SECRET", telegramClientSecret],
  ];

  if (telegramBotToken !== telegramClientSecret) {
    secretEntries.push(["TELEGRAM_BOT_TOKEN", telegramBotToken]);
  }

  if (redisPassword) {
    secretEntries.push(["REDIS_URL password", redisPassword]);
  }

  if (paymentSecret) {
    secretEntries.push(["PAYMENT_RECONCILIATION_SECRET", paymentSecret]);
  }

  if (turnstileSecret) {
    secretEntries.push(["TURNSTILE_SECRET_KEY", turnstileSecret]);
  }

  distinctSecrets(secretEntries);
}

function validateDatabaseUrl(url, expectedDatabase, expectedUser, expectedPassword) {
  rejectCredentialsInHostname("DATABASE_URL", url);
  rejectLocalHostname("DATABASE_URL", url.hostname);

  const username = decodedUrlComponent("DATABASE_URL username", url.username);
  const password = decodedUrlComponent("DATABASE_URL password", url.password);
  const database = decodedUrlComponent(
    "DATABASE_URL database",
    url.pathname.replace(/^\//, ""),
  );

  if (username !== expectedUser) {
    fail("DATABASE_URL username must match POSTGRES_USER");
  }

  if (password !== expectedPassword) {
    fail("DATABASE_URL password must match POSTGRES_PASSWORD");
  }

  if (database !== expectedDatabase) {
    fail("DATABASE_URL database must match POSTGRES_DB");
  }

  if (!url.hostname || !database || url.hash) {
    fail("DATABASE_URL must include a hostname and database without a fragment");
  }

  validateDatabaseQueryParameters(url);

  if (normalizeHostname(url.hostname) === "postgres" && url.port && url.port !== "5432") {
    fail("DATABASE_URL must use port 5432 for the bundled postgres service");
  }

  if (!isInternalHostname(url.hostname)) {
    const sslMode = url.searchParams.get("sslmode");

    if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      fail("DATABASE_URL for a public host must require TLS with sslmode");
    }
  }
}

function validateRedisUrl(url) {
  rejectLocalHostname("REDIS_URL", url.hostname);
  const isBundledRedis = normalizeHostname(url.hostname) === "redis";

  if (!url.hostname || url.hash) {
    fail("REDIS_URL must include a hostname and must not include a fragment");
  }

  if (url.protocol === "redis:" && !isInternalHostname(url.hostname)) {
    fail("REDIS_URL must use rediss:// for a public host");
  }

  if (isBundledRedis && (url.username || url.password)) {
    fail("REDIS_URL must not include credentials for the bundled Redis service");
  }

  if (!isBundledRedis && url.username && !url.password) {
    fail("REDIS_URL must not include a username without a password");
  }

  let externalPassword = null;

  if (!isBundledRedis && url.password) {
    externalPassword = strongSecret(
      "REDIS_URL password",
      decodedUrlComponent("REDIS_URL password", url.password),
      24,
    );
  }

  if (!/^\/(?:\d+)?$/.test(url.pathname)) {
    fail("REDIS_URL must use a numeric Redis database path");
  }

  if (isBundledRedis && url.port && url.port !== "6379") {
    fail("REDIS_URL must use port 6379 for the bundled redis service");
  }

  return externalPassword;
}

function validateDatabaseQueryParameters(url) {
  const seenParameters = new Set();

  for (const [rawName, value] of url.searchParams) {
    const name = rawName.toLowerCase();

    if (seenParameters.has(name)) {
      fail(`DATABASE_URL must not repeat the ${rawName} query parameter`);
    }

    seenParameters.add(name);

    if (!ALLOWED_DATABASE_QUERY_PARAMETERS.has(name)) {
      fail(`DATABASE_URL query parameter ${rawName} is not allowed`);
    }

    if (name === "schema") {
      simpleDatabaseName("DATABASE_URL schema", value);
    }
  }
}

function remnashopBaseUrl(name, value, scope) {
  const url = serviceUrl(name, value);
  const path = normalizedPath(url.pathname);

  if (url.search || url.hash) {
    fail(`${name} must not include a query string or fragment`);
  }

  if (!path.endsWith(`/api/v1/${scope}`)) {
    fail(`${name} must end with /api/v1/${scope}`);
  }

  return url;
}

function internalReconciliationUrl(value) {
  const name = "PAYMENT_RECONCILIATION_INTERNAL_URL";
  const url = parsedUrl(name, value, ["http:", "https:"]);

  rejectUrlCredentials(name, url);
  rejectLocalHostname(name, url.hostname);

  if (!isInternalHostname(url.hostname)) {
    fail(`${name} must use an internal service hostname`);
  }

  if (
    normalizedPath(url.pathname) !== "/api/internal/payments/reconcile" ||
    url.search ||
    url.hash
  ) {
    fail(`${name} must target exactly /api/internal/payments/reconcile`);
  }

  return url;
}

function publicHttpsOrigin(name, value) {
  const url = publicHttpsUrl(name, value);
  assertOriginOnly(name, url);
  return url;
}

function publicHttpsUrl(name, value) {
  const url = parsedUrl(name, value, ["https:"]);

  rejectUrlCredentials(name, url);
  assertPublicHostname(name, url.hostname);
  return url;
}

function serviceOrigin(name, value) {
  const url = serviceUrl(name, value);

  assertOriginOnly(name, url);
  return url;
}

function serviceUrl(name, value) {
  const url = parsedUrl(name, value, ["http:", "https:"]);

  rejectUrlCredentials(name, url);
  rejectLocalHostname(name, url.hostname);

  if (!url.hostname) {
    fail(`${name} must include a hostname`);
  }

  if (url.protocol === "http:" && !isInternalHostname(url.hostname)) {
    fail(`${name} must use HTTPS for a public host`);
  }

  if (!isInternalHostname(url.hostname)) {
    assertPublicHostname(name, url.hostname);
  }

  return url;
}

function canonicalUrl(name, value) {
  const url = parsedUrl(name, value, ["https:"]);

  rejectUrlCredentials(name, url);
  return url.toString().replace(/\/$/, "");
}

function parsedUrl(name, value, protocols) {
  try {
    const url = new URL(value);

    if (!protocols.includes(url.protocol)) {
      throw new Error();
    }

    return url;
  } catch {
    fail(`${name} must be a valid ${protocols.join(" or ")} URL`);
  }
}

function assertOriginOnly(name, url) {
  if (url.pathname !== "/" || url.search || url.hash) {
    fail(`${name} must contain only an origin (no path, query string, or fragment)`);
  }
}

function assertPublicHostname(name, hostname) {
  rejectLocalHostname(name, hostname);

  const normalized = normalizeHostname(hostname);

  if (
    !normalized.includes(".") ||
    isInternalHostname(normalized) ||
    isReservedExampleHostname(normalized) ||
    isNonPublicIpv4(normalized)
  ) {
    fail(`${name} must use a public, non-placeholder hostname`);
  }
}

function rejectLocalHostname(name, hostname) {
  const normalized = normalizeHostname(hostname);

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "localhost.localdomain" ||
    normalized.endsWith(".localhost.localdomain") ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  ) {
    fail(`${name} must not use localhost or a loopback address`);
  }
}

function isInternalHostname(hostname) {
  const normalized = normalizeHostname(hostname);

  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")) {
    return false;
  }

  if (normalized.includes(":")) {
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  if (!normalized.includes(".")) {
    return true;
  }

  if (
    normalized.endsWith(".internal") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".lan") ||
    normalized.endsWith(".docker")
  ) {
    return true;
  }

  const octets = normalized.split(".").map(Number);

  if (octets.length === 4 && octets.every((part) => Number.isInteger(part))) {
    return (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    );
  }

  return false;
}

function isReservedExampleHostname(hostname) {
  const normalized = normalizeHostname(hostname);

  return (
    normalized === "example" ||
    normalized.endsWith(".example") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized === "example.net" ||
    normalized.endsWith(".example.net") ||
    normalized === "example.org" ||
    normalized.endsWith(".example.org") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".test")
  );
}

function isNonPublicIpv4(hostname) {
  const octets = hostname.split(".").map(Number);

  if (
    octets.length !== 4 ||
    !octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return false;
  }

  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 0) ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
    (octets[0] === 192 && octets[1] === 88 && octets[2] === 99) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) ||
    (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) ||
    octets[0] >= 224
  );
}

function rejectUrlCredentials(name, url) {
  if (url.username || url.password) {
    fail(`${name} must not include URL credentials`);
  }
}

function rejectCredentialsInHostname(name, url) {
  if (!url.username || !url.password) {
    fail(`${name} must include both username and password`);
  }
}

function normalizeHostname(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.+$/, "");
}

function normalizedPath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function decodedUrlComponent(name, value) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(`${name} contains invalid percent-encoding`);
  }
}

function simpleDatabaseName(name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    fail(`${name} must be a shell-safe PostgreSQL identifier of at most 63 characters`);
  }

  return value;
}

function strongSecret(name, value, minimumLength) {
  if (value.length < minimumLength) {
    fail(`${name} must be at least ${minimumLength} characters`);
  }

  if (looksLikePlaceholder(value)) {
    fail(`${name} must not use a placeholder or known weak value`);
  }

  if (isRepeatedValue(value) || new Set(value).size < 8) {
    fail(`${name} must not use a repeated or low-variety value`);
  }

  return value;
}

function looksLikePlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");

  return (
    COMMON_WEAK_VALUES.has(normalized) ||
    compact.includes("changeme") ||
    compact.includes("replaceme") ||
    compact.includes("placeholder") ||
    /^(?:default|dummy|example|test)(?:[\s_-]|$)/.test(normalized) ||
    normalized.startsWith("your-") ||
    normalized.startsWith("<") ||
    normalized.endsWith(">")
  );
}

function isRepeatedValue(value) {
  const maximumPatternLength = Math.min(32, Math.floor(value.length / 2));

  for (let patternLength = 1; patternLength <= maximumPatternLength; patternLength += 1) {
    if (value.length % patternLength !== 0) {
      continue;
    }

    const pattern = value.slice(0, patternLength);

    if (pattern.repeat(value.length / patternLength) === value) {
      return true;
    }
  }

  return false;
}

function distinctSecrets(entries) {
  const owners = new Map();

  for (const [name, value] of entries) {
    const existingName = owners.get(value);

    if (existingName) {
      fail(`${name} must be different from ${existingName}`);
    }

    owners.set(value, name);
  }
}

function bool(name, rawValue, defaultValue) {
  if (!rawValue) {
    return defaultValue;
  }

  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  fail(`${name} must be "true" or "false"`);
}

function sameSite(name, rawValue, defaultValue) {
  const value = rawValue?.toLowerCase() || defaultValue;

  if (value !== "lax" && value !== "strict" && value !== "none") {
    fail(`${name} must be "lax", "strict", or "none"`);
  }

  return value;
}

function boundedInteger(name, rawValue, defaultValue, minimum, maximum) {
  if (!rawValue) {
    return defaultValue;
  }

  if (!/^(?:0|[1-9]\d*)$/.test(rawValue)) {
    fail(`${name} must be a canonical decimal integer between ${minimum} and ${maximum}`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  return value;
}

function publicPath(name, value) {
  let decodedValue = value;

  try {
    for (let index = 0; index < 2; index += 1) {
      const nextValue = decodeURIComponent(decodedValue);

      if (nextValue === decodedValue) {
        break;
      }

      decodedValue = nextValue;
    }
  } catch {
    fail(`${name} contains invalid percent-encoding`);
  }

  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    decodedValue.startsWith("//") ||
    /[?#\\\u0000-\u001f\u007f]/.test(decodedValue) ||
    decodedValue.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail(`${name} must be a root-relative public path like /brand/logo.png`);
  }
}

function parseEnvValue(rawValue, sourceName, lineNumber) {
  if (!rawValue) {
    return "";
  }

  const quote = rawValue[0];

  if (quote !== '"' && quote !== "'") {
    if (/\s#/.test(rawValue)) {
      fail(`${sourceName}:${lineNumber} must use a standalone comment line`);
    }

    if (rawValue.includes("$")) {
      fail(
        `${sourceName}:${lineNumber} must not use environment interpolation; single-quote a literal dollar sign`,
      );
    }

    return rawValue;
  }

  if (rawValue.length < 2 || rawValue.at(-1) !== quote) {
    fail(`${sourceName}:${lineNumber} contains an unterminated quoted value`);
  }

  const value = rawValue.slice(1, -1);

  if (quote === '"' && (value.includes("$") || value.includes("\\"))) {
    fail(`${sourceName}:${lineNumber} uses unsupported double-quoted expansion`);
  }

  return value;
}

function fail(message) {
  throw new ProductionEnvironmentError(message);
}
