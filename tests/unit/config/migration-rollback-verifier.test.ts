import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  APPROVED_ATOMIC_MIGRATION_CHECKSUMS,
  APPROVED_ATOMIC_ROLLBACK_MIGRATIONS,
  APPROVED_ROLLBACK_MIGRATION,
  ATOMIC_ROLLBACK_INVARIANTS,
  REDUNDANT_INDEXES,
  REQUIRED_UNIQUE_INDEXES,
  assertMigrationConnectionIdentity,
  assertApprovedRollbackMigration,
  assertAtomicMigrationSql,
  assertMigrationRollbackRuntimeEnvironment,
  migrationDatabaseIdentity,
  migrationDatabaseSchema,
  migrationSqlChecksum,
  readRollbackSnapshot,
  resolveFailedMigration,
  verifyPostResolveSnapshot,
  verifyPreResolveSnapshot,
} from "../../../deploy/prod/migration-rollback-verifier.mjs";

const firstAttemptId = "11111111-1111-4111-8111-111111111111";
const secondAttemptId = "22222222-2222-4222-8222-222222222222";
const migrationSql = readFileSync(
  `prisma/migrations/${APPROVED_ROLLBACK_MIGRATION}/migration.sql`,
  "utf8",
);
const expectedChecksum = migrationSqlChecksum(migrationSql);

type MigrationRow = {
  appliedStepsCount: number;
  checksum: string;
  finishedAt: string | null;
  hasFailureLog: boolean;
  id: string;
  logs: string | null;
  migrationName: string;
  rolledBackAt: string | null;
  startedAt: string;
};

type IndexRow = {
  attributeCount: number;
  expression: string | null;
  indexName: string;
  isLive: boolean;
  isReady: boolean;
  isUnique: boolean;
  isValid: boolean;
  keyAttributeCount: number;
  keyColumns: string[];
  predicate: string | null;
  schemaName: string;
  tableName: string;
  tableSchemaName: string;
};

const indexTopology = Object.freeze({
  PaymentRecord_paymentId_idx: ["PaymentRecord", "paymentId", false],
  PaymentRecord_paymentId_key: ["PaymentRecord", "paymentId", true],
  WebUser_email_idx: ["WebUser", "email", false],
  WebUser_email_key: ["WebUser", "email", true],
  WebUser_telegramId_idx: ["WebUser", "telegramId", false],
  WebUser_telegramId_key: ["WebUser", "telegramId", true],
} as const);

function validIndex(indexName: keyof typeof indexTopology): IndexRow {
  const [tableName, columnName, isUnique] = indexTopology[indexName];
  return {
    attributeCount: 1,
    expression: null,
    indexName,
    isLive: true,
    isReady: true,
    isUnique,
    isValid: true,
    keyAttributeCount: 1,
    keyColumns: [columnName],
    predicate: null,
    schemaName: "public",
    tableName,
    tableSchemaName: "public",
  };
}

function validIndexes(): IndexRow[] {
  return Object.keys(indexTopology)
    .map((indexName) => validIndex(indexName as keyof typeof indexTopology));
}

function failedAttempt(id: string): MigrationRow {
  return {
    appliedStepsCount: 0,
    checksum: expectedChecksum,
    finishedAt: null,
    hasFailureLog: true,
    id,
    logs: "migration failed",
    migrationName: APPROVED_ROLLBACK_MIGRATION,
    rolledBackAt: null,
    startedAt: "2026-08-26T00:00:00.000000Z",
  };
}

function rolledBackAttempt(id: string): MigrationRow {
  return {
    ...failedAttempt(id),
    rolledBackAt: "2026-08-26T00:00:00.000000Z",
  };
}

function successfulAttempt(
  id: string,
  migrationName = "20260717223000_add_payment_idempotency",
): MigrationRow {
  return {
    appliedStepsCount: 1,
    checksum: "9".repeat(64),
    finishedAt: "2026-08-25T23:59:00.000000Z",
    hasFailureLog: false,
    id,
    logs: null,
    migrationName,
    rolledBackAt: null,
    startedAt: "2026-08-25T23:58:00.000000Z",
  };
}

function snapshot(migrationRows: MigrationRow[] = [failedAttempt(firstAttemptId)]) {
  return {
    schemaName: "public",
    migrationRows,
    indexes: validIndexes(),
    objects: [],
  };
}

