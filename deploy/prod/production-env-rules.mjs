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
  "schema",
  "sslmode",
]);

const LEGACY_DATABASE_POOL_QUERY_PARAMETERS = new Set([
  "application_name",
  "connect_timeout",
  "connection_limit",
  "idle_in_transaction_session_timeout",
  "pool_timeout",
  "statement_timeout",
]);

const FORBIDDEN_COMPOSE_CONTROL_NAMES = new Set([
  "COMPOSE_ENV_FILES",
  "COMPOSE_FILE",
  "COMPOSE_PROFILES",
]);

const FORBIDDEN_ENV_FILE_METADATA_NAMES = new Set([
  "CLEAN_PAY_BAKED_BRAND_LOGO_URL",
  "CLEAN_PAY_BAKED_BRAND_NAME",
  "CLEAN_PAY_BAKED_PUBLIC_APP_URL",
  "CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID",
]);

// Production env files are also passed to Docker as container env files. Keep
// this list explicit so Node/Docker control variables (for example
// NODE_OPTIONS) cannot be smuggled into a reviewed deployment.
export const PRODUCTION_ENVIRONMENT_FILE_NAMES = Object.freeze([
  "APP_URL",
  "AUDIT_INFO_RETENTION_DAYS",
  "AUDIT_IP_HASH_SECRET",
  "AUDIT_SECURITY_RETENTION_DAYS",
  "AUTH_CONCURRENCY_LIMIT",
  "AUTH_RATE_LIMIT_CAPACITY",
  "AUTH_STATE_RETENTION_DAYS",
  "CHATWOOT_BASE_URL",
  "CHATWOOT_HMAC_TOKEN",
  "CHATWOOT_WEBSITE_TOKEN",
  "CLEAN_PAY_BIND",
  "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED",
  "CLEAN_PAY_DATABASE_ADOPT_EXISTING",
  "CLEAN_PAY_DEPLOY_SOURCE",
  "CLEAN_PAY_EDGE_NETWORK",
  "CLEAN_PAY_IMAGE",
  "CLEAN_PAY_MIGRATION_IMAGE",
  "CLEAN_PAY_MIN_FREE_DISK_MB",
  "CLEAN_PAY_PORT",
  "CLEAN_PAY_READINESS_MAILPIT_URL",
  "CLEAN_PAY_READINESS_REMNAWAVE_URL",
  "CLEAN_PAY_RELEASE",
  "CLEAN_PAY_REVISION",
  "COMPOSE_PROJECT_NAME",
  "COOKIE_SAMESITE",
  "COOKIE_SECURE",
  "DATABASE_URL",
  "DATABASE_CONNECTION_TIMEOUT_MS",
  "DATABASE_IDLE_TIMEOUT_MS",
  "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
  "DATABASE_LOCK_TIMEOUT_MS",
  "DATABASE_POOL_MAX",
  "DATABASE_QUERY_TIMEOUT_MS",
  "DATABASE_STATEMENT_TIMEOUT_MS",
  "DATA_RETENTION_INTERVAL_SECONDS",
  "HOLD_OPERATOR_DATABASE_URL",
  "LOG_LEVEL",
  "MIGRATION_DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_BRAND_LOGO_URL",
  "NEXT_PUBLIC_BRAND_NAME",
  "PAYMENT_RECONCILIATION_BATCH_SIZE",
  "PAYMENT_RECONCILIATION_ENABLED",
  "PAYMENT_RECONCILIATION_INTERNAL_URL",
  "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
  "PAYMENT_RECONCILIATION_SECRET",
  "PAYMENT_REDIRECT_ORIGINS",
  "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
  "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
  "PAYMENT_SENSITIVE_RETENTION_DAYS",
  "POSTGRES_DB",
  "POSTGRES_PASSWORD",
  "POSTGRES_USER",
  "RATE_LIMIT_IDENTITY_SECRET",
  "RATE_LIMIT_RETENTION_DAYS",
  "READINESS_INTERNAL_SECRET",
  "REDIS_URL",
  "REMNASHOP_ADMIN_API_BASE_URL",
  "REMNASHOP_API_BASE_URL",
  "REMNASHOP_API_CONTAINER",
  "REMNASHOP_API_KEY",
  "REMNASHOP_AUTH_SERVICE_KEY",
  "REMNASHOP_DOCKER_NETWORK",
  "REMNASHOP_ENV_EXPECTED_GID",
  "REMNASHOP_ENV_EXPECTED_UID",
  "REMNASHOP_ENV_FILE",
  "REMNASHOP_MINIMUM_ALEMBIC_REVISION",
  "REMNASHOP_POSTGRES_CONTAINER",
  "REMNASHOP_SCHEDULER_CONTAINER",
  "REMNASHOP_WORKER_CONTAINER",
  "REMNAWAVE_API_BASE_URL",
  "REMNAWAVE_SUBSCRIPTION_ORIGINS",
  "REMNAWAVE_TOKEN",
  "RETENTION_DATABASE_CONNECTION_TIMEOUT_MS",
  "RETENTION_DATABASE_IDLE_TIMEOUT_MS",
  "RETENTION_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
  "RETENTION_DATABASE_LOCK_TIMEOUT_MS",
  "RETENTION_DATABASE_POOL_MAX",
  "RETENTION_DATABASE_QUERY_TIMEOUT_MS",
  "RETENTION_DATABASE_STATEMENT_TIMEOUT_MS",
  "RETENTION_DATABASE_URL",
  "SESSION_RETENTION_DAYS",
  "SUPPORT_EMAIL",
  "SUPPORT_ENABLED",
  "SUPPORT_FAQ_URL",
  "SUPPORT_TELEGRAM_USERNAME",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT",
  "TELEGRAM_OIDC_CLIENT_ID",
  "TELEGRAM_OIDC_CLIENT_SECRET",
  "TELEGRAM_OIDC_ISSUER",
  "TELEGRAM_OIDC_JWKS_URI",
  "TELEGRAM_OIDC_TOKEN_ENDPOINT",
  "TRUSTED_PROXY_HOPS",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_VERIFY_URL",
  "WEB_JWT_SECRET",
  "WEB_REFRESH_KEY_ID",
  "WEB_REFRESH_PREVIOUS_KEYS",
  "WEB_REFRESH_SECRET",
]);

