#!/usr/bin/env node

import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  APPLICATION_COLUMN_INSERTS,
  APPLICATION_COLUMN_SELECTS,
  APPLICATION_COLUMN_UPDATES,
  APPLICATION_TABLE_PRIVILEGES,
  DATABASE_ENVIRONMENT_CONTRACT,
  DATABASE_ENUM_TYPES,
  DATABASE_FUNCTIONS,
  DATABASE_INTERNAL_TABLES,
  DATABASE_PG17_SYSTEM_PUBLIC_ACL_SHA256,
  DATABASE_PRIVILEGE_MANIFEST_VERSION,
  DATABASE_RECOVERY_PREDECESSOR_STATES,
  DATABASE_REVIEWED_CATALOG_STATES,
  DATABASE_SECURITY_CONSTRAINTS,
  DATABASE_SECURITY_INDEXES,
  DATABASE_TABLE_COLUMNS,
  DATABASE_TABLES,
  DATABASE_TRIGGERS,
  HOLD_OPERATOR_COLUMN_INSERTS,
  HOLD_OPERATOR_COLUMN_SELECTS,
  HOLD_OPERATOR_COLUMN_UPDATES,
  HOLD_OPERATOR_TABLE_PRIVILEGES,
  RETENTION_COLUMN_SELECTS,
  RETENTION_COLUMN_UPDATES,
  RETENTION_TABLE_PRIVILEGES,
  ROLE_ENUM_TYPES,
  isReservedPostgresSchema,
} from "./database-privilege-manifest.mjs";

const { Client } = pg;
const LOCK_NAMESPACE = "clean-pay/database-role-provision/v1";
const MIGRATIONS_DIRECTORY = resolve(
  fileURLToPath(new URL("../../prisma/migrations/", import.meta.url)),
);
const REVIEWED_ROLLBACK_MIGRATIONS = new Set([
  "20260718141000_drop_redundant_indexes",
  "20260825010000_add_durable_telegram_callback",
  "20260825210000_add_payment_sensitive_retention",
  "20260825220000_add_payment_retention_hold_lifecycle",
  "20260825230000_guard_retention_mutations",
]);
const REVIEWED_ALTERNATE_MIGRATION_CHECKSUMS = Object.freeze({
  "20260718141000_drop_redundant_indexes": Object.freeze([
    "d7857cdbea5de7e559d305697e25fa7e2eeab37f4c207f940d7d06368bd629d6",
  ]),
});
const ROLE_URLS = Object.freeze({
  application: "DATABASE_URL",
  holdOperator: "HOLD_OPERATOR_DATABASE_URL",
  migration: "MIGRATION_DATABASE_URL",
  retention: "RETENTION_DATABASE_URL",
});
const RUNTIME_ROLE_KEYS = Object.freeze([
  "application",
  "retention",
  "holdOperator",
]);
const TABLE_PRIVILEGES = Object.freeze([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
]);
const COLUMN_PRIVILEGES = Object.freeze([
  "SELECT",
  "INSERT",
  "UPDATE",
  "REFERENCES",
]);
const PG17_PREDEFINED_ROLES = Object.freeze([
  "pg_checkpoint",
  "pg_create_subscription",
  "pg_database_owner",
  "pg_execute_server_program",
  "pg_maintain",
  "pg_monitor",
  "pg_read_all_data",
  "pg_read_all_settings",
  "pg_read_all_stats",
  "pg_read_server_files",
  "pg_signal_backend",
  "pg_stat_scan_tables",
  "pg_use_reserved_connections",
  "pg_write_all_data",
  "pg_write_server_files",
]);
const PG17_PREDEFINED_MEMBERSHIPS = Object.freeze([
  "pg_read_all_settings:pg_monitor",
  "pg_read_all_stats:pg_monitor",
  "pg_stat_scan_tables:pg_monitor",
]);
const RETENTION_POLICY_FIELDS = Object.freeze([
  Object.freeze({
    column: "auth_state_days",
    environment: "AUTH_STATE_RETENTION_DAYS",
    fallback: 7,
    key: "authStateDays",
    maximum: 30,
    minimum: 1,
  }),
  Object.freeze({
    column: "session_days",
    environment: "SESSION_RETENTION_DAYS",
    fallback: 90,
    key: "sessionDays",
    maximum: 365,
    minimum: 30,
  }),
  Object.freeze({
    column: "audit_info_days",
    environment: "AUDIT_INFO_RETENTION_DAYS",
    fallback: 180,
    key: "auditInfoDays",
    maximum: 730,
    minimum: 30,
  }),
  Object.freeze({
    column: "audit_security_days",
    environment: "AUDIT_SECURITY_RETENTION_DAYS",
    fallback: 365,
    key: "auditSecurityDays",
    maximum: 2_555,
    minimum: 90,
  }),
  Object.freeze({
    column: "rate_limit_days",
    environment: "RATE_LIMIT_RETENTION_DAYS",
    fallback: 30,
    key: "rateLimitDays",
    maximum: 180,
    minimum: 1,
  }),
  Object.freeze({
    column: "payment_sensitive_days",
    environment: "PAYMENT_SENSITIVE_RETENTION_DAYS",
    fallback: 30,
    key: "paymentSensitiveDays",
    maximum: 365,
    minimum: 7,
  }),
  Object.freeze({
    column: "payment_operation_snapshot_days",
    environment: "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
    fallback: 90,
    key: "paymentOperationSnapshotDays",
    maximum: 730,
    minimum: 30,
  }),
  Object.freeze({
    column: "payment_hold_disposed_days",
    environment: "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
    fallback: 365,
    key: "paymentHoldDisposedDays",
    maximum: 2_555,
    minimum: 90,
  }),
]);

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${name} is required and must not contain surrounding whitespace`);
  }
  return value;
}

function boundedRetentionDays(environment, field) {
  const raw = environment[field.environment];
  if (raw === undefined || raw === "") return field.fallback;
  if (
    typeof raw !== "string"
    || raw !== raw.trim()
    || !/^[0-9]+$/.test(raw)
  ) {
    throw new Error(`${field.environment} must be an integer without surrounding whitespace`);
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value)
    || value < field.minimum
    || value > field.maximum
  ) {
    throw new Error(
      `${field.environment} must be an integer between ${field.minimum} and ${field.maximum}`,
    );
  }
  return value;
}

function parseRetentionPolicy(environment) {
  const policy = Object.fromEntries(
    RETENTION_POLICY_FIELDS.map((field) => [
      field.key,
      boundedRetentionDays(environment, field),
    ]),
  );
  if (policy.auditSecurityDays < policy.auditInfoDays) {
    throw new Error("AUDIT_SECURITY_RETENTION_DAYS must be at least AUDIT_INFO_RETENTION_DAYS");
  }
  return Object.freeze(policy);
}

function databaseIdentifier(name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${name} must be a PostgreSQL identifier of at most 63 characters`);
  }
  if (value.toLowerCase() === "public" || value.toLowerCase().startsWith("pg_")) {
    throw new Error(`${name} uses a reserved PostgreSQL role name`);
  }
  return value;
}

function decode(name, value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${name} contains invalid percent-encoding`);
  }
}

function strongDatabasePassword(name, value) {
  if (
    value.length < 24
    || /[^\x20-\x7e]/.test(value)
    || /change-me|changeme/i.test(value)
    || ["password", "password123"].includes(value.toLowerCase())
  ) {
    throw new Error(`${name} must contain at least 24 printable ASCII characters and must not be a placeholder`);
  }
  return value;
}

function parseRoleUrl(name, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute PostgreSQL URL`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${name} must use postgresql:// or postgres://`);
  }
  if (!url.hostname || !url.pathname.replace(/^\//, "") || url.hash) {
    throw new Error(`${name} must include a host and database and no fragment`);
  }
  const seen = new Set();
  for (const [rawParameter] of url.searchParams) {
    const parameter = rawParameter.toLowerCase();
    if (rawParameter !== parameter || seen.has(parameter)) {
      throw new Error(`${name} query parameters must be unique and lowercase`);
    }
    if (!["schema", "sslmode"].includes(parameter)) {
      throw new Error(`${name} query parameter ${rawParameter} is not allowed`);
    }
    seen.add(parameter);
  }
  const role = databaseIdentifier(
    `${name} username`,
    decode(`${name} username`, url.username),
  );
  if (role.toLowerCase() === "postgres") {
    throw new Error(`${name} must not use the PostgreSQL bootstrap role`);
  }
  const password = strongDatabasePassword(
    `${name} password`,
    decode(`${name} password`, url.password),
  );
  const database = decode(`${name} database`, url.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database)) {
    throw new Error(`${name} database must be a PostgreSQL identifier`);
  }
  if (["postgres", "template0", "template1"].includes(database.toLowerCase())) {
    throw new Error(`${name} must target a dedicated application database`);
  }
  const schema = url.searchParams.get("schema") || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(`${name} schema must be a PostgreSQL identifier`);
  }
  if (isReservedPostgresSchema(schema)) {
    throw new Error(`${name} must not target reserved PostgreSQL schema ${schema}`);
  }
  return Object.freeze({ database, password, raw, role, schema, url });
}

function targetFingerprint(parsed) {
  return JSON.stringify({
    database: parsed.database,
    host: parsed.url.hostname.toLowerCase(),
    port: parsed.url.port || "5432",
    protocol: parsed.url.protocol,
    schema: parsed.schema,
    sslmode: parsed.url.searchParams.get("sslmode") || "",
  });
}

