import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  RetentionCleanupAggregateError,
  retentionPolicy,
  RetentionProgressError,
  retentionRetryDelayMs,
  runRetentionCleanup,
} from "../../../deploy/prod/retention-cleanup.mjs";

const DELETE_PHASES = [
  "webAuthnChallengesExpired",
  "webAuthnChallengesConsumed",
  "telegramAuthStatesExpired",
  "telegramAuthStatesConsumed",
  "emailVerificationCodesExpired",
  "emailVerificationCodesConsumed",
  "accountMergeConfirmations",
  "webSessionsRevoked",
  "webSessionsExpired",
  "auditInfo",
  "auditSecurity",
  "paymentRetentionHolds",
  "rateLimitEvents",
] as const;

const PHASE_ORDER = [
  "webAuthnChallengesExpired",
  "webAuthnChallengesConsumed",
  "telegramCallbackResults",
  "telegramAuthStatesExpired",
  "telegramAuthStatesConsumed",
  "emailVerificationCodesExpired",
  "emailVerificationCodesConsumed",
  "accountMergeConfirmations",
  "webSessionsRevoked",
  "webSessionsExpired",
  "auditInfo",
  "auditSecurity",
  "paymentRetentionHolds",
  "rateLimitEvents",
  "paymentRecords",
  "paymentOperations",
] as const;

type GuardedRow = Readonly<{
  affected: number;
  backlog: boolean;
  selected: number;
}>;

type GuardedCall = Readonly<{
  phase: string;
  query: string;
  values: readonly unknown[];
}>;

function guardedPrisma(responses: Record<string, unknown> = {}) {
  const calls: GuardedCall[] = [];
  const queryRaw = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const query = strings.join("?");
    let phase: string;
    if (query.includes('"clean_pay_retention_delete_batch"')) {
      phase = String(values[0]);
    } else if (query.includes('"clean_pay_retention_scrub_telegram_callbacks"')) {
      phase = "telegramCallbackResults";
    } else if (query.includes('"clean_pay_retention_scrub_payment_records"')) {
      phase = "paymentRecords";
    } else if (query.includes('"clean_pay_retention_scrub_payment_operation_snapshots"')) {
      phase = "paymentOperations";
    } else {
      throw new Error("unexpected guarded retention query");
    }
    calls.push(Object.freeze({ phase, query, values: Object.freeze([...values]) }));
    const response = responses[phase];
    if (response instanceof Error) throw response;
    if (response === undefined) {
      return [{ affected: 0, backlog: false, selected: 0 } satisfies GuardedRow];
    }
    return Array.isArray(response) ? response : [response];
  });
  return { $queryRaw: queryRaw, calls };
}

