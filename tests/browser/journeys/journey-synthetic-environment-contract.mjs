import { createHash } from "node:crypto";
import path from "node:path";

import { validateProductionEnvironment } from "../../../runtime/production-env-rules.mjs";

export const JOURNEY_PRODUCTION_ROLE_ENVIRONMENT_NAMES = Object.freeze({
  application: Object.freeze([
    "APP_URL", "AUDIT_IP_HASH_SECRET", "AUTH_CONCURRENCY_LIMIT", "AUTH_RATE_LIMIT_CAPACITY",
    "CHATWOOT_BASE_URL", "CHATWOOT_HMAC_TOKEN", "CHATWOOT_WEBSITE_TOKEN",
    "CLEAN_PAY_DEPLOY_SOURCE", "CLEAN_PAY_IMAGE", "CLEAN_PAY_MIGRATION_IMAGE",
    "CLEAN_PAY_READINESS_MAILPIT_URL", "CLEAN_PAY_READINESS_REMNAWAVE_URL",
    "CLEAN_PAY_RELEASE", "CLEAN_PAY_REVISION", "COOKIE_SAMESITE", "COOKIE_SECURE",
    "DATABASE_CONNECTION_TIMEOUT_MS", "DATABASE_IDLE_TIMEOUT_MS",
    "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS", "DATABASE_LOCK_TIMEOUT_MS", "DATABASE_POOL_MAX",
    "DATABASE_QUERY_TIMEOUT_MS", "DATABASE_STATEMENT_TIMEOUT_MS", "DATABASE_URL", "LOG_LEVEL",
    "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BRAND_LOGO_URL", "NEXT_PUBLIC_BRAND_NAME",
    "PAYMENT_RECONCILIATION_BATCH_SIZE", "PAYMENT_RECONCILIATION_ENABLED",
    "PAYMENT_RECONCILIATION_INTERNAL_URL", "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
    "PAYMENT_RECONCILIATION_SECRET", "PAYMENT_REDIRECT_ORIGINS", "RATE_LIMIT_IDENTITY_SECRET",
    "READINESS_INTERNAL_SECRET", "REDIS_URL", "REMNASHOP_ADMIN_API_BASE_URL",
    "REMNASHOP_API_BASE_URL", "REMNASHOP_API_KEY", "REMNASHOP_AUTH_SERVICE_KEY",
    "REMNAWAVE_API_BASE_URL", "REMNAWAVE_SUBSCRIPTION_ORIGINS", "REMNAWAVE_TOKEN",
    "SUPPORT_EMAIL", "SUPPORT_ENABLED", "SUPPORT_FAQ_URL", "SUPPORT_TELEGRAM_USERNAME",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT", "TELEGRAM_OIDC_CLIENT_ID",
    "TELEGRAM_OIDC_CLIENT_SECRET", "TELEGRAM_OIDC_ISSUER", "TELEGRAM_OIDC_JWKS_URI",
    "TELEGRAM_OIDC_TOKEN_ENDPOINT", "TRUSTED_PROXY_HOPS", "TURNSTILE_ENABLED",
    "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_VERIFY_URL", "WEB_JWT_SECRET",
    "WEB_REFRESH_KEY_ID", "WEB_REFRESH_PREVIOUS_KEYS", "WEB_REFRESH_SECRET",
  ]),
  holdOperator: Object.freeze(["DATABASE_URL"]),
  migration: Object.freeze(["DATABASE_URL"]),
  postgres: Object.freeze(["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]),
  reconciliation: Object.freeze([
    "PAYMENT_RECONCILIATION_ENABLED", "PAYMENT_RECONCILIATION_INTERNAL_URL",
    "PAYMENT_RECONCILIATION_INTERVAL_SECONDS", "PAYMENT_RECONCILIATION_SECRET",
  ]),
  provision: Object.freeze([
    "AUDIT_INFO_RETENTION_DAYS", "AUDIT_SECURITY_RETENTION_DAYS", "AUTH_STATE_RETENTION_DAYS",
    "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED", "CLEAN_PAY_DATABASE_ADOPT_EXISTING",
    "DATABASE_URL", "HOLD_OPERATOR_DATABASE_URL", "MIGRATION_DATABASE_URL",
    "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS", "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
    "PAYMENT_SENSITIVE_RETENTION_DAYS", "POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER",
    "RATE_LIMIT_RETENTION_DAYS", "RETENTION_DATABASE_URL", "SESSION_RETENTION_DAYS",
  ]),
  retention: Object.freeze([
    "AUDIT_INFO_RETENTION_DAYS", "AUDIT_SECURITY_RETENTION_DAYS", "AUTH_STATE_RETENTION_DAYS",
    "DATABASE_URL", "DATA_RETENTION_INTERVAL_SECONDS", "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
    "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS", "PAYMENT_SENSITIVE_RETENTION_DAYS",
    "RATE_LIMIT_RETENTION_DAYS", "RETENTION_DATABASE_CONNECTION_TIMEOUT_MS",
    "RETENTION_DATABASE_IDLE_TIMEOUT_MS", "RETENTION_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
    "RETENTION_DATABASE_LOCK_TIMEOUT_MS", "RETENTION_DATABASE_POOL_MAX",
    "RETENTION_DATABASE_QUERY_TIMEOUT_MS", "RETENTION_DATABASE_STATEMENT_TIMEOUT_MS",
    "SESSION_RETENTION_DAYS",
  ]),
});

export const JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES = Object.freeze([
  ".env",
  ".env.app",
  ".env.browser-observer",
  ".env.browser-observer-provision",
  ".env.hold-operator",
  ".env.migration",
  ".env.postgres",
  ".env.provision",
  ".env.reconciliation",
  ".env.retention",
]);

const exactInputKeys = Object.freeze([
  "appImage",
  "appPort",
  "connectProxyPort",
  "directory",
  "migrationImage",
  "project",
  "providerPort",
  "proxyBind",
  "revision",
  "turnstileSiteKey",
]);

export function buildJourneySyntheticEnvironment(input) {
  assertExactKeys(input, exactInputKeys, "synthetic environment input");
  assertMatch(input.project, /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/, "project");
  assertMatch(input.appImage, /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/, "app image");
  assertMatch(input.migrationImage, /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/, "migration image");
  if (input.appImage === input.migrationImage) fail("Synthetic image references must be distinct.");
  assertMatch(input.revision, /^[a-f0-9]{40}$/, "revision");
  for (const [name, value] of [
    ["app port", input.appPort],
    ["provider port", input.providerPort],
    ["CONNECT proxy port", input.connectProxyPort],
  ]) assertPort(value, name);
  assertMatch(
    input.proxyBind,
    /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/,
    "TLS proxy bind",
  );
  assertMatch(input.turnstileSiteKey, /^[A-Za-z0-9_-]{20,100}$/, "Turnstile site key");
  const directory = path.resolve(input.directory);
  const authoritativePath = path.join(directory, ".env");
  const database = {
    bootstrap: secret("database-bootstrap"),
    application: secret("database-application"),
    migration: secret("database-migration"),
    observer: secret("database-browser-observer"),
    retention: secret("database-retention"),
    hold: secret("database-hold"),
  };
  const environment = {
    COMPOSE_PROJECT_NAME: input.project,
    CLEAN_PAY_MIN_FREE_DISK_MB: "1024",
    CLEAN_PAY_DEPLOY_SOURCE: "build",
    CLEAN_PAY_IMAGE: input.appImage,
    CLEAN_PAY_MIGRATION_IMAGE: input.migrationImage,
    CLEAN_PAY_RELEASE: `browser-journey-${input.revision.slice(0, 12)}`,
    CLEAN_PAY_REVISION: input.revision,
    CLEAN_PAY_BIND: "127.0.0.1",
    CLEAN_PAY_PORT: input.appPort,
    CLEAN_PAY_EDGE_NETWORK: `${input.project}-unused-edge`,
    CLEAN_PAY_APP_ENV_FILE: `${authoritativePath}.app`,
    CLEAN_PAY_BROWSER_DB_OBSERVER_ENV_FILE: `${authoritativePath}.browser-observer`,
    CLEAN_PAY_BROWSER_DB_OBSERVER_PROVISION_ENV_FILE:
      `${authoritativePath}.browser-observer-provision`,
    CLEAN_PAY_HOLD_OPERATOR_ENV_FILE: `${authoritativePath}.hold-operator`,
    CLEAN_PAY_MIGRATION_ENV_FILE: `${authoritativePath}.migration`,
    CLEAN_PAY_POSTGRES_ENV_FILE: `${authoritativePath}.postgres`,
    CLEAN_PAY_PROVISION_ENV_FILE: `${authoritativePath}.provision`,
    CLEAN_PAY_RECONCILIATION_ENV_FILE: `${authoritativePath}.reconciliation`,
    CLEAN_PAY_RETENTION_ENV_FILE: `${authoritativePath}.retention`,
    CLEAN_PAY_BROWSER_PROXY_BIND: input.proxyBind,
    CLEAN_PAY_BROWSER_PROVIDER_BIND: "127.0.0.1",
    CLEAN_PAY_BROWSER_PROVIDER_PORT: input.providerPort,
    POSTGRES_DB: "clean_pay",
    POSTGRES_USER: "clean_pay_bootstrap",
    POSTGRES_PASSWORD: database.bootstrap,
    DATABASE_URL: databaseUrl("clean_pay_app", database.application),
    MIGRATION_DATABASE_URL: databaseUrl("clean_pay_migration", database.migration),
    RETENTION_DATABASE_URL: databaseUrl("clean_pay_retention", database.retention),
    HOLD_OPERATOR_DATABASE_URL: databaseUrl("clean_pay_hold", database.hold),
    CLEAN_PAY_DATABASE_ADOPT_EXISTING: "false",
    CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED: "false",
    DATABASE_POOL_MAX: "8",
    DATABASE_CONNECTION_TIMEOUT_MS: "5000",
    DATABASE_IDLE_TIMEOUT_MS: "30000",
    DATABASE_QUERY_TIMEOUT_MS: "15000",
    DATABASE_STATEMENT_TIMEOUT_MS: "15000",
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "10000",
    DATABASE_LOCK_TIMEOUT_MS: "5000",
    REDIS_URL: "redis://redis:6379/0",
    APP_URL: "https://pay.ci.clean-pay.dev",
    NEXT_PUBLIC_APP_URL: "https://pay.ci.clean-pay.dev",
    NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
    NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
    LOG_LEVEL: "error",
    AUTH_STATE_RETENTION_DAYS: "7",
    SESSION_RETENTION_DAYS: "90",
    AUDIT_INFO_RETENTION_DAYS: "180",
    AUDIT_SECURITY_RETENTION_DAYS: "365",
    RATE_LIMIT_RETENTION_DAYS: "30",
    PAYMENT_SENSITIVE_RETENTION_DAYS: "30",
    PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS: "90",
    PAYMENT_HOLD_DISPOSED_RETENTION_DAYS: "365",
    DATA_RETENTION_INTERVAL_SECONDS: "21600",
    RETENTION_DATABASE_POOL_MAX: "2",
    RETENTION_DATABASE_CONNECTION_TIMEOUT_MS: "5000",
    RETENTION_DATABASE_IDLE_TIMEOUT_MS: "30000",
    RETENTION_DATABASE_QUERY_TIMEOUT_MS: "120000",
    RETENTION_DATABASE_STATEMENT_TIMEOUT_MS: "120000",
    RETENTION_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "15000",
    RETENTION_DATABASE_LOCK_TIMEOUT_MS: "30000",
    REMNASHOP_API_BASE_URL: "https://remnashop.browser.clean-pay.dev/api/v1/public",
    REMNASHOP_ADMIN_API_BASE_URL: "https://remnashop.browser.clean-pay.dev/api/v1/admin",
    REMNASHOP_API_KEY: digest("clean-pay-browser-journey:remnashop-api"),
    REMNASHOP_AUTH_SERVICE_KEY: digest("clean-pay-browser-journey:remnashop-auth"),
    REMNASHOP_API_CONTAINER: "browser-provider-mock",
    REMNASHOP_WORKER_CONTAINER: "browser-provider-mock",
    REMNASHOP_SCHEDULER_CONTAINER: "browser-provider-mock",
    REMNASHOP_POSTGRES_CONTAINER: "postgres",
    REMNASHOP_MINIMUM_ALEMBIC_REVISION: "0058",
    REMNASHOP_ENV_FILE: "/synthetic/not-mounted.env",
    REMNASHOP_ENV_EXPECTED_UID: "0",
    REMNASHOP_ENV_EXPECTED_GID: "0",
    PAYMENT_RECONCILIATION_ENABLED: "false",
    PAYMENT_RECONCILIATION_SECRET: "",
    PAYMENT_RECONCILIATION_BATCH_SIZE: "10",
    PAYMENT_RECONCILIATION_INTERVAL_SECONDS: "30",
    PAYMENT_RECONCILIATION_INTERNAL_URL: "http://app:4000/api/internal/payments/reconcile",
    PAYMENT_REDIRECT_ORIGINS: "https://checkout.browser.clean-pay.dev",
    REMNAWAVE_API_BASE_URL: "https://panel.ci.clean-pay.dev",
    REMNAWAVE_TOKEN: digest("clean-pay-browser-journey:remnawave"),
    REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://subscription.ci.clean-pay.dev",
    WEB_JWT_SECRET: secret("web-jwt"),
    WEB_REFRESH_KEY_ID: "browser-journey-primary",
    WEB_REFRESH_SECRET: secret("web-refresh"),
    AUDIT_IP_HASH_SECRET: secret("audit-ip"),
    TRUSTED_PROXY_HOPS: "1",
    RATE_LIMIT_IDENTITY_SECRET: secret("rate-limit"),
    AUTH_RATE_LIMIT_CAPACITY: "1000",
    AUTH_CONCURRENCY_LIMIT: "64",
    READINESS_INTERNAL_SECRET: secret("readiness"),
    COOKIE_SECURE: "true",
    COOKIE_SAMESITE: "lax",
    TELEGRAM_OIDC_ISSUER: "https://oauth.telegram.org",
    TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT: "https://oauth.telegram.org/auth",
    TELEGRAM_OIDC_TOKEN_ENDPOINT: "https://oauth.telegram.org/token",
    TELEGRAM_OIDC_JWKS_URI: "https://oauth.telegram.org/.well-known/jwks.json",
    TELEGRAM_OIDC_CLIENT_ID: "7654321098",
    TELEGRAM_OIDC_CLIENT_SECRET: digest("clean-pay-browser-journey:telegram-oidc"),
    TELEGRAM_BOT_TOKEN: `7654321098:${digest("clean-pay-browser-journey:telegram-bot")}`,
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SITE_KEY: input.turnstileSiteKey,
    TURNSTILE_SECRET_KEY: digest("clean-pay-browser-journey:turnstile"),
    TURNSTILE_VERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    SUPPORT_ENABLED: "true",
    SUPPORT_EMAIL: "support@clean-pay.dev",
    SUPPORT_TELEGRAM_USERNAME: "cleanpay_support",
    SUPPORT_FAQ_URL: "https://pay.ci.clean-pay.dev/support",
    CHATWOOT_BASE_URL: "https://chatwoot.browser.clean-pay.dev",
    CHATWOOT_WEBSITE_TOKEN: digest("clean-pay-browser-journey:chatwoot-website"),
    CHATWOOT_HMAC_TOKEN: digest("clean-pay-browser-journey:chatwoot-hmac"),
    CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://panel.ci.clean-pay.dev",
    CLEAN_PAY_READINESS_MAILPIT_URL: "",
  };
  validateProductionEnvironment(environment);
  const files = { ".env": assignmentBytes(environment) };
  const databaseSources = {
    application: "DATABASE_URL",
    migration: "MIGRATION_DATABASE_URL",
    retention: "RETENTION_DATABASE_URL",
    holdOperator: "HOLD_OPERATOR_DATABASE_URL",
  };
  for (const [role, names] of Object.entries(JOURNEY_PRODUCTION_ROLE_ENVIRONMENT_NAMES)) {
    const values = {};
    for (const name of names) {
      const sourceName = name === "DATABASE_URL" ? databaseSources[role] ?? name : name;
      if (environment[sourceName] !== undefined) values[name] = environment[sourceName];
    }
    const suffix = role === "application" ? "app"
      : role === "holdOperator" ? "hold-operator"
        : role;
    files[`.env.${suffix}`] = assignmentBytes(values);
  }
  files[".env.browser-observer"] = assignmentBytes({
    DATABASE_URL: databaseUrl("clean_pay_browser_observer", database.observer),
  });
  files[".env.browser-observer-provision"] = assignmentBytes({
    CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD: database.observer,
    CLEAN_PAY_BROWSER_DB_OBSERVER_USER: "clean_pay_browser_observer",
    CLEAN_PAY_BROWSER_DB_SCOPE: input.project,
    PGDATABASE: "clean_pay",
    PGHOST: "postgres",
    PGPASSWORD: database.bootstrap,
    PGPORT: "5432",
    PGUSER: "clean_pay_bootstrap",
  });
  assertExactKeys(files, JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES, "synthetic role files");

  const publicBuildContractSha256 = publicBuildContract(environment);
  const fileHashes = Object.entries(files).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bytes]) => ({ name, sha256: digest(bytes) }));
  const normalizedEnvironment = { ...environment };
  for (const name of [
    "COMPOSE_PROJECT_NAME", "CLEAN_PAY_IMAGE", "CLEAN_PAY_MIGRATION_IMAGE",
    "CLEAN_PAY_RELEASE", "CLEAN_PAY_REVISION", "CLEAN_PAY_PORT",
    "CLEAN_PAY_EDGE_NETWORK", "CLEAN_PAY_BROWSER_PROVIDER_PORT",
    "CLEAN_PAY_BROWSER_PROXY_BIND",
  ]) normalizedEnvironment[name] = `<${name}>`;
  for (const name of Object.keys(normalizedEnvironment).filter((name) => name.endsWith("_ENV_FILE"))) {
    normalizedEnvironment[name] = `<${path.basename(normalizedEnvironment[name])}>`;
  }
  return Object.freeze({
    directory,
    environment: Object.freeze({ ...environment }),
    files: Object.freeze({ ...files }),
    fileContractSha256: hashJson(fileHashes),
    policyContractSha256: hashJson({
      environment: normalizedEnvironment,
      filenames: JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
      productionRoles: JOURNEY_PRODUCTION_ROLE_ENVIRONMENT_NAMES,
      version: 1,
    }),
    productionRoleFileCount: Object.keys(JOURNEY_PRODUCTION_ROLE_ENVIRONMENT_NAMES).length,
    publicBuildContractSha256,
  });
}