export function parseDatabaseRoleConfiguration(environment = process.env) {
  const roles = Object.fromEntries(
    Object.entries(ROLE_URLS).map(([roleKey, name]) => [
      roleKey,
      parseRoleUrl(name, required(environment, name)),
    ]),
  );
  const fingerprints = new Set(Object.values(roles).map(targetFingerprint));
  if (fingerprints.size !== 1) {
    throw new Error("all four database role URLs must target the exact same host, database, schema, and TLS mode");
  }
  const bootstrapRole = databaseIdentifier(
    "POSTGRES_USER",
    required(environment, "POSTGRES_USER"),
  );
  const bootstrapPassword = strongDatabasePassword(
    "POSTGRES_PASSWORD",
    required(environment, "POSTGRES_PASSWORD"),
  );
  const bootstrapDatabase = required(environment, "POSTGRES_DB");
  if (bootstrapDatabase !== roles.application.database) {
    throw new Error("POSTGRES_DB must match the database in every role URL");
  }
  const roleNames = [bootstrapRole, ...Object.values(roles).map(({ role }) => role)];
  if (new Set(roleNames).size !== roleNames.length) {
    throw new Error("bootstrap, migration, application, retention, and hold operator roles must be pairwise distinct");
  }
  const passwords = [
    bootstrapPassword,
    ...Object.values(roles).map(({ password }) => password),
  ];
  if (new Set(passwords).size !== passwords.length) {
    throw new Error("all five database identities must use distinct passwords");
  }
  const bootstrapUrl = new URL(roles.application.raw);
  bootstrapUrl.username = bootstrapRole;
  bootstrapUrl.password = bootstrapPassword;
  return Object.freeze({
    bootstrap: Object.freeze({
      database: bootstrapDatabase,
      password: bootstrapPassword,
      raw: bootstrapUrl.toString(),
      role: bootstrapRole,
      schema: roles.application.schema,
    }),
    retentionPolicy: parseRetentionPolicy(environment),
    roles: Object.freeze(roles),
  });
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function quoteLiteral(value) {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("PostgreSQL literal contains a forbidden control character");
  }
  return `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

export function generateScramVerifier(
  password,
  { iterations = 4_096, salt = randomBytes(16) } = {},
) {
  if (typeof password !== "string" || /[^\x20-\x7e]/.test(password)) {
    throw new Error("SCRAM verifier password must contain printable ASCII only");
  }
  if (!Buffer.isBuffer(salt) || salt.length < 16 || iterations !== 4_096) {
    throw new Error("SCRAM verifier requires a 16-byte salt and 4096 iterations");
  }
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword)
    .update("Server Key")
    .digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export function scramVerifierMatchesPassword(verifier, password) {
  const match = typeof verifier === "string"
    ? /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier)
    : null;
  if (!match || Number(match[1]) !== 4_096) return false;
  try {
    const salt = Buffer.from(match[2], "base64");
    const expected = generateScramVerifier(password, { iterations: 4_096, salt });
    const actualBytes = Buffer.from(verifier, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    return actualBytes.length === expectedBytes.length
      && timingSafeEqual(actualBytes, expectedBytes);
  } catch {
    return false;
  }
}

function qualified(schema, name) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function normalizeCatalogText(value, schema) {
  if (value === null || value === undefined) return value;
  const quotedPrefix = `${quoteIdentifier(schema)}.`;
  const barePrefix = `${schema}.`;
  return String(value)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(quotedPrefix, "<target>.")
    .replaceAll(barePrefix, "<target>.");
}

function normalizeFunctionConfiguration(configuration, schema) {
  if (!Array.isArray(configuration)) return configuration;
  const exactSearchPaths = new Set([
    `search_path=pg_catalog, ${schema}`,
    `search_path=pg_catalog, ${quoteIdentifier(schema)}`,
  ]);
  return configuration.map((setting) => exactSearchPaths.has(setting)
    ? "search_path=pg_catalog, <target>"
    : normalizeCatalogText(setting, schema));
}

function stableCatalogValue(value) {
  if (Array.isArray(value)) return value.map(stableCatalogValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableCatalogValue(child)]),
    );
  }
  return value;
}

export function canonicalCatalogFingerprint(snapshot) {
  return createHash("sha256")
    .update(JSON.stringify(stableCatalogValue(snapshot)))
    .digest("hex");
}

export async function buildCanonicalCatalogSnapshot(client, schema) {
  const queryRows = async (sql) => (await client.query(sql, [schema])).rows;
  const relations = await queryRows(`
    SELECT relation.relname AS name, relation.relkind AS kind,
           relation.relpersistence AS persistence,
           relation.relreplident AS replica_identity,
           ARRAY(
             SELECT option::text
               FROM unnest(COALESCE(relation.reloptions, ARRAY[]::text[])) option
              ORDER BY option
           )::text[] AS options,
           tablespace.spcname AS tablespace,
           access_method.amname AS access_method,
           relation.relrowsecurity AS row_security,
           relation.relforcerowsecurity AS force_row_security,
           relation.relispartition AS is_partition,
           relation.relispopulated AS is_populated,
           of_type_namespace.nspname AS of_type_schema,
           of_type.typname AS of_type_name,
           relation.reltoastrelid <> 0 AS has_toast,
           toast_relation.relpersistence AS toast_persistence,
           ARRAY(
             SELECT option::text
               FROM unnest(COALESCE(toast_relation.reloptions, ARRAY[]::text[])) option
              ORDER BY option
           )::text[] AS toast_options,
           toast_tablespace.spcname AS toast_tablespace,
           toast_access_method.amname AS toast_access_method,
           pg_get_partkeydef(relation.oid) AS partition_key,
           pg_get_expr(relation.relpartbound, relation.oid, false) AS partition_bound
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_tablespace tablespace ON tablespace.oid = relation.reltablespace
      LEFT JOIN pg_am access_method ON access_method.oid = relation.relam
      LEFT JOIN pg_type of_type ON of_type.oid = relation.reloftype
      LEFT JOIN pg_namespace of_type_namespace
        ON of_type_namespace.oid = of_type.typnamespace
      LEFT JOIN pg_class toast_relation
        ON toast_relation.oid = relation.reltoastrelid
      LEFT JOIN pg_tablespace toast_tablespace
        ON toast_tablespace.oid = toast_relation.reltablespace
      LEFT JOIN pg_am toast_access_method
        ON toast_access_method.oid = toast_relation.relam
     WHERE namespace.nspname = $1
       AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
     ORDER BY relation.relname
  `);
  const columns = await queryRows(`
    SELECT relation.relname AS table_name, attribute.attnum AS position,
           attribute.attname::text AS name,
           format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
           attribute.attnotnull AS not_null,
           attribute.attndims AS dimensions,
           attribute.attidentity AS identity,
           attribute.attgenerated AS generated,
           attribute.attstorage AS storage,
           attribute.attcompression AS compression,
           attribute.attstattarget AS statistics_target,
           attribute.atthasmissing AS has_missing,
           attribute.attinhcount AS inheritance_count,
           attribute.attislocal AS is_local,
           ARRAY(
             SELECT option::text
               FROM unnest(COALESCE(attribute.attoptions, ARRAY[]::text[])) option
              ORDER BY option
           )::text[] AS options,
           ARRAY(
             SELECT option::text
               FROM unnest(COALESCE(attribute.attfdwoptions, ARRAY[]::text[])) option
              ORDER BY option
           )::text[] AS foreign_options,
           collation_namespace.nspname AS collation_schema,
           catalog_collation.collname AS collation_name,
           catalog_collation.collprovider AS collation_provider,
           catalog_collation.collencoding AS collation_encoding,
           catalog_collation.collisdeterministic AS collation_deterministic,
           catalog_collation.collcollate AS collation_collate,
           catalog_collation.collctype AS collation_ctype,
           catalog_collation.colllocale AS collation_locale,
           catalog_collation.collicurules AS collation_rules,
           catalog_collation.collversion AS collation_version,
           pg_collation_actual_version(catalog_collation.oid) AS collation_actual_version,
           pg_get_expr(default_value.adbin, default_value.adrelid, false) AS default_expression
      FROM pg_attribute attribute
      JOIN pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid
       AND default_value.adnum = attribute.attnum
      LEFT JOIN pg_collation catalog_collation
        ON catalog_collation.oid = attribute.attcollation
      LEFT JOIN pg_namespace collation_namespace
        ON collation_namespace.oid = catalog_collation.collnamespace
     WHERE namespace.nspname = $1
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY relation.relname, attribute.attnum
  `);
  const collations = await queryRows(`
    SELECT catalog_collation.collname AS name,
           catalog_collation.collprovider AS provider,
           catalog_collation.collencoding AS encoding,
           catalog_collation.collisdeterministic AS deterministic,
           catalog_collation.collcollate AS collate,
           catalog_collation.collctype AS ctype,
           catalog_collation.colllocale AS locale,
           catalog_collation.collicurules AS rules,
           catalog_collation.collversion AS version,
           pg_collation_actual_version(catalog_collation.oid) AS actual_version
      FROM pg_collation catalog_collation
      JOIN pg_namespace namespace
        ON namespace.oid = catalog_collation.collnamespace
     WHERE namespace.nspname = $1
     ORDER BY catalog_collation.collname
  `);
  const constraints = await queryRows(`
    SELECT relation.relname AS table_name, catalog_constraint.conname AS name,
           catalog_constraint.contype AS type,
           pg_get_constraintdef(catalog_constraint.oid, false) AS definition,
           catalog_constraint.convalidated AS validated,
           catalog_constraint.condeferrable AS deferrable,
           catalog_constraint.condeferred AS deferred,
           catalog_constraint.connoinherit AS no_inherit,
           catalog_constraint.conislocal AS is_local,
           catalog_constraint.coninhcount AS inheritance_count,
           parent_relation.relname AS parent_table,
           parent_constraint.conname AS parent_constraint
      FROM pg_constraint catalog_constraint
      JOIN pg_class relation ON relation.oid = catalog_constraint.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_constraint parent_constraint
        ON parent_constraint.oid = catalog_constraint.conparentid
      LEFT JOIN pg_class parent_relation
        ON parent_relation.oid = parent_constraint.conrelid
     WHERE namespace.nspname = $1
     ORDER BY relation.relname, catalog_constraint.conname
  `);
  const indexes = await queryRows(`
    SELECT relation.relname AS table_name, index_relation.relname AS name,
           access_method.amname AS access_method,
           pg_get_indexdef(index_relation.oid, 0, false) AS definition,
           catalog_index.indisunique AS unique,
           catalog_index.indisprimary AS primary,
           catalog_index.indisexclusion AS exclusion,
           catalog_index.indimmediate AS immediate,
           catalog_index.indisvalid AS valid,
           catalog_index.indisready AS ready,
           catalog_index.indislive AS live,
           catalog_index.indisclustered AS clustered,
           catalog_index.indisreplident AS replica_identity,
           catalog_index.indnullsnotdistinct AS nulls_not_distinct,
           catalog_index.indcheckxmin AS check_xmin,
           ARRAY(
             SELECT option::text
               FROM unnest(COALESCE(index_relation.reloptions, ARRAY[]::text[])) option
              ORDER BY option
           )::text[] AS options,
           tablespace.spcname AS tablespace
      FROM pg_index catalog_index
      JOIN pg_class relation ON relation.oid = catalog_index.indrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_class index_relation ON index_relation.oid = catalog_index.indexrelid
      JOIN pg_am access_method ON access_method.oid = index_relation.relam
      LEFT JOIN pg_tablespace tablespace ON tablespace.oid = index_relation.reltablespace
     WHERE namespace.nspname = $1
     ORDER BY relation.relname, index_relation.relname
  `);
  const types = await queryRows(`
    SELECT type.typname AS name, type.typtype AS kind,
           format_type(type.oid, NULL) AS formatted_type,
           type.typnotnull AS not_null,
           type.typdefault AS default_value,
           ARRAY(
             SELECT enum.enumlabel::text
               FROM pg_enum enum
              WHERE enum.enumtypid = type.oid
              ORDER BY enum.enumsortorder
           )::text[] AS enum_values
      FROM pg_type type
      JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
     WHERE namespace.nspname = $1
       AND (
         type.typtype IN ('e', 'd', 'r', 'm')
         OR (
           type.typtype = 'c'
           AND EXISTS (
             SELECT 1 FROM pg_class composite
              WHERE composite.oid = type.typrelid AND composite.relkind = 'c'
           )
         )
       )
     ORDER BY type.typname
  `);
  const functions = await queryRows(`
    SELECT function.proname AS name,
           pg_get_function_identity_arguments(function.oid) AS identity_arguments,
           pg_get_function_result(function.oid) AS return_type,
           function.prokind AS kind, language.lanname AS language,
           function.prosecdef AS security_definer,
           function.proleakproof AS leakproof,
           function.proisstrict AS strict,
           function.provolatile AS volatility,
           function.proparallel AS parallel,
           function.proconfig AS configuration,
           function.prosrc AS source
      FROM pg_proc function
      JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
      JOIN pg_language language ON language.oid = function.prolang
     WHERE namespace.nspname = $1
     ORDER BY function.proname, pg_get_function_identity_arguments(function.oid)
  `);
  const triggers = await queryRows(`
    SELECT relation.relname AS table_name,
           CASE WHEN trigger.tgisinternal THEN NULL ELSE trigger.tgname END AS name,
           CASE WHEN trigger.tgisinternal THEN NULL
                ELSE pg_get_triggerdef(trigger.oid, false) END AS definition,
           trigger.tgenabled AS enabled,
           trigger.tgisinternal AS internal,
           trigger.tgtype AS type,
           trigger.tgattr::text AS attribute_numbers,
           pg_get_expr(trigger.tgqual, trigger.tgrelid, false) AS condition,
           trigger.tgqual IS NULL AS condition_free,
           encode(trigger.tgargs, 'hex') AS arguments_hex,
           trigger.tgoldtable AS old_transition_table,
           trigger.tgnewtable AS new_transition_table,
           trigger.tgdeferrable AS deferrable,
           trigger.tginitdeferred AS initially_deferred,
           trigger.tgparentid = 0 AS parent_free,
           catalog_constraint.conname AS constraint_name,
           function_namespace.nspname AS function_schema,
           function.proname AS function_name,
           pg_get_function_identity_arguments(function.oid) AS function_arguments
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc function ON function.oid = trigger.tgfoid
      JOIN pg_namespace function_namespace
        ON function_namespace.oid = function.pronamespace
      LEFT JOIN pg_constraint catalog_constraint
        ON catalog_constraint.oid = trigger.tgconstraint
     WHERE namespace.nspname = $1
     ORDER BY relation.relname, catalog_constraint.conname,
              function.proname, trigger.tgtype, trigger.tgname
  `);
  const rules = await queryRows(`
    SELECT relation.relname AS table_name, rule.rulename AS name,
           rule.ev_enabled AS enabled,
           rule.is_instead AS instead,
           rule.ev_type AS event_type,
           pg_get_ruledef(rule.oid, false) AS definition
      FROM pg_rewrite rule
      JOIN pg_class relation ON relation.oid = rule.ev_class
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
     ORDER BY relation.relname, rule.rulename
  `);
  const policies = await queryRows(`
    SELECT relation.relname AS table_name, policy.polname AS name,
           policy.polcmd AS command, policy.polpermissive AS permissive,
           ARRAY(
             SELECT CASE WHEN selected.role_oid = 0 THEN 'PUBLIC'
                         ELSE COALESCE(role.rolname, '<dropped-role>') END
               FROM unnest(policy.polroles) WITH ORDINALITY selected(role_oid, position)
               LEFT JOIN pg_roles role ON role.oid = selected.role_oid
              ORDER BY selected.position
           )::text[] AS roles,
           pg_get_expr(policy.polqual, policy.polrelid, false) AS using_expression,
           pg_get_expr(policy.polwithcheck, policy.polrelid, false) AS check_expression
      FROM pg_policy policy
      JOIN pg_class relation ON relation.oid = policy.polrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
     ORDER BY relation.relname, policy.polname
  `);
  const operators = await queryRows(`
    SELECT operator.oprname AS name,
           format_type(operator.oprleft, NULL) AS left_type,
           format_type(operator.oprright, NULL) AS right_type,
           format_type(operator.oprresult, NULL) AS result_type
      FROM pg_operator operator
      JOIN pg_namespace namespace ON namespace.oid = operator.oprnamespace
     WHERE namespace.nspname = $1
     ORDER BY operator.oprname, operator.oprleft, operator.oprright
  `);
  const casts = await queryRows(`
    SELECT format_type(cast_catalog.castsource, NULL) AS source_type,
           format_type(cast_catalog.casttarget, NULL) AS target_type,
           cast_catalog.castcontext AS context,
           cast_catalog.castmethod AS method,
           CASE WHEN cast_catalog.castfunc = 0 THEN NULL
                ELSE function_namespace.nspname END AS function_schema,
           CASE WHEN cast_catalog.castfunc = 0 THEN NULL
                ELSE function.proname END AS function_name,
           CASE WHEN cast_catalog.castfunc = 0 THEN NULL
                ELSE pg_get_function_identity_arguments(function.oid) END
             AS function_arguments
      FROM pg_cast cast_catalog
      JOIN pg_type source_type ON source_type.oid = cast_catalog.castsource
      JOIN pg_namespace source_namespace
        ON source_namespace.oid = source_type.typnamespace
      JOIN pg_type target_type ON target_type.oid = cast_catalog.casttarget
      JOIN pg_namespace target_namespace
        ON target_namespace.oid = target_type.typnamespace
      LEFT JOIN pg_proc function ON function.oid = cast_catalog.castfunc
      LEFT JOIN pg_namespace function_namespace
        ON function_namespace.oid = function.pronamespace
     WHERE source_namespace.nspname = $1 OR target_namespace.nspname = $1
     ORDER BY cast_catalog.castsource, cast_catalog.casttarget
  `);
  const operatorClasses = await queryRows(`
    SELECT operator_class.opcname AS name,
           access_method.amname AS access_method,
           format_type(operator_class.opcintype, NULL) AS input_type,
           operator_class.opcdefault AS is_default,
           operator_family.opfname AS family
      FROM pg_opclass operator_class
      JOIN pg_namespace namespace
        ON namespace.oid = operator_class.opcnamespace
      JOIN pg_am access_method ON access_method.oid = operator_class.opcmethod
      JOIN pg_opfamily operator_family
        ON operator_family.oid = operator_class.opcfamily
     WHERE namespace.nspname = $1
     ORDER BY operator_class.opcname, access_method.amname
  `);
  const operatorFamilies = await queryRows(`
    SELECT operator_family.opfname AS name,
           access_method.amname AS access_method
      FROM pg_opfamily operator_family
      JOIN pg_namespace namespace
        ON namespace.oid = operator_family.opfnamespace
      JOIN pg_am access_method ON access_method.oid = operator_family.opfmethod
     WHERE namespace.nspname = $1
     ORDER BY operator_family.opfname, access_method.amname
  `);
  const conversions = await queryRows(`
    SELECT conversion.conname AS name,
           pg_encoding_to_char(conversion.conforencoding) AS source_encoding,
           pg_encoding_to_char(conversion.contoencoding) AS target_encoding,
           conversion.condefault AS is_default,
           function_namespace.nspname AS function_schema,
           function.proname AS function_name
      FROM pg_conversion conversion
      JOIN pg_namespace namespace ON namespace.oid = conversion.connamespace
      JOIN pg_proc function ON function.oid = conversion.conproc
      JOIN pg_namespace function_namespace
        ON function_namespace.oid = function.pronamespace
     WHERE namespace.nspname = $1
     ORDER BY conversion.conname
  `);
  const extendedStatistics = await queryRows(`
    SELECT statistics.stxname AS name,
           relation.relname AS table_name,
           statistics.stxkind::text AS kinds,
           pg_get_statisticsobjdef(statistics.oid) AS definition
      FROM pg_statistic_ext statistics
      JOIN pg_namespace namespace ON namespace.oid = statistics.stxnamespace
      JOIN pg_class relation ON relation.oid = statistics.stxrelid
     WHERE namespace.nspname = $1
     ORDER BY statistics.stxname
  `);
  const textSearchObjects = await queryRows(`
    SELECT kind, name
      FROM (
        SELECT 'configuration'::text AS kind, configuration.cfgname AS name
          FROM pg_ts_config configuration
          JOIN pg_namespace namespace ON namespace.oid = configuration.cfgnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'dictionary', dictionary.dictname
          FROM pg_ts_dict dictionary
          JOIN pg_namespace namespace ON namespace.oid = dictionary.dictnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'parser', parser.prsname
          FROM pg_ts_parser parser
          JOIN pg_namespace namespace ON namespace.oid = parser.prsnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'template', template.tmplname
          FROM pg_ts_template template
          JOIN pg_namespace namespace ON namespace.oid = template.tmplnamespace
         WHERE namespace.nspname = $1
      ) objects
     ORDER BY kind, name
  `);
  const normalizeField = (key, value) => {
    if (key === "configuration") {
      return normalizeFunctionConfiguration(value, schema);
    }
    if (typeof value !== "string") return value;
    if (key.endsWith("_schema") && value === schema) return "<target>";
    return normalizeCatalogText(value, schema);
  };
  const normalizeRows = (rows) => rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeField(key, value)]),
  ));
  const staleColumnCollation = columns.find((column) =>
    column.collation_version !== column.collation_actual_version);
  const staleTargetCollation = collations.find((collation) =>
    collation.version !== collation.actual_version);
  if (staleColumnCollation || staleTargetCollation) {
    throw new Error("database catalog contains a collation with a stale provider version");
  }
  return Object.freeze({
    casts: normalizeRows(casts),
    collations: normalizeRows(collations),
    columns: normalizeRows(columns),
    constraints: normalizeRows(constraints),
    conversions: normalizeRows(conversions),
    extendedStatistics: normalizeRows(extendedStatistics),
    functions: functions.map((fn) => ({
      ...Object.fromEntries(
        Object.entries(fn)
          .filter(([key]) => key !== "source")
          .map(([key, value]) => [
            key,
            normalizeField(key, value),
          ]),
      ),
      source: normalizedSourceSha256(fn.source, schema),
    })),
    indexes: normalizeRows(indexes),
    operatorClasses: normalizeRows(operatorClasses),
    operatorFamilies: normalizeRows(operatorFamilies),
    operators: normalizeRows(operators),
    policies: normalizeRows(policies),
    relations: normalizeRows(relations),
    rules: normalizeRows(rules),
    textSearchObjects: normalizeRows(textSearchObjects),
    triggers: normalizeRows(triggers),
    types: normalizeRows(types),
  });
}

function reviewedMigrationPlan() {
  return readdirSync(MIGRATIONS_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => {
      const sql = readFileSync(resolve(MIGRATIONS_DIRECTORY, name, "migration.sql"));
      const text = sql.toString("utf8");
      if (text.includes("\r")) {
        throw new Error(`packaged migration ${name} must use exact LF line endings`);
      }
      return Object.freeze({
        checksum: createHash("sha256").update(sql).digest("hex"),
        name,
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function reviewedChecksums(migration) {
  return new Set([
    migration.checksum,
    ...(REVIEWED_ALTERNATE_MIGRATION_CHECKSUMS[migration.name] ?? []),
  ]);
}

const REVIEWED_LEDGER_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * @param {Array<Record<string, any>>} rows
 * @param {Array<{name: string, checksum: string}>} migrationPlan
 * @param {{unresolvedMigration?: string | null}} [options]
 */
export function inspectReviewedLedgerRows(
  rows,
  migrationPlan,
  { unresolvedMigration = null } = {},
) {
  const seenIds = new Set();
  let nextMigrationIndex = 0;
  let previousTerminalAt = null;
  let unresolved = null;
  for (const [rowIndex, row] of rows.entries()) {
    const migrationIndex = migrationPlan.findIndex(
      ({ name }) => name === row.migration_name,
    );
    const migration = migrationPlan[migrationIndex];
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)
      || seenIds.has(row.id)
      || !/^[0-9a-f]{64}$/.test(row.checksum)
      || !migration
      || !reviewedChecksums(migration).has(row.checksum)
      || typeof row.started_at !== "string"
      || !REVIEWED_LEDGER_TIMESTAMP_PATTERN.test(row.started_at)
      || typeof row.observed_at !== "string"
      || !REVIEWED_LEDGER_TIMESTAMP_PATTERN.test(row.observed_at)
      || row.started_at > row.observed_at
      || (previousTerminalAt !== null && row.started_at < previousTerminalAt)
      || migrationIndex !== nextMigrationIndex
    ) {
      throw new Error(`Prisma ledger contains an out-of-order or unreviewed row ${row.migration_name}`);
    }
    seenIds.add(row.id);
    if (row.finished_at !== null) {
      if (
        row.rolled_back_at !== null
        || row.applied_steps_count !== 1
        || row.logs !== null
        || typeof row.finished_at !== "string"
        || !REVIEWED_LEDGER_TIMESTAMP_PATTERN.test(row.finished_at)
        || row.started_at > row.finished_at
        || row.finished_at > row.observed_at
      ) {
        throw new Error(`Prisma ledger contains an invalid success for ${row.migration_name}`);
      }
      previousTerminalAt = row.finished_at;
      nextMigrationIndex += 1;
      continue;
    }
    if (row.rolled_back_at !== null) {
      if (
        row.applied_steps_count !== 0
        || typeof row.logs !== "string"
        || !row.logs.trim()
        || typeof row.rolled_back_at !== "string"
        || !REVIEWED_LEDGER_TIMESTAMP_PATTERN.test(row.rolled_back_at)
        || row.started_at > row.rolled_back_at
        || row.rolled_back_at > row.observed_at
        || !REVIEWED_ROLLBACK_MIGRATIONS.has(row.migration_name)
      ) {
        throw new Error(`Prisma ledger contains an invalid rollback for ${row.migration_name}`);
      }
      previousTerminalAt = row.rolled_back_at;
      continue;
    }
    if (
      unresolvedMigration === null
      || unresolved !== null
      || row.migration_name !== unresolvedMigration
      || row.applied_steps_count !== 0
      || typeof row.logs !== "string"
      || !row.logs.trim()
      || rowIndex !== rows.length - 1
    ) {
      throw new Error(`Prisma ledger contains an unresolved migration ${row.migration_name}`);
    }
    unresolved = row;
  }
  return Object.freeze({
    lastSuccess: nextMigrationIndex > 0
      ? migrationPlan[nextMigrationIndex - 1].name
      : null,
    nextMigrationIndex,
    unresolved,
  });
}

async function reviewedLedgerState(client, configuration) {
  const migrationPlan = reviewedMigrationPlan();
  const ledgerExists = await client.query(`
    SELECT to_regclass(format('%I.%I', $1::text, '_prisma_migrations')) IS NOT NULL AS exists
  `, [configuration.bootstrap.schema]);
  if (!ledgerExists.rows[0].exists) return "EMPTY";
  const ledger = await client.query(`
    SELECT id, checksum, migration_name, logs,
           pg_catalog.to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
           CASE WHEN finished_at IS NULL THEN NULL
                ELSE pg_catalog.to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS finished_at,
           CASE WHEN rolled_back_at IS NULL THEN NULL
                ELSE pg_catalog.to_char(rolled_back_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS rolled_back_at,
           pg_catalog.to_char(pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at,
           applied_steps_count
      FROM ${qualified(configuration.bootstrap.schema, "_prisma_migrations")}
     ORDER BY started_at, id
  `);
  const state = inspectReviewedLedgerRows(ledger.rows, migrationPlan);
  return state.lastSuccess ?? "LEDGER_ONLY";
}

async function assertReviewedCatalogState(client, configuration, { postOnly = false } = {}) {
  const ledgerState = await reviewedLedgerState(client, configuration);
  const expectedFingerprint = DATABASE_REVIEWED_CATALOG_STATES[ledgerState];
  const postState = reviewedMigrationPlan().at(-1).name;
  if (
    !expectedFingerprint
    || (postOnly && ledgerState !== postState)
  ) {
    throw new Error(`Prisma ledger state ${ledgerState} is not an approved deployment boundary`);
  }
  const snapshot = await buildCanonicalCatalogSnapshot(
    client,
    configuration.bootstrap.schema,
  );
  const fingerprint = canonicalCatalogFingerprint(snapshot);
  if (fingerprint !== expectedFingerprint) {
    throw new Error(
      `database catalog does not match reviewed ${ledgerState} state for privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}: expected ${expectedFingerprint}, received ${fingerprint}`,
    );
  }
  return ledgerState;
}

export async function assertReviewedRecoveryPredecessor(
  client,
  configuration,
  migrationName,
) {
  const recoveryState = DATABASE_RECOVERY_PREDECESSOR_STATES[migrationName];
  if (!recoveryState) {
    throw new Error(`migration ${migrationName} has no reviewed recovery predecessor`);
  }
  const migrationPlan = reviewedMigrationPlan();
  const targetIndex = migrationPlan.findIndex(({ name }) => name === migrationName);
  if (
    targetIndex < 1
    || migrationPlan[targetIndex - 1].name !== recoveryState.predecessor
    || !/^[0-9a-f]{64}$/.test(recoveryState.fingerprint)
  ) {
    throw new Error(`migration ${migrationName} recovery manifest is invalid`);
  }
  const ledgerExists = await client.query(`
    SELECT to_regclass(format('%I.%I', $1::text, '_prisma_migrations')) IS NOT NULL AS exists
  `, [configuration.bootstrap.schema]);
  if (!ledgerExists.rows[0].exists) {
    throw new Error("Prisma recovery requires an exact existing migration ledger");
  }
  const ledger = await client.query(`
    SELECT id, checksum, migration_name, logs,
           pg_catalog.to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
           CASE WHEN finished_at IS NULL THEN NULL
                ELSE pg_catalog.to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS finished_at,
           CASE WHEN rolled_back_at IS NULL THEN NULL
                ELSE pg_catalog.to_char(rolled_back_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS rolled_back_at,
           pg_catalog.to_char(pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at,
           applied_steps_count
      FROM ${qualified(configuration.bootstrap.schema, "_prisma_migrations")}
     ORDER BY started_at, id
  `);
  const ledgerState = inspectReviewedLedgerRows(ledger.rows, migrationPlan, {
    unresolvedMigration: migrationName,
  });
  if (
    ledgerState.unresolved === null
    || ledgerState.nextMigrationIndex !== targetIndex
    || ledgerState.lastSuccess !== recoveryState.predecessor
  ) {
    throw new Error("Prisma recovery ledger is not the exact reviewed predecessor prefix");
  }
  const fingerprint = canonicalCatalogFingerprint(
    await buildCanonicalCatalogSnapshot(client, configuration.bootstrap.schema),
  );
  if (fingerprint !== recoveryState.fingerprint) {
    throw new Error(`database catalog does not match recovery predecessor ${recoveryState.predecessor}`);
  }
}

export async function withProvisioningLock(client, work) {
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_NAMESPACE]);
  try {
    await client.query("SELECT pg_advisory_lock(72707369)");
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(72707369)");
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_NAMESPACE]);
  }
}

export async function runProvisioningTransaction(client, work) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function assertBootstrapIdentity(client, configuration) {
  const result = await client.query(`
    SELECT pg_catalog.current_database() AS database, current_user AS role,
           r.rolsuper AS superuser
      FROM pg_catalog.pg_roles r
     WHERE r.rolname = current_user
  `);
  const row = result.rows[0];
  if (
    !row
    || row.database !== configuration.bootstrap.database
    || row.role !== configuration.bootstrap.role
    || row.superuser !== true
  ) {
    throw new Error("database role provisioning requires the exact POSTGRES bootstrap superuser and database");
  }
}

async function assertDatabaseEnvironmentContract(client, configuration) {
  const result = await client.query(`
    SELECT current_setting('server_version_num')::int AS server_version_num,
           current_setting('max_prepared_transactions')::int AS max_prepared_transactions,
           current_setting('session_replication_role') AS session_replication_role,
           pg_encoding_to_char(database.encoding) AS encoding,
           database.datlocprovider::text AS locale_provider,
           database.datcollate AS collate,
           database.datctype AS ctype,
           database.datlocale AS locale,
           database.daticurules AS icu_rules,
           database.datcollversion AS collation_version,
           pg_database_collation_actual_version(database.oid) AS actual_collation_version,
           database.datistemplate AS is_template,
           database.datallowconn AS allow_connections,
           database.datconnlimit AS connection_limit
      FROM pg_database database
     WHERE database.datname = current_database()
  `);
  const row = result.rows[0];
  const contract = DATABASE_ENVIRONMENT_CONTRACT;
  if (
    !row
    || row.server_version_num !== contract.serverVersionNumber
    || row.encoding !== contract.encoding
    || row.locale_provider !== contract.localeProvider
    || row.collate !== contract.collate
    || row.ctype !== contract.ctype
    || row.locale !== contract.locale
    || row.icu_rules !== contract.icuRules
    || row.collation_version !== contract.collationVersion
    || row.actual_collation_version !== row.collation_version
    || row.is_template
    || !row.allow_connections
    || row.connection_limit !== -1
    || row.max_prepared_transactions !== 0
    || row.session_replication_role !== "origin"
  ) {
    throw new Error(
      `database environment does not match the pinned PostgreSQL ${contract.serverMajor} UTF-8 libc locale contract`,
    );
  }
  const prepared = await client.query("SELECT count(*)::int AS count FROM pg_prepared_xacts");
  if (prepared.rows[0].count !== 0) {
    throw new Error("dedicated PostgreSQL cluster must not contain prepared transactions");
  }
  const extensions = await client.query(`
    SELECT extension.extname AS name, extension.extversion AS version,
           owner.rolname AS owner, namespace.nspname AS schema
      FROM pg_extension extension
      JOIN pg_roles owner ON owner.oid = extension.extowner
      JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
     ORDER BY extension.extname
  `);
  if (
    extensions.rowCount !== 1
    || extensions.rows[0].name !== "plpgsql"
    || extensions.rows[0].version !== "1.0"
    || extensions.rows[0].owner !== configuration.bootstrap.role
    || extensions.rows[0].schema !== "pg_catalog"
  ) {
    throw new Error("dedicated PostgreSQL cluster must contain only the exact built-in plpgsql extension");
  }
}

async function assertExactClusterRoleInventory(client, configuration) {
  const roles = await client.query(`
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
           rolcanlogin, rolreplication, rolconnlimit, rolbypassrls
      FROM pg_authid
     ORDER BY rolname
  `);
  const configuredNames = Object.values(configuration.roles).map(({ role }) => role);
  const expectedNames = new Set([
    ...PG17_PREDEFINED_ROLES,
    configuration.bootstrap.role,
    ...configuredNames,
  ]);
  if (
    roles.rows.length !== expectedNames.size
    || roles.rows.some(({ rolname }) => !expectedNames.has(rolname))
  ) {
    throw new Error("dedicated PostgreSQL cluster contains an unexpected login or group role");
  }
  for (const role of roles.rows) {
    if (role.rolname === configuration.bootstrap.role) {
      if (
        !role.rolsuper
        || !role.rolinherit
        || !role.rolcreaterole
        || !role.rolcreatedb
        || !role.rolcanlogin
        || !role.rolreplication
        || role.rolconnlimit !== -1
        || !role.rolbypassrls
      ) {
        throw new Error("POSTGRES bootstrap identity must be the sole exact cluster administrator");
      }
      continue;
    }
    if (PG17_PREDEFINED_ROLES.includes(role.rolname)) {
      if (
        role.rolsuper
        || !role.rolinherit
        || role.rolcreaterole
        || role.rolcreatedb
        || role.rolcanlogin
        || role.rolreplication
        || role.rolconnlimit !== -1
        || role.rolbypassrls
      ) {
        throw new Error(`PostgreSQL 17 predefined role ${role.rolname} has unexpected attributes`);
      }
    }
  }
  const memberships = await client.query(`
    SELECT parent.rolname || ':' || member.rolname AS edge
      FROM pg_auth_members membership
      JOIN pg_roles parent ON parent.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
     ORDER BY parent.rolname, member.rolname
  `);
  if (!sameSet(memberships.rows.map(({ edge }) => edge), PG17_PREDEFINED_MEMBERSHIPS)) {
    throw new Error("PostgreSQL cluster role memberships do not match the exact PG17 baseline");
  }
}

async function setConfiguredRoleLoginState(client, configuration, loginRoleKeys) {
  const loginRoles = new Set(loginRoleKeys);
  for (const [roleKey, role] of Object.entries(configuration.roles)) {
    await client.query(
      `ALTER ROLE ${quoteIdentifier(role.role)} ${loginRoles.has(roleKey) ? "LOGIN" : "NOLOGIN"}`,
    );
  }
}

async function reconcileLoginRoles(
  client,
  configuration,
  { loginRoleKeys = [] } = {},
) {
  const loginRoles = new Set(loginRoleKeys);
  await client.query(
    `ALTER DATABASE ${quoteIdentifier(configuration.bootstrap.database)} RESET ALL`,
  );
  for (const [roleKey, role] of Object.entries(configuration.roles)) {
    const exists = await client.query(
      "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
      [role.role],
    );
    const passwordMatches = exists.rowCount === 1
      && scramVerifierMatchesPassword(exists.rows[0].rolpassword, role.password);
    if (exists.rowCount === 0) {
      const verifier = generateScramVerifier(role.password);
      await client.query(
        `CREATE ROLE ${quoteIdentifier(role.role)} NOLOGIN PASSWORD ${quoteLiteral(verifier)}`,
      );
    }
    await client.query(`
      ALTER ROLE ${quoteIdentifier(role.role)}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
      ${loginRoles.has(roleKey) ? "LOGIN" : "NOLOGIN"}
      NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1
      VALID UNTIL 'infinity'
    `);
    if (!passwordMatches && exists.rowCount === 1) {
      const verifier = generateScramVerifier(role.password);
      await client.query(
        `ALTER ROLE ${quoteIdentifier(role.role)} PASSWORD ${quoteLiteral(verifier)}`,
      );
    }
    const memberships = await client.query(`
      SELECT parent.rolname AS parent_role, member.rolname AS member_role
        FROM pg_auth_members membership
        JOIN pg_roles parent ON parent.oid = membership.roleid
        JOIN pg_roles member ON member.oid = membership.member
       WHERE member.rolname = $1 OR parent.rolname = $1
    `, [role.role]);
    for (const membership of memberships.rows) {
      await client.query(
        `REVOKE ${quoteIdentifier(membership.parent_role)} FROM ${quoteIdentifier(membership.member_role)}`,
      );
    }
    const settings = await client.query(`
      SELECT setting.setdatabase, database.datname
        FROM pg_db_role_setting setting
        LEFT JOIN pg_database database ON database.oid = setting.setdatabase
        JOIN pg_roles configured_role ON configured_role.oid = setting.setrole
       WHERE configured_role.rolname = $1
    `, [role.role]);
    await client.query(`ALTER ROLE ${quoteIdentifier(role.role)} RESET ALL`);
    for (const setting of settings.rows) {
      if (setting.setdatabase !== 0 && setting.datname) {
        await client.query(
          `ALTER ROLE ${quoteIdentifier(role.role)} IN DATABASE ${quoteIdentifier(setting.datname)} RESET ALL`,
        );
      }
    }
    await client.query(
      `ALTER ROLE ${quoteIdentifier(role.role)} IN DATABASE ${quoteIdentifier(configuration.bootstrap.database)} SET search_path TO pg_catalog, ${quoteIdentifier(configuration.bootstrap.schema)}`,
    );
  }
}

async function commitNoLoginFence(client, configuration) {
  await runProvisioningTransaction(client, async () => {
    await reconcileLoginRoles(client, configuration);
  });
  await terminateRuntimeRoleSessions(client, configuration);
  await runProvisioningTransaction(client, async () => {
    const inventory = await inventoryDatabaseObjects(
      client,
      configuration.bootstrap.schema,
    );
    await revokeRoleObjectPrivileges(client, configuration, inventory);
    await assertTargetRuntimeObjectPrivilegesAbsent(
      client,
      configuration,
      inventory,
    );
  });
  await terminateRuntimeRoleSessions(client, configuration);
}

async function terminateRuntimeRoleSessions(client, configuration) {
  const roleNames = Object.values(configuration.roles).map(({ role }) => role);
  await client.query(`
    SELECT pg_terminate_backend(activity.pid)
      FROM pg_stat_activity activity
     WHERE activity.usename = ANY($1::text[])
       AND activity.pid <> pg_backend_pid()
  `, [roleNames]);
  const remaining = await client.query(`
    SELECT count(*)::int AS count
      FROM pg_stat_activity activity
     WHERE activity.usename = ANY($1::text[])
       AND activity.pid <> pg_backend_pid()
  `, [roleNames]);
  if (remaining.rows[0].count !== 0) {
    throw new Error("database role maintenance could not terminate every configured role session");
  }
}

async function ensureTargetSchema(client, configuration) {
  const exists = await client.query(
    "SELECT 1 FROM pg_namespace WHERE nspname = $1",
    [configuration.bootstrap.schema],
  );
  if (exists.rowCount > 0) return;
  const userObjects = await client.query(`
    SELECT count(*)::int AS count
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname !~ '^pg_'
       AND namespace.nspname <> 'information_schema'
  `);
  if (userObjects.rows[0].count !== 0) {
    throw new Error("target schema is missing from a database that already contains user objects");
  }
  await client.query(
    `CREATE SCHEMA ${quoteIdentifier(configuration.bootstrap.schema)} AUTHORIZATION ${quoteIdentifier(configuration.roles.migration.role)}`,
  );
}

async function assertDedicatedClusterTopology(client, configuration) {
  const allowedDatabases = new Set([
    configuration.bootstrap.database,
    "postgres",
    "template0",
    "template1",
  ]);
  const databases = await client.query("SELECT datname FROM pg_database ORDER BY datname");
  const unexpectedDatabase = databases.rows.find(({ datname }) => !allowedDatabases.has(datname));
  if (unexpectedDatabase) {
    throw new Error(
      `database role provisioning requires a dedicated PostgreSQL cluster; unexpected sibling database ${unexpectedDatabase.datname} exists`,
    );
  }
  const schemas = await client.query(`
    SELECT namespace.nspname AS name,
           EXISTS (
             SELECT 1 FROM pg_class relation
              WHERE relation.relnamespace = namespace.oid
           ) OR EXISTS (
             SELECT 1 FROM pg_proc function
              WHERE function.pronamespace = namespace.oid
           ) OR EXISTS (
             SELECT 1 FROM pg_type type
              WHERE type.typnamespace = namespace.oid
                AND type.typtype IN ('d', 'e', 'r', 'm')
           ) OR EXISTS (
             SELECT 1 FROM pg_operator operator
              WHERE operator.oprnamespace = namespace.oid
           ) AS contains_objects
      FROM pg_namespace namespace
     WHERE namespace.nspname !~ '^pg_'
       AND namespace.nspname <> 'information_schema'
       AND namespace.nspname <> $1
     ORDER BY namespace.nspname
  `, [configuration.bootstrap.schema]);
  const unexpectedSchema = schemas.rows.find(
    ({ name, contains_objects }) => name !== "public" || contains_objects,
  );
  if (unexpectedSchema) {
    throw new Error(
      `database role provisioning rejects non-target user schema surface ${unexpectedSchema.name}`,
    );
  }
}

async function hardenDedicatedClusterSurface(client, configuration) {
  const nonBootstrapRoles = Object.values(configuration.roles)
    .map(({ role }) => quoteIdentifier(role));
  const grantees = ["PUBLIC", ...nonBootstrapRoles].join(", ");
  const databases = await client.query(
    "SELECT datname FROM pg_database WHERE datname = ANY($1::text[]) ORDER BY datname",
    [["postgres", "template0", "template1"].filter(
      (name) => name !== configuration.bootstrap.database,
    )],
  );
  for (const { datname } of databases.rows) {
    await client.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(datname)} FROM ${grantees}`,
    );
  }
  const publicSchema = await client.query("SELECT to_regnamespace('public') IS NOT NULL AS exists");
  if (configuration.bootstrap.schema !== "public" && publicSchema.rows[0].exists) {
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${grantees}`);
  }
  const largeObjectFunctions = await client.query(`
    SELECT function.proname AS name,
           pg_get_function_identity_arguments(function.oid) AS identity_arguments
      FROM pg_proc function
      JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'pg_catalog'
       AND function.proname = ANY($1::text[])
     ORDER BY function.proname, pg_get_function_identity_arguments(function.oid)
  `, [[
    "lo_create", "lo_creat", "lo_export", "lo_from_bytea", "lo_import", "lo_open",
    "lo_put", "lo_truncate", "lo_truncate64", "lo_unlink", "lowrite",
  ]]);
  for (const fn of largeObjectFunctions.rows) {
    await client.query(
      `REVOKE EXECUTE ON FUNCTION ${qualified("pg_catalog", fn.name)}(${fn.identity_arguments}) FROM ${grantees}`,
    );
  }
  const parameterAcl = await client.query(
    "SELECT parname FROM pg_parameter_acl ORDER BY parname",
  );
  if (parameterAcl.rowCount > 0) {
    const clusterRoles = await client.query("SELECT rolname FROM pg_roles ORDER BY rolname");
    const parameterGrantees = [
      "PUBLIC",
      ...clusterRoles.rows.map(({ rolname }) => quoteIdentifier(rolname)),
    ].join(", ");
    for (const { parname } of parameterAcl.rows) {
      await client.query(
        `REVOKE ALL PRIVILEGES ON PARAMETER ${quoteIdentifier(parname)} FROM ${parameterGrantees}`,
      );
    }
  }
}

async function assertExactParameterPrivileges(client, configuration) {
  const parameterAcl = await client.query(
    `SELECT parameter.parname, acl.grantee, acl.privilege_type
       FROM pg_parameter_acl parameter
       CROSS JOIN LATERAL aclexplode(parameter.paracl) acl
      LIMIT 1`,
  );
  if (parameterAcl.rowCount !== 0) {
    throw new Error("dedicated PostgreSQL cluster must not contain parameter ACL overrides");
  }
  for (const role of Object.values(configuration.roles)) {
    for (const parameter of ["session_replication_role", "allow_system_table_mods"]) {
      const privileges = await client.query(`
        SELECT has_parameter_privilege($1, $2, 'SET') AS can_set,
               has_parameter_privilege($1, $2, 'ALTER SYSTEM') AS can_alter_system
      `, [role.role, parameter]);
      if (privileges.rows[0].can_set || privileges.rows[0].can_alter_system) {
        throw new Error(`${role.role} can change security-sensitive parameter ${parameter}`);
      }
    }
  }
}

async function assertDatabaseWideSurface(client, configuration) {
  const emptySurfaces = await client.query(`
    SELECT (SELECT count(*)::int FROM pg_event_trigger) AS event_triggers,
           (SELECT count(*)::int FROM pg_foreign_data_wrapper) AS foreign_data_wrappers,
           (SELECT count(*)::int FROM pg_foreign_server) AS foreign_servers,
           (SELECT count(*)::int FROM pg_user_mapping) AS user_mappings,
           (SELECT count(*)::int FROM pg_publication) AS publications,
           (SELECT count(*)::int FROM pg_subscription) AS subscriptions,
           (SELECT count(*)::int FROM pg_replication_slots) AS replication_slots,
           (SELECT count(*)::int FROM pg_replication_origin_status) AS replication_origins
  `);
  const nonempty = Object.entries(emptySurfaces.rows[0])
    .find(([, count]) => count !== 0);
  if (nonempty) {
    throw new Error(`dedicated PostgreSQL cluster contains forbidden ${nonempty[0]}`);
  }
  const languages = await client.query(`
    SELECT language.lanname AS name, owner.rolname AS owner,
           language.lanpltrusted AS trusted
      FROM pg_language language
      JOIN pg_roles owner ON owner.oid = language.lanowner
     ORDER BY language.lanname
  `);
  const expectedLanguages = [
    { name: "c", owner: configuration.bootstrap.role, trusted: false },
    { name: "internal", owner: configuration.bootstrap.role, trusted: false },
    { name: "plpgsql", owner: configuration.bootstrap.role, trusted: true },
    { name: "sql", owner: configuration.bootstrap.role, trusted: true },
  ];
  if (JSON.stringify(languages.rows) !== JSON.stringify(expectedLanguages)) {
    throw new Error("procedural language inventory does not match the exact PG17 baseline");
  }
  const tablespaces = await client.query(`
    SELECT tablespace.spcname AS name, owner.rolname AS owner
      FROM pg_tablespace tablespace
      JOIN pg_roles owner ON owner.oid = tablespace.spcowner
     ORDER BY tablespace.spcname
  `);
  if (JSON.stringify(tablespaces.rows) !== JSON.stringify([
    { name: "pg_default", owner: configuration.bootstrap.role },
    { name: "pg_global", owner: configuration.bootstrap.role },
  ])) {
    throw new Error("tablespace inventory does not match the exact PG17 baseline");
  }
}

async function assertNoNonTargetConfiguredRoleSurface(client, configuration) {
  const configuredRoles = Object.values(configuration.roles).map(({ role }) => role);
  const ownership = await client.query(`
    SELECT surface.kind, surface.name, owner.rolname AS owner
      FROM (
        SELECT 'database'::text AS kind, database.datname AS name,
               database.datdba AS owner, NULL::text AS namespace,
               database.oid AS objoid
          FROM pg_database database
        UNION ALL
        SELECT 'schema', namespace.nspname, namespace.nspowner, namespace.nspname,
               namespace.oid
          FROM pg_namespace namespace
        UNION ALL
        SELECT 'relation', relation.relname, relation.relowner, namespace.nspname,
               relation.oid
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        UNION ALL
        SELECT 'function', function.proname, function.proowner, namespace.nspname,
               function.oid
          FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
        UNION ALL
        SELECT 'type', type.typname, type.typowner, namespace.nspname, type.oid
          FROM pg_type type
          JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
        UNION ALL
        SELECT 'collation', collation_catalog.collname,
               collation_catalog.collowner, namespace.nspname,
               collation_catalog.oid
          FROM pg_collation collation_catalog
          JOIN pg_namespace namespace
            ON namespace.oid = collation_catalog.collnamespace
        UNION ALL
        SELECT 'conversion', conversion_catalog.conname,
               conversion_catalog.conowner, namespace.nspname,
               conversion_catalog.oid
          FROM pg_conversion conversion_catalog
          JOIN pg_namespace namespace
            ON namespace.oid = conversion_catalog.connamespace
        UNION ALL
        SELECT 'operator', operator_catalog.oprname, operator_catalog.oprowner,
               namespace.nspname, operator_catalog.oid
          FROM pg_operator operator_catalog
          JOIN pg_namespace namespace
            ON namespace.oid = operator_catalog.oprnamespace
        UNION ALL
        SELECT 'language', language.lanname, language.lanowner, NULL, language.oid
          FROM pg_language language
        UNION ALL
        SELECT 'tablespace', tablespace.spcname, tablespace.spcowner, NULL, tablespace.oid
          FROM pg_tablespace tablespace
        UNION ALL
        SELECT 'event-trigger', event_trigger.evtname, event_trigger.evtowner, NULL,
               event_trigger.oid
          FROM pg_event_trigger event_trigger
        UNION ALL
        SELECT 'foreign-data-wrapper', wrapper.fdwname, wrapper.fdwowner, NULL,
               wrapper.oid
          FROM pg_foreign_data_wrapper wrapper
        UNION ALL
        SELECT 'foreign-server', server.srvname, server.srvowner, NULL, server.oid
          FROM pg_foreign_server server
        UNION ALL
        SELECT 'publication', publication.pubname, publication.pubowner, NULL,
               publication.oid
          FROM pg_publication publication
        UNION ALL
        SELECT 'subscription', subscription.subname, subscription.subowner, NULL,
               subscription.oid
          FROM pg_subscription subscription
      ) surface
      JOIN pg_roles owner ON owner.oid = surface.owner
     WHERE owner.rolname = ANY($1::text[])
       AND NOT (
         owner.rolname = $2
         AND surface.namespace = $3
         AND surface.kind IN ('schema', 'relation', 'function', 'type', 'collation', 'conversion', 'operator')
       )
       AND NOT (
         owner.rolname = $2
         AND surface.namespace = 'pg_toast'
         AND (
           (
             surface.kind = 'relation'
             AND (
               EXISTS (
                 SELECT 1
                   FROM pg_class base
                   JOIN pg_namespace base_namespace ON base_namespace.oid = base.relnamespace
                  WHERE base_namespace.nspname = $3
                    AND base.reltoastrelid = surface.objoid
               )
               OR EXISTS (
                 SELECT 1
                   FROM pg_index toast_index
                   JOIN pg_class toast ON toast.oid = toast_index.indrelid
                   JOIN pg_class base ON base.reltoastrelid = toast.oid
                   JOIN pg_namespace base_namespace ON base_namespace.oid = base.relnamespace
                  WHERE base_namespace.nspname = $3
                    AND toast_index.indexrelid = surface.objoid
               )
             )
           )
           OR (
             surface.kind = 'type'
             AND EXISTS (
               SELECT 1
                 FROM pg_type toast_type
                 JOIN pg_class toast ON toast.oid = toast_type.typrelid
                 JOIN pg_class base ON base.reltoastrelid = toast.oid
                 JOIN pg_namespace base_namespace ON base_namespace.oid = base.relnamespace
                WHERE base_namespace.nspname = $3
                  AND toast_type.oid = surface.objoid
             )
           )
         )
       )
     LIMIT 1
  `, [
    configuredRoles,
    configuration.roles.migration.role,
    configuration.bootstrap.schema,
  ]);
  if (ownership.rowCount > 0) {
    const first = ownership.rows[0];
    throw new Error(`${first.owner} owns forbidden ${first.kind} ${first.name} outside the target schema`);
  }
  const acl = await client.query(`
    SELECT surface.kind, surface.name,
           COALESCE(grantee.rolname, '<dropped-role>') AS grantee,
           surface.privilege_type
      FROM (
        SELECT 'database'::text AS kind, database.datname AS name,
               acl.grantee, acl.privilege_type
          FROM pg_database database
          CROSS JOIN LATERAL aclexplode(database.datacl) acl
         WHERE database.datname <> current_database()
        UNION ALL
        SELECT 'schema', namespace.nspname, acl.grantee, acl.privilege_type
          FROM pg_namespace namespace
          CROSS JOIN LATERAL aclexplode(namespace.nspacl) acl
         WHERE namespace.nspname <> $2
        UNION ALL
        SELECT 'relation', namespace.nspname || '.' || relation.relname,
               acl.grantee, acl.privilege_type
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL aclexplode(relation.relacl) acl
         WHERE namespace.nspname <> $2
        UNION ALL
        SELECT 'column', namespace.nspname || '.' || relation.relname || '.' || attribute.attname::text,
               acl.grantee, acl.privilege_type
          FROM pg_attribute attribute
          JOIN pg_class relation ON relation.oid = attribute.attrelid
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
         WHERE namespace.nspname <> $2
        UNION ALL
        SELECT 'function', namespace.nspname || '.' || function.proname,
               acl.grantee, acl.privilege_type
          FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
          CROSS JOIN LATERAL aclexplode(function.proacl) acl
         WHERE namespace.nspname <> $2
        UNION ALL
        SELECT 'type', namespace.nspname || '.' || type.typname,
               acl.grantee, acl.privilege_type
          FROM pg_type type
          JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
          CROSS JOIN LATERAL aclexplode(type.typacl) acl
         WHERE namespace.nspname <> $2
        UNION ALL
        SELECT 'language', language.lanname, acl.grantee, acl.privilege_type
          FROM pg_language language
          CROSS JOIN LATERAL aclexplode(language.lanacl) acl
        UNION ALL
        SELECT 'tablespace', tablespace.spcname, acl.grantee, acl.privilege_type
          FROM pg_tablespace tablespace
          CROSS JOIN LATERAL aclexplode(tablespace.spcacl) acl
        UNION ALL
        SELECT 'foreign-data-wrapper', wrapper.fdwname, acl.grantee, acl.privilege_type
          FROM pg_foreign_data_wrapper wrapper
          CROSS JOIN LATERAL aclexplode(wrapper.fdwacl) acl
        UNION ALL
        SELECT 'foreign-server', server.srvname, acl.grantee, acl.privilege_type
          FROM pg_foreign_server server
          CROSS JOIN LATERAL aclexplode(server.srvacl) acl
      ) surface
      LEFT JOIN pg_roles grantee ON grantee.oid = surface.grantee
     WHERE grantee.rolname = ANY($1::text[])
     LIMIT 1
  `, [configuredRoles, configuration.bootstrap.schema]);
  if (acl.rowCount > 0) {
    const first = acl.rows[0];
    throw new Error(`${first.grantee} retains explicit ${first.privilege_type} on forbidden ${first.kind} ${first.name}`);
  }
}

export function systemPublicAclFingerprint(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("PostgreSQL PUBLIC ACL surface is unavailable");
  }
  const canonical = rows.map((row) => {
    if (
      typeof row?.kind !== "string"
      || typeof row.identity !== "string"
      || typeof row.privilege_type !== "string"
      || typeof row.is_grantable !== "boolean"
      || typeof row.grantor_is_owner !== "boolean"
    ) {
      throw new Error("PostgreSQL PUBLIC ACL surface contains an invalid row");
    }
    return {
      grantable: row.is_grantable,
      grantorIsOwner: row.grantor_is_owner,
      identity: row.identity,
      kind: row.kind,
      privilege: row.privilege_type,
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  for (let index = 1; index < canonical.length; index += 1) {
    if (JSON.stringify(canonical[index - 1]) === JSON.stringify(canonical[index])) {
      throw new Error("PostgreSQL PUBLIC ACL surface contains a duplicate row");
    }
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function readSystemPublicAclSurface(client, targetSchema) {
  const result = await client.query(`
    WITH surface AS (
      SELECT 'schema'::text AS kind,
             pg_catalog.format('%I', namespace.nspname) AS identity,
             namespace.nspowner AS owner, 'n'::"char" AS default_kind,
             namespace.nspacl AS acl
        FROM pg_catalog.pg_namespace namespace
       WHERE namespace.nspname <> $1
      UNION ALL
      SELECT 'relation:' || relation.relkind::text,
             pg_catalog.format('%I.%I', namespace.nspname, relation.relname),
             relation.relowner,
             CASE WHEN relation.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
             relation.relacl
        FROM pg_catalog.pg_class relation
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname <> $1
      UNION ALL
      SELECT 'column',
             pg_catalog.format(
               '%I.%I.%I',
               namespace.nspname,
               relation.relname,
               attribute.attname::text
             ),
             relation.relowner, NULL::"char", attribute.attacl
        FROM pg_catalog.pg_attribute attribute
        JOIN pg_catalog.pg_class relation ON relation.oid = attribute.attrelid
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname <> $1
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
      UNION ALL
      SELECT 'function',
             pg_catalog.format(
               '%I.%I(%s)',
               namespace.nspname,
               function.proname,
               pg_catalog.pg_get_function_identity_arguments(function.oid)
             ),
             function.proowner, 'f'::"char", function.proacl
        FROM pg_catalog.pg_proc function
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname <> $1
      UNION ALL
      SELECT 'type:' || type.typtype::text,
             pg_catalog.format('%I.%I', namespace.nspname, type.typname),
             type.typowner, 'T'::"char", type.typacl
        FROM pg_catalog.pg_type type
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace
       WHERE namespace.nspname <> $1
      UNION ALL
      SELECT 'language', pg_catalog.format('%I', language.lanname),
             language.lanowner, 'l'::"char", language.lanacl
        FROM pg_catalog.pg_language language
      UNION ALL
      SELECT 'tablespace', pg_catalog.format('%I', tablespace.spcname),
             tablespace.spcowner, 't'::"char", tablespace.spcacl
        FROM pg_catalog.pg_tablespace tablespace
      UNION ALL
      SELECT 'database', pg_catalog.format('%I', database.datname),
             database.datdba, 'd'::"char", database.datacl
        FROM pg_catalog.pg_database database
       WHERE database.datname <> pg_catalog.current_database()
    )
    SELECT surface.kind, surface.identity, acl.privilege_type,
           acl.is_grantable, acl.grantor = surface.owner AS grantor_is_owner
      FROM surface
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          surface.acl,
          CASE WHEN surface.default_kind IS NULL THEN NULL::aclitem[]
               ELSE pg_catalog.acldefault(surface.default_kind, surface.owner) END
        )
      ) acl
     WHERE acl.grantee = 0
     ORDER BY surface.kind, surface.identity, acl.privilege_type,
              acl.is_grantable, grantor_is_owner
  `, [targetSchema]);
  return result.rows;
}

async function assertNoUnexpectedSystemPublicAcl(client, configuration) {
  const rows = await readSystemPublicAclSurface(
    client,
    configuration.bootstrap.schema,
  );
  const fingerprint = systemPublicAclFingerprint(rows);
  if (fingerprint !== DATABASE_PG17_SYSTEM_PUBLIC_ACL_SHA256) {
    throw new Error(
      `effective PUBLIC system ACL surface does not match pinned PostgreSQL 17.11 baseline (expected ${DATABASE_PG17_SYSTEM_PUBLIC_ACL_SHA256}, actual ${fingerprint})`,
    );
  }
}

async function inventoryDatabaseObjects(client, schema) {
  const relations = await client.query(`
    SELECT c.oid, c.relname AS name, c.relkind AS kind, owner.rolname AS owner,
           extension.extname AS extension
      FROM pg_class c
      JOIN pg_namespace namespace ON namespace.oid = c.relnamespace
      JOIN pg_roles owner ON owner.oid = c.relowner
      LEFT JOIN LATERAL (
        SELECT e.extname
          FROM pg_depend dependency
          JOIN pg_extension e ON e.oid = dependency.refobjid
         WHERE dependency.classid = 'pg_class'::regclass
           AND dependency.objid = c.oid
           AND dependency.refclassid = 'pg_extension'::regclass
           AND dependency.deptype = 'e'
         LIMIT 1
      ) extension ON true
     WHERE namespace.nspname = $1
       AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
     ORDER BY c.relname
  `, [schema]);
  const types = await client.query(`
    SELECT t.oid, t.typname AS name, t.typtype AS kind, owner.rolname AS owner,
           extension.extname AS extension
      FROM pg_type t
      JOIN pg_namespace namespace ON namespace.oid = t.typnamespace
      JOIN pg_roles owner ON owner.oid = t.typowner
      LEFT JOIN LATERAL (
        SELECT e.extname
          FROM pg_depend dependency
          JOIN pg_extension e ON e.oid = dependency.refobjid
         WHERE dependency.classid = 'pg_type'::regclass
           AND dependency.objid = t.oid
           AND dependency.refclassid = 'pg_extension'::regclass
           AND dependency.deptype = 'e'
         LIMIT 1
      ) extension ON true
     WHERE namespace.nspname = $1
       AND (
         t.typtype IN ('e', 'd', 'r', 'm')
         OR (
           t.typtype = 'c'
           AND EXISTS (
             SELECT 1
               FROM pg_class composite
              WHERE composite.oid = t.typrelid
                AND composite.relkind = 'c'
           )
         )
       )
     ORDER BY t.typname
  `, [schema]);
  const functions = await client.query(`
    SELECT p.oid, namespace.nspname AS schema_name, p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_get_function_result(p.oid) AS return_type,
           p.prokind AS kind, language.lanname AS language,
           p.prosecdef AS security_definer, p.proleakproof AS leakproof,
           p.proisstrict AS strict, p.provolatile AS volatility,
           p.proparallel AS parallel, p.proconfig AS configuration,
           p.prosrc AS source,
           owner.rolname AS owner, extension.extname AS extension
      FROM pg_proc p
      JOIN pg_namespace namespace ON namespace.oid = p.pronamespace
      JOIN pg_roles owner ON owner.oid = p.proowner
      JOIN pg_language language ON language.oid = p.prolang
      LEFT JOIN LATERAL (
        SELECT e.extname
          FROM pg_depend dependency
          JOIN pg_extension e ON e.oid = dependency.refobjid
         WHERE dependency.classid = 'pg_proc'::regclass
           AND dependency.objid = p.oid
           AND dependency.refclassid = 'pg_extension'::regclass
           AND dependency.deptype = 'e'
         LIMIT 1
      ) extension ON true
     WHERE namespace.nspname = $1
     ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
  `, [schema]);
  const triggers = await client.query(`
    SELECT trigger.oid, trigger.tgname AS name, relation.relname AS table_name,
           function.oid AS function_oid,
           function_namespace.nspname AS function_schema,
           function.proname AS function_name,
           pg_get_function_identity_arguments(function.oid) AS function_identity_arguments,
           trigger.tgtype::int AS type, trigger.tgenabled AS enabled,
           trigger.tgisinternal AS internal,
           trigger.tgconstraint = 0 AS constraint_free,
           constraint_definition.oid AS constraint_oid,
           constraint_definition.conname AS constraint_name,
           trigger.tgdeferrable AS deferrable,
           trigger.tginitdeferred AS initially_deferred,
           trigger.tgnargs = 0 AND octet_length(trigger.tgargs) = 0 AS argument_free,
           trigger.tgoldtable AS old_transition_table,
           trigger.tgnewtable AS new_transition_table,
           ARRAY(
             SELECT attribute.attname::text
               FROM unnest(trigger.tgattr::smallint[]) WITH ORDINALITY AS selected(attnum, position)
               JOIN pg_attribute attribute
                 ON attribute.attrelid = relation.oid
                AND attribute.attnum = selected.attnum
              ORDER BY selected.position
           )::text[] AS update_columns,
           trigger.tgqual IS NULL AS condition_free
           ,pg_get_triggerdef(trigger.oid, false) AS definition
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc function ON function.oid = trigger.tgfoid
      JOIN pg_namespace function_namespace ON function_namespace.oid = function.pronamespace
      LEFT JOIN pg_constraint constraint_definition
        ON constraint_definition.oid = trigger.tgconstraint
     WHERE namespace.nspname = $1
       AND NOT trigger.tgisinternal
     ORDER BY relation.relname, trigger.tgname
  `, [schema]);
  const rules = await client.query(`
    SELECT rule.rulename AS name, relation.relname AS table_name
      FROM pg_rewrite rule
      JOIN pg_class relation ON relation.oid = rule.ev_class
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
       AND rule.rulename <> '_RETURN'
     ORDER BY relation.relname, rule.rulename
  `, [schema]);
  const policies = await client.query(`
    SELECT policy.polname AS name, relation.relname AS table_name
      FROM pg_policy policy
      JOIN pg_class relation ON relation.oid = policy.polrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
     ORDER BY relation.relname, policy.polname
  `, [schema]);
  const operators = await client.query(`
    SELECT operator.oid, operator.oprname AS name
      FROM pg_operator operator
      JOIN pg_namespace namespace ON namespace.oid = operator.oprnamespace
     WHERE namespace.nspname = $1
     ORDER BY operator.oprname, operator.oid
  `, [schema]);
  const constraints = await client.query(`
    SELECT relation.relname AS table_name,
           catalog_constraint.conname AS name,
           catalog_constraint.contype AS type,
           catalog_constraint.convalidated AS validated,
           catalog_constraint.condeferrable AS deferrable,
           catalog_constraint.condeferred AS initially_deferred,
           pg_get_constraintdef(catalog_constraint.oid, false) AS definition
      FROM pg_constraint catalog_constraint
      JOIN pg_class relation ON relation.oid = catalog_constraint.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
     ORDER BY relation.relname, catalog_constraint.conname
  `, [schema]);
  const indexes = await client.query(`
    SELECT index_relation.oid, index_relation.relname AS name,
           table_relation.relname AS table_name,
           owner.rolname AS owner,
           catalog_index.indisunique AS unique,
           catalog_index.indisprimary AS primary,
           catalog_index.indisvalid AS valid,
           catalog_index.indisready AS ready,
           catalog_index.indislive AS live,
           pg_get_indexdef(index_relation.oid, 0, false) AS definition
      FROM pg_index catalog_index
      JOIN pg_class index_relation
        ON index_relation.oid = catalog_index.indexrelid
      JOIN pg_class table_relation
        ON table_relation.oid = catalog_index.indrelid
      JOIN pg_namespace namespace
        ON namespace.oid = index_relation.relnamespace
      JOIN pg_roles owner ON owner.oid = index_relation.relowner
     WHERE namespace.nspname = $1
     ORDER BY index_relation.relname
  `, [schema]);
  const unsupportedObjects = await client.query(`
    SELECT kind, name
      FROM (
        SELECT 'cast'::text AS kind,
               format_type(cast_catalog.castsource, NULL) || '->' ||
               format_type(cast_catalog.casttarget, NULL) AS name
          FROM pg_cast cast_catalog
          JOIN pg_type source_type ON source_type.oid = cast_catalog.castsource
          JOIN pg_namespace source_namespace
            ON source_namespace.oid = source_type.typnamespace
          JOIN pg_type target_type ON target_type.oid = cast_catalog.casttarget
          JOIN pg_namespace target_namespace
            ON target_namespace.oid = target_type.typnamespace
         WHERE source_namespace.nspname = $1 OR target_namespace.nspname = $1
        UNION ALL
        SELECT 'operator class', operator_class.opcname
          FROM pg_opclass operator_class
          JOIN pg_namespace namespace
            ON namespace.oid = operator_class.opcnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'operator family', operator_family.opfname
          FROM pg_opfamily operator_family
          JOIN pg_namespace namespace
            ON namespace.oid = operator_family.opfnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'conversion', conversion.conname
          FROM pg_conversion conversion
          JOIN pg_namespace namespace ON namespace.oid = conversion.connamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'extended statistics', statistics.stxname
          FROM pg_statistic_ext statistics
          JOIN pg_namespace namespace ON namespace.oid = statistics.stxnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'text search configuration', configuration.cfgname
          FROM pg_ts_config configuration
          JOIN pg_namespace namespace ON namespace.oid = configuration.cfgnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'text search dictionary', dictionary.dictname
          FROM pg_ts_dict dictionary
          JOIN pg_namespace namespace ON namespace.oid = dictionary.dictnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'text search parser', parser.prsname
          FROM pg_ts_parser parser
          JOIN pg_namespace namespace ON namespace.oid = parser.prsnamespace
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'text search template', template.tmplname
          FROM pg_ts_template template
          JOIN pg_namespace namespace ON namespace.oid = template.tmplnamespace
         WHERE namespace.nspname = $1
      ) unsupported
     ORDER BY kind, name
  `, [schema]);
  const columns = await client.query(`
    SELECT table_name, column_name, ordinal_position
      FROM information_schema.columns
     WHERE table_schema = $1
     ORDER BY table_name, ordinal_position
  `, [schema]);
  const extensionObjects = [
    ...relations.rows,
    ...types.rows,
    ...functions.rows,
  ].filter(({ extension }) => extension);
  if (extensionObjects.length > 0) {
    throw new Error(
      `target schema ${schema} contains extension-owned objects; install extensions in a separate non-application schema`,
    );
  }
  if (unsupportedObjects.rowCount > 0) {
    const first = unsupportedObjects.rows[0];
    throw new Error(
      `target schema contains unsupported ${first.kind} ${first.name}`,
    );
  }
  const columnsByTable = new Map();
  for (const row of columns.rows) {
    const names = columnsByTable.get(row.table_name) ?? [];
    names.push(row.column_name);
    columnsByTable.set(row.table_name, names);
  }
  return Object.freeze({
    columnsByTable,
    constraints: constraints.rows,
    functions: functions.rows,
    indexes: indexes.rows,
    operators: operators.rows,
    policies: policies.rows,
    relations: relations.rows,
    rules: rules.rows,
    schema,
    triggers: triggers.rows,
    types: types.rows,
  });
}

function relationSets(inventory) {
  return {
    sequences: inventory.relations.filter(({ kind }) => kind === "S"),
    tables: inventory.relations.filter(({ kind }) => ["r", "p"].includes(kind)),
    views: inventory.relations.filter(({ kind }) => ["v", "m", "f"].includes(kind)),
  };
}

function functionKey(value) {
  return `${value.name}(${value.identity_arguments ?? value.identityArguments})`;
}

function triggerKey(value) {
  return `${value.table_name ?? value.table}:${value.name}`;
}

function normalizedSourceSha256(source, schema) {
  return createHash("sha256")
    .update(normalizeCatalogText(
      source.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
      schema,
    ))
    .digest("hex");
}

function catalogDefinitionSha256(definition, schema) {
  return createHash("sha256")
    .update(normalizeCatalogText(definition, schema))
    .digest("hex");
}

function assertKnownFunctionIntegrity(actual, expected) {
  const configuration = normalizeFunctionConfiguration(
    actual.configuration ?? [],
    actual.schema_name,
  );
  if (
    actual.kind !== expected.kind
    || actual.return_type !== expected.returnType
    || actual.language !== expected.language
    || actual.security_definer !== expected.securityDefiner
    || actual.leakproof !== expected.leakproof
    || actual.strict !== expected.strict
    || actual.volatility !== expected.volatility
    || actual.parallel !== expected.parallel
    || !sameSet(configuration, expected.configuration)
    || normalizedSourceSha256(actual.source, actual.schema_name) !== expected.sourceSha256
  ) {
    throw new Error(
      `database function ${functionKey(actual)} executable definition does not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`,
    );
  }
}

function assertKnownTriggerIntegrity(actual, expected, expectedFunction) {
  const expectedConstraintName = expected.constraintName ?? null;
  if (
    !expectedFunction
    || actual.table_name !== expected.table
    || actual.function_name !== expected.functionName
    || actual.function_identity_arguments !== expected.functionIdentityArguments
    || String(actual.function_oid) !== String(expectedFunction.oid)
    || actual.function_schema !== expectedFunction.schema_name
    || actual.type !== expected.type
    || actual.enabled !== expected.enabled
    || actual.internal
    || actual.constraint_free !== (expectedConstraintName === null)
    || actual.constraint_name !== expectedConstraintName
    || actual.deferrable !== (expected.deferrable ?? false)
    || actual.initially_deferred !== (expected.initiallyDeferred ?? false)
    || !actual.argument_free
    || !actual.condition_free
    || actual.old_transition_table !== null
    || actual.new_transition_table !== null
    || !sameSet(actual.update_columns, expected.updateColumns)
    || catalogDefinitionSha256(actual.definition, expectedFunction.schema_name)
      !== expected.definitionSha256
  ) {
    throw new Error(
      `database trigger ${triggerKey(actual)} definition does not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`,
    );
  }
}

function assertNoUnknownObjects(inventory) {
  const expectedTables = new Set([...DATABASE_TABLES, ...DATABASE_INTERNAL_TABLES]);
  const expectedTypes = new Set(DATABASE_ENUM_TYPES);
  const expectedFunctions = new Set(DATABASE_FUNCTIONS.map(functionKey));
  const expectedTriggers = new Set(DATABASE_TRIGGERS.map(triggerKey));
  const relations = relationSets(inventory);
  const unknown = [
    ...relations.tables.filter(({ name }) => !expectedTables.has(name)).map(({ name }) => `table:${name}`),
    ...relations.sequences.map(({ name }) => `sequence:${name}`),
    ...relations.views.map(({ name }) => `view:${name}`),
    ...inventory.types.filter(({ name, kind }) => kind !== "e" || !expectedTypes.has(name)).map(({ name }) => `type:${name}`),
    ...inventory.functions.filter((entry) => !expectedFunctions.has(functionKey(entry))).map((entry) => `function:${functionKey(entry)}`),
    ...inventory.triggers.filter((entry) => !expectedTriggers.has(triggerKey(entry))).map((entry) => `trigger:${triggerKey(entry)}`),
    ...inventory.rules.map(({ name, table_name }) => `rule:${table_name}:${name}`),
    ...inventory.policies.map(({ name, table_name }) => `policy:${table_name}:${name}`),
    ...inventory.operators.map(({ name }) => `operator:${name}`),
  ];
  if (unknown.length > 0) {
    throw new Error(`database contains objects outside privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}: ${unknown.join(", ")}`);
  }
  for (const actual of inventory.functions) {
    const expected = DATABASE_FUNCTIONS.find((entry) => functionKey(entry) === functionKey(actual));
    assertKnownFunctionIntegrity(actual, expected);
  }
  for (const actual of inventory.triggers) {
    const expected = DATABASE_TRIGGERS.find((entry) => triggerKey(entry) === triggerKey(actual));
    const expectedFunction = inventory.functions.find(
      (entry) => functionKey(entry) === `${expected.functionName}(${expected.functionIdentityArguments})`,
    );
    assertKnownTriggerIntegrity(actual, expected, expectedFunction);
  }
}

function sameSet(actual, expected) {
  return actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function assertSecurityCatalogArtifacts(inventory) {
  for (const expected of DATABASE_SECURITY_CONSTRAINTS) {
    const matches = inventory.constraints.filter(
      (actual) => actual.table_name === expected.table && actual.name === expected.name,
    );
    const actual = matches[0];
    const expectedDeferred = expected.type === "t";
    if (
      matches.length !== 1
      || actual.type !== expected.type
      || !actual.validated
      || actual.deferrable !== expectedDeferred
      || actual.initially_deferred !== expectedDeferred
      || catalogDefinitionSha256(actual.definition, inventory.schema)
        !== expected.definitionSha256
    ) {
      throw new Error(
        `security constraint ${expected.table}.${expected.name} does not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`,
      );
    }
  }
  for (const expected of DATABASE_SECURITY_INDEXES) {
    const matches = inventory.indexes.filter(
      (actual) => actual.table_name === expected.table && actual.name === expected.name,
    );
    const actual = matches[0];
    if (
      matches.length !== 1
      || actual.unique !== expected.unique
      || actual.primary !== expected.primary
      || !actual.valid
      || !actual.ready
      || !actual.live
      || catalogDefinitionSha256(actual.definition, inventory.schema)
        !== expected.definitionSha256
    ) {
      throw new Error(
        `security index ${expected.table}.${expected.name} does not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`,
      );
    }
  }
}

function assertExactManifest(inventory) {
  assertNoUnknownObjects(inventory);
  assertSecurityCatalogArtifacts(inventory);
  const relations = relationSets(inventory);
  const expectedTables = [...DATABASE_TABLES, ...DATABASE_INTERNAL_TABLES];
  if (!sameSet(relations.tables.map(({ name }) => name), expectedTables)) {
    throw new Error(`database tables do not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`);
  }
  if (relations.sequences.length !== 0 || relations.views.length !== 0) {
    throw new Error(`database sequences/views do not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`);
  }
  if (!sameSet(inventory.types.map(({ name }) => name), DATABASE_ENUM_TYPES)) {
    throw new Error(`database enum types do not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`);
  }
  if (!sameSet(inventory.functions.map(functionKey), DATABASE_FUNCTIONS.map(functionKey))) {
    throw new Error(`database functions do not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`);
  }
  if (!sameSet(inventory.triggers.map(triggerKey), DATABASE_TRIGGERS.map(triggerKey))) {
    throw new Error(`database triggers do not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`);
  }
  if (
    inventory.rules.length !== 0
    || inventory.policies.length !== 0
    || inventory.operators.length !== 0
  ) {
    throw new Error(`database rules/policies/operators do not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`);
  }
  for (const [table, expectedColumns] of Object.entries(DATABASE_TABLE_COLUMNS)) {
    const actualColumns = inventory.columnsByTable.get(table) ?? [];
    if (!sameSet(actualColumns, expectedColumns)) {
      throw new Error(`${table} columns do not match privilege manifest ${DATABASE_PRIVILEGE_MANIFEST_VERSION}`);
    }
  }
}

async function ownershipState(client, configuration, inventory) {
  const database = await client.query(`
    SELECT owner.rolname AS owner
      FROM pg_database database
      JOIN pg_roles owner ON owner.oid = database.datdba
     WHERE database.datname = current_database()
  `);
  const schema = await client.query(`
    SELECT owner.rolname AS owner
      FROM pg_namespace namespace
      JOIN pg_roles owner ON owner.oid = namespace.nspowner
     WHERE namespace.nspname = $1
  `, [configuration.bootstrap.schema]);
  if (schema.rowCount !== 1) {
    throw new Error(`target schema ${configuration.bootstrap.schema} does not exist`);
  }
  return {
    databaseOwner: database.rows[0]?.owner,
    objectOwners: [
      ...inventory.relations,
      ...inventory.types,
      ...inventory.functions,
      ...inventory.indexes,
    ],
    schemaOwner: schema.rows[0].owner,
  };
}

function assertAdoptableOwners(state, configuration) {
  const allowed = new Set([
    configuration.bootstrap.role,
    configuration.roles.migration.role,
  ]);
  if (!allowed.has(state.databaseOwner)) {
    throw new Error(`database is owned by unexpected role ${state.databaseOwner}`);
  }
  if (!allowed.has(state.schemaOwner) && state.schemaOwner !== "pg_database_owner") {
    throw new Error(`target schema is owned by unexpected role ${state.schemaOwner}`);
  }
  const unexpected = state.objectOwners.find(({ owner }) => !allowed.has(owner));
  if (unexpected) {
    throw new Error(`database object ${unexpected.name} is owned by unexpected role ${unexpected.owner}`);
  }
}

async function transferObjectOwnership(client, configuration, inventory) {
  const migration = quoteIdentifier(configuration.roles.migration.role);
  const database = quoteIdentifier(configuration.bootstrap.database);
  const schema = quoteIdentifier(configuration.bootstrap.schema);
  await client.query(
    `ALTER DATABASE ${database} OWNER TO ${quoteIdentifier(configuration.bootstrap.role)}`,
  );
  await client.query(`ALTER SCHEMA ${schema} OWNER TO ${migration}`);
  for (const relation of inventory.relations) {
    const object = qualified(configuration.bootstrap.schema, relation.name);
    const statement = relation.kind === "S"
      ? "ALTER SEQUENCE"
      : relation.kind === "v"
        ? "ALTER VIEW"
        : relation.kind === "m"
          ? "ALTER MATERIALIZED VIEW"
          : relation.kind === "f"
            ? "ALTER FOREIGN TABLE"
            : "ALTER TABLE";
    await client.query(`${statement} ${object} OWNER TO ${migration}`);
  }
  for (const type of inventory.types) {
    await client.query(
      `ALTER TYPE ${qualified(configuration.bootstrap.schema, type.name)} OWNER TO ${migration}`,
    );
  }
  for (const fn of inventory.functions) {
    await client.query(
      `ALTER FUNCTION ${qualified(configuration.bootstrap.schema, fn.name)}(${fn.identity_arguments}) OWNER TO ${migration}`,
    );
  }
}

async function installFailClosedDefaults(client, configuration) {
  const migration = quoteIdentifier(configuration.roles.migration.role);
  const schema = quoteIdentifier(configuration.bootstrap.schema);
  const runtimeRoles = RUNTIME_ROLE_KEYS
    .map((key) => quoteIdentifier(configuration.roles[key].role));
  const grantees = ["PUBLIC", ...runtimeRoles].join(", ");
  for (const objectKind of ["TABLES", "SEQUENCES", "TYPES", "FUNCTIONS"]) {
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} REVOKE ALL PRIVILEGES ON ${objectKind} FROM ${grantees}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema} REVOKE ALL PRIVILEGES ON ${objectKind} FROM ${grantees}`,
    );
  }
}

