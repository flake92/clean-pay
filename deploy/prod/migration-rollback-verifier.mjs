import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { assertReviewedRecoveryPredecessor } from "./database-role-provision.mjs";
import { validateProductionDatabaseRoleEnvironment } from "./production-env-rules.mjs";

const { Pool } = pg;

export const APPROVED_ROLLBACK_MIGRATION =
  "20260718141000_drop_redundant_indexes";

export const APPROVED_ATOMIC_ROLLBACK_MIGRATIONS = Object.freeze([
  "20260825010000_add_durable_telegram_callback",
  "20260825210000_add_payment_sensitive_retention",
  "20260825220000_add_payment_retention_hold_lifecycle",
  "20260825230000_guard_retention_mutations",
]);

export const APPROVED_ATOMIC_MIGRATION_CHECKSUMS = Object.freeze({
  "20260825010000_add_durable_telegram_callback":
    "f899d737638c2a5a97eb9fddf4d571e28b2c22c72eb6121ea3ca487a1c3b3fc6",
  "20260825210000_add_payment_sensitive_retention":
    "12ffa81da01b36e93109f0118679a8d5ea731d2b6c9f7edf4713b0c8dcc8c4fd",
  "20260825220000_add_payment_retention_hold_lifecycle":
    "c8e607efaf9db0da0b352e29406bd88ac571cc6ffdeba29f3a3c06c1485ed146",
  "20260825230000_guard_retention_mutations":
    "98ff886adb0ca62778712d243c7f6d208612f82ac8407ca85aae3f89155b0456",
});

const DURABLE_CALLBACK_OBJECTS = Object.freeze([
  "type:TelegramCallbackStatus",
  "column:TelegramAuthState.callbackStatus",
  "column:TelegramAuthState.callbackCodeHash",
  "column:TelegramAuthState.callbackClaimTokenHash",
  "column:TelegramAuthState.callbackLeaseExpiresAt",
  "column:TelegramAuthState.callbackAttemptCount",
  "column:TelegramAuthState.callbackResultEncrypted",
  "column:TelegramAuthState.callbackResultExpiresAt",
  "column:TelegramAuthState.callbackWebSessionId",
  "column:TelegramAuthState.callbackCompletedAt",
  "column:TelegramAuthState.callbackFailureCode",
  "index:TelegramAuthState.TelegramAuthState_callbackStatus_callbackLeaseExpiresAt_idx",
  "index:TelegramAuthState.TelegramAuthState_callbackResultExpiresAt_idx",
  "index:TelegramAuthState.TelegramAuthState_callbackWebSessionId_idx",
]);

const PAYMENT_SENSITIVE_OBJECTS = Object.freeze([
  "column:PaymentRecord.retentionHoldAt",
  "column:PaymentRecord.terminalObservedAt",
  "column:PaymentRecord.sensitiveDataScrubbedAt",
  "column:PaymentOperation.retentionHoldAt",
  "column:PaymentOperation.snapshotScrubbedAt",
  "index:PaymentRecord.PaymentRecord_retention_scrub_candidates_idx",
  "index:PaymentRecord.PaymentRecord_retentionHoldAt_idx",
  "index:PaymentOperation.PaymentOperation_status_snapshotScrubbedAt_completedAt_idx",
  "index:PaymentOperation.PaymentOperation_retentionHoldAt_idx",
  "index:RateLimitEvent.RateLimitEvent_occurredAt_idx",
]);