describe("production data retention", () => {
  it("uses conservative bounded defaults and rejects unsafe policy values", () => {
    expect(retentionPolicy({ NODE_ENV: "test" })).toEqual({
      authStateDays: 7,
      sessionDays: 90,
      auditInfoDays: 180,
      auditSecurityDays: 365,
      rateLimitDays: 30,
      paymentSensitiveDays: 30,
      paymentOperationSnapshotDays: 90,
      paymentHoldDisposedDays: 365,
    });
    expect(() => retentionPolicy({
      NODE_ENV: "test",
      AUTH_STATE_RETENTION_DAYS: "0",
    })).toThrow("AUTH_STATE_RETENTION_DAYS");
    expect(() => retentionPolicy({
      NODE_ENV: "test",
      AUDIT_INFO_RETENTION_DAYS: "400",
      AUDIT_SECURITY_RETENTION_DAYS: "365",
    })).toThrow("must be at least");
    expect(() => retentionPolicy({
      NODE_ENV: "test",
      PAYMENT_SENSITIVE_RETENTION_DAYS: "6",
    })).toThrow("PAYMENT_SENSITIVE_RETENTION_DAYS");
  });

  it("dispatches only the reviewed guarded functions and maps their bounded results", async () => {
    const prisma = guardedPrisma({
      webAuthnChallengesExpired: { selected: 1, affected: 1, backlog: false },
      webAuthnChallengesConsumed: { selected: 2, affected: 2, backlog: true },
      telegramCallbackResults: { selected: 10, affected: 9, backlog: true },
      telegramAuthStatesExpired: { selected: 3, affected: 3, backlog: false },
      telegramAuthStatesConsumed: { selected: 4, affected: 4, backlog: false },
      emailVerificationCodesExpired: { selected: 5, affected: 5, backlog: false },
      emailVerificationCodesConsumed: { selected: 6, affected: 6, backlog: false },
      accountMergeConfirmations: { selected: 7, affected: 7, backlog: false },
      webSessionsRevoked: { selected: 8, affected: 8, backlog: false },
      webSessionsExpired: { selected: 9, affected: 9, backlog: false },
      auditInfo: { selected: 11, affected: 11, backlog: false },
      auditSecurity: { selected: 12, affected: 12, backlog: false },
      paymentRetentionHolds: { selected: 13, affected: 13, backlog: true },
      rateLimitEvents: { selected: 14, affected: 14, backlog: false },
      paymentRecords: { selected: 15, affected: 15, backlog: true },
      paymentOperations: { selected: 16, affected: 16, backlog: false },
    });

    await expect(runRetentionCleanup(
      prisma,
      retentionPolicy({ NODE_ENV: "test" }),
      new Date("2026-08-26T00:00:00.000Z"),
    )).resolves.toEqual({
      webAuthnChallenges: 3,
      telegramCallbackResultsScrubbed: 9,
      telegramCallbackRetentionBacklog: true,
      telegramAuthStates: 7,
      emailVerificationCodes: 11,
      accountMergeConfirmations: 7,
      webSessions: 17,
      auditInfo: 11,
      auditSecurity: 12,
      paymentRetentionHoldsDisposed: 13,
      paymentRetentionHoldBacklog: true,
      rateLimitEvents: 14,
      paymentRecordsScrubbed: 15,
      paymentOperationsScrubbed: 16,
      paymentRetentionBacklog: true,
      genericRetentionBacklogSources: ["webAuthnChallenges"],
      genericRetentionBacklog: true,
      retentionBacklog: true,
    });

    expect(prisma.calls.map(({ phase }) => phase)).toEqual(PHASE_ORDER);
    expect(prisma.calls.filter(({ phase }) =>
      DELETE_PHASES.includes(phase as (typeof DELETE_PHASES)[number])
    ).every(({ query, values }) =>
      query.includes('FROM "clean_pay_retention_delete_batch"(?::text)')
      && values.length === 1
    )).toBe(true);
    expect(prisma.calls.filter(({ phase }) =>
      !DELETE_PHASES.includes(phase as (typeof DELETE_PHASES)[number])
    ).every(({ values }) => values.length === 0)).toBe(true);
  });

  it("never sends caller policy, clock, cutoffs, or raw DML to PostgreSQL", async () => {
    const prisma = guardedPrisma();
    const secretPolicyMarker = "CALLER_POLICY_MUST_NOT_REACH_SQL";
    const secretNow = new Date("2040-03-04T05:06:07.890Z");
    await runRetentionCleanup(prisma, { marker: secretPolicyMarker }, secretNow);

    const serializedCalls = JSON.stringify(prisma.calls);
    expect(serializedCalls).not.toContain(secretPolicyMarker);
    expect(serializedCalls).not.toContain(secretNow.toISOString());
    expect(prisma.calls.flatMap(({ values }) => values)).toEqual(DELETE_PHASES);

    const cleanup = readFileSync("deploy/prod/retention-cleanup.mjs", "utf8");
    expect(cleanup.match(/\$queryRaw`/gu)).toHaveLength(4);
    expect(cleanup).not.toContain("$queryRawUnsafe");
    expect(cleanup).not.toContain("$executeRaw");
    expect(cleanup).not.toMatch(/\.(?:deleteMany|findMany|updateMany|update|delete)\s*\(/u);
    expect(cleanup).not.toContain("setHours");
    expect(cleanup).not.toContain("setDate");
    expect(cleanup).toContain("void policy");
    expect(cleanup).toContain("void now");
  });

  it("validates every guarded function result before reporting mutation counts", async () => {
    const invalidResults: unknown[] = [
      [],
      [{ selected: 0, affected: 0, backlog: false }, { selected: 0, affected: 0, backlog: false }],
      [{ selected: 501, affected: 0, backlog: false }],
      [{ selected: 1, affected: 2, backlog: false }],
      [{ selected: 1.5, affected: 1, backlog: false }],
      [{ selected: 1, affected: 1, backlog: "false" }],
    ];

    for (const invalid of invalidResults) {
      const prisma = guardedPrisma({ webAuthnChallengesExpired: invalid });
      await expect(runRetentionCleanup(
        prisma,
        retentionPolicy({ NODE_ENV: "test" }),
      )).rejects.toMatchObject({
        name: "RetentionCleanupAggregateError",
        phases: ["webAuthnChallengesExpired"],
      });
    }
  });

  it("continues independent guarded phases and aggregates only redacted phase failures", async () => {
    const secret = "RAW_DATABASE_SECRET_MARKER";
    const prisma = guardedPrisma({
      webAuthnChallengesExpired: new Error(secret),
      paymentRecords: new Error(`${secret}-payment`),
      rateLimitEvents: { selected: 1, affected: 1, backlog: false },
      paymentOperations: { selected: 1, affected: 1, backlog: false },
    });

    let thrown: unknown;
    try {
      await runRetentionCleanup(prisma, retentionPolicy({ NODE_ENV: "test" }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RetentionCleanupAggregateError);
    expect(thrown).toMatchObject({
      phases: ["webAuthnChallengesExpired", "paymentRecords"],
    });
    expect((thrown as Error).message).not.toContain(secret);
    expect(prisma.calls.map(({ phase }) => phase)).toEqual(PHASE_ORDER);
  });

  it("reports bounded progress without identifiers and treats reporter failure as fatal", async () => {
    const prisma = guardedPrisma({
      webAuthnChallengesExpired: { selected: 2, affected: 1, backlog: false },
      telegramCallbackResults: { selected: 3, affected: 2, backlog: false },
    });
    const onProgress = vi.fn();
    await runRetentionCleanup(
      prisma,
      retentionPolicy({ NODE_ENV: "test" }),
      new Date(),
      { onProgress },
    );
    const events = onProgress.mock.calls.map(([event]) => event);
    expect(events).toEqual(expect.arrayContaining([
      { phase: "webAuthnChallengesExpired", stage: "selecting", processed: 0 },
      { phase: "webAuthnChallengesExpired", stage: "selected", processed: 2 },
      { phase: "webAuthnChallengesExpired", stage: "mutated", processed: 1 },
      { phase: "telegramCallbackResults", stage: "selected", processed: 3 },
      { phase: "telegramCallbackResults", stage: "mutated", processed: 2 },
      { phase: "cleanup", stage: "completed", processed: 0 },
    ]));
    expect(JSON.stringify(events)).not.toContain("row-");

    const fatalPrisma = guardedPrisma({
      webAuthnChallengesExpired: { selected: 1, affected: 1, backlog: false },
    });
    await expect(runRetentionCleanup(
      fatalPrisma,
      retentionPolicy({ NODE_ENV: "test" }),
      new Date(),
      {
        onProgress(event: { stage: string }) {
          if (event.stage === "selected") {
            throw new Error("RAW_HEARTBEAT_SECRET_MARKER");
          }
        },
      },
    )).rejects.toBeInstanceOf(RetentionProgressError);
    expect(fatalPrisma.calls.map(({ phase }) => phase)).toEqual([
      "webAuthnChallengesExpired",
    ]);
  });

  it("reports each split-phase backlog source once and all dedicated backlogs", async () => {
    const prisma = guardedPrisma({
      webAuthnChallengesExpired: { selected: 500, affected: 500, backlog: true },
      webAuthnChallengesConsumed: { selected: 500, affected: 500, backlog: true },
      telegramCallbackResults: { selected: 500, affected: 500, backlog: true },
      paymentRetentionHolds: { selected: 500, affected: 500, backlog: true },
      paymentRecords: { selected: 500, affected: 500, backlog: true },
      paymentOperations: { selected: 500, affected: 500, backlog: true },
    });
    await expect(runRetentionCleanup(
      prisma,
      retentionPolicy({ NODE_ENV: "test" }),
    )).resolves.toMatchObject({
      webAuthnChallenges: 1_000,
      genericRetentionBacklogSources: ["webAuthnChallenges"],
      genericRetentionBacklog: true,
      telegramCallbackRetentionBacklog: true,
      paymentRetentionHoldBacklog: true,
      paymentRetentionBacklog: true,
      retentionBacklog: true,
    });

    const loop = readFileSync("deploy/prod/retention-loop.mjs", "utf8");
    expect(loop).toContain("counts.retentionBacklog");
    expect(loop).toContain("await shutdown.sleep(1_000)");
  });

  it("ships exact policy-bound guarded retention SQL with safe snapshot minimization", () => {
    const migration = readFileSync(
      "prisma/migrations/20260825230000_guard_retention_mutations/migration.sql",
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "_clean_pay_retention_policy"');
    expect(migration.match(/CREATE FUNCTION %1\$I\."clean_pay_retention_/gu)).toHaveLength(4);
    expect(migration.match(/SECURITY DEFINER/gu)).toHaveLength(4);
    expect(migration.match(/pg_catalog\.pg_advisory_xact_lock\(72707369\)/gu)).toHaveLength(4);
    expect(migration.match(/INTO STRICT/gu)).toHaveLength(4);
    expect(migration.match(/LIMIT 501/gu)?.length).toBeGreaterThanOrEqual(16);
    expect(migration).toContain("unknown guarded retention delete phase");
    expect(migration).toContain("ERRCODE = '22023'");
    expect(migration).toContain("operation.\"errorSnapshot\" ->> 'status' ~ '^[45][0-9]{2}([.]0+)?$'");
    expect(migration).toContain("pg_catalog.substring(operation.\"errorSnapshot\" ->> 'status', 1, 3)::INTEGER");
    expect(migration).not.toMatch(/errorSnapshot[\s\S]{0,300}::NUMERIC/u);
    expect(migration).toContain("operation.\"retentionHoldAt\" IS NULL");
    expect(migration).toContain("operation.\"retentionHoldId\" IS NULL");
    expect(migration).toContain("hold.\"status\" IN ('ACTIVE', 'RELEASED')");
    expect(migration.match(/REVOKE ALL PRIVILEGES ON FUNCTION %I\."clean_pay_retention_/gu)).toHaveLength(4);
    expect(migration).not.toMatch(/GRANT\s+EXECUTE/iu);
  });

  it("ships explicit retention-hold and scrub-state columns in an additive migration", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20260825210000_add_payment_sensitive_retention/migration.sql",
      "utf8",
    );

    expect(schema).toContain("sensitiveDataScrubbedAt");
    expect(schema).toContain("terminalObservedAt");
    expect(schema).toContain("snapshotScrubbedAt");
    expect(schema.match(/retentionHoldAt/g)).toHaveLength(4);
    expect(schema).toContain(
      '@@index([status, sensitiveDataScrubbedAt, terminalObservedAt, id], map: "PaymentRecord_retention_scrub_candidates_idx")',
    );
    expect(schema).toContain(
      '@@index([status, snapshotScrubbedAt, completedAt, id], map: "PaymentOperation_status_snapshotScrubbedAt_completedAt_idx")',
    );
    expect(migration).toContain('ALTER TABLE "PaymentRecord"');
    expect(migration).toContain('ALTER TABLE "PaymentOperation"');
    expect(migration).toContain('CREATE INDEX "RateLimitEvent_occurredAt_idx"');
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)/iu);
  });

  it("uses bounded exponential failure retries and exits for supervisor restart", () => {
    expect([1, 2, 3, 4, 5, 6].map(retentionRetryDelayMs)).toEqual([
      5_000,
      10_000,
      20_000,
      40_000,
      60_000,
      60_000,
    ]);
    expect(() => retentionRetryDelayMs(0)).toThrow("positive integer");

    const loop = readFileSync("deploy/prod/retention-loop.mjs", "utf8");
    const fatalHeartbeatCheck = loop.indexOf("error instanceof RetentionHeartbeatError");
    const cleanupFailureIncrement = loop.indexOf("consecutiveCleanupFailures += 1");
    expect(loop).toContain("const MAX_CONSECUTIVE_CLEANUP_FAILURES = 5");
    expect(loop).toContain("consecutiveCleanupFailures = 0");
    expect(loop).toContain("await shutdown.sleep(retryDelayMs)");
    expect(loop).toContain("supervisorRestartRequired: exhausted");
    expect(loop).toContain("error instanceof RetentionProgressError");
    expect(fatalHeartbeatCheck).toBeGreaterThan(0);
    expect(fatalHeartbeatCheck).toBeLessThan(cleanupFailureIncrement);
    expect(loop).not.toContain("error.message");
  });

  it("documents a schema-bound backup and guarded restore without URL credentials", () => {
    const runbook = readFileSync("docs/production-migration-runbook.md", "utf8");

    expect(runbook).not.toContain('pg_dump "$DATABASE_URL"');
    expect(runbook).toContain("host:port:database:user:password");
    expect(runbook).toContain("stat -c '%a' -- \"$PGPASSFILE\"");
    expect(runbook).toContain('--schema="$pg_schema"');
    expect(runbook).toContain("--format=custom");
    expect(runbook).toContain('test "$source_database" != "$restore_database"');
    expect(runbook).toContain("test \"$database_guard\" = '0'");
    expect(runbook).toContain('sha256sum --check "$backup_checksum"');
    expect(runbook).toContain('SELECT count(*) FROM :"expected_schema"."WebUser"');
    expect(runbook).toContain('FROM :"expected_schema"."WebSession"');
    expect(runbook).not.toContain("schemaname = current_schema()");
  });

  it("validates, packages, and gracefully stops the isolated retention worker", () => {
    const loop = readFileSync("deploy/prod/retention-loop.mjs", "utf8");
    const prodCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
    const rootCompose = readFileSync("docker-compose.yml", "utf8");
    const rootDockerfile = readFileSync("Dockerfile", "utf8");
    const roleGuard = loop.indexOf('process.env.CLEAN_PAY_RUNTIME_ROLE !== "retention"');
    const environmentGuard = loop.indexOf("validateProductionDatabaseRoleEnvironment(process.env)");
    const poolCreation = loop.indexOf("createPostgresPool({");
    expect(roleGuard).toBeGreaterThanOrEqual(0);
    expect(environmentGuard).toBeGreaterThan(roleGuard);
    expect(poolCreation).toBeGreaterThan(environmentGuard);

    for (const compose of [prodCompose, rootCompose]) {
      expect(compose).toMatch(/retention-worker:[\s\S]*retention-loop\.mjs[\s\S]*retention-heartbeat\.mjs/u);
      const section = compose.match(/\n  retention-worker:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n)/u)?.[1] ?? "";
      expect(section).toContain("depends_on:");
      expect(section).toContain("init: true");
      expect(section).toContain("stop_grace_period: 2m");
      expect(section).toContain('test: ["CMD", "node", "deploy/prod/retention-heartbeat.mjs", "check"]');
    }
    expect(rootDockerfile).toContain("retention-cleanup.mjs");
    expect(loop).toContain("while (!shutdown.requested)");
    expect(loop).toContain("onProgress: () => heartbeat.progress()");
    expect(loop.indexOf("await prisma.$disconnect()")).toBeGreaterThan(
      loop.indexOf("} finally {")
    );
  });
});