async function retentionPolicyTableExists(client, configuration) {
  const result = await client.query(
    "SELECT to_regclass(format('%I.%I', $1::text, '_clean_pay_retention_policy')) IS NOT NULL AS exists",
    [configuration.bootstrap.schema],
  );
  return result.rows[0]?.exists === true;
}

async function assertExactRetentionPolicy(client, configuration) {
  if (!await retentionPolicyTableExists(client, configuration)) {
    throw new Error("guarded retention policy table is missing");
  }
  const result = await client.query(`
    SELECT singleton,
           auth_state_days AS "authStateDays",
           session_days AS "sessionDays",
           audit_info_days AS "auditInfoDays",
           audit_security_days AS "auditSecurityDays",
           rate_limit_days AS "rateLimitDays",
           payment_sensitive_days AS "paymentSensitiveDays",
           payment_operation_snapshot_days AS "paymentOperationSnapshotDays",
           payment_hold_disposed_days AS "paymentHoldDisposedDays",
           updated_at <= (
             pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
           )::timestamp(3) AS "serverTimestampNotFuture"
      FROM ${qualified(configuration.bootstrap.schema, "_clean_pay_retention_policy")}
  `);
  const row = result.rows[0];
  if (
    result.rowCount !== 1
    || row.singleton !== true
    || row.serverTimestampNotFuture !== true
    || RETENTION_POLICY_FIELDS.some(
      ({ key }) => row[key] !== configuration.retentionPolicy[key],
    )
  ) {
    throw new Error("guarded retention policy does not match the exact configured production policy");
  }
}