export const ATOMIC_ROLLBACK_INVARIANTS = Object.freeze({
  "20260825010000_add_durable_telegram_callback": Object.freeze({
    absent: DURABLE_CALLBACK_OBJECTS,
    present: Object.freeze(["table:TelegramAuthState"]),
  }),
  "20260825210000_add_payment_sensitive_retention": Object.freeze({
    absent: PAYMENT_SENSITIVE_OBJECTS,
    present: Object.freeze([
      "table:PaymentOperation",
      "table:PaymentRecord",
      "table:RateLimitEvent",
      "table:TelegramAuthState",
      ...DURABLE_CALLBACK_OBJECTS,
    ]),
  }),
  "20260825220000_add_payment_retention_hold_lifecycle": Object.freeze({
    absent: Object.freeze([
      "type:PaymentRetentionHoldStatus",
      "type:PaymentRetentionHoldSelectorKind",
      "type:PaymentRetentionDisposition",
      "table:PaymentRetentionHold",
      "column:PaymentOperation.retentionHoldId",
      "column:PaymentRecord.retentionHoldId",
      "index:PaymentOperation.PaymentOperation_retentionHoldId_key",
      "index:PaymentRecord.PaymentRecord_retentionHoldId_key",
      "index:PaymentRetentionHold.PaymentRetentionHold_active_caseOperationId_key",
      "index:PaymentRetentionHold.PaymentRetentionHold_active_casePaymentRecordId_key",
      "constraint:PaymentOperation.PaymentOperation_retention_hold_pointer_pair_check",
      "constraint:PaymentRecord.PaymentRecord_retention_hold_pointer_pair_check",
      "constraint:PaymentOperation.PaymentOperation_retentionHoldId_fkey",
      "constraint:PaymentRecord.PaymentRecord_retentionHoldId_fkey",
      "constraint:PaymentRetentionHold.PaymentRetentionHold_caseOperationId_fkey",
      "constraint:PaymentRetentionHold.PaymentRetentionHold_casePaymentRecordId_fkey",
      "function:prevent_held_payment_case_link()",
      "function:prevent_retained_payment_hold_delete()",
      "function:prevent_payment_retention_hold_reassignment()",
      "function:enforce_payment_retention_hold_integrity()",
      "trigger:PaymentRecord.PaymentRecord_prevent_held_case_link",
      "trigger:PaymentRetentionHold.PaymentRetentionHold_prevent_retained_delete",
      "trigger:PaymentRetentionHold.PaymentRetentionHold_prevent_reassignment",
      "trigger:PaymentOperation.PaymentOperation_payment_retention_hold_integrity",
      "trigger:PaymentRecord.PaymentRecord_payment_retention_hold_integrity",
      "trigger:PaymentRetentionHold.PaymentRetentionHold_payment_retention_hold_integrity",
    ]),
    present: Object.freeze([
      "table:PaymentOperation",
      "table:PaymentRecord",
      "table:RateLimitEvent",
      "table:TelegramAuthState",
      ...DURABLE_CALLBACK_OBJECTS,
      ...PAYMENT_SENSITIVE_OBJECTS,
    ]),
  }),
  "20260825230000_guard_retention_mutations": Object.freeze({
    absent: Object.freeze([
      "table:_clean_pay_retention_policy",
      "function:clean_pay_retention_delete_batch(phase text)",
      "function:clean_pay_retention_scrub_telegram_callbacks()",
      "function:clean_pay_retention_scrub_payment_records()",
      "function:clean_pay_retention_scrub_payment_operation_snapshots()",
    ]),
    present: Object.freeze([
      "table:PaymentOperation",
      "table:PaymentRecord",
      "table:PaymentRetentionHold",
      "function:enforce_payment_retention_hold_integrity()",
    ]),
  }),
});

const APPROVED_ROLLBACK_MIGRATIONS = new Set([
  APPROVED_ROLLBACK_MIGRATION,
  ...APPROVED_ATOMIC_ROLLBACK_MIGRATIONS,
]);

export const REDUNDANT_INDEXES = Object.freeze([
  "PaymentRecord_paymentId_idx",
  "WebUser_email_idx",
  "WebUser_telegramId_idx",
]);

export const REQUIRED_UNIQUE_INDEXES = Object.freeze([
  "PaymentRecord_paymentId_key",
  "WebUser_email_key",
  "WebUser_telegramId_key",
]);