function atomicMigration(migrationName: string) {
  const sql = readFileSync(
    `prisma/migrations/${migrationName}/migration.sql`,
    "utf8",
  );
  return { sql, checksum: migrationSqlChecksum(sql) };
}

function atomicAttempt(
  migrationName: string,
  checksum: string,
  id = firstAttemptId,
): MigrationRow {
  return {
    appliedStepsCount: 0,
    checksum,
    finishedAt: null,
    hasFailureLog: true,
    id,
    logs: "migration failed",
    migrationName,
    rolledBackAt: null,
    startedAt: "2026-08-26T00:00:00.000000Z",
  };
}

function atomicSnapshot(
  migrationName: keyof typeof ATOMIC_ROLLBACK_INVARIANTS,
  migrationRows: MigrationRow[],
) {
  return {
    schemaName: "public",
    migrationRows,
    indexes: [],
    objects: ATOMIC_ROLLBACK_INVARIANTS[migrationName].present.map(
      (objectKey) => ({ objectKey }),
    ),
  };
}

describe("migration rollback verifier", () => {
  it("admits only migrations with reviewed recovery invariants and hashes exact bytes", () => {
    expect(() => assertApprovedRollbackMigration(APPROVED_ROLLBACK_MIGRATION))
      .not.toThrow();
    for (const migrationName of APPROVED_ATOMIC_ROLLBACK_MIGRATIONS) {
      expect(() => assertApprovedRollbackMigration(migrationName)).not.toThrow();
    }
    expect(() => assertApprovedRollbackMigration("20260718141001_wrong_migration"))
      .toThrow("No fail-closed rollback invariant");
    expect(expectedChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the exact allowlisted schema from the scoped migration URL", () => {
    expect(migrationDatabaseSchema("postgresql://user:pass@postgres/db?schema=audit"))
      .toBe("audit");
    expect(migrationDatabaseSchema("postgresql://user:pass@postgres/db"))
      .toBe("public");
    expect(() => migrationDatabaseSchema(
      "postgresql://user:pass@postgres/db?schema=public&schema=shadow",
    )).toThrow("must not repeat the schema");
    expect(() => migrationDatabaseSchema(
      "postgresql://user:pass@postgres/db?schema=public%2Cshadow",
    )).toThrow("schema is invalid");
    expect(() => migrationDatabaseSchema(
      "postgresql://user:pass@postgres/db?schema=pg_catalog",
    )).toThrow("schema is invalid");
    expect(() => migrationDatabaseSchema(
      "https://user:pass@postgres/db?schema=public",
    )).toThrow("must use postgresql: or postgres:");
    expect(() => migrationDatabaseSchema(
      "postgresql://user:pass@postgres/db?schema=public&options=-c%20search_path%3Devil",
    )).toThrow("query parameter options is not allowed");
    expect(migrationDatabaseIdentity(
      "postgresql://clean_pay_migration:pass@postgres/clean_pay?schema=public",
    )).toEqual({
      database: "clean_pay",
      schema: "public",
      username: "clean_pay_migration",
    });
  });

  it("requires an isolated migration role environment before database access", () => {
    const databaseUrl =
      "postgresql://clean_pay_migration:db-migration-unit-4Qp8Xs2Ln7Vr5Km9Wc3H@postgres:5432/clean_pay?schema=public";
    expect(assertMigrationRollbackRuntimeEnvironment({
      CLEAN_PAY_RUNTIME_ROLE: "migration",
      DATABASE_URL: databaseUrl,
    })).toEqual({
      connectionString: databaseUrl,
      databaseIdentity: {
        database: "clean_pay",
        schema: "public",
        username: "clean_pay_migration",
      },
    });
    expect(() => assertMigrationRollbackRuntimeEnvironment({
      DATABASE_URL: databaseUrl,
    })).toThrow("CLEAN_PAY_RUNTIME_ROLE=migration");
    expect(() => assertMigrationRollbackRuntimeEnvironment({
      CLEAN_PAY_RUNTIME_ROLE: "migration",
      DATABASE_URL: databaseUrl,
      POSTGRES_PASSWORD: "must-not-reach-the-migration-role",
    })).toThrow(
      "POSTGRES_PASSWORD must not be present in a role-scoped runtime environment",
    );
  });

  it("requires the connected non-superuser identity to match the migration URL", async () => {
    const expected = {
      database: "clean_pay",
      schema: "public",
      username: "clean_pay_migration",
    };
    const exact = {
      rowCount: 1,
      rows: [{
        currentDatabase: expected.database,
        currentUser: expected.username,
        isSuperuser: false,
      }],
    };
    await expect(assertMigrationConnectionIdentity(
      { query: async () => exact },
      expected,
    )).resolves.toBeUndefined();
    await expect(assertMigrationConnectionIdentity(
      { query: async () => ({
        ...exact,
        rows: [{ ...exact.rows[0], isSuperuser: true }],
      }) },
      expected,
    )).rejects.toThrow("exact non-superuser migration database identity");

    const source = readFileSync(
      "deploy/prod/migration-rollback-verifier.mjs",
      "utf8",
    );
    expect(source).toContain(
      "pg_catalog.set_config('search_path', 'pg_catalog, ' || pg_catalog.quote_ident($1), true)",
    );
  });

  it("requires exact transaction and timeout boundaries for every atomic recovery", () => {
    for (const migrationName of APPROVED_ATOMIC_ROLLBACK_MIGRATIONS) {
      const { sql } = atomicMigration(migrationName);
      expect(() => assertAtomicMigrationSql(migrationName, sql)).not.toThrow();
      expect(() => assertAtomicMigrationSql(
        migrationName,
        sql.replace("COMMIT;", ""),
      )).toThrow("reviewed checksum");
      expect(migrationSqlChecksum(sql))
        .toBe(APPROVED_ATOMIC_MIGRATION_CHECKSUMS[
          migrationName as keyof typeof APPROVED_ATOMIC_MIGRATION_CHECKSUMS
        ]);
      expect(() => assertAtomicMigrationSql(
        migrationName,
        sql.replaceAll("\n", "\r\n"),
      )).toThrow("reviewed checksum");
    }
    expect(() => assertAtomicMigrationSql(APPROVED_ROLLBACK_MIGRATION, "not atomic"))
      .not.toThrow();
  });

  it.each(APPROVED_ATOMIC_ROLLBACK_MIGRATIONS)(
    "proves the exact pre-schema and ledger state for atomic recovery %s",
    (migrationName) => {
      const typedName = migrationName as keyof typeof ATOMIC_ROLLBACK_INVARIANTS;
      const { checksum } = atomicMigration(migrationName);
      const attempt = atomicAttempt(migrationName, checksum);
      const valid = atomicSnapshot(typedName, [attempt]);

      const recoveryToken = verifyPreResolveSnapshot(valid, migrationName, checksum);
      expect(recoveryToken).toMatch(new RegExp(`^${firstAttemptId}:[0-9a-f]{64}$`));
      expect(() => verifyPostResolveSnapshot(
        {
          ...valid,
          migrationRows: [{
            ...attempt,
            rolledBackAt: "2026-08-26T00:00:00.000000Z",
          }],
        },
        migrationName,
        recoveryToken,
        checksum,
      )).not.toThrow();

      const missingPrerequisite = {
        ...valid,
        objects: valid.objects.slice(1),
      };
      expect(() => verifyPreResolveSnapshot(
        missingPrerequisite,
        migrationName,
        checksum,
      )).toThrow("exact reviewed pre-migration schema state");

      const partialArtifact = {
        ...valid,
        objects: [
          ...valid.objects,
          { objectKey: ATOMIC_ROLLBACK_INVARIANTS[typedName].absent[0] },
        ],
      };
      expect(() => verifyPreResolveSnapshot(
        partialArtifact,
        migrationName,
        checksum,
      )).toThrow("exact reviewed pre-migration schema state");

      if (migrationName === "20260825220000_add_payment_retention_hold_lifecycle") {
        expect(ATOMIC_ROLLBACK_INVARIANTS[typedName].absent).toEqual(
          expect.arrayContaining([
            "constraint:PaymentOperation.PaymentOperation_retention_hold_pointer_pair_check",
            "constraint:PaymentRecord.PaymentRecord_retention_hold_pointer_pair_check",
            "index:PaymentRetentionHold.PaymentRetentionHold_active_caseOperationId_key",
            "index:PaymentRetentionHold.PaymentRetentionHold_active_casePaymentRecordId_key",
            "function:prevent_payment_retention_hold_reassignment()",
            "function:enforce_payment_retention_hold_integrity()",
            "trigger:PaymentRetentionHold.PaymentRetentionHold_prevent_reassignment",
            "trigger:PaymentOperation.PaymentOperation_payment_retention_hold_integrity",
            "trigger:PaymentRecord.PaymentRecord_payment_retention_hold_integrity",
            "trigger:PaymentRetentionHold.PaymentRetentionHold_payment_retention_hold_integrity",
          ]),
        );
      }
    },
  );

  it("captures exactly one untouched failed ledger attempt", () => {
    expect(verifyPreResolveSnapshot(
      snapshot(),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    ))
      .toMatch(new RegExp(`^${firstAttemptId}:[0-9a-f]{64}$`));

    expect(() => verifyPreResolveSnapshot(
      snapshot([]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    ))
      .toThrow("exactly one unresolved failed migration ledger row");
    expect(() => verifyPreResolveSnapshot(
      snapshot([failedAttempt(firstAttemptId), failedAttempt(secondAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("exactly one unresolved failed migration ledger row");
    expect(() => verifyPreResolveSnapshot(
      snapshot([
        failedAttempt(firstAttemptId),
        {
          ...failedAttempt(secondAttemptId),
          migrationName: "20260825210000_add_payment_sensitive_retention",
        },
      ]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("exactly one unresolved failed migration ledger row");
    expect(() => verifyPreResolveSnapshot(
      snapshot([{ ...failedAttempt(firstAttemptId), appliedStepsCount: 1 }]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("not an untouched failed attempt");
    expect(() => verifyPreResolveSnapshot(
      snapshot([{ ...failedAttempt(firstAttemptId), hasFailureLog: false }]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("not an untouched failed attempt");
    expect(() => verifyPreResolveSnapshot(
      snapshot([{ ...failedAttempt(firstAttemptId), checksum: "0".repeat(64) }]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("not an untouched failed attempt");
  });

  it("fails closed when any redundant or required unique index is missing", () => {
    expect(() => verifyPreResolveSnapshot(
      {
        ...snapshot(),
        indexes: validIndexes().filter(
          ({ indexName }) => indexName !== REDUNDANT_INDEXES[0],
        ),
      },
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("partial index changes");
    expect(() => verifyPreResolveSnapshot(
      {
        ...snapshot(),
        indexes: validIndexes().filter(
          ({ indexName }) => indexName !== REQUIRED_UNIQUE_INDEXES[0],
        ),
      },
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("Required unique indexes are missing");
  });

  it("rejects an index-name spoof on another table or schema", () => {
    for (const change of [
      { tableName: "SpoofedPaymentRecord" },
      { schemaName: "shadow", tableSchemaName: "shadow" },
    ]) {
      const indexes = validIndexes();
      indexes[0] = { ...indexes[0]!, ...change };

      expect(() => verifyPreResolveSnapshot(
        { ...snapshot(), indexes },
        APPROVED_ROLLBACK_MIGRATION,
        expectedChecksum,
      )).toThrow("partial index changes");
    }
  });

  it("rejects a non-unique replacement for a required unique index", () => {
    const indexes = validIndexes();
    const requiredIndex = indexes.findIndex(
      ({ indexName }) => indexName === REQUIRED_UNIQUE_INDEXES[0],
    );
    indexes[requiredIndex] = { ...indexes[requiredIndex]!, isUnique: false };

    expect(() => verifyPreResolveSnapshot(
      { ...snapshot(), indexes },
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    )).toThrow("Required unique indexes are missing");
  });

  it.each(["isValid", "isReady", "isLive"] as const)(
    "rejects an index whose %s catalog flag is false",
    (flag) => {
      const indexes = validIndexes();
      indexes[0] = { ...indexes[0]!, [flag]: false };

      expect(() => verifyPreResolveSnapshot(
        { ...snapshot(), indexes },
        APPROVED_ROLLBACK_MIGRATION,
        expectedChecksum,
      )).toThrow("partial index changes");
    },
  );

  it("rejects a wrong, included, expression, or partial index shape", () => {
    for (const change of [
      { keyColumns: ["wrongColumn"] },
      { attributeCount: 2 },
      { keyAttributeCount: 2, keyColumns: ["paymentId", "id"] },
      { expression: "lower(\"paymentId\")" },
      { predicate: "(\"paymentId\" IS NOT NULL)" },
      { isUnique: true },
    ]) {
      const indexes = validIndexes();
      indexes[0] = { ...indexes[0]!, ...change };

      expect(() => verifyPreResolveSnapshot(
        { ...snapshot(), indexes },
        APPROVED_ROLLBACK_MIGRATION,
        expectedChecksum,
      )).toThrow("partial index changes");
    }
  });

  it("verifies the captured row transition and supports repeated failure cycles", () => {
    const firstToken = verifyPreResolveSnapshot(
      snapshot([failedAttempt(firstAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    );
    expect(() => verifyPostResolveSnapshot(
      snapshot([rolledBackAttempt(firstAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      firstToken,
      expectedChecksum,
    )).not.toThrow();

    const secondToken = verifyPreResolveSnapshot(
      snapshot([rolledBackAttempt(firstAttemptId), failedAttempt(secondAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    );
    expect(secondToken).toMatch(new RegExp(`^${secondAttemptId}:[0-9a-f]{64}$`));
    expect(() => verifyPostResolveSnapshot(
      snapshot([rolledBackAttempt(firstAttemptId), rolledBackAttempt(secondAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      secondToken,
      expectedChecksum,
    )).not.toThrow();
  });

  it("rejects a wrong postcondition row or a remaining unresolved attempt", () => {
    const recoveryToken = verifyPreResolveSnapshot(
      snapshot([failedAttempt(firstAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    );
    expect(() => verifyPostResolveSnapshot(
      snapshot([failedAttempt(firstAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      recoveryToken,
      expectedChecksum,
    )).toThrow("did not mark the captured failed migration attempt");
    expect(() => verifyPostResolveSnapshot(
      snapshot([rolledBackAttempt(firstAttemptId), failedAttempt(secondAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      recoveryToken,
      expectedChecksum,
    )).toThrow("An unresolved failed attempt remains");
    expect(() => verifyPostResolveSnapshot(
      snapshot([rolledBackAttempt(firstAttemptId)]),
      APPROVED_ROLLBACK_MIGRATION,
      `${secondAttemptId}:${"0".repeat(64)}`,
      expectedChecksum,
    )).toThrow("no longer has one exact ledger row");
    expect(() => verifyPostResolveSnapshot(
      snapshot([{ ...rolledBackAttempt(firstAttemptId), checksum: "0".repeat(64) }]),
      APPROVED_ROLLBACK_MIGRATION,
      recoveryToken,
      expectedChecksum,
    )).toThrow("did not mark the captured failed migration attempt");
    expect(() => verifyPostResolveSnapshot(
      snapshot([{
        ...rolledBackAttempt(firstAttemptId),
        rolledBackAt: "2026-08-25T23:59:59.999999Z",
      }]),
      APPROVED_ROLLBACK_MIGRATION,
      recoveryToken,
      expectedChecksum,
    )).toThrow("did not mark the captured failed migration attempt");
  });

  it("rejects any concurrent migration-ledger change outside the captured transition", () => {
    const prior = successfulAttempt(secondAttemptId);
    const before = snapshot([
      prior,
      failedAttempt(firstAttemptId),
    ]);
    const recoveryToken = verifyPreResolveSnapshot(
      before,
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    );

    expect(() => verifyPostResolveSnapshot(
      snapshot([
        prior,
        rolledBackAttempt(firstAttemptId),
        {
          ...rolledBackAttempt("33333333-3333-4333-8333-333333333333"),
          startedAt: "2026-08-26T00:01:00.000001Z",
        },
      ]),
      APPROVED_ROLLBACK_MIGRATION,
      recoveryToken,
      expectedChecksum,
    )).toThrow("changed outside the exact reviewed rollback transition");

    expect(() => verifyPostResolveSnapshot(
      snapshot([
        { ...prior, checksum: "8".repeat(64) },
        rolledBackAttempt(firstAttemptId),
      ]),
      APPROVED_ROLLBACK_MIGRATION,
      recoveryToken,
      expectedChecksum,
    )).toThrow("changed outside the exact reviewed rollback transition");
  });

  it("locks the ledger and resolves exactly one captured row in one operation", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const assertRecoveryPredecessor = vi.fn(async () => undefined);
    let ledgerReads = 0;
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        if (text.includes("pg_advisory_xact_lock")) return { rows: [{}] };
        if (text.startsWith("LOCK TABLE")) return { rowCount: null, rows: [] };
        if (text.startsWith("UPDATE")) {
          return { rowCount: 1, rows: [{ id: firstAttemptId }] };
        }
        if (text.includes('migration_name AS "migrationName"')) {
          ledgerReads += 1;
          return {
            rows: ledgerReads === 1
              ? [failedAttempt(firstAttemptId)]
              : [rolledBackAttempt(firstAttemptId)],
          };
        }
        return { rows: validIndexes() };
      },
    };

    await expect(resolveFailedMigration(
      client,
      APPROVED_ROLLBACK_MIGRATION,
      "public",
      expectedChecksum,
      { assertRecoveryPredecessor },
    )).resolves.toBe(firstAttemptId);

    expect(assertRecoveryPredecessor).toHaveBeenCalledWith(
      client,
      { bootstrap: { schema: "public" } },
      APPROVED_ROLLBACK_MIGRATION,
    );

    expect(calls[0]?.text).toBe("SELECT pg_catalog.pg_advisory_xact_lock(72707369)");
    expect(calls[1]?.text).toBe(
      'LOCK TABLE "public"."_prisma_migrations" IN EXCLUSIVE MODE',
    );
    const update = calls.find(({ text }) => text.startsWith("UPDATE"));
    expect(update?.text).toContain("WHERE id = $1");
    expect(update?.text).toContain("AND migration_name = $2");
    expect(update?.text).toContain("AND applied_steps_count = 0");
    expect(update?.text).toContain(
      "AND started_at <= pg_catalog.transaction_timestamp()",
    );
    expect(update?.values).toEqual([
      firstAttemptId,
      APPROVED_ROLLBACK_MIGRATION,
      expectedChecksum,
    ]);
  });

  it("queries the whole ledger plus the exact schema and six allowlisted index names", async () => {
    const prior = successfulAttempt(secondAttemptId);
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        if (calls.length === 1) return { rows: [prior, failedAttempt(firstAttemptId)] };
        return { rows: validIndexes() };
      },
    };

    const result = await readRollbackSnapshot(
      client,
      APPROVED_ROLLBACK_MIGRATION,
      "public",
    );

    expect(result).toEqual(snapshot([prior, failedAttempt(firstAttemptId)]));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.values).toBeUndefined();
    expect(calls[0]?.text).toContain('FROM "public"."_prisma_migrations"');
    expect(calls[0]?.text).not.toContain("WHERE migration_name");
    expect(calls[1]?.values).toEqual([
      "public",
      [...REDUNDANT_INDEXES, ...REQUIRED_UNIQUE_INDEXES],
    ]);
    expect(calls[1]?.text).toContain(
      "FROM pg_catalog.pg_index AS index_catalog",
    );
    expect(calls[1]?.text).toContain("index_namespace.nspname = $1");
    expect(calls[1]?.text).toContain("table_namespace.nspname = $1");
    expect(calls[1]?.text).toContain("index_catalog.indisvalid");
    expect(calls[1]?.text).toContain("index_catalog.indisready");
    expect(calls[1]?.text).toContain("index_catalog.indislive");
    expect(calls[1]?.text).toContain("pg_catalog.pg_get_expr(");
    expect(calls[1]?.text).toContain("index_catalog.indpred");
    expect(calls[1]?.text).toContain("index_catalog.indexprs");
    expect(calls[1]?.text).toContain("pg_catalog.unnest(index_catalog.indkey)");
    expect(calls[1]?.text).toContain("attribute.attname::text");
  });

  it("reads atomic rollback objects only from the selected schema", async () => {
    const migrationName = APPROVED_ATOMIC_ROLLBACK_MIGRATIONS[0]!;
    const typedName = migrationName as keyof typeof ATOMIC_ROLLBACK_INVARIANTS;
    const { checksum } = atomicMigration(migrationName);
    const attempt = atomicAttempt(migrationName, checksum);
    const objects = ATOMIC_ROLLBACK_INVARIANTS[typedName].present.map(
      (objectKey) => ({ objectKey }),
    );
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      async query(text: string, values: unknown[]) {
        calls.push({ text, values });
        return calls.length === 1 ? { rows: [attempt] } : { rows: objects };
      },
    };

    await expect(readRollbackSnapshot(client, migrationName, "tenant_a"))
      .resolves.toEqual({
        schemaName: "tenant_a",
        migrationRows: [attempt],
        indexes: [],
        objects,
      });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain('FROM "tenant_a"."_prisma_migrations"');
    expect(calls[1]?.values).toEqual(["tenant_a"]);
    expect(calls[1]?.text).toContain("namespace.nspname = $1");
    expect(calls[1]?.text).toContain("NOT trigger_catalog.tgisinternal");
    expect(calls[1]?.text).toContain("pg_get_function_identity_arguments");
  });
});