async function reconcileRetentionPolicy(
  client,
  configuration,
  { required: policyRequired = true } = {},
) {
  const exists = await retentionPolicyTableExists(client, configuration);
  if (!exists) {
    if (policyRequired) throw new Error("guarded retention policy table is missing");
    return false;
  }
  const values = RETENTION_POLICY_FIELDS.map(
    ({ key }) => configuration.retentionPolicy[key],
  );
  await client.query(`
    INSERT INTO ${qualified(configuration.bootstrap.schema, "_clean_pay_retention_policy")} (
      singleton,
      auth_state_days,
      session_days,
      audit_info_days,
      audit_security_days,
      rate_limit_days,
      payment_sensitive_days,
      payment_operation_snapshot_days,
      payment_hold_disposed_days,
      updated_at
    ) VALUES (
      TRUE, $1, $2, $3, $4, $5, $6, $7, $8,
      (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
    )
    ON CONFLICT (singleton) DO UPDATE
      SET auth_state_days = EXCLUDED.auth_state_days,
          session_days = EXCLUDED.session_days,
          audit_info_days = EXCLUDED.audit_info_days,
          audit_security_days = EXCLUDED.audit_security_days,
          rate_limit_days = EXCLUDED.rate_limit_days,
          payment_sensitive_days = EXCLUDED.payment_sensitive_days,
          payment_operation_snapshot_days = EXCLUDED.payment_operation_snapshot_days,
          payment_hold_disposed_days = EXCLUDED.payment_hold_disposed_days,
          updated_at = EXCLUDED.updated_at
    WHERE (
      _clean_pay_retention_policy.auth_state_days,
      _clean_pay_retention_policy.session_days,
      _clean_pay_retention_policy.audit_info_days,
      _clean_pay_retention_policy.audit_security_days,
      _clean_pay_retention_policy.rate_limit_days,
      _clean_pay_retention_policy.payment_sensitive_days,
      _clean_pay_retention_policy.payment_operation_snapshot_days,
      _clean_pay_retention_policy.payment_hold_disposed_days
    ) IS DISTINCT FROM (
      EXCLUDED.auth_state_days,
      EXCLUDED.session_days,
      EXCLUDED.audit_info_days,
      EXCLUDED.audit_security_days,
      EXCLUDED.rate_limit_days,
      EXCLUDED.payment_sensitive_days,
      EXCLUDED.payment_operation_snapshot_days,
      EXCLUDED.payment_hold_disposed_days
    )
  `, values);
  await assertExactRetentionPolicy(client, configuration);
  return true;
}