export function parseJourneyEnvironmentAssignments(bytes) {
  const source = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  if (source.includes("\r") || !source.endsWith("\n")) fail("Synthetic environment bytes are not canonical.");
  const result = {};
  for (const line of source.split("\n")) {
    if (!line) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(result, match[1])) fail("Synthetic environment assignment is invalid.");
    result[match[1]] = match[2];
  }
  return result;
}

function assignmentBytes(values) {
  return `${Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
}

function databaseUrl(user, password) {
  return `postgresql://${user}:${encodeURIComponent(password)}@postgres:5432/clean_pay?schema=public`;
}

function publicBuildContract(values) {
  const chunks = [];
  for (const value of ["clean-pay-public-build-contract", "1"]) chunks.push(...lengthPrefixed(value));
  for (const name of [
    "NEXT_PUBLIC_APP_URL", "TURNSTILE_ENABLED", "TURNSTILE_SITE_KEY",
    "NEXT_PUBLIC_BRAND_NAME", "NEXT_PUBLIC_BRAND_LOGO_URL",
  ]) chunks.push(...lengthPrefixed(name), ...lengthPrefixed(values[name]));
  return createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
}

function lengthPrefixed(value) {
  const bytes = Buffer.from(value, "utf8");
  const size = Buffer.allocUnsafe(8);
  size.writeBigUInt64BE(BigInt(bytes.length));
  return [size, bytes];
}

function secret(label) {
  return `browser-journey-${label}-${digest(`secret:${label}`)}`;
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashJson(value) {
  return digest(JSON.stringify(value));
}

function assertPort(value, label) {
  assertMatch(String(value), /^\d{4,5}$/, label);
  if (String(Number(value)) !== String(value) || Number(value) > 65_535) fail(`${label} is invalid.`);
}

function assertMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`Synthetic ${label} is invalid.`);
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} keys are not exact.`);
  }
}

function fail(message) {
  throw new Error(message);
}
