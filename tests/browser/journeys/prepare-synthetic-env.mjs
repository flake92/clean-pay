import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PRODUCTION_ROLE_ENVIRONMENT_NAMES } from "../../../deploy/prod/role-env.mjs";
import { validateProductionEnvironment } from "../../../runtime/production-env-rules.mjs";

const destination = requiredPath("CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR");
const repositoryRoot = path.resolve(process.cwd());
if (isWithin(repositoryRoot, destination)) {
  throw new Error("Journey environment output must stay outside the repository.");
}
if (process.env.CLEAN_PAY_BROWSER_SYNTHETIC_ENV_SOURCE) {
  throw new Error("Journey environment is self-contained and refuses external env sources.");
}

const project = requiredValue(
  "CLEAN_PAY_BROWSER_COMPOSE_PROJECT",
  /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/,
);
const appImage = requiredValue(
  "CLEAN_PAY_BROWSER_APP_IMAGE",
  /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/,
);
const migrationImage = requiredValue(
  "CLEAN_PAY_BROWSER_MIGRATION_IMAGE",
  /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/,
);
const revision = requiredValue("CLEAN_PAY_BROWSER_SOURCE_REVISION", /^[a-f0-9]{40}$/);
const appPort = optionalValue("CLEAN_PAY_BROWSER_APP_PORT", "4100", /^\d{4,5}$/);
const providerPort = optionalValue("CLEAN_PAY_BROWSER_PROVIDER_PORT", "13100", /^\d{4,5}$/);
const connectProxyPort = optionalValue(
  "CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT",
  "14444",
  /^\d{4,5}$/,
);
const proxyBind = optionalValue(
  "CLEAN_PAY_BROWSER_PROXY_BIND",
  "127.0.0.2",
  /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/,
);
const turnstileSiteKey = optionalValue(
  "CLEAN_PAY_BROWSER_TURNSTILE_SITE_KEY",
  "0x4AAAAABrowserJourneyOnly8Wp4Jz7Lc2",
  /^[A-Za-z0-9_-]{20,100}$/,
);
const authoritativePath = path.join(destination, ".env");
const observerEnvironmentPath = `${authoritativePath}.browser-observer`;
const observerProvisionEnvironmentPath = `${authoritativePath}.browser-observer-provision`;