async function prepareDatabaseRoles(client, configuration, environment) {
  if (environment.CLEAN_PAY_DATABASE_MAINTENANCE_CONFIRMED !== "true") {
    throw new Error("role provisioning requires CLEAN_PAY_DATABASE_MAINTENANCE_CONFIRMED=true after runtimes are stopped");
  }
  await runProvisioningTransaction(client, async () => {
    await reconcileLoginRoles(client, configuration);
    await assertExactClusterRoleInventory(client, configuration);
    await assertDedicatedClusterTopology(client, configuration);
    await assertDatabaseWideSurface(client, configuration);
    await ensureTargetSchema(client, configuration);
    await assertReviewedCatalogState(client, configuration);
    const inventory = await inventoryDatabaseObjects(client, configuration.bootstrap.schema);
    const state = await ownershipState(client, configuration, inventory);
    assertAdoptableOwners(state, configuration);
    await assertNoUnexpectedGrantees(client, configuration, { allowBootstrap: true });
    const migrationRole = configuration.roles.migration.role;
    const ownershipMismatch = state.databaseOwner !== configuration.bootstrap.role
      || state.schemaOwner !== migrationRole
      || state.objectOwners.some(({ owner }) => owner !== migrationRole);
    const populated = inventory.relations.length + inventory.types.length + inventory.functions.length > 0;
    if (populated && ownershipMismatch) {
      if (
        environment.CLEAN_PAY_DATABASE_ADOPT_EXISTING !== "true"
        || environment.CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED !== "true"
      ) {
        throw new Error(
          "existing database ownership requires CLEAN_PAY_DATABASE_ADOPT_EXISTING=true and CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=true after a verified backup",
        );
      }
    }
    if (ownershipMismatch) {
      await transferObjectOwnership(client, configuration, inventory);
    }
    await reconcileRetentionPolicy(client, configuration, { required: false });
    await revokeRoleObjectPrivileges(client, configuration, inventory);
    const schema = quoteIdentifier(configuration.bootstrap.schema);
    const database = quoteIdentifier(configuration.bootstrap.database);
    const nonBootstrapRoles = Object.values(configuration.roles)
      .map(({ role }) => quoteIdentifier(role));
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM PUBLIC, ${nonBootstrapRoles.join(", ")}`);
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${nonBootstrapRoles.join(", ")}`);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${nonBootstrapRoles.join(", ")}`);
    await hardenDedicatedClusterSurface(client, configuration);
    await assertExactParameterPrivileges(client, configuration);
    await assertNoNonTargetConfiguredRoleSurface(client, configuration);
    await assertNoUnexpectedSystemPublicAcl(client, configuration);
    await assertDatabaseEnvironmentContract(client, configuration);
    await installFailClosedDefaults(client, configuration);
    await assertNoUnexpectedGrantees(client, configuration);
    await assertNoPublicPrivileges(client, configuration);
    await assertFailClosedDefaultPrivileges(client, configuration);
    await terminateRuntimeRoleSessions(client, configuration);
    await setConfiguredRoleLoginState(client, configuration, ["migration"]);
    await assertRoleFlags(client, configuration, { loginRoleKeys: ["migration"] });
  });
  await terminateRuntimeRoleSessions(client, configuration);
}

function logicalRoles(configuration) {
  return Object.freeze({
    application: configuration.roles.application.role,
    holdOperator: configuration.roles.holdOperator.role,
    retention: configuration.roles.retention.role,
  });
}

async function revokeRoleObjectPrivileges(client, configuration, inventory) {
  const roles = Object.values(logicalRoles(configuration)).map(quoteIdentifier);
  const grantees = ["PUBLIC", ...roles].join(", ");
  for (const relation of inventory.relations) {
    const object = qualified(configuration.bootstrap.schema, relation.name);
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${object} FROM ${grantees}`);
    const columns = inventory.columnsByTable.get(relation.name) ?? [];
    if (columns.length > 0) {
      const columnList = columns.map(quoteIdentifier).join(", ");
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
        await client.query(
          `REVOKE ${privilege} (${columnList}) ON TABLE ${object} FROM ${grantees}`,
        );
      }
    }
  }
  for (const type of inventory.types) {
    await client.query(
      `REVOKE ALL PRIVILEGES ON TYPE ${qualified(configuration.bootstrap.schema, type.name)} FROM ${grantees}`,
    );
  }
  for (const fn of inventory.functions) {
    await client.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${qualified(configuration.bootstrap.schema, fn.name)}(${fn.identity_arguments}) FROM ${grantees}`,
    );
  }
}

async function grantTablePrivileges(client, configuration, role, matrix) {
  for (const [table, privileges] of Object.entries(matrix)) {
    if (privileges.length === 0) continue;
    await client.query(
      `GRANT ${privileges.join(", ")} ON TABLE ${qualified(configuration.bootstrap.schema, table)} TO ${quoteIdentifier(role)}`,
    );
  }
}

async function grantColumnPrivileges(client, configuration, role, privilege, matrix) {
  for (const [table, columns] of Object.entries(matrix)) {
    if (columns.length === 0) continue;
    await client.query(
      `GRANT ${privilege} (${columns.map(quoteIdentifier).join(", ")}) ON TABLE ${qualified(configuration.bootstrap.schema, table)} TO ${quoteIdentifier(role)}`,
    );
  }
}

async function applyExactPrivileges(client, configuration, inventory) {
  const roles = logicalRoles(configuration);
  const database = quoteIdentifier(configuration.bootstrap.database);
  const schema = quoteIdentifier(configuration.bootstrap.schema);
  const runtimeRoles = Object.values(roles).map(quoteIdentifier);
  const nonBootstrapRoles = [
    quoteIdentifier(configuration.roles.migration.role),
    ...runtimeRoles,
  ].join(", ");
  const runtimeRoleList = runtimeRoles.join(", ");
  await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM PUBLIC, ${nonBootstrapRoles}`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${nonBootstrapRoles}`);
  await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM PUBLIC, ${runtimeRoleList}`);
  await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRoleList}`);
  await revokeRoleObjectPrivileges(client, configuration, inventory);
  await grantTablePrivileges(client, configuration, roles.application, APPLICATION_TABLE_PRIVILEGES);
  await grantColumnPrivileges(client, configuration, roles.application, "SELECT", APPLICATION_COLUMN_SELECTS);
  await grantColumnPrivileges(client, configuration, roles.application, "INSERT", APPLICATION_COLUMN_INSERTS);
  await grantColumnPrivileges(client, configuration, roles.application, "UPDATE", APPLICATION_COLUMN_UPDATES);
  await grantTablePrivileges(client, configuration, roles.retention, RETENTION_TABLE_PRIVILEGES);
  await grantColumnPrivileges(client, configuration, roles.retention, "SELECT", RETENTION_COLUMN_SELECTS);
  await grantColumnPrivileges(client, configuration, roles.retention, "UPDATE", RETENTION_COLUMN_UPDATES);
  await grantTablePrivileges(client, configuration, roles.holdOperator, HOLD_OPERATOR_TABLE_PRIVILEGES);
  await grantColumnPrivileges(client, configuration, roles.holdOperator, "SELECT", HOLD_OPERATOR_COLUMN_SELECTS);
  await grantColumnPrivileges(client, configuration, roles.holdOperator, "INSERT", HOLD_OPERATOR_COLUMN_INSERTS);
  await grantColumnPrivileges(client, configuration, roles.holdOperator, "UPDATE", HOLD_OPERATOR_COLUMN_UPDATES);
  for (const [logicalRole, typeNames] of Object.entries(ROLE_ENUM_TYPES)) {
    const role = logicalRole === "holdOperator" ? roles.holdOperator : roles[logicalRole];
    for (const type of typeNames) {
      await client.query(
        `GRANT USAGE ON TYPE ${qualified(configuration.bootstrap.schema, type)} TO ${quoteIdentifier(role)}`,
      );
    }
  }
  for (const fn of DATABASE_FUNCTIONS) {
    for (const logicalRole of fn.executeRoles) {
      await client.query(
        `GRANT EXECUTE ON FUNCTION ${qualified(configuration.bootstrap.schema, fn.name)}(${fn.identityArguments}) TO ${quoteIdentifier(roles[logicalRole])}`,
      );
    }
  }
  await installFailClosedDefaults(client, configuration);
  await assertNoUnexpectedGrantees(client, configuration);
  await assertFailClosedDefaultPrivileges(client, configuration);
  await assertExactParameterPrivileges(client, configuration);
}

function expectedTablePrivileges(logicalRole, table) {
  const matrix = logicalRole === "application"
    ? APPLICATION_TABLE_PRIVILEGES
    : logicalRole === "retention"
      ? RETENTION_TABLE_PRIVILEGES
      : HOLD_OPERATOR_TABLE_PRIVILEGES;
  return new Set(matrix[table] ?? []);
}

function expectedColumnPrivilege(logicalRole, table, column, privilege) {
  if (expectedTablePrivileges(logicalRole, table).has(privilege)) return true;
  const matrices = logicalRole === "application"
    ? { INSERT: APPLICATION_COLUMN_INSERTS, SELECT: APPLICATION_COLUMN_SELECTS, UPDATE: APPLICATION_COLUMN_UPDATES }
    : logicalRole === "retention"
      ? { SELECT: RETENTION_COLUMN_SELECTS, UPDATE: RETENTION_COLUMN_UPDATES }
      : { INSERT: HOLD_OPERATOR_COLUMN_INSERTS, SELECT: HOLD_OPERATOR_COLUMN_SELECTS, UPDATE: HOLD_OPERATOR_COLUMN_UPDATES };
  return matrices[privilege]?.[table]?.includes(column) ?? false;
}

async function assertRoleFlags(
  client,
  configuration,
  { loginRoleKeys = RUNTIME_ROLE_KEYS } = {},
) {
  const expectedLogins = new Set(loginRoleKeys);
  const databaseWideSettings = await client.query(`
    SELECT setting.setconfig
      FROM pg_db_role_setting setting
      JOIN pg_database database ON database.oid = setting.setdatabase
     WHERE database.datname = current_database()
       AND setting.setrole = 0
  `);
  if (databaseWideSettings.rowCount !== 0) {
    throw new Error("application database must not have database-wide role settings");
  }
  const expectedSearchPath = await client.query(
    "SELECT pg_catalog.format('search_path=pg_catalog, %I', $1::text) AS setting",
    [configuration.bootstrap.schema],
  );
  for (const [roleKey, role] of Object.entries(configuration.roles)) {
    const result = await client.query(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin,
             rolreplication, rolbypassrls, rolconnlimit,
             rolvaliduntil::text AS valid_until, rolpassword
        FROM pg_authid
       WHERE rolname = $1
    `, [role.role]);
    const flags = result.rows[0];
    if (
      !flags
      || flags.rolsuper
      || flags.rolcreatedb
      || flags.rolcreaterole
      || flags.rolinherit
      || flags.rolcanlogin !== expectedLogins.has(roleKey)
      || flags.rolreplication
      || flags.rolbypassrls
      || flags.rolconnlimit !== -1
      || flags.valid_until !== "infinity"
      || !scramVerifierMatchesPassword(flags.rolpassword, role.password)
    ) {
      throw new Error(`database role ${role.role} does not have the exact least-privilege role flags`);
    }
    const memberships = await client.query(`
      SELECT count(*)::int AS count
        FROM pg_auth_members membership
        JOIN pg_roles parent ON parent.oid = membership.roleid
        JOIN pg_roles member ON member.oid = membership.member
       WHERE member.rolname = $1 OR parent.rolname = $1
    `, [role.role]);
    if (memberships.rows[0].count !== 0) {
      throw new Error(`database role ${role.role} must not inherit membership in another role`);
    }
    const settings = await client.query(`
      SELECT database.datname, setting.setconfig
        FROM pg_db_role_setting setting
        LEFT JOIN pg_database database ON database.oid = setting.setdatabase
        JOIN pg_roles configured_role ON configured_role.oid = setting.setrole
       WHERE configured_role.rolname = $1
       ORDER BY setting.setdatabase
    `, [role.role]);
    if (
      settings.rowCount !== 1
      || settings.rows[0].datname !== configuration.bootstrap.database
      || !sameSet(settings.rows[0].setconfig, [
        expectedSearchPath.rows[0].setting,
      ])
    ) {
      throw new Error(`database role ${role.role} must use only the exact pg_catalog-first search_path`);
    }
  }
}