const REDUNDANT_INDEX_TOPOLOGY = Object.freeze([
  Object.freeze({
    columnName: "paymentId",
    indexName: "PaymentRecord_paymentId_idx",
    tableName: "PaymentRecord",
    unique: false,
  }),
  Object.freeze({
    columnName: "email",
    indexName: "WebUser_email_idx",
    tableName: "WebUser",
    unique: false,
  }),
  Object.freeze({
    columnName: "telegramId",
    indexName: "WebUser_telegramId_idx",
    tableName: "WebUser",
    unique: false,
  }),
]);

const REQUIRED_UNIQUE_INDEX_TOPOLOGY = Object.freeze([
  Object.freeze({
    columnName: "paymentId",
    indexName: "PaymentRecord_paymentId_key",
    tableName: "PaymentRecord",
    unique: true,
  }),
  Object.freeze({
    columnName: "email",
    indexName: "WebUser_email_key",
    tableName: "WebUser",
    unique: true,
  }),
  Object.freeze({
    columnName: "telegramId",
    indexName: "WebUser_telegramId_key",
    tableName: "WebUser",
    unique: true,
  }),
]);

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, "i");
const RECOVERY_TOKEN_PATTERN = new RegExp(
  `^(${UUID_SOURCE}):([0-9a-f]{64})$`,
  "i",
);
const LEDGER_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

function fail(message) {
  throw new Error(message);
}

function canonicalLedgerTimestamp(value, fieldName, nullable = true) {
  if (value === null) {
    if (nullable) return null;
    fail(`The migration ledger ${fieldName} is invalid.`);
  }
  if (typeof value !== "string" || !LEDGER_TIMESTAMP_PATTERN.test(value)) {
    fail(`The migration ledger ${fieldName} is invalid.`);
  }
  return value;
}

function migrationLedgerFingerprint(migrationRows, targetAttemptId) {
  if (!Array.isArray(migrationRows)) {
    fail("The migration ledger snapshot is unavailable.");
  }
  const canonicalRows = migrationRows.map((row) => {
    if (
      !UUID_PATTERN.test(row?.id)
      || typeof row.migrationName !== "string"
      || !/^[0-9a-f]{64}$/u.test(row.checksum)
      || !Number.isSafeInteger(row.appliedStepsCount)
      || row.appliedStepsCount < 0
      || (row.logs !== null && typeof row.logs !== "string")
      || typeof row.hasFailureLog !== "boolean"
    ) {
      fail("The migration ledger contains an invalid row.");
    }
    return {
      appliedStepsCount: row.appliedStepsCount,
      checksum: row.checksum,
      finishedAt: canonicalLedgerTimestamp(row.finishedAt, "finished_at"),
      id: row.id,
      logs: row.logs,
      migrationName: row.migrationName,
      rolledBackAt: row.id === targetAttemptId
        ? null
        : canonicalLedgerTimestamp(row.rolledBackAt, "rolled_back_at"),
      startedAt: canonicalLedgerTimestamp(row.startedAt, "started_at", false),
    };
  });
  canonicalRows.sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256")
    .update(JSON.stringify(canonicalRows), "utf8")
    .digest("hex");
}

function parseRecoveryToken(recoveryToken) {
  const match = typeof recoveryToken === "string"
    ? RECOVERY_TOKEN_PATTERN.exec(recoveryToken)
    : null;
  if (!match) {
    fail("The captured failed migration recovery token is invalid.");
  }
  return { attemptId: match[1], ledgerFingerprint: match[2].toLowerCase() };
}

export function assertApprovedRollbackMigration(migrationName) {
  if (!APPROVED_ROLLBACK_MIGRATIONS.has(migrationName)) {
    fail("No fail-closed rollback invariant is implemented for the named migration.");
  }
}

