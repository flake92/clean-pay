import pg from "pg";

const { Pool } = pg;

const LEGACY_URL_POOL_PARAMETERS = new Set([
  "application_name",
  "connect_timeout",
  "connection_limit",
  "idle_in_transaction_session_timeout",
  "pool_timeout",
  "statement_timeout",
]);

const ROLE_DEFAULTS = Object.freeze({
  application: Object.freeze({
    applicationName: "clean-pay-app",
    poolMax: 8,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
    queryTimeoutMs: 15_000,
    statementTimeoutMs: 15_000,
    idleTransactionTimeoutMs: 10_000,
    lockTimeoutMs: 5_000,
    prefix: "DATABASE",
  }),
  holdOperator: Object.freeze({
    applicationName: "clean-pay-hold-operator",
    poolMax: 1,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
    queryTimeoutMs: 30_000,
    statementTimeoutMs: 30_000,
    idleTransactionTimeoutMs: 15_000,
    lockTimeoutMs: 15_000,
    prefix: null,
  }),
  readiness: Object.freeze({
    applicationName: "clean-pay-readiness",
    poolMax: 1,
    connectionTimeoutMs: 4_000,
    idleTimeoutMs: 30_000,
    queryTimeoutMs: 4_000,
    statementTimeoutMs: 4_000,
    idleTransactionTimeoutMs: 4_000,
    lockTimeoutMs: 4_000,
    prefix: null,
  }),
  retention: Object.freeze({
    applicationName: "clean-pay-retention",
    poolMax: 2,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
    queryTimeoutMs: 120_000,
    statementTimeoutMs: 120_000,
    idleTransactionTimeoutMs: 15_000,
    lockTimeoutMs: 30_000,
    prefix: "RETENTION_DATABASE",
  }),
});

const POOL_ERROR_ROLES = new Set(Object.keys(ROLE_DEFAULTS));
const SAFE_ERROR_NAMES = new Set([
  "AggregateError",
  "DatabaseError",
  "Error",
  "RangeError",
  "TypeError",
  "error",
]);
const SAFE_NODE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);
const POSTGRES_SQLSTATE = /^[0-9A-Z]{5}$/;

function assertCanonicalDatabaseQueryParameterNames(url) {
  for (const rawName of url.searchParams.keys()) {
    if (rawName !== rawName.toLowerCase()) {
      throw new Error(
        `DATABASE_URL query parameter ${rawName} must use canonical lowercase spelling`,
      );
    }
  }
}

function boundedInteger(env, name, fallback, minimum, maximum) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function assertNoLegacyDatabasePoolUrlParameters(connectionString) {
  const url = new URL(connectionString);
  assertCanonicalDatabaseQueryParameterNames(url);
  for (const name of url.searchParams.keys()) {
    if (LEGACY_URL_POOL_PARAMETERS.has(name.toLowerCase())) {
      throw new Error(
        `DATABASE_URL query parameter ${name} is not supported by the active PrismaPg pool; use the documented role-specific environment setting`,
      );
    }
  }
}

/**
 * PrismaPg does not infer its query schema from an externally supplied
 * pg.Pool. Keep the only supported Prisma-specific URL option effective
 * instead of silently falling back to the connection user's search_path.
 */
export function prismaPgAdapterOptions(connectionString, options = {}) {
  const url = new URL(connectionString);
  assertCanonicalDatabaseQueryParameterNames(url);
  const schemas = url.searchParams.getAll("schema");
  if (schemas.length > 1) {
    throw new Error("DATABASE_URL must not repeat the schema query parameter");
  }
  const schema = schemas[0];
  if (schema !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("DATABASE_URL schema is invalid");
  }
  return Object.freeze({
    ...options,
    ...(schema ? { schema } : {}),
  });
}

/**
 * Returns the effective pg.Pool configuration passed to PrismaPg. The same
 * connection timeout bounds both a new TCP connection and a queued pool
 * acquisition in pg-pool.
 */