async function assertExactOwnership(client, configuration, inventory) {
  const state = await ownershipState(client, configuration, inventory);
  const migration = configuration.roles.migration.role;
  if (
    state.databaseOwner !== configuration.bootstrap.role
    || state.schemaOwner !== migration
    || state.objectOwners.some(({ owner }) => owner !== migration)
  ) {
    throw new Error("bootstrap must own the database and migration must own the target schema and every non-extension schema object");
  }
}

async function assertNoUnexpectedGrantees(
  client,
  configuration,
  { allowBootstrap = false } = {},
) {
  const allowedRoles = [
    configuration.roles.migration.role,
    ...RUNTIME_ROLE_KEYS.map((key) => configuration.roles[key].role),
    configuration.bootstrap.role,
    ...(allowBootstrap ? ["pg_database_owner"] : []),
  ];
  const result = await client.query(`
    SELECT acl_object.kind, acl_object.name,
           COALESCE(grantee.rolname, '<dropped-role>') AS grantee,
           acl_object.is_grantable
      FROM (
        SELECT 'database'::text AS kind, database.datname AS name,
               acl.grantee, acl.is_grantable
          FROM pg_database database
          CROSS JOIN LATERAL aclexplode(
            COALESCE(database.datacl, acldefault('d', database.datdba))
          ) acl
         WHERE database.datname = current_database()
        UNION ALL
        SELECT 'schema', namespace.nspname, acl.grantee, acl.is_grantable
          FROM pg_namespace namespace
          CROSS JOIN LATERAL aclexplode(
            COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
          ) acl
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'relation', relation.relname, acl.grantee, acl.is_grantable
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL aclexplode(COALESCE(
            relation.relacl,
            acldefault(
              CASE WHEN relation.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
              relation.relowner
            )
          )) acl
         WHERE namespace.nspname = $1
           AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        UNION ALL
        SELECT 'column', relation.relname || '.' || attribute.attname,
               acl.grantee, acl.is_grantable
          FROM pg_attribute attribute
          JOIN pg_class relation ON relation.oid = attribute.attrelid
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
         WHERE namespace.nspname = $1
           AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
        UNION ALL
        SELECT 'function', function.proname, acl.grantee, acl.is_grantable
          FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
          CROSS JOIN LATERAL aclexplode(
            COALESCE(function.proacl, acldefault('f', function.proowner))
          ) acl
         WHERE namespace.nspname = $1
        UNION ALL
        SELECT 'type', type.typname, acl.grantee, acl.is_grantable
          FROM pg_type type
          JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
          CROSS JOIN LATERAL aclexplode(
            COALESCE(type.typacl, acldefault('T', type.typowner))
          ) acl
         WHERE namespace.nspname = $1
           AND (
             type.typtype IN ('e', 'd', 'r', 'm')
             OR (
               type.typtype = 'c'
               AND EXISTS (
                 SELECT 1
                   FROM pg_class composite
                  WHERE composite.oid = type.typrelid
                    AND composite.relkind = 'c'
               )
             )
           )
      ) acl_object
      LEFT JOIN pg_roles grantee ON grantee.oid = acl_object.grantee
     WHERE (
       acl_object.grantee <> 0
       AND (grantee.rolname IS NULL OR NOT (grantee.rolname = ANY($2::text[])))
     ) OR (
       grantee.rolname = $4
       AND NOT $5::boolean
       AND acl_object.kind <> 'database'
     ) OR (
       grantee.rolname = ANY($3::text[])
       AND acl_object.is_grantable
     )
     LIMIT 1
  `, [
    configuration.bootstrap.schema,
    allowedRoles,
    RUNTIME_ROLE_KEYS.map((key) => configuration.roles[key].role),
    configuration.bootstrap.role,
    allowBootstrap,
  ]);
  if (result.rowCount > 0) {
    const first = result.rows[0];
    throw new Error(
      `${first.is_grantable ? "runtime grant option" : "unexpected ACL grantee"} ${first.grantee} remains on ${first.kind} ${first.name}`,
    );
  }
}