export function assertAtomicMigrationSql(migrationName, sql) {
  if (!APPROVED_ATOMIC_ROLLBACK_MIGRATIONS.includes(migrationName)) return;
  if (typeof sql !== "string") {
    fail("The approved recovery migration SQL is unavailable.");
  }
  const exactChecksum = createHash("sha256")
    .update(sql, "utf8")
    .digest("hex");
  if (
    exactChecksum
    !== APPROVED_ATOMIC_MIGRATION_CHECKSUMS[migrationName]
  ) {
    fail("The approved atomic migration no longer has its reviewed checksum.");
  }
  const executableLines = sql
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"));
  if (
    executableLines[0] !== "BEGIN;"
    || executableLines.at(-1) !== "COMMIT;"
    || executableLines.filter((line) => line === "BEGIN;").length !== 1
    || executableLines.filter((line) => line === "COMMIT;").length !== 1
    || !sql.includes("SET LOCAL lock_timeout = '5s';")
    || !sql.includes("SET LOCAL statement_timeout = '15min';")
  ) {
    fail("The approved atomic migration no longer has the reviewed transaction boundaries.");
  }
}

export function migrationSqlChecksum(sql) {
  if (typeof sql !== "string") {
    fail("The approved recovery migration SQL is unavailable.");
  }
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function migrationDatabaseSchema(connectionString) {
  return migrationDatabaseIdentity(connectionString).schema;
}

export function migrationDatabaseIdentity(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    fail("Migration-role DATABASE_URL is invalid.");
  }
  if (!new Set(["postgresql:", "postgres:"]).has(url.protocol)) {
    fail("Migration-role DATABASE_URL must use postgresql: or postgres:.");
  }
  if (!url.hostname || url.hash || !url.username || !url.password) {
    fail("Migration-role DATABASE_URL must include host, username, password, and no fragment.");
  }
  const decode = (value, label) => {
    try {
      return decodeURIComponent(value);
    } catch {
      fail(`Migration-role DATABASE_URL ${label} is invalid.`);
    }
  };
  const username = decode(url.username, "username");
  const database = decode(url.pathname.replace(/^\//u, ""), "database");
  if (
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(username)
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(database)
  ) {
    fail("Migration-role DATABASE_URL username or database is invalid.");
  }
  const seenParameters = new Set();
  for (const [name] of url.searchParams) {
    if (name !== name.toLowerCase() || !new Set(["schema", "sslmode"]).has(name)) {
      fail(`Migration-role DATABASE_URL query parameter ${name} is not allowed.`);
    }
    if (seenParameters.has(name)) {
      fail(`Migration-role DATABASE_URL must not repeat the ${name} parameter.`);
    }
    seenParameters.add(name);
  }
  const schema = url.searchParams.get("schema") ?? "public";
  const normalizedSchema = schema.toLowerCase();
  if (
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(schema)
    || normalizedSchema === "information_schema"
    || normalizedSchema.startsWith("pg_")
  ) {
    fail("Migration-role DATABASE_URL schema is invalid.");
  }
  return Object.freeze({ database, schema, username });
}

export function assertMigrationRollbackRuntimeEnvironment(environment) {
  if (environment.CLEAN_PAY_RUNTIME_ROLE !== "migration") {
    fail("Rollback verification requires CLEAN_PAY_RUNTIME_ROLE=migration.");
  }
  validateProductionDatabaseRoleEnvironment(environment);
  const connectionString = environment.DATABASE_URL.trim();
  return Object.freeze({
    connectionString,
    databaseIdentity: migrationDatabaseIdentity(connectionString),
  });
}

export async function assertMigrationConnectionIdentity(client, expected) {
  const result = await client.query(
    `SELECT
       current_user AS "currentUser",
       pg_catalog.current_database() AS "currentDatabase",
       role.rolsuper AS "isSuperuser"
       FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user`,
  );
  if (
    result.rowCount !== 1
    || result.rows.length !== 1
    || result.rows[0]?.currentUser !== expected.username
    || result.rows[0]?.currentDatabase !== expected.database
    || result.rows[0]?.isSuperuser !== false
  ) {
    fail("Rollback verification requires the exact non-superuser migration database identity.");
  }
}

function assertExactIndexTopology(snapshot, expectedIndexes, failureMessage) {
  if (
    typeof snapshot?.schemaName !== "string"
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(snapshot.schemaName)
    || !Array.isArray(snapshot.indexes)
  ) {
    fail(failureMessage);
  }

  for (const expected of expectedIndexes) {
    const matches = snapshot.indexes.filter(
      (index) => index?.indexName === expected.indexName,
    );
    if (matches.length !== 1) fail(failureMessage);

    const [index] = matches;
    if (
      index.schemaName !== snapshot.schemaName
      || index.tableSchemaName !== snapshot.schemaName
      || index.tableName !== expected.tableName
      || index.isUnique !== expected.unique
      || index.isValid !== true
      || index.isReady !== true
      || index.isLive !== true
      || index.keyAttributeCount !== 1
      || index.attributeCount !== 1
      || !Array.isArray(index.keyColumns)
      || index.keyColumns.length !== 1
      || index.keyColumns[0] !== expected.columnName
      || index.predicate !== null
      || index.expression !== null
    ) {
      fail(failureMessage);
    }
  }
}

function assertRollbackIndexes(snapshot) {
  assertExactIndexTopology(
    snapshot,
    REDUNDANT_INDEX_TOPOLOGY,
    "Failed migration left partial index changes; restore or repair explicitly before resolve.",
  );
  assertExactIndexTopology(
    snapshot,
    REQUIRED_UNIQUE_INDEX_TOPOLOGY,
    "Required unique indexes are missing; resolve is forbidden.",
  );
}

function assertAtomicRollbackState(snapshot, migrationName) {
  const invariant = ATOMIC_ROLLBACK_INVARIANTS[migrationName];
  if (!invariant) return;
  if (!Array.isArray(snapshot?.objects)) {
    fail("Atomic migration rollback catalog state is unavailable.");
  }
  const objects = new Set(snapshot.objects.map((entry) => entry?.objectKey));
  if (objects.has(undefined) || objects.size !== snapshot.objects.length) {
    fail("Atomic migration rollback catalog state is ambiguous.");
  }
  const missing = invariant.present.filter((objectKey) => !objects.has(objectKey));
  const partial = invariant.absent.filter((objectKey) => objects.has(objectKey));
  if (missing.length > 0 || partial.length > 0) {
    fail("Atomic migration did not roll back to its exact reviewed pre-migration schema state.");
  }
}

function assertRollbackDatabaseState(snapshot, migrationName) {
  if (migrationName === APPROVED_ROLLBACK_MIGRATION) {
    assertRollbackIndexes(snapshot);
    return;
  }
  assertAtomicRollbackState(snapshot, migrationName);
}

export function verifyPreResolveSnapshot(snapshot, migrationName, expectedChecksum) {
  assertApprovedRollbackMigration(migrationName);
  if (!/^[0-9a-f]{64}$/u.test(expectedChecksum)) {
    fail("The packaged migration checksum is invalid.");
  }
  assertRollbackDatabaseState(snapshot, migrationName);

  const unresolved = snapshot.migrationRows.filter(
    (row) => row.finishedAt === null && row.rolledBackAt === null,
  );
  if (unresolved.length !== 1) {
    fail("Expected exactly one unresolved failed migration ledger row.");
  }

  const attempt = unresolved[0];
  if (
    attempt.migrationName !== migrationName
    || !UUID_PATTERN.test(attempt.id)
    || attempt.checksum !== expectedChecksum
    || attempt.appliedStepsCount !== 0
    || attempt.hasFailureLog !== true
  ) {
    fail("The unresolved migration ledger row is not an untouched failed attempt.");
  }

  const ledgerFingerprint = migrationLedgerFingerprint(
    snapshot.migrationRows,
    attempt.id,
  );
  return `${attempt.id}:${ledgerFingerprint}`;
}

export function verifyPostResolveSnapshot(
  snapshot,
  migrationName,
  recoveryToken,
  expectedChecksum,
) {
  assertApprovedRollbackMigration(migrationName);
  const { attemptId, ledgerFingerprint } = parseRecoveryToken(recoveryToken);
  if (!/^[0-9a-f]{64}$/u.test(expectedChecksum)) {
    fail("The packaged migration checksum is invalid.");
  }
  assertRollbackDatabaseState(snapshot, migrationName);

  const attempts = snapshot.migrationRows.filter((row) => row.id === attemptId);
  if (attempts.length !== 1) {
    fail("The captured failed migration attempt no longer has one exact ledger row.");
  }
  const attempt = attempts[0];
  if (
    attempt.migrationName !== migrationName
    || attempt.checksum !== expectedChecksum
    || attempt.finishedAt !== null
    || attempt.rolledBackAt === null
    || attempt.rolledBackAt < attempt.startedAt
    || attempt.appliedStepsCount !== 0
    || attempt.hasFailureLog !== true
  ) {
    fail("The guarded transaction did not mark the captured failed migration attempt as rolled back.");
  }

  const unresolved = snapshot.migrationRows.filter(
    (row) => row.finishedAt === null && row.rolledBackAt === null,
  );
  if (unresolved.length !== 0) {
    fail("An unresolved failed attempt remains after the guarded ledger transition.");
  }
  const postFingerprint = migrationLedgerFingerprint(
    snapshot.migrationRows,
    attemptId,
  );
  if (postFingerprint !== ledgerFingerprint) {
    fail("The migration ledger changed outside the exact reviewed rollback transition.");
  }
}

export async function readRollbackSnapshot(client, migrationName, schemaName) {
  assertApprovedRollbackMigration(migrationName);
  if (
    typeof schemaName !== "string"
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(schemaName)
  ) {
    fail("Migration-role DATABASE_URL schema is invalid.");
  }
  const migrationLedger = `"${schemaName}"."_prisma_migrations"`;
  const migrationResult = await client.query(
    `SELECT
       id,
       migration_name AS "migrationName",
       checksum,
       logs,
       CASE WHEN finished_at IS NULL THEN NULL ELSE
         to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       END AS "finishedAt",
       CASE WHEN rolled_back_at IS NULL THEN NULL ELSE
         to_char(rolled_back_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       END AS "rolledBackAt",
       to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
         AS "startedAt",
       applied_steps_count AS "appliedStepsCount",
       (logs IS NOT NULL AND btrim(logs) <> '') AS "hasFailureLog"
     FROM ${migrationLedger}
     ORDER BY started_at ASC, id ASC`,
  );
  if (migrationName !== APPROVED_ROLLBACK_MIGRATION) {
    const objectResult = await client.query(
      `SELECT "objectKey"
         FROM (
           SELECT 'table:' || relation.relname AS "objectKey"
             FROM pg_catalog.pg_class AS relation
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = $1
              AND relation.relkind IN ('r', 'p')
           UNION ALL
           SELECT 'column:' || relation.relname || '.' || attribute.attname
             FROM pg_catalog.pg_attribute AS attribute
             JOIN pg_catalog.pg_class AS relation
               ON relation.oid = attribute.attrelid
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = $1
              AND relation.relkind IN ('r', 'p')
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
           UNION ALL
           SELECT 'index:' || table_relation.relname || '.' || index_relation.relname
             FROM pg_catalog.pg_index AS index_catalog
             JOIN pg_catalog.pg_class AS index_relation
               ON index_relation.oid = index_catalog.indexrelid
             JOIN pg_catalog.pg_class AS table_relation
               ON table_relation.oid = index_catalog.indrelid
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = index_relation.relnamespace
            WHERE namespace.nspname = $1
           UNION ALL
           SELECT 'constraint:' || relation.relname || '.' || constraint_catalog.conname
             FROM pg_catalog.pg_constraint AS constraint_catalog
             JOIN pg_catalog.pg_class AS relation
               ON relation.oid = constraint_catalog.conrelid
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = constraint_catalog.connamespace
            WHERE namespace.nspname = $1
           UNION ALL
           SELECT 'type:' || type_catalog.typname
             FROM pg_catalog.pg_type AS type_catalog
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = type_catalog.typnamespace
            WHERE namespace.nspname = $1
              AND type_catalog.typtype IN ('d', 'e')
              AND type_catalog.typisdefined
           UNION ALL
           SELECT 'function:' || procedure.proname || '(' ||
                  pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')'
             FROM pg_catalog.pg_proc AS procedure
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = $1
              AND procedure.prokind IN ('f', 'p')
           UNION ALL
           SELECT 'trigger:' || relation.relname || '.' || trigger_catalog.tgname
             FROM pg_catalog.pg_trigger AS trigger_catalog
             JOIN pg_catalog.pg_class AS relation
               ON relation.oid = trigger_catalog.tgrelid
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = $1
              AND NOT trigger_catalog.tgisinternal
         ) AS catalog_objects
        ORDER BY "objectKey"`,
      [schemaName],
    );
    return {
      schemaName,
      migrationRows: migrationResult.rows,
      indexes: [],
      objects: objectResult.rows,
    };
  }

  const indexResult = await client.query(
    `SELECT
       index_namespace.nspname AS "schemaName",
       table_namespace.nspname AS "tableSchemaName",
       index_class.relname AS "indexName",
       table_class.relname AS "tableName",
       index_catalog.indisunique AS "isUnique",
       index_catalog.indisvalid AS "isValid",
       index_catalog.indisready AS "isReady",
       index_catalog.indislive AS "isLive",
       index_catalog.indnkeyatts::int AS "keyAttributeCount",
       index_catalog.indnatts::int AS "attributeCount",
       pg_catalog.pg_get_expr(
         index_catalog.indpred,
         index_catalog.indrelid
       ) AS "predicate",
       pg_catalog.pg_get_expr(
         index_catalog.indexprs,
         index_catalog.indrelid
       ) AS "expression",
       ARRAY(
         SELECT attribute.attname::text
           FROM pg_catalog.unnest(index_catalog.indkey) WITH ORDINALITY
             AS indexed_key(attnum, position)
           JOIN pg_catalog.pg_attribute AS attribute
             ON attribute.attrelid = index_catalog.indrelid
            AND attribute.attnum = indexed_key.attnum
          WHERE indexed_key.position <= index_catalog.indnkeyatts
          ORDER BY indexed_key.position
       ) AS "keyColumns"
       FROM pg_catalog.pg_index AS index_catalog
       JOIN pg_catalog.pg_class AS index_class
         ON index_class.oid = index_catalog.indexrelid
       JOIN pg_catalog.pg_namespace AS index_namespace
         ON index_namespace.oid = index_class.relnamespace
       JOIN pg_catalog.pg_class AS table_class
         ON table_class.oid = index_catalog.indrelid
       JOIN pg_catalog.pg_namespace AS table_namespace
         ON table_namespace.oid = table_class.relnamespace
      WHERE index_namespace.nspname = $1
        AND table_namespace.nspname = $1
        AND index_class.relname = ANY($2::text[])
      ORDER BY index_class.relname`,
    [schemaName, [...REDUNDANT_INDEXES, ...REQUIRED_UNIQUE_INDEXES]],
  );
  return {
    schemaName,
    migrationRows: migrationResult.rows,
    indexes: indexResult.rows,
    objects: [],
  };
}

export async function resolveFailedMigration(
  client,
  migrationName,
  schemaName,
  expectedChecksum,
  { assertRecoveryPredecessor = assertReviewedRecoveryPredecessor } = {},
) {
  assertApprovedRollbackMigration(migrationName);
  if (
    typeof schemaName !== "string"
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(schemaName)
  ) {
    fail("Migration-role DATABASE_URL schema is invalid.");
  }
  const migrationLedger = `"${schemaName}"."_prisma_migrations"`;
  await client.query("SELECT pg_catalog.pg_advisory_xact_lock(72707369)");
  await client.query(`LOCK TABLE ${migrationLedger} IN EXCLUSIVE MODE`);

  // Repeat the exact whole-ledger and canonical predecessor-catalog predicate
  // while the same SERIALIZABLE transaction holds Prisma's advisory lock and
  // an EXCLUSIVE ledger lock. The earlier bootstrap recovery preflight fences
  // credentials, but it is intentionally not trusted across this boundary.
  await assertRecoveryPredecessor(
    client,
    { bootstrap: { schema: schemaName } },
    migrationName,
  );

  const before = await readRollbackSnapshot(client, migrationName, schemaName);
  const recoveryToken = verifyPreResolveSnapshot(
    before,
    migrationName,
    expectedChecksum,
  );
  const { attemptId } = parseRecoveryToken(recoveryToken);
  const updateResult = await client.query(
    `UPDATE ${migrationLedger}
        SET rolled_back_at = now()
      WHERE id = $1
        AND migration_name = $2
        AND checksum = $3
        AND finished_at IS NULL
        AND rolled_back_at IS NULL
        AND applied_steps_count = 0
        AND logs IS NOT NULL
        AND btrim(logs) <> ''
        AND started_at <= pg_catalog.transaction_timestamp()
      RETURNING id`,
    [attemptId, migrationName, expectedChecksum],
  );
  if (
    updateResult.rowCount !== 1
    || updateResult.rows.length !== 1
    || updateResult.rows[0]?.id !== attemptId
  ) {
    fail("The captured failed migration attempt was not updated exactly once.");
  }

  const after = await readRollbackSnapshot(client, migrationName, schemaName);
  verifyPostResolveSnapshot(
    after,
    migrationName,
    recoveryToken,
    expectedChecksum,
  );
  return attemptId;
}

async function readPackagedMigrationSql(migrationName) {
  const migrationUrl = new URL(
    `../../prisma/migrations/${migrationName}/migration.sql`,
    import.meta.url,
  );
  return readFile(migrationUrl, "utf8");
}

async function resolveDatabaseRollback(migrationName) {
  assertApprovedRollbackMigration(migrationName);
  const { connectionString, databaseIdentity } =
    assertMigrationRollbackRuntimeEnvironment(process.env);
  const schema = databaseIdentity.schema;

  const migrationSql = await readPackagedMigrationSql(migrationName);
  assertAtomicMigrationSql(migrationName, migrationSql);
  const expectedChecksum = migrationSqlChecksum(migrationSql);

  const pool = new Pool({
    application_name: "clean-pay-rollback-verifier",
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    max: 1,
    options: "-c lock_timeout=5000",
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await assertMigrationConnectionIdentity(client, databaseIdentity);
    await client.query(
      "SELECT pg_catalog.set_config('search_path', 'pg_catalog, ' || pg_catalog.quote_ident($1), true)",
      [schema],
    );
    await resolveFailedMigration(client, migrationName, schema, expectedChecksum);
    await client.query("COMMIT");
    process.stdout.write("verified\n");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main(argv) {
  const [mode, migrationName, ...extra] = argv;
  if (extra.length > 0 || mode !== "resolve" || !migrationName) {
    fail("Usage: migration-rollback-verifier.mjs resolve MIGRATION_NAME");
  }
  await resolveDatabaseRollback(migrationName);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : "rollback verification failed"}\n`);
    process.exitCode = 1;
  });
}