export function prismaPgPoolOptions({
  connectionString,
  role,
  env = process.env,
}) {
  const defaults = ROLE_DEFAULTS[role];
  if (!defaults) {
    throw new Error(`Unsupported database role: ${role}`);
  }
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("DATABASE_URL is required");
  }

  assertNoLegacyDatabasePoolUrlParameters(connectionString);
  const prefix = defaults.prefix;
  const configured = (suffix, fallback, minimum, maximum) => prefix
    ? boundedInteger(env, `${prefix}_${suffix}`, fallback, minimum, maximum)
    : fallback;

  return Object.freeze({
    connectionString,
    max: configured("POOL_MAX", defaults.poolMax, 1, 50),
    connectionTimeoutMillis: configured(
      "CONNECTION_TIMEOUT_MS",
      defaults.connectionTimeoutMs,
      250,
      60_000,
    ),
    idleTimeoutMillis: configured(
      "IDLE_TIMEOUT_MS",
      defaults.idleTimeoutMs,
      1_000,
      600_000,
    ),
    query_timeout: configured(
      "QUERY_TIMEOUT_MS",
      defaults.queryTimeoutMs,
      250,
      300_000,
    ),
    statement_timeout: configured(
      "STATEMENT_TIMEOUT_MS",
      defaults.statementTimeoutMs,
      250,
      300_000,
    ),
    idle_in_transaction_session_timeout: configured(
      "IDLE_TRANSACTION_TIMEOUT_MS",
      defaults.idleTransactionTimeoutMs,
      250,
      300_000,
    ),
    options: `-c lock_timeout=${configured(
      "LOCK_TIMEOUT_MS",
      defaults.lockTimeoutMs,
      250,
      300_000,
    )}`,
    application_name: defaults.applicationName,
  });
}

export function createPostgresPool(input) {
  if (input.onError !== undefined && typeof input.onError !== "function") {
    throw new Error("PostgreSQL pool error reporter must be a function");
  }

  const pool = new Pool(prismaPgPoolOptions(input));
  if (input.onError) {
    pool.on("error", (error) => {
      input.onError(postgresPoolErrorTelemetry(input.role, error));
    });
  }
  return pool;
}

/**
 * Projects an arbitrary pg error onto a fixed, low-cardinality telemetry
 * shape. In particular, error messages and driver properties never cross the
 * logging boundary because they can contain SQL, connection strings or PII.
 */
export function postgresPoolErrorTelemetry(role, error) {
  if (!POOL_ERROR_ROLES.has(role)) {
    throw new Error(`Unsupported database role: ${role}`);
  }

  const errorName = typeof error?.name === "string"
    && SAFE_ERROR_NAMES.has(error.name)
    ? error.name
    : "Error";
  const code = typeof error?.code === "string"
    && (
      POSTGRES_SQLSTATE.test(error.code)
      || SAFE_NODE_ERROR_CODES.has(error.code)
    )
    ? error.code
    : "UNKNOWN";

  return Object.freeze({ role, errorName, code });
}

const OBSERVABLE_POOL_ROLES = new Set(["application", "readiness", "retention"]);

function nonNegativeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Reads only documented pg.Pool counters. Role is a fixed allowlisted label,
 * so exposing this snapshot cannot create unbounded Prometheus cardinality.
 */
export function postgresPoolMetrics(pool, role) {
  if (!OBSERVABLE_POOL_ROLES.has(role)) {
    throw new Error(`Unsupported observable database role: ${role}`);
  }

  const total = nonNegativeCount(pool?.totalCount);
  const idle = Math.min(total, nonNegativeCount(pool?.idleCount));
  const waiting = nonNegativeCount(pool?.waitingCount);
  const maximum = Math.max(1, nonNegativeCount(pool?.options?.max));
  const active = Math.max(0, total - idle);

  return Object.freeze({
    role,
    active,
    idle,
    waiting,
    maximum,
    exhausted: waiting > 0 || (active >= maximum && idle === 0) ? 1 : 0,
  });
}