async function assertNoPublicPrivileges(client, configuration) {
  const result = await client.query(`
    SELECT 'database' AS kind, database.datname AS name, acl.privilege_type
      FROM pg_database database
      CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
     WHERE database.datname = current_database() AND acl.grantee = 0
    UNION ALL
    SELECT 'schema', namespace.nspname, acl.privilege_type
      FROM pg_namespace namespace
      CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
     WHERE namespace.nspname = $1 AND acl.grantee = 0
    UNION ALL
    SELECT 'relation', relation.relname, acl.privilege_type
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
     WHERE namespace.nspname = $1 AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f') AND acl.grantee = 0
    UNION ALL
    SELECT 'column', relation.relname || '.' || attribute.attname::text,
           acl.privilege_type
      FROM pg_attribute attribute
      JOIN pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
     WHERE namespace.nspname = $1
       AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee = 0
    UNION ALL
    SELECT 'function', function.proname, acl.privilege_type
      FROM pg_proc function
      JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(function.proacl, acldefault('f', function.proowner))) acl
     WHERE namespace.nspname = $1 AND acl.grantee = 0
    UNION ALL
    SELECT 'type', type.typname, acl.privilege_type
      FROM pg_type type
      JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(type.typacl, acldefault('T', type.typowner))) acl
     WHERE namespace.nspname = $1
       AND (
         type.typtype IN ('e', 'd', 'r', 'm')
         OR (
           type.typtype = 'c'
           AND EXISTS (
             SELECT 1
               FROM pg_class composite
              WHERE composite.oid = type.typrelid
                AND composite.relkind = 'c'
           )
         )
       )
       AND acl.grantee = 0
  `, [configuration.bootstrap.schema]);
  if (result.rowCount > 0) {
    const first = result.rows[0];
    throw new Error(`dangerous PUBLIC ${first.privilege_type} privilege remains on ${first.kind} ${first.name}`);
  }
}

async function assertFailClosedDefaultPrivileges(client, configuration) {
  const result = await client.query(`
    WITH migration_owner AS (
      SELECT oid
        FROM pg_roles
       WHERE rolname = $1
    ), object_kinds(object_kind) AS (
      VALUES ('r'::"char"), ('S'::"char"), ('f'::"char"), ('T'::"char")
    ), global_defaults AS (
      SELECT '<global>'::text AS scope, kinds.object_kind,
             owner.oid AS owner_oid, acl.grantee, acl.privilege_type
        FROM migration_owner owner
        CROSS JOIN object_kinds kinds
        LEFT JOIN pg_default_acl defaults
          ON defaults.defaclrole = owner.oid
         AND defaults.defaclnamespace = 0
         AND defaults.defaclobjtype = kinds.object_kind
        CROSS JOIN LATERAL aclexplode(
          COALESCE(defaults.defaclacl, acldefault(kinds.object_kind, owner.oid))
        ) acl
    ), schema_defaults AS (
      SELECT namespace.nspname AS scope, defaults.defaclobjtype AS object_kind,
             owner.oid AS owner_oid, acl.grantee, acl.privilege_type
        FROM pg_default_acl defaults
        JOIN migration_owner owner ON owner.oid = defaults.defaclrole
        JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
       WHERE namespace.nspname = $2
    )
    SELECT defaults.scope, defaults.object_kind, defaults.privilege_type,
           CASE WHEN defaults.grantee = 0 THEN 'PUBLIC'
                ELSE COALESCE(grantee.rolname, '<dropped-role>') END AS grantee
      FROM (
        SELECT * FROM global_defaults
        UNION ALL
        SELECT * FROM schema_defaults
      ) defaults
      LEFT JOIN pg_roles grantee ON grantee.oid = defaults.grantee
     WHERE defaults.grantee <> defaults.owner_oid
  `, [
    configuration.roles.migration.role,
    configuration.bootstrap.schema,
  ]);
  if (result.rowCount > 0) {
    const first = result.rows[0];
    throw new Error(
      `dangerous default ${first.privilege_type} privilege for ${first.grantee} remains on ${first.scope} ${first.object_kind} objects`,
    );
  }
}

