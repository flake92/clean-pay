import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  APPLICATION_COLUMN_INSERTS,
  APPLICATION_COLUMN_SELECTS,
  APPLICATION_COLUMN_UPDATES,
  APPLICATION_TABLE_PRIVILEGES,
  DATABASE_ENUM_TYPES,
  DATABASE_FUNCTIONS,
  DATABASE_INTERNAL_TABLES,
  DATABASE_TABLE_COLUMNS,
  DATABASE_TABLES,
  DATABASE_TRIGGERS,
  HOLD_OPERATOR_COLUMN_INSERTS,
  HOLD_OPERATOR_COLUMN_UPDATES,
  HOLD_OPERATOR_TABLE_PRIVILEGES,
  RETENTION_COLUMN_SELECTS,
  RETENTION_COLUMN_UPDATES,
  RETENTION_TABLE_PRIVILEGES,
} from "../../../deploy/prod/database-privilege-manifest.mjs";
import {
  parseDatabaseRoleConfiguration,
  quoteLiteral,
  runProvisioningTransaction,
  withProvisioningLock,
} from "../../../deploy/prod/database-role-provision.mjs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const holdMigration = readFileSync(
  "prisma/migrations/20260825220000_add_payment_retention_hold_lifecycle/migration.sql",
  "utf8",
);
const guardedRetentionMigration = readFileSync(
  "prisma/migrations/20260825230000_guard_retention_mutations/migration.sql",
  "utf8",
);
const provisioner = readFileSync("deploy/prod/database-role-provision.mjs", "utf8");
const productionCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");

function schemaObjects() {
  const models = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => ({ body: match[2]!, name: match[1]! }));
  const modelNames = new Set(models.map(({ name }) => name));
  const columns = Object.fromEntries(models.map(({ body, name }) => {
    const names = body.split(/\r?\n/).flatMap((line) => {
      const field = line.trim().match(/^(\w+)\s+([^\s]+)/);
      if (!field || field[1]!.startsWith("@@")) return [];
      const type = field[2]!.replace(/[?\[\]]/g, "");
      return modelNames.has(type) ? [] : [field[1]!];
    });
    return [name, names];
  }));
  const enums = [...schema.matchAll(/enum\s+(\w+)\s*\{/g)].map((match) => match[1]!);
  return { columns, enums, models: [...modelNames] };
}

function roleEnvironment(overrides: Record<string, string> = {}) {
  const credentials = {
    application: "app-role-secret-2Qx8Lm4Vr9Kp7Nc5Ws3H",
    bootstrap: "bootstrap-secret-8Nm3Kp7Vr2Xs9Lc5Qw4H",
    hold: "hold-role-secret-5Vr8Kp2Xm7Nc4Ls9Qw3H",
    migration: "migration-role-secret-4Kp9Xs2Vr7Lm5Nc8Qw3H",
    retention: "retention-role-secret-7Xs3Kp8Vr2Lm9Nc5Qw4H",
  };
  return {
    NODE_ENV: "production" as const,
    POSTGRES_DB: "clean_pay",
    POSTGRES_USER: "clean_pay_bootstrap",
    POSTGRES_PASSWORD: credentials.bootstrap,
    DATABASE_URL: `postgresql://clean_pay_app:${credentials.application}@postgres:5432/clean_pay?schema=public`,
    MIGRATION_DATABASE_URL: `postgresql://clean_pay_migration:${credentials.migration}@postgres:5432/clean_pay?schema=public`,
    RETENTION_DATABASE_URL: `postgresql://clean_pay_retention:${credentials.retention}@postgres:5432/clean_pay?schema=public`,
    HOLD_OPERATOR_DATABASE_URL: `postgresql://clean_pay_hold:${credentials.hold}@postgres:5432/clean_pay?schema=public`,
    ...overrides,
  };
}