const PRODUCTION_ENVIRONMENT_FILE_NAME_SET = new Set(
  PRODUCTION_ENVIRONMENT_FILE_NAMES,
);

export const COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES = Object.freeze([
  "CLEAN_PAY_APP_ENV_FILE",
  "CLEAN_PAY_BIND",
  "CLEAN_PAY_EDGE_NETWORK",
  "CLEAN_PAY_IMAGE",
  "CLEAN_PAY_HOLD_OPERATOR_ENV_FILE",
  "CLEAN_PAY_MIGRATION_ENV_FILE",
  "CLEAN_PAY_MIGRATION_IMAGE",
  "CLEAN_PAY_MIN_FREE_DISK_MB",
  "CLEAN_PAY_PORT",
  "CLEAN_PAY_POSTGRES_ENV_FILE",
  "CLEAN_PAY_PROVISION_ENV_FILE",
  "CLEAN_PAY_RECONCILIATION_ENV_FILE",
  "CLEAN_PAY_RELEASE",
  "CLEAN_PAY_RETENTION_ENV_FILE",
  "CLEAN_PAY_REVISION",
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

    if (FORBIDDEN_ENV_FILE_METADATA_NAMES.has(name)) {
      fail(`${name} is image metadata and must not be set in an env file`);
    }

    if (name === "CLEAN_PAY_BUILD_PHASE") {
      fail("CLEAN_PAY_BUILD_PHASE is build-only and must not be set in an env file");
    }

    if (Object.hasOwn(environment, name)) {
      fail(`${sourceName}:${index + 1} duplicates ${name}`);
    }

    environment[name] = parseEnvValue(rawValue, sourceName, index + 1);
  }

  for (const name of Object.keys(environment)) {
    if (!PRODUCTION_ENVIRONMENT_FILE_NAME_SET.has(name)) {
      fail(
        `${sourceName} contains unsupported runtime variable ${name}; only documented Clean Pay settings are allowed`,
      );
    }
  }

  return environment;
}

export function validateProductionPublicBuildConfiguration(environment) {
  const required = (name) => {
    const value = deploymentEnvironmentValue(environment, name, true);
    return value;
  };

  const appUrl = publicHttpsOrigin(
    "NEXT_PUBLIC_APP_URL",
    required("NEXT_PUBLIC_APP_URL"),
  ).origin;
  const brandName = required("NEXT_PUBLIC_BRAND_NAME");
  const brandLogoUrl = required("NEXT_PUBLIC_BRAND_LOGO_URL");
  const turnstileEnabled = bool(
    "TURNSTILE_ENABLED",
    required("TURNSTILE_ENABLED"),
    false,
  );
  const turnstileSiteKey = required("TURNSTILE_SITE_KEY");

  if (brandName.length > 80 || /[\r\n]/.test(brandName)) {
    fail("NEXT_PUBLIC_BRAND_NAME must contain 1 to 80 characters");
  }

  publicPath("NEXT_PUBLIC_BRAND_LOGO_URL", brandLogoUrl);

  if (!turnstileEnabled) {
    fail("TURNSTILE_ENABLED must be true in a production public build");
  }

  if (
    looksLikePlaceholder(turnstileSiteKey) ||
    KNOWN_TURNSTILE_TEST_KEYS.has(turnstileSiteKey)
  ) {
    fail("TURNSTILE_SITE_KEY must be a real non-test Cloudflare site key");
  }

  if (turnstileSiteKey.length < 20 || /[\r\n]/.test(turnstileSiteKey)) {
    fail("TURNSTILE_SITE_KEY must be a complete Cloudflare site key");
  }

  return Object.freeze({ appUrl, brandName, brandLogoUrl, turnstileSiteKey });
}