async function assertDedicatedRuntimeIsolation(client, configuration) {
  await assertDedicatedClusterTopology(client, configuration);
  const nonBootstrapRoles = Object.values(configuration.roles).map(({ role }) => role);
  const largeObjects = await client.query(
    "SELECT count(*)::int AS count FROM pg_largeobject_metadata",
  );
  if (largeObjects.rows[0].count !== 0) {
    throw new Error("dedicated application database must not contain PostgreSQL large objects");
  }
  const largeObjectFunctions = await client.query(`
    SELECT function.oid, function.proname AS name,
           pg_get_function_identity_arguments(function.oid) AS identity_arguments,
           EXISTS (
             SELECT 1
               FROM aclexplode(COALESCE(function.proacl, acldefault('f', function.proowner))) acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute
      FROM pg_proc function
      JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'pg_catalog'
       AND function.proname = ANY($1::text[])
     ORDER BY function.proname, pg_get_function_identity_arguments(function.oid)
  `, [[
    "lo_create", "lo_creat", "lo_export", "lo_from_bytea", "lo_import", "lo_open",
    "lo_put", "lo_truncate", "lo_truncate64", "lo_unlink", "lowrite",
  ]]);
  for (const fn of largeObjectFunctions.rows) {
    if (fn.public_execute) {
      throw new Error(`PUBLIC can execute large-object mutator ${fn.name}(${fn.identity_arguments})`);
    }
    for (const role of nonBootstrapRoles) {
      const privilege = await client.query(
        "SELECT has_function_privilege($1, $2::oid, 'EXECUTE') AS allowed",
        [role, fn.oid],
      );
      if (privilege.rows[0].allowed) {
        throw new Error(`${role} can execute large-object mutator ${fn.name}(${fn.identity_arguments})`);
      }
    }
  }
  for (const [roleKey, role] of Object.entries(configuration.roles)) {
    const targetPrivileges = await client.query(`
      SELECT has_database_privilege($1, current_database(), 'CONNECT') AS connect,
             has_database_privilege($1, current_database(), 'CREATE') AS create,
             has_database_privilege($1, current_database(), 'TEMP') AS temporary,
             has_schema_privilege($1, $2, 'USAGE') AS usage,
             has_schema_privilege($1, $2, 'CREATE') AS schema_create
    `, [role.role, configuration.bootstrap.schema]);
    const target = targetPrivileges.rows[0];
    if (
      !target.connect
      || target.create
      || target.temporary
      || !target.usage
      || target.schema_create !== (roleKey === "migration")
    ) {
      throw new Error(`${role.role} has privileges outside its exact application database boundary`);
    }
  }
  const siblingDatabases = await client.query(
    "SELECT datname FROM pg_database WHERE datname <> current_database() ORDER BY datname",
  );
  for (const { datname } of siblingDatabases.rows) {
    for (const role of nonBootstrapRoles) {
      const privileges = await client.query(`
        SELECT has_database_privilege($1, $2, 'CONNECT') AS connect,
               has_database_privilege($1, $2, 'CREATE') AS create,
               has_database_privilege($1, $2, 'TEMP') AS temporary
      `, [role, datname]);
      const row = privileges.rows[0];
      if (row.connect || row.create || row.temporary) {
        throw new Error(`${role} has privileges on non-application database ${datname}`);
      }
    }
    const publicPrivileges = await client.query(`
      SELECT acl.privilege_type
        FROM pg_database database
        CROSS JOIN LATERAL aclexplode(
          COALESCE(database.datacl, acldefault('d', database.datdba))
        ) acl
       WHERE database.datname = $1
         AND acl.grantee = 0
       LIMIT 1
    `, [datname]);
    if (publicPrivileges.rowCount > 0) {
      throw new Error(`PUBLIC retains privileges on non-application database ${datname}`);
    }
  }
  if (configuration.bootstrap.schema !== "public") {
    const publicSchema = await client.query(`
      SELECT owner.rolname AS owner
        FROM pg_namespace namespace
        JOIN pg_roles owner ON owner.oid = namespace.nspowner
       WHERE namespace.nspname = 'public'
    `);
    if (
      publicSchema.rowCount > 0
      && ![configuration.bootstrap.role, "pg_database_owner"].includes(publicSchema.rows[0].owner)
    ) {
      throw new Error("non-target public schema has an unexpected owner");
    }
    const publicAcl = await client.query(`
      SELECT acl.privilege_type
        FROM pg_namespace namespace
        CROSS JOIN LATERAL aclexplode(
          COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
        ) acl
       WHERE namespace.nspname = 'public'
         AND acl.grantee = 0
       LIMIT 1
    `);
    if (publicAcl.rowCount > 0) {
      throw new Error("PUBLIC retains privileges on the non-target public schema");
    }
    for (const role of nonBootstrapRoles) {
      if (publicSchema.rowCount === 0) break;
      const privileges = await client.query(`
        SELECT has_schema_privilege($1, 'public', 'USAGE') AS usage,
               has_schema_privilege($1, 'public', 'CREATE') AS create
      `, [role]);
      if (privileges.rows[0].usage || privileges.rows[0].create) {
        throw new Error(`${role} has privileges outside the target schema`);
      }
    }
  }
}

async function assertRuntimePrivileges(client, configuration, inventory) {
  const roles = logicalRoles(configuration);
  const relationOids = new Map(inventory.relations.map((row) => [row.name, row.oid]));
  for (const [logicalRole, role] of Object.entries(roles)) {
    const databaseChecks = await client.query(`
      SELECT has_database_privilege($1, current_database(), 'CONNECT') AS connect,
             has_database_privilege($1, current_database(), 'CREATE') AS create,
             has_database_privilege($1, current_database(), 'TEMP') AS temporary,
             has_schema_privilege($1, $2, 'USAGE') AS usage,
             has_schema_privilege($1, $2, 'CREATE') AS schema_create
    `, [role, configuration.bootstrap.schema]);
    const database = databaseChecks.rows[0];
    if (!database.connect || database.create || database.temporary || !database.usage || database.schema_create) {
      throw new Error(`${role} has unexpected database or schema privileges`);
    }
    for (const table of [...DATABASE_TABLES, ...DATABASE_INTERNAL_TABLES]) {
      const oid = relationOids.get(table);
      for (const privilege of TABLE_PRIVILEGES) {
        const result = await client.query(
          "SELECT has_table_privilege($1, $2::oid, $3) AS allowed",
          [role, oid, privilege],
        );
        const expected = expectedTablePrivileges(logicalRole, table).has(privilege);
        if (result.rows[0].allowed !== expected) {
          throw new Error(`${role} has unexpected ${privilege} privilege on ${table}`);
        }
      }
      for (const column of inventory.columnsByTable.get(table) ?? []) {
        for (const privilege of COLUMN_PRIVILEGES) {
          const result = await client.query(
            "SELECT has_column_privilege($1, $2::oid, $3, $4) AS allowed",
            [role, oid, column, privilege],
          );
          const expected = expectedColumnPrivilege(logicalRole, table, column, privilege);
          if (result.rows[0].allowed !== expected) {
            throw new Error(`${role} has unexpected ${privilege} privilege on ${table}.${column}`);
          }
        }
      }
    }
    const expectedTypes = new Set(ROLE_ENUM_TYPES[logicalRole] ?? []);
    for (const type of inventory.types) {
      const result = await client.query(
        "SELECT has_type_privilege($1, $2::oid, 'USAGE') AS allowed",
        [role, type.oid],
      );
      if (result.rows[0].allowed !== expectedTypes.has(type.name)) {
        throw new Error(`${role} has unexpected USAGE privilege on type ${type.name}`);
      }
    }
    for (const fn of inventory.functions) {
      const expectedFunction = DATABASE_FUNCTIONS.find((item) => functionKey(item) === functionKey(fn));
      const result = await client.query(
        "SELECT has_function_privilege($1, $2::oid, 'EXECUTE') AS allowed",
        [role, fn.oid],
      );
      if (result.rows[0].allowed !== expectedFunction.executeRoles.includes(logicalRole)) {
        throw new Error(`${role} has unexpected EXECUTE privilege on ${functionKey(fn)}`);
      }
    }
  }
}

async function assertTargetRuntimeObjectPrivilegesAbsent(
  client,
  configuration,
  inventory,
) {
  const runtimeRoles = RUNTIME_ROLE_KEYS.map((key) => configuration.roles[key].role);
  for (const role of runtimeRoles) {
    for (const relation of inventory.relations) {
      for (const privilege of TABLE_PRIVILEGES) {
        const result = await client.query(
          "SELECT has_table_privilege($1, $2::oid, $3) AS allowed",
          [role, relation.oid, privilege],
        );
        if (result.rows[0].allowed) {
          throw new Error(`${role} retains ${privilege} on fenced relation ${relation.name}`);
        }
      }
      for (const column of inventory.columnsByTable.get(relation.name) ?? []) {
        for (const privilege of COLUMN_PRIVILEGES) {
          const result = await client.query(
            "SELECT has_column_privilege($1, $2::oid, $3, $4) AS allowed",
            [role, relation.oid, column, privilege],
          );
          if (result.rows[0].allowed) {
            throw new Error(`${role} retains ${privilege} on fenced column ${relation.name}.${column}`);
          }
        }
      }
    }
    for (const type of inventory.types) {
      const result = await client.query(
        "SELECT has_type_privilege($1, $2::oid, 'USAGE') AS allowed",
        [role, type.oid],
      );
      if (result.rows[0].allowed) {
        throw new Error(`${role} retains USAGE on fenced type ${type.name}`);
      }
    }
    for (const fn of inventory.functions) {
      const result = await client.query(
        "SELECT has_function_privilege($1, $2::oid, 'EXECUTE') AS allowed",
        [role, fn.oid],
      );
      if (result.rows[0].allowed) {
        throw new Error(`${role} retains EXECUTE on fenced function ${functionKey(fn)}`);
      }
    }
  }
}

async function runRecoveryPreflight(
  client,
  configuration,
  environment,
  migrationName,
) {
  if (environment.CLEAN_PAY_DATABASE_MAINTENANCE_CONFIRMED !== "true") {
    throw new Error("recovery preflight requires stopped runtimes and maintenance confirmation");
  }
  await runProvisioningTransaction(client, async () => {
    await assertReviewedRecoveryPredecessor(
      client,
      configuration,
      migrationName,
    );
    const inventory = await inventoryDatabaseObjects(
      client,
      configuration.bootstrap.schema,
    );
    await assertExactClusterRoleInventory(client, configuration);
    await assertRoleFlags(client, configuration, { loginRoleKeys: [] });
    await assertExactOwnership(client, configuration, inventory);
    await assertNoUnexpectedGrantees(client, configuration);
    await assertNoPublicPrivileges(client, configuration);
    await assertFailClosedDefaultPrivileges(client, configuration);
    await assertExactParameterPrivileges(client, configuration);
    await assertDatabaseWideSurface(client, configuration);
    await assertNoNonTargetConfiguredRoleSurface(client, configuration);
    await assertNoUnexpectedSystemPublicAcl(client, configuration);
    await assertDedicatedRuntimeIsolation(client, configuration);
    await assertTargetRuntimeObjectPrivilegesAbsent(client, configuration, inventory);
    await setConfiguredRoleLoginState(client, configuration, ["migration"]);
    await assertRoleFlags(client, configuration, { loginRoleKeys: ["migration"] });
  });
  await terminateRuntimeRoleSessions(client, configuration);
}

async function verifyDatabaseContract(
  client,
  configuration,
  inventory,
  { loginRoleKeys = RUNTIME_ROLE_KEYS } = {},
) {
  assertExactManifest(inventory);
  await assertDatabaseEnvironmentContract(client, configuration);
  await assertExactClusterRoleInventory(client, configuration);
  await assertDatabaseWideSurface(client, configuration);
  await assertRoleFlags(client, configuration, { loginRoleKeys });
  await assertExactOwnership(client, configuration, inventory);
  await assertNoUnexpectedGrantees(client, configuration);
  await assertNoPublicPrivileges(client, configuration);
  await assertFailClosedDefaultPrivileges(client, configuration);
  await assertExactParameterPrivileges(client, configuration);
  await assertNoNonTargetConfiguredRoleSurface(client, configuration);
  await assertNoUnexpectedSystemPublicAcl(client, configuration);
  await assertDedicatedRuntimeIsolation(client, configuration);
  await assertRuntimePrivileges(client, configuration, inventory);
  await assertExactRetentionPolicy(client, configuration);
}

export async function runDatabaseRoleProvisioning({
  environment = process.env,
  migrationName,
  mode,
} = {}) {
  if (!["fence", "prepare", "recovery-preflight", "sync", "verify"].includes(mode)) {
    throw new Error("database role provisioning mode must be fence, prepare, recovery-preflight, sync, or verify");
  }
  if (
    mode === "recovery-preflight"
    && (typeof migrationName !== "string" || !Object.hasOwn(DATABASE_RECOVERY_PREDECESSOR_STATES, migrationName))
  ) {
    throw new Error("recovery-preflight requires one exact reviewed migration name");
  }
  const configuration = parseDatabaseRoleConfiguration(environment);
  const client = new Client({
    application_name: `clean-pay-db-role-${mode}`,
    connectionString: configuration.bootstrap.raw,
    connectionTimeoutMillis: 10_000,
    options: "-c search_path=pg_catalog",
    statement_timeout: 120_000,
  });
  await client.connect();
  let refenceOnFailure = false;
  try {
    await assertBootstrapIdentity(client, configuration);
    await client.query(
      "SELECT pg_catalog.set_config('search_path', pg_catalog.format('pg_catalog, %I', $1::text), false)",
      [configuration.bootstrap.schema],
    );
    await assertDatabaseEnvironmentContract(client, configuration);
    if (["fence", "prepare", "recovery-preflight", "sync"].includes(mode)) {
      if (environment.CLEAN_PAY_DATABASE_MAINTENANCE_CONFIRMED !== "true") {
        throw new Error(`${mode} requires stopped runtimes and maintenance confirmation`);
      }
      // The committed fail-closed fence must precede cooperative advisory
      // locks. A compromised runtime may itself hold the public PostgreSQL
      // advisory-lock functions; NOLOGIN plus session termination removes that
      // blocker before this process waits on either deployment lock.
      refenceOnFailure = true;
      await commitNoLoginFence(client, configuration);
      if (mode === "fence") return Object.freeze({
        manifestVersion: DATABASE_PRIVILEGE_MANIFEST_VERSION,
        mode,
      });
    }
    await withProvisioningLock(client, async () => {
      if (mode === "recovery-preflight") {
        await runRecoveryPreflight(
          client,
          configuration,
          environment,
          migrationName,
        );
        return;
      }
      if (mode === "prepare") {
        await prepareDatabaseRoles(client, configuration, environment);
        return;
      }
      if (mode === "sync") {
        await runProvisioningTransaction(client, async () => {
          await reconcileLoginRoles(client, configuration);
          await assertReviewedCatalogState(client, configuration, { postOnly: true });
          const inventory = await inventoryDatabaseObjects(
            client,
            configuration.bootstrap.schema,
          );
          assertExactManifest(inventory);
          await reconcileRetentionPolicy(client, configuration);
          await assertNoUnexpectedGrantees(client, configuration);
          await applyExactPrivileges(client, configuration, inventory);
          const verifiedInventory = await inventoryDatabaseObjects(
            client,
            configuration.bootstrap.schema,
          );
          await assertReviewedCatalogState(client, configuration, { postOnly: true });
          await setConfiguredRoleLoginState(client, configuration, RUNTIME_ROLE_KEYS);
          await verifyDatabaseContract(
            client,
            configuration,
            verifiedInventory,
          );
        });
        await terminateRuntimeRoleSessions(client, configuration);
        return;
      }
      await assertReviewedCatalogState(client, configuration, { postOnly: true });
      const inventory = await inventoryDatabaseObjects(
        client,
        configuration.bootstrap.schema,
      );
      await verifyDatabaseContract(client, configuration, inventory);
    });
  } catch (error) {
    if (refenceOnFailure) {
      try {
        await commitNoLoginFence(client, configuration);
      } catch (fenceError) {
        if (error instanceof Error) {
          error.message += `; automatic failure re-fence also failed: ${fenceError instanceof Error ? fenceError.message : String(fenceError)}`;
        }
      }
    }
    throw error;
  } finally {
    await client.end();
  }
  return Object.freeze({
    manifestVersion: DATABASE_PRIVILEGE_MANIFEST_VERSION,
    mode,
  });
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    if (
      process.argv.length < 3
      || process.argv.length > 4
      || (process.argv[2] === "recovery-preflight") !== (process.argv.length === 4)
    ) {
      throw new Error("usage: database-role-provision.mjs fence|prepare|recovery-preflight MIGRATION|sync|verify");
    }
    const result = await runDatabaseRoleProvisioning({
      migrationName: process.argv[3],
      mode: process.argv[2],
    });
    process.stdout.write(
      `Database role ${result.mode} completed with privilege manifest ${result.manifestVersion}.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Database role provisioning failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