describe("production database least-privilege contract", () => {
  it("keeps the exact manifest aligned with every Prisma model, column, and enum", () => {
    const objects = schemaObjects();
    expect([...DATABASE_TABLES].sort()).toEqual(objects.models.sort());
    expect([...DATABASE_ENUM_TYPES].sort()).toEqual(objects.enums.sort());
    expect(DATABASE_INTERNAL_TABLES).toEqual([
      "_clean_pay_retention_policy",
      "_prisma_migrations",
    ]);
    expect(Object.keys(DATABASE_TABLE_COLUMNS).sort()).toEqual([
      ...objects.models,
      "_clean_pay_retention_policy",
      "_prisma_migrations",
    ].sort());
    expect(DATABASE_TABLE_COLUMNS._clean_pay_retention_policy).toEqual([
      "singleton",
      "auth_state_days",
      "session_days",
      "audit_info_days",
      "audit_security_days",
      "rate_limit_days",
      "payment_sensitive_days",
      "payment_operation_snapshot_days",
      "payment_hold_disposed_days",
      "updated_at",
    ]);
    expect(DATABASE_TABLE_COLUMNS._prisma_migrations).toEqual([
      "id",
      "checksum",
      "finished_at",
      "migration_name",
      "logs",
      "rolled_back_at",
      "started_at",
      "applied_steps_count",
    ]);
    for (const [table, columns] of Object.entries(objects.columns)) {
      const manifestColumns = DATABASE_TABLE_COLUMNS as Record<string, readonly string[]>;
      expect([...manifestColumns[table]!].sort(), table).toEqual(columns.sort());
    }
    expect(DATABASE_FUNCTIONS.map(({ executeRoles, identityArguments, name }) => ({
      executeRoles,
      identityArguments,
      name,
    }))).toEqual([
      {
        name: "clean_pay_retention_delete_batch",
        identityArguments: "phase text",
        executeRoles: ["retention"],
      },
      {
        name: "clean_pay_retention_scrub_payment_operation_snapshots",
        identityArguments: "",
        executeRoles: ["retention"],
      },
      {
        name: "clean_pay_retention_scrub_payment_records",
        identityArguments: "",
        executeRoles: ["retention"],
      },
      {
        name: "clean_pay_retention_scrub_telegram_callbacks",
        identityArguments: "",
        executeRoles: ["retention"],
      },
      {
        name: "enforce_payment_retention_hold_integrity",
        identityArguments: "",
        executeRoles: [],
      },
      {
        name: "prevent_held_payment_case_link",
        identityArguments: "",
        executeRoles: [],
      },
      {
        name: "prevent_payment_retention_hold_reassignment",
        identityArguments: "",
        executeRoles: [],
      },
      {
        name: "prevent_retained_payment_hold_delete",
        identityArguments: "",
        executeRoles: [],
      },
    ]);
    expect(DATABASE_FUNCTIONS.every((fn) =>
      /^[0-9a-f]{64}$/.test(fn.sourceSha256)
    )).toBe(true);
    const retentionFunctions = DATABASE_FUNCTIONS.filter(({ executeRoles }) =>
      executeRoles.some((role: string) => role === "retention")
    );
    expect(retentionFunctions).toHaveLength(4);
    expect(retentionFunctions.every((fn) =>
      fn.securityDefiner
      && fn.configuration.join(",") === "search_path=pg_catalog, <target>,TimeZone=UTC"
    )).toBe(true);
    expect(DATABASE_FUNCTIONS.filter(({ executeRoles }) => executeRoles.length === 0)
      .every(({ configuration }) => configuration.join(",") === "search_path=pg_catalog"))
      .toBe(true);
    expect(DATABASE_FUNCTIONS.filter(({ securityDefiner }) => securityDefiner)
      .map(({ name }) => name)).toEqual([
      "clean_pay_retention_delete_batch",
      "clean_pay_retention_scrub_payment_operation_snapshots",
      "clean_pay_retention_scrub_payment_records",
      "clean_pay_retention_scrub_telegram_callbacks",
      "enforce_payment_retention_hold_integrity",
    ]);
    for (const fn of DATABASE_FUNCTIONS.filter(({ executeRoles }) => executeRoles.length === 0)) {
      const start = holdMigration.indexOf(`CREATE FUNCTION "${fn.name}"()`);
      expect(start).toBeGreaterThan(-1);
      const bodyStart = holdMigration.indexOf("AS $$", start) + "AS $$".length;
      const bodyEnd = holdMigration.indexOf("$$;", bodyStart);
      const normalizedBody = holdMigration.slice(bodyStart, bodyEnd)
        .replaceAll("\r\n", "\n")
        .replaceAll("\r", "\n");
      expect(createHash("sha256").update(normalizedBody).digest("hex")).toBe(
        fn.sourceSha256,
      );
    }
    for (const fn of retentionFunctions) {
      expect(guardedRetentionMigration).toContain(
        `CREATE FUNCTION %1$I."${fn.name}"`,
      );
      expect(guardedRetentionMigration).toContain(
        `REVOKE ALL PRIVILEGES ON FUNCTION %I."${fn.name}"`,
      );
    }
    expect(guardedRetentionMigration).toContain(
      'CREATE TABLE "_clean_pay_retention_policy"',
    );
    expect(guardedRetentionMigration).toContain("INTO STRICT");
    expect(guardedRetentionMigration).toContain(
      "pg_catalog.pg_advisory_xact_lock(72707369)",
    );
    expect(DATABASE_TRIGGERS).toHaveLength(6);
  });

  it("denies application access to cleanup markers, hold pointers, and dead models", () => {
    for (const table of ["AppSetting", "IntegrationStatus", "RateLimitEvent"]) {
      expect(APPLICATION_TABLE_PRIVILEGES).not.toHaveProperty(table);
      expect(APPLICATION_COLUMN_INSERTS).not.toHaveProperty(table);
      expect(APPLICATION_COLUMN_UPDATES).not.toHaveProperty(table);
    }
    expect(APPLICATION_TABLE_PRIVILEGES).not.toHaveProperty("PaymentRetentionHold");
    expect(APPLICATION_TABLE_PRIVILEGES.EmailVerificationCode).toEqual(["DELETE"]);
    expect(APPLICATION_COLUMN_SELECTS.EmailVerificationCode).toEqual(["userId"]);
    expect(APPLICATION_COLUMN_SELECTS.PaymentRetentionHold).toEqual([
      "status",
      "caseUserId",
      "caseOperationId",
      "casePaymentRecordId",
    ]);
    expect(APPLICATION_COLUMN_UPDATES.PaymentRetentionHold).toEqual([
      "caseUserId",
      "updatedAt",
    ]);
    expect(APPLICATION_COLUMN_INSERTS).not.toHaveProperty("PaymentRetentionHold");
    expect(APPLICATION_COLUMN_UPDATES.PaymentRecord).not.toEqual(
      expect.arrayContaining(["retentionHoldAt", "retentionHoldId", "sensitiveDataScrubbedAt"]),
    );
    expect(APPLICATION_COLUMN_UPDATES.PaymentOperation).not.toEqual(
      expect.arrayContaining([
        "requestPayload",
        "retentionHoldAt",
        "retentionHoldId",
        "snapshotScrubbedAt",
      ]),
    );
  });

  it("allows the exact Prisma-managed defaults required by active inserts", () => {
    const applicationDefaults = {
      AccountMergeConfirmation: ["status", "attemptCount", "createdAt", "updatedAt"],
      AuditLog: ["createdAt"],
      PaymentHistorySyncState: [
        "generation", "attemptCount", "failureCount", "createdAt", "updatedAt",
      ],
      PaymentOperation: [
        "status", "attemptCount", "reconcileAttemptCount",
        "reconcileFailureCount", "createdAt", "updatedAt",
      ],
      PaymentRecord: ["createdAt", "updatedAt"],
      TelegramAuthState: [
        "callbackStatus", "callbackAttemptCount", "createdAt", "updatedAt",
      ],
      WebAuthnChallenge: ["createdAt"],
      WebAuthnCredential: ["createdAt", "updatedAt"],
      WebRefreshToken: ["createdAt"],
      WebSession: ["remnashopRefreshAttemptCount", "createdAt", "updatedAt"],
      WebUser: ["paymentOwnerChangeAttemptCount", "createdAt", "updatedAt"],
    } as const;

    for (const [table, columns] of Object.entries(applicationDefaults)) {
      const insertColumns = APPLICATION_COLUMN_INSERTS[
        table as keyof typeof APPLICATION_COLUMN_INSERTS
      ];
      expect(insertColumns).toEqual(
        expect.arrayContaining([...columns]),
      );
    }
    expect(HOLD_OPERATOR_COLUMN_INSERTS.PaymentRetentionHold).toEqual(
      expect.arrayContaining(["createdAt", "updatedAt"]),
    );
    expect(APPLICATION_TABLE_PRIVILEGES).not.toHaveProperty("AuditLog");
    expect(APPLICATION_COLUMN_SELECTS.AuditLog).toEqual(["userId"]);
    expect(APPLICATION_COLUMN_UPDATES.AuditLog).toEqual(["userId"]);
  });

  it("keeps cleanup and hold lifecycle rights mutually isolated", () => {
    expect(RETENTION_TABLE_PRIVILEGES).toEqual({});
    expect(RETENTION_COLUMN_SELECTS).toEqual({});
    expect(RETENTION_COLUMN_UPDATES).toEqual({});
    expect(DATABASE_FUNCTIONS.filter(({ executeRoles }) =>
      executeRoles.some((role: string) => role === "retention")
    ).map(({ name }) => name)).toEqual([
      "clean_pay_retention_delete_batch",
      "clean_pay_retention_scrub_payment_operation_snapshots",
      "clean_pay_retention_scrub_payment_records",
      "clean_pay_retention_scrub_telegram_callbacks",
    ]);
    expect(HOLD_OPERATOR_TABLE_PRIVILEGES.PaymentRetentionHold).toEqual(["SELECT"]);
    expect(HOLD_OPERATOR_COLUMN_INSERTS).toHaveProperty("PaymentRetentionHold");
    expect(HOLD_OPERATOR_COLUMN_UPDATES.PaymentRetentionHold).not.toEqual(
      expect.arrayContaining(["holdIdHash", "selectorEvidenceHash", "heldAt", "createdAt"]),
    );
    expect(Object.values(HOLD_OPERATOR_TABLE_PRIVILEGES).flat()).not.toContain("DELETE");
  });

  it("uses guarded targeted ownership and fail-closed ACL reconciliation", () => {
    expect(provisioner).toContain("pg_advisory_lock");
    expect(provisioner).toContain("CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED");
    expect(provisioner).toContain("ALTER DEFAULT PRIVILEGES");
    expect(provisioner).toContain("REVOKE ALL PRIVILEGES ON ${objectKind} FROM ${grantees}");
    expect(provisioner).toContain("assertExactManifest");
    expect(provisioner).toContain("assertFailClosedDefaultPrivileges");
    expect(provisioner).toContain("assertNoUnexpectedGrantees");
    expect(provisioner).toContain("acl.is_grantable");
    expect(provisioner).toContain("trigger.tgqual IS NULL AS condition_free");
    expect(provisioner).toContain("normalizedSourceSha256");
    expect(provisioner).toContain("member.rolname = $1 OR parent.rolname = $1");
    expect(provisioner).toContain("requires a dedicated PostgreSQL cluster");
    expect(provisioner).toContain("SET search_path TO pg_catalog");
    expect(provisioner).toContain("pg_terminate_backend");
    expect(provisioner).toContain("t.typtype IN ('e', 'd', 'r', 'm')");
    expect(provisioner).toContain("NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    expect(provisioner).toContain('${loginRoles.has(roleKey) ? "LOGIN" : "NOLOGIN"}');
    expect(provisioner).not.toContain("REASSIGN OWNED");
    expect(provisioner).not.toMatch(/GRANT\s+(?:ALL|CREATE|TEMP|TRUNCATE)/);

    const committedFence = provisioner.slice(
      provisioner.indexOf("async function commitNoLoginFence"),
      provisioner.indexOf("async function terminateRuntimeRoleSessions"),
    );
    expect(committedFence.match(/runProvisioningTransaction/gu)).toHaveLength(2);
    expect(committedFence.indexOf("reconcileLoginRoles")).toBeLessThan(
      committedFence.indexOf("terminateRuntimeRoleSessions"),
    );
    expect(committedFence.indexOf("terminateRuntimeRoleSessions")).toBeLessThan(
      committedFence.indexOf("revokeRoleObjectPrivileges"),
    );
    expect(committedFence).toContain("assertTargetRuntimeObjectPrivilegesAbsent");
    const rollbackAllowlist = provisioner.slice(
      provisioner.indexOf("const REVIEWED_ROLLBACK_MIGRATIONS"),
      provisioner.indexOf("const REVIEWED_ALTERNATE_MIGRATION_CHECKSUMS"),
    );
    expect(rollbackAllowlist).toContain(
      '"20260825230000_guard_retention_mutations"',
    );
  });

  it("rolls back every provisioning mutation after a late failure", async () => {
    const query = vi.fn(async (statement: string) => {
      void statement;
      return {};
    });
    await expect(runProvisioningTransaction({ query }, async () => {
      await query("ALTER ROLE late_failure");
      throw new Error("late failure");
    })).rejects.toThrow("late failure");
    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "ALTER ROLE late_failure",
      "ROLLBACK",
    ]);
    const prepare = provisioner.slice(
      provisioner.indexOf("async function prepareDatabaseRoles"),
      provisioner.indexOf("function logicalRoles"),
    );
    expect(prepare.indexOf("runProvisioningTransaction")).toBeLessThan(
      prepare.indexOf("reconcileLoginRoles"),
    );
  });

  it("serializes against Prisma migrations and releases both locks after failure", async () => {
    const query = vi.fn(async (statement: string) => {
      void statement;
      return {};
    });
    await expect(withProvisioningLock({ query }, async () => {
      throw new Error("locked failure");
    })).rejects.toThrow("locked failure");
    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      "SELECT pg_advisory_lock(72707369)",
      "SELECT pg_advisory_unlock(72707369)",
      "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
    ]);
  });

  it("requires five distinct identities and rejects reserved schemas", () => {
    const configuration = parseDatabaseRoleConfiguration(roleEnvironment());
    expect(configuration.retentionPolicy).toEqual({
      authStateDays: 7,
      sessionDays: 90,
      auditInfoDays: 180,
      auditSecurityDays: 365,
      rateLimitDays: 30,
      paymentSensitiveDays: 30,
      paymentOperationSnapshotDays: 90,
      paymentHoldDisposedDays: 365,
    });
    expect(parseDatabaseRoleConfiguration(roleEnvironment({
      AUTH_STATE_RETENTION_DAYS: "14",
      SESSION_RETENTION_DAYS: "120",
      AUDIT_INFO_RETENTION_DAYS: "365",
      AUDIT_SECURITY_RETENTION_DAYS: "730",
      RATE_LIMIT_RETENTION_DAYS: "60",
      PAYMENT_SENSITIVE_RETENTION_DAYS: "45",
      PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS: "180",
      PAYMENT_HOLD_DISPOSED_RETENTION_DAYS: "730",
    })).retentionPolicy).toEqual({
      authStateDays: 14,
      sessionDays: 120,
      auditInfoDays: 365,
      auditSecurityDays: 730,
      rateLimitDays: 60,
      paymentSensitiveDays: 45,
      paymentOperationSnapshotDays: 180,
      paymentHoldDisposedDays: 730,
    });
    expect(() => parseDatabaseRoleConfiguration(roleEnvironment({
      PAYMENT_SENSITIVE_RETENTION_DAYS: " 30",
    }))).toThrow("without surrounding whitespace");
    expect(() => parseDatabaseRoleConfiguration(roleEnvironment({
      PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS: "29",
    }))).toThrow("between 30 and 730");
    expect(new Set([
      configuration.bootstrap.role,
      ...Object.values(configuration.roles).map(({ role }) => role),
    ]).size).toBe(5);
    expect(() => parseDatabaseRoleConfiguration(roleEnvironment({
      RETENTION_DATABASE_URL: roleEnvironment().DATABASE_URL,
    }))).toThrow("pairwise distinct");
    expect(() => parseDatabaseRoleConfiguration(roleEnvironment({
      DATABASE_URL: roleEnvironment().DATABASE_URL.replace("schema=public", "schema=pg_catalog"),
    }))).toThrow("reserved PostgreSQL schema");
    expect(quoteLiteral("long-password-with\\slash'quote-value")).toBe(
      "E'long-password-with\\\\slash''quote-value'",
    );
    for (const encodedControl of ["%00", "%0A"]) {
      expect(() => parseDatabaseRoleConfiguration(roleEnvironment({
        DATABASE_URL: roleEnvironment().DATABASE_URL.replace(
          "app-role-secret-2Qx8Lm4Vr9Kp7Nc5Ws3H",
          `app-role-secret-2Qx8Lm4Vr9Kp7Nc5Ws3H${encodedControl}`,
        ),
      }))).toThrow("password");
    }
  });

  it("orders every Compose deployment through provision, migration, and grant sync", () => {
    for (const compose of [productionCompose, rootCompose]) {
      expect(compose).toContain("db-role-provision:");
      expect(compose).toContain("db-grant-sync:");
      expect(compose).toContain("retention-hold:");
      expect(compose).toMatch(
        /migration:[\s\S]*?db-role-provision:[\s\S]*?condition: service_completed_successfully/,
      );
      expect(compose).toMatch(
        /app:[\s\S]*?db-grant-sync:[\s\S]*?condition: service_completed_successfully/,
      );
      expect(compose).toContain("${CLEAN_PAY_HOLD_OPERATOR_ENV_FILE:-.env.hold-operator}");
      expect(compose).toContain("${CLEAN_PAY_PROVISION_ENV_FILE:-.env.provision}");
    }
  });
});