export function validateDeploymentImageReferences(environment) {
  const source = deploymentEnvironmentValue(
    environment,
    "CLEAN_PAY_DEPLOY_SOURCE",
    false,
  ) ?? "build";

  if (source !== "build" && source !== "pull") {
    fail('CLEAN_PAY_DEPLOY_SOURCE must be "build" or "pull"');
  }

  const applicationValue = deploymentEnvironmentValue(
    environment,
    "CLEAN_PAY_IMAGE",
    true,
  );
  const migrationValue = deploymentEnvironmentValue(
    environment,
    "CLEAN_PAY_MIGRATION_IMAGE",
    true,
  );

  if (source === "build") {
    const applicationImage = taggedImageReference(
      "CLEAN_PAY_IMAGE",
      applicationValue,
    );
    const migrationImage = taggedImageReference(
      "CLEAN_PAY_MIGRATION_IMAGE",
      migrationValue,
    );

    if (applicationImage === migrationImage) {
      fail("CLEAN_PAY_IMAGE and CLEAN_PAY_MIGRATION_IMAGE must reference different target images");
    }

    return Object.freeze({
      source,
      applicationImage,
      migrationImage,
      applicationDigest: null,
      migrationDigest: null,
    });
  }

  const applicationImage = immutableImageReference(
    "CLEAN_PAY_IMAGE",
    applicationValue,
  );
  const migrationImage = immutableImageReference(
    "CLEAN_PAY_MIGRATION_IMAGE",
    migrationValue,
  );

  if (applicationImage.digest === migrationImage.digest) {
    fail("CLEAN_PAY_IMAGE and CLEAN_PAY_MIGRATION_IMAGE must use different sha256 digests");
  }

  return Object.freeze({
    source,
    applicationImage: applicationImage.reference,
    migrationImage: migrationImage.reference,
    applicationDigest: applicationImage.digest,
    migrationDigest: migrationImage.digest,
  });
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

  const deploymentImages = validateDeploymentImageReferences(environment);
  const imageRelease = imageMetadataValue(
    "CLEAN_PAY_RELEASE",
    optional("CLEAN_PAY_RELEASE") ?? "local",
  );
  const imageRevision = imageMetadataValue(
    "CLEAN_PAY_REVISION",
    optional("CLEAN_PAY_REVISION") ?? "local",
  );
  const localImageMetadata = imageRelease === "local" && imageRevision === "local";

  if ((imageRelease === "local") !== (imageRevision === "local")) {
    fail("CLEAN_PAY_RELEASE and CLEAN_PAY_REVISION must both be local or both be traceable");
  }

  if (!localImageMetadata && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(imageRevision)) {
    fail("CLEAN_PAY_REVISION must be an exact lowercase Git commit hash outside local mode");
  }

  if (deploymentImages.source === "pull" && localImageMetadata) {
    fail("pull mode requires traceable CLEAN_PAY_RELEASE and CLEAN_PAY_REVISION metadata");
  }
  boundedInteger(
    "CLEAN_PAY_MIN_FREE_DISK_MB",
    optional("CLEAN_PAY_MIN_FREE_DISK_MB"),
    8192,
    1,
    1_000_000,
  );

  if (optional("CLEAN_PAY_BUILD_PHASE") === "true") {
    fail("CLEAN_PAY_BUILD_PHASE is build-only and must not be enabled at runtime");
  }

  const remnashopEnvironmentFile = optional("REMNASHOP_ENV_FILE") ?? "/opt/remnashop/.env";
  const remnashopPathSegments = remnashopEnvironmentFile.split("/");
  if (
    !remnashopEnvironmentFile.startsWith("/")
    || /[\0\r\n]/.test(remnashopEnvironmentFile)
    || remnashopPathSegments.some((segment) => segment === "." || segment === "..")
    || remnashopEnvironmentFile.endsWith("/")
  ) {
    fail("REMNASHOP_ENV_FILE must be a normalized absolute file path");
  }
  boundedInteger(
    "REMNASHOP_ENV_EXPECTED_UID",
    optional("REMNASHOP_ENV_EXPECTED_UID"),
    0,
    0,
    2_147_483_647,
  );
  boundedInteger(
    "REMNASHOP_ENV_EXPECTED_GID",
    optional("REMNASHOP_ENV_EXPECTED_GID"),
    0,
    0,
    2_147_483_647,
  );

  const postgresDatabase = simpleDatabaseName("POSTGRES_DB", required("POSTGRES_DB"));
  const postgresUser = simpleDatabaseName("POSTGRES_USER", required("POSTGRES_USER"));
  const postgresPassword = databasePassword(
    "POSTGRES_PASSWORD",
    required("POSTGRES_PASSWORD"),
    24,
  );
  const roleDatabaseUrls = Object.freeze(Object.fromEntries([
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "RETENTION_DATABASE_URL",
    "HOLD_OPERATOR_DATABASE_URL",
  ].map((name) => [
    name,
    validateRoleDatabaseUrl(name, required(name), postgresDatabase),
  ])));
  const databaseIdentities = [
    ["POSTGRES_USER", postgresUser],
    ...Object.entries(roleDatabaseUrls).map(([name, value]) => [
      `${name} username`,
      value.username,
    ]),
  ];
  if (new Set(databaseIdentities.map(([, value]) => value)).size !== databaseIdentities.length) {
    fail("bootstrap, migration, application, retention, and hold operator database usernames must be pairwise distinct");
  }
  const databaseTargets = new Set(
    Object.values(roleDatabaseUrls).map(({ url }) => databaseTargetFingerprint(url)),
  );
  if (databaseTargets.size !== 1) {
    fail("all four database role URLs must target the exact same host, database, schema, and TLS mode");
  }
  distinctSecrets([
    ["POSTGRES_PASSWORD", postgresPassword],
    ...Object.entries(roleDatabaseUrls).map(([name, value]) => [
      `${name} password`,
      value.password,
    ]),
  ]);
  const adoptExisting = bool(
    "CLEAN_PAY_DATABASE_ADOPT_EXISTING",
    optional("CLEAN_PAY_DATABASE_ADOPT_EXISTING") ?? "false",
  );
  const adoptionBackupConfirmed = bool(
    "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED",
    optional("CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED") ?? "false",
  );
  if (adoptionBackupConfirmed && !adoptExisting) {
    fail("CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=true requires CLEAN_PAY_DATABASE_ADOPT_EXISTING=true");
  }
  boundedInteger("DATABASE_POOL_MAX", optional("DATABASE_POOL_MAX"), 8, 1, 50);
  for (const [name, fallback, minimum, maximum] of [
    ["DATABASE_CONNECTION_TIMEOUT_MS", 5_000, 250, 60_000],
    ["DATABASE_IDLE_TIMEOUT_MS", 30_000, 1_000, 600_000],
    ["DATABASE_QUERY_TIMEOUT_MS", 15_000, 250, 300_000],
    ["DATABASE_STATEMENT_TIMEOUT_MS", 15_000, 250, 300_000],
    ["DATABASE_IDLE_TRANSACTION_TIMEOUT_MS", 10_000, 250, 300_000],
    ["DATABASE_LOCK_TIMEOUT_MS", 5_000, 250, 300_000],
  ]) {
    boundedInteger(name, optional(name), fallback, minimum, maximum);
  }
  boundedInteger(
    "RETENTION_DATABASE_POOL_MAX",
    optional("RETENTION_DATABASE_POOL_MAX"),
    2,
    1,
    50,
  );
  for (const [name, fallback, minimum, maximum] of [
    ["RETENTION_DATABASE_CONNECTION_TIMEOUT_MS", 5_000, 250, 60_000],
    ["RETENTION_DATABASE_IDLE_TIMEOUT_MS", 30_000, 1_000, 600_000],
    ["RETENTION_DATABASE_QUERY_TIMEOUT_MS", 120_000, 250, 300_000],
    ["RETENTION_DATABASE_STATEMENT_TIMEOUT_MS", 120_000, 250, 300_000],
    ["RETENTION_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS", 15_000, 250, 300_000],
    ["RETENTION_DATABASE_LOCK_TIMEOUT_MS", 30_000, 250, 300_000],
  ]) {
    boundedInteger(name, optional(name), fallback, minimum, maximum);
  }
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
  publicHttpsOriginList(
    "REMNAWAVE_SUBSCRIPTION_ORIGINS",
    required("REMNAWAVE_SUBSCRIPTION_ORIGINS"),
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
  const remnashopAuthServiceKey = strongSecret(
    "REMNASHOP_AUTH_SERVICE_KEY",
    required("REMNASHOP_AUTH_SERVICE_KEY"),
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
  const webRefreshKeyId = optional("WEB_REFRESH_KEY_ID") ?? "primary";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(webRefreshKeyId)) {
    fail("WEB_REFRESH_KEY_ID must contain 1 to 32 safe key-id characters");
  }
  const previousRefreshKeysRaw = optional("WEB_REFRESH_PREVIOUS_KEYS");
  const previousRefreshKeys = [];
  if (previousRefreshKeysRaw) {
    let parsed;
    try {
      parsed = JSON.parse(previousRefreshKeysRaw);
    } catch {
      fail("WEB_REFRESH_PREVIOUS_KEYS must be a JSON object of key ids to secrets");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("WEB_REFRESH_PREVIOUS_KEYS must be a JSON object of key ids to secrets");
    }
    const entries = Object.entries(parsed);
    if (entries.length === 0 || entries.length > 4) {
      fail("WEB_REFRESH_PREVIOUS_KEYS must contain 1 to 4 previous keys");
    }
    for (const [keyId, secret] of entries) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) {
        fail("WEB_REFRESH_PREVIOUS_KEYS contains an invalid key id");
      }
      if (typeof secret !== "string") {
        fail(`WEB_REFRESH_PREVIOUS_KEYS.${keyId} must be a string`);
      }
      previousRefreshKeys.push([
        `WEB_REFRESH_PREVIOUS_KEYS.${keyId}`,
        strongSecret(`WEB_REFRESH_PREVIOUS_KEYS.${keyId}`, secret, 32),
      ]);
    }
  }
  const auditIpHashSecret = strongSecret(
    "AUDIT_IP_HASH_SECRET",
    required("AUDIT_IP_HASH_SECRET"),
    32,
  );
  boundedInteger(
    "TRUSTED_PROXY_HOPS",
    required("TRUSTED_PROXY_HOPS"),
    undefined,
    1,
    8,
  );
  const rateLimitIdentitySecret = strongSecret(
    "RATE_LIMIT_IDENTITY_SECRET",
    required("RATE_LIMIT_IDENTITY_SECRET"),
    32,
  );
  boundedInteger(
    "AUTH_RATE_LIMIT_CAPACITY",
    required("AUTH_RATE_LIMIT_CAPACITY"),
    undefined,
    100,
    1_000_000,
  );
  boundedInteger(
    "AUTH_CONCURRENCY_LIMIT",
    required("AUTH_CONCURRENCY_LIMIT"),
    undefined,
    1,
    10_000,
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
    true,
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
  boundedInteger(
    "PAYMENT_SENSITIVE_RETENTION_DAYS",
    optional("PAYMENT_SENSITIVE_RETENTION_DAYS"),
    30,
    7,
    365,
  );
  boundedInteger(
    "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
    optional("PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS"),
    90,
    30,
    730,
  );
  boundedInteger(
    "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
    optional("PAYMENT_HOLD_DISPOSED_RETENTION_DAYS"),
    365,
    90,
    2_555,
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

  const paymentRedirectOrigins = optional("PAYMENT_REDIRECT_ORIGINS");
  if (paymentRedirectOrigins) {
    publicHttpsOriginList(
      "PAYMENT_REDIRECT_ORIGINS",
      paymentRedirectOrigins,
    );
  }

  const turnstileEnabled = bool(
    "TURNSTILE_ENABLED",
    optional("TURNSTILE_ENABLED"),
    false,
  );
  const turnstileSiteKey = optional("TURNSTILE_SITE_KEY");
  const turnstileSecretValue = optional("TURNSTILE_SECRET_KEY");
  const turnstileVerifyValue = optional("TURNSTILE_VERIFY_URL");

  if (!turnstileEnabled) {
    fail("TURNSTILE_ENABLED must be true in production");
  }

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

  const bakedTurnstileSiteKey = optional(
    "CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID",
  );

  if (bakedTurnstileSiteKey && bakedTurnstileSiteKey !== turnstileSiteKey) {
    fail(
      "CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID must match TURNSTILE_SITE_KEY; rebuild the image",
    );
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

  const chatwootBaseUrl = optional("CHATWOOT_BASE_URL");
  const chatwootWebsiteToken = optional("CHATWOOT_WEBSITE_TOKEN");
  const chatwootHmacValue = optional("CHATWOOT_HMAC_TOKEN");
  const chatwootConfiguredCount = [
    chatwootBaseUrl,
    chatwootWebsiteToken,
    chatwootHmacValue,
  ].filter(Boolean).length;
  let chatwootHmacToken = null;

  if (chatwootConfiguredCount !== 0 && chatwootConfiguredCount !== 3) {
    fail("CHATWOOT_BASE_URL, CHATWOOT_WEBSITE_TOKEN and CHATWOOT_HMAC_TOKEN must be configured together");
  }

  if (chatwootConfiguredCount === 3) {
    publicHttpsOrigin("CHATWOOT_BASE_URL", chatwootBaseUrl);
    chatwootToken("CHATWOOT_WEBSITE_TOKEN", chatwootWebsiteToken);
    chatwootHmacToken = strongSecret(
      "CHATWOOT_HMAC_TOKEN",
      chatwootToken("CHATWOOT_HMAC_TOKEN", chatwootHmacValue),
      24,
    );
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

  const resolvedBrandName = brandName ?? "Clean Pay";
  const resolvedBrandLogo = brandLogo ?? "/clean-pay-logo.png";
  const bakedBrandName = optional("CLEAN_PAY_BAKED_BRAND_NAME");
  const bakedBrandLogo = optional("CLEAN_PAY_BAKED_BRAND_LOGO_URL");

  if (bakedBrandName && bakedBrandName !== resolvedBrandName) {
    fail("CLEAN_PAY_BAKED_BRAND_NAME must match NEXT_PUBLIC_BRAND_NAME; rebuild the image");
  }
  if (bakedBrandLogo) {
    publicPath("CLEAN_PAY_BAKED_BRAND_LOGO_URL", bakedBrandLogo);
    if (bakedBrandLogo !== resolvedBrandLogo) {
      fail("CLEAN_PAY_BAKED_BRAND_LOGO_URL must match NEXT_PUBLIC_BRAND_LOGO_URL; rebuild the image");
    }
  }

  const bindAddress = optional("CLEAN_PAY_BIND");

  if (bindAddress && bindAddress !== "127.0.0.1" && bindAddress !== "::1") {
    fail("CLEAN_PAY_BIND must be a loopback address in production");
  }

  boundedInteger("CLEAN_PAY_PORT", optional("CLEAN_PAY_PORT"), 4000, 1, 65_535);

  const composeProject = optional("COMPOSE_PROJECT_NAME");
  if (composeProject) {
    composeProjectName("COMPOSE_PROJECT_NAME", composeProject);
  }
  for (const name of [
    "CLEAN_PAY_EDGE_NETWORK",
    "REMNASHOP_DOCKER_NETWORK",
    "REMNASHOP_API_CONTAINER",
    "REMNASHOP_WORKER_CONTAINER",
    "REMNASHOP_SCHEDULER_CONTAINER",
    "REMNASHOP_POSTGRES_CONTAINER",
  ]) {
    const value = optional(name);
    if (value) {
      dockerObjectName(name, value);
    }
  }

  const minimumAlembicRevision = optional("REMNASHOP_MINIMUM_ALEMBIC_REVISION");
  if (minimumAlembicRevision && !/^\d{1,18}$/.test(minimumAlembicRevision)) {
    fail("REMNASHOP_MINIMUM_ALEMBIC_REVISION must be a numeric revision of at most 18 digits");
  }

  const logLevel = optional("LOG_LEVEL");
  if (logLevel && !/^(?:debug|info|warn|error)$/i.test(logLevel)) {
    fail("LOG_LEVEL must be debug, info, warn, or error");
  }

  const secretEntries = [
    ["POSTGRES_PASSWORD", postgresPassword],
    ...Object.entries(roleDatabaseUrls).map(([name, value]) => [
      `${name} password`,
      value.password,
    ]),
    ["REMNASHOP_API_KEY", remnashopApiKey],
    ["REMNASHOP_AUTH_SERVICE_KEY", remnashopAuthServiceKey],
    ["REMNAWAVE_TOKEN", remnawaveToken],
    ["WEB_JWT_SECRET", webJwtSecret],
    ["WEB_REFRESH_SECRET", webRefreshSecret],
    ...previousRefreshKeys,
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

  if (chatwootHmacToken) {
    secretEntries.push(["CHATWOOT_HMAC_TOKEN", chatwootHmacToken]);
  }

  distinctSecrets(secretEntries);
}

const ROLE_SCOPED_FORBIDDEN_DATABASE_NAMES = Object.freeze([
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_INITDB_ARGS",
  "MIGRATION_DATABASE_URL",
  "RETENTION_DATABASE_URL",
  "HOLD_OPERATOR_DATABASE_URL",
]);

function rejectPeerAndBootstrapDatabaseEnvironment(environment) {
  const exposedName = ROLE_SCOPED_FORBIDDEN_DATABASE_NAMES.find((name) =>
    Object.hasOwn(environment, name)
  );
  if (exposedName) {
    fail(
      `${exposedName} must not be present in a role-scoped runtime environment`,
    );
  }
}

export function validateProductionDatabaseRoleEnvironment(environment) {
  rejectPeerAndBootstrapDatabaseEnvironment(environment);
  const value = (name) => {
    const result = environment[name];
    if (typeof result !== "string" || !result || result !== result.trim()) {
      fail(`${name} is required and must not contain surrounding whitespace`);
    }
    return result;
  };
  const rawDatabaseUrl = value("DATABASE_URL");
  const databaseUrl = parsedUrl(
    "DATABASE_URL",
    rawDatabaseUrl,
    ["postgresql:", "postgres:"],
  );
  const database = decodedUrlComponent(
    "DATABASE_URL database",
    databaseUrl.pathname.replace(/^\//, ""),
  );
  validateRoleDatabaseUrl("DATABASE_URL", rawDatabaseUrl, database);
}

export function validateProductionApplicationRoleEnvironment(environment) {
  rejectPeerAndBootstrapDatabaseEnvironment(environment);
  const rawDatabaseUrl = environment.DATABASE_URL;
  if (
    typeof rawDatabaseUrl !== "string"
    || !rawDatabaseUrl
    || rawDatabaseUrl !== rawDatabaseUrl.trim()
  ) {
    fail("DATABASE_URL is required and must not contain surrounding whitespace");
  }
  const databaseUrl = parsedUrl(
    "DATABASE_URL",
    rawDatabaseUrl,
    ["postgresql:", "postgres:"],
  );
  const postgresDatabase = simpleDatabaseName(
    "DATABASE_URL database",
    decodedUrlComponent(
      "DATABASE_URL database",
      databaseUrl.pathname.replace(/^\//, ""),
    ),
  );
  validateRoleDatabaseUrl("DATABASE_URL", rawDatabaseUrl, postgresDatabase);
  const syntheticUrls = [
    ["MIGRATION_DATABASE_URL", "clean_pay_validation_migration", "92b5fd62eb1a441083c021323a8088adf1a25e98d9e0ed6c"],
    ["RETENTION_DATABASE_URL", "clean_pay_validation_retention", "2d90eeb6fde04b8aa3bc03af442192415366a45934f862de"],
    ["HOLD_OPERATOR_DATABASE_URL", "clean_pay_validation_hold", "b8efb671365f44be85e01a41de9a02023c4238bde75dc5e0"],
  ];
  const roleUrls = Object.fromEntries(syntheticUrls.map(([name, username, password]) => {
    const value = new URL(rawDatabaseUrl);
    value.username = username;
    value.password = password;
    return [name, value.toString()];
  }));

  // Runtime containers intentionally receive one role URL only. Reconstruct a
  // non-secret synthetic authoritative view to reuse all application checks
  // without ever injecting bootstrap or peer-role credentials.
  validateProductionEnvironment({
    ...environment,
    ...roleUrls,
    CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED: "false",
    CLEAN_PAY_DATABASE_ADOPT_EXISTING: "false",
    POSTGRES_DB: postgresDatabase,
    POSTGRES_USER: "clean_pay_validation_bootstrap",
    POSTGRES_PASSWORD: "40f3b040a561432b8482d11a7d74901e0c1cf9d92e98c46f",
  });
}

function validateRoleDatabaseUrl(name, rawValue, expectedDatabase) {
  const url = parsedUrl(name, rawValue, ["postgresql:", "postgres:"]);
  rejectCredentialsInHostname(name, url);
  rejectLocalHostname(name, url.hostname);
  const username = simpleDatabaseName(
    `${name} username`,
    decodedUrlComponent(`${name} username`, url.username),
  );
  if (
    username.toLowerCase() === "postgres"
    || username.toLowerCase() === "public"
    || username.toLowerCase().startsWith("pg_")
  ) {
    fail(`${name} username uses a reserved PostgreSQL role name`);
  }
  const password = databasePassword(
    `${name} password`,
    decodedUrlComponent(`${name} password`, url.password),
    24,
  );
  const database = simpleDatabaseName(
    `${name} database`,
    decodedUrlComponent(`${name} database`, url.pathname.replace(/^\//, "")),
  );
  if (database !== expectedDatabase) {
    fail(`${name} database must match POSTGRES_DB`);
  }
  if (!url.hostname || !database || url.hash) {
    fail(`${name} must include a hostname and database without a fragment`);
  }
  validateDatabaseQueryParameters(url, name);
  const schema = url.searchParams.get("schema") ?? "public";
  const normalizedSchema = schema.toLowerCase();
  if (
    normalizedSchema === "information_schema"
    || normalizedSchema === "pg_catalog"
    || normalizedSchema === "pg_toast"
    || normalizedSchema.startsWith("pg_")
  ) {
    fail(`${name} must not target reserved PostgreSQL schema ${schema}`);
  }
  if (normalizeHostname(url.hostname) === "postgres" && url.port && url.port !== "5432") {
    fail(`${name} must use port 5432 for the bundled postgres service`);
  }
  if (!isInternalHostname(url.hostname)) {
    const sslMode = url.searchParams.get("sslmode");
    if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      fail(`${name} for a public host must require TLS with sslmode`);
    }
  }
  return Object.freeze({ database, password, url, username });
}

function databaseTargetFingerprint(url) {
  return JSON.stringify({
    database: decodedUrlComponent(
      "database URL database",
      url.pathname.replace(/^\//, ""),
    ),
    hostname: normalizeHostname(url.hostname),
    port: url.port || "5432",
    protocol: url.protocol,
    schema: url.searchParams.get("schema") ?? "public",
    sslmode: url.searchParams.get("sslmode") ?? "",
  });
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

function validateDatabaseQueryParameters(url, urlName = "DATABASE_URL") {
  const seenParameters = new Set();

  for (const [rawName, value] of url.searchParams) {
    const name = rawName.toLowerCase();

    if (rawName !== name) {
      fail(
        `${urlName} query parameter ${rawName} must use canonical lowercase spelling`,
      );
    }

    if (seenParameters.has(name)) {
      fail(`${urlName} must not repeat the ${rawName} query parameter`);
    }

    seenParameters.add(name);

    if (LEGACY_DATABASE_POOL_QUERY_PARAMETERS.has(name)) {
      fail(
        `${urlName} query parameter ${rawName} is not supported by the active PrismaPg pool; use the documented role-specific environment setting`,
      );
    }

    if (!ALLOWED_DATABASE_QUERY_PARAMETERS.has(name)) {
      fail(`${urlName} query parameter ${rawName} is not allowed`);
    }

    if (name === "schema") {
      simpleDatabaseName(`${urlName} schema`, value);
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

function publicHttpsOriginList(name, value) {
  const entries = value.split(",").map((entry) => entry.trim());

  if (entries.some((entry) => !entry) || entries.length > 32) {
    fail(`${name} must contain 1 to 32 comma-separated HTTPS origins`);
  }

  const origins = entries.map((entry, index) =>
    publicHttpsOrigin(`${name}[${index + 1}]`, entry).origin
  );

  if (new Set(origins).size !== origins.length) {
    fail(`${name} must not contain duplicate origins`);
  }

  return origins;
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

function composeProjectName(name, value) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) {
    fail(`${name} must contain 1 to 63 lowercase letters, digits, dashes, or underscores`);
  }

  return value;
}

function dockerObjectName(name, value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    fail(`${name} must contain 1 to 128 Docker-safe name characters`);
  }

  return value;
}

function chatwootToken(name, value) {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(value)) {
    fail(`${name} must be a complete Chatwoot token`);
  }

  if (looksLikePlaceholder(value)) {
    fail(`${name} must not use a placeholder value`);
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

function databasePassword(name, value, minimumLength) {
  const password = strongSecret(name, value, minimumLength);
  if (/[^\x20-\x7e]/.test(password)) {
    fail(`${name} must contain printable ASCII only`);
  }
  return password;
}

function looksLikePlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");

  return (
    COMMON_WEAK_VALUES.has(normalized) ||
    compact.includes("changeme") ||
    compact.includes("replaceme") ||
    compact.includes("placeholder") ||
    /^(?:default|dummy|example|local(?:[\s_-]+development)?|test)(?:[\s_-]|$)/
      .test(normalized) ||
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

function deploymentEnvironmentValue(environment, name, required) {
  const rawValue = environment[name];

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    if (required) {
      fail(`${name} is required`);
    }

    return null;
  }

  if (typeof rawValue !== "string") {
    fail(`${name} must be a string`);
  }

  if (rawValue !== rawValue.trim()) {
    fail(`${name} must not contain surrounding whitespace`);
  }

  return rawValue;
}

function taggedImageReference(name, value) {
  if (value.includes("@")) {
    fail(`${name} must be a non-digest tagged image reference in build mode`);
  }

  const lastSlash = value.lastIndexOf("/");
  const lastColon = value.lastIndexOf(":");

  if (lastColon <= lastSlash) {
    fail(`${name} must include an explicit tag in build mode`);
  }

  const repository = value.slice(0, lastColon);
  const tag = value.slice(lastColon + 1);

  if (!validImageRepository(repository) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    fail(`${name} must be a valid non-digest tagged image reference in build mode`);
  }

  return value;
}

function immutableImageReference(name, value) {
  const match = /^(.*)@sha256:([a-f0-9]{64})$/.exec(value);

  if (!match) {
    fail(`${name} must be pinned by an exact sha256 digest in pull mode`);
  }

  const [, repository, digest] = match;

  if (!validImageRepository(repository) || repositoryHasTag(repository)) {
    fail(`${name} must be a valid image repository pinned by an exact sha256 digest`);
  }

  return Object.freeze({ reference: value, digest });
}

function repositoryHasTag(repository) {
  return repository.lastIndexOf(":") > repository.lastIndexOf("/");
}

function validImageRepository(repository) {
  if (
    repository.length === 0 ||
    repository.length > 255 ||
    repository.includes("@") ||
    repository.includes("//") ||
    repository.startsWith("/") ||
    repository.endsWith("/")
  ) {
    return false;
  }

  const components = repository.split("/");
  const first = components[0];
  const firstIsRegistry =
    components.length > 1 &&
    (first === "localhost" || first.includes(".") || first.includes(":"));
  const pathComponents = firstIsRegistry ? components.slice(1) : components;

  if (firstIsRegistry && !validImageRegistry(first)) {
    return false;
  }

  return pathComponents.every((component) =>
    /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/.test(component),
  );
}

function validImageRegistry(registry) {
  const separator = registry.lastIndexOf(":");
  const hasPort = separator !== -1;
  const hostname = hasPort ? registry.slice(0, separator) : registry;
  const port = hasPort ? registry.slice(separator + 1) : null;

  if (
    !hostname ||
    hostname.length > 253 ||
    !hostname.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    )
  ) {
    return false;
  }

  if (port !== null) {
    if (!/^[1-9]\d{0,4}$/.test(port)) {
      return false;
    }

    const portNumber = Number(port);

    if (portNumber > 65_535) {
      return false;
    }
  }

  return true;
}

function imageMetadataValue(name, value) {
  if (
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+\/-]{0,127}$/.test(value)
  ) {
    fail(`${name} must be a compact release identifier of 1 to 128 characters`);
  }

  return value;
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