const database = {
  bootstrap: secret("database-bootstrap"),
  application: secret("database-application"),
  migration: secret("database-migration"),
  observer: secret("database-browser-observer"),
  retention: secret("database-retention"),
  hold: secret("database-hold"),
};
const environment = {
  COMPOSE_PROJECT_NAME: project,
  CLEAN_PAY_MIN_FREE_DISK_MB: "1024",
  CLEAN_PAY_DEPLOY_SOURCE: "build",
  CLEAN_PAY_IMAGE: appImage,
  CLEAN_PAY_MIGRATION_IMAGE: migrationImage,
  CLEAN_PAY_RELEASE: `browser-journey-${revision.slice(0, 12)}`,
  CLEAN_PAY_REVISION: revision,
  CLEAN_PAY_BIND: "127.0.0.1",
  CLEAN_PAY_PORT: appPort,
  CLEAN_PAY_EDGE_NETWORK: `${project}-unused-edge`,
  CLEAN_PAY_APP_ENV_FILE: `${authoritativePath}.app`,
  CLEAN_PAY_BROWSER_DB_OBSERVER_ENV_FILE: observerEnvironmentPath,
  CLEAN_PAY_BROWSER_DB_OBSERVER_PROVISION_ENV_FILE: observerProvisionEnvironmentPath,
  CLEAN_PAY_HOLD_OPERATOR_ENV_FILE: `${authoritativePath}.hold-operator`,
  CLEAN_PAY_MIGRATION_ENV_FILE: `${authoritativePath}.migration`,
  CLEAN_PAY_POSTGRES_ENV_FILE: `${authoritativePath}.postgres`,
  CLEAN_PAY_PROVISION_ENV_FILE: `${authoritativePath}.provision`,
  CLEAN_PAY_RECONCILIATION_ENV_FILE: `${authoritativePath}.reconciliation`,
  CLEAN_PAY_RETENTION_ENV_FILE: `${authoritativePath}.retention`,
  CLEAN_PAY_BROWSER_PROXY_BIND: proxyBind,
  CLEAN_PAY_BROWSER_PROVIDER_BIND: "127.0.0.1",
  CLEAN_PAY_BROWSER_PROVIDER_PORT: providerPort,
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
  TURNSTILE_SITE_KEY: turnstileSiteKey,
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
await mkdir(destination, { recursive: true, mode: 0o700 });
await chmod(destination, 0o700).catch(() => undefined);
await privateWrite(authoritativePath, assignmentBytes(environment));

const databaseSources = {
  application: "DATABASE_URL",
  migration: "MIGRATION_DATABASE_URL",
  retention: "RETENTION_DATABASE_URL",
  holdOperator: "HOLD_OPERATOR_DATABASE_URL",
};
for (const [role, names] of Object.entries(PRODUCTION_ROLE_ENVIRONMENT_NAMES)) {
  const values = {};
  for (const name of names) {
    const sourceName = name === "DATABASE_URL" ? databaseSources[role] ?? name : name;
    if (environment[sourceName] !== undefined) values[name] = environment[sourceName];
  }
  const suffix = role === "application" ? "app"
    : role === "holdOperator" ? "hold-operator"
      : role;
  await privateWrite(`${authoritativePath}.${suffix}`, assignmentBytes(values));
}

await privateWrite(observerEnvironmentPath, assignmentBytes({
  DATABASE_URL: databaseUrl("clean_pay_browser_observer", database.observer),
}));
await privateWrite(observerProvisionEnvironmentPath, assignmentBytes({
  CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD: database.observer,
  CLEAN_PAY_BROWSER_DB_OBSERVER_USER: "clean_pay_browser_observer",
  CLEAN_PAY_BROWSER_DB_SCOPE: project,
  PGDATABASE: "clean_pay",
  PGHOST: "postgres",
  PGPASSWORD: database.bootstrap,
  PGPORT: "5432",
  PGUSER: "clean_pay_bootstrap",
}));

const publicBuildContractSha256 = publicBuildContract(environment);
await privateWrite(path.join(destination, "browser-journey-contract.json"), `${JSON.stringify({
  schemaVersion: 1,
  kind: "self-contained-synthetic-browser-journey",
  project,
  revision,
  images: {
    application: appImage,
    migration: migrationImage,
  },
  publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
  publications: {
    app: `127.0.0.1:${appPort}`,
    providerControl: `127.0.0.1:${providerPort}`,
    browserTls: `${proxyBind}:443`,
    connectProxy: `127.0.0.1:${connectProxyPort}`,
  },
  secretSource: "deterministic synthetic fixture labels; no external env or credential file",
  ownedStateReset: {
    postgres: "transactional truncate of public application tables; migrations retained; schema has no sequences",
    redis: "flush DB 0 on the project-local redis service",
    scope: "exact COMPOSE_PROJECT_NAME label and internal service DNS only",
  },
}, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  status: "prepared",
  project,
  publicBuildContractSha256,
  roleFileCount: Object.keys(PRODUCTION_ROLE_ENVIRONMENT_NAMES).length,
})}\n`);

function assignmentBytes(values) {
  return `${Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
}

async function privateWrite(target, value) {
  await writeFile(target, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(target, 0o600).catch(() => undefined);
}

function databaseUrl(user, password) {
  return `postgresql://${user}:${encodeURIComponent(password)}@postgres:5432/clean_pay?schema=public`;
}

function publicBuildContract(values) {
  const chunks = [];
  for (const value of ["clean-pay-public-build-contract", "1"]) chunks.push(...lengthPrefixed(value));
  for (const name of [
    "NEXT_PUBLIC_APP_URL",
    "TURNSTILE_ENABLED",
    "TURNSTILE_SITE_KEY",
    "NEXT_PUBLIC_BRAND_NAME",
    "NEXT_PUBLIC_BRAND_LOGO_URL",
  ]) {
    chunks.push(...lengthPrefixed(name), ...lengthPrefixed(values[name]));
  }
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

function requiredPath(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return path.resolve(value);
}

function requiredValue(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`${name} is required and must match ${pattern}.`);
  return value;
}

function optionalValue(name, fallback, pattern) {
  const value = process.env[name]?.trim() || fallback;
  if (!pattern.test(value)) throw new Error(`${name} must match ${pattern}.`);
  return value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
