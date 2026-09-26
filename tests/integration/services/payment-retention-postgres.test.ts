import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyRemnashopTransaction } from "@/backend/integrations/payments/payment-record-service";
import {
  disposePaymentRetentionHold,
  placePaymentRetentionHold,
  releasePaymentRetentionHold,
} from "../../../deploy/prod/payment-retention-hold.mjs";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;
const realDatabaseSchema = realDatabaseUrl
  ? (new URL(realDatabaseUrl).searchParams.get("schema") ?? "public")
  : "public";
if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(realDatabaseSchema)) {
  throw new Error("REAL_DATABASE_URL schema is invalid");
}
const qualifiedPaymentRecord = `"${realDatabaseSchema}"."PaymentRecord"`;
const qualifiedRetentionPolicy =
  `"${realDatabaseSchema}"."_clean_pay_retention_policy"`;
const qualifiedPaymentRecordScrub =
  `"${realDatabaseSchema}"."clean_pay_retention_scrub_payment_records"`;
const qualifiedPaymentOperationScrub =
  `"${realDatabaseSchema}"."clean_pay_retention_scrub_payment_operation_snapshots"`;

const DAY_MS = 24 * 60 * 60 * 1_000;
const standardRetentionPolicy = Object.freeze({
  authStateDays: 7,
  sessionDays: 90,
  auditInfoDays: 180,
  auditSecurityDays: 365,
  rateLimitDays: 30,
  paymentSensitiveDays: 30,
  paymentOperationSnapshotDays: 90,
  paymentHoldDisposedDays: 365,
});

type StoredRetentionPolicy = typeof standardRetentionPolicy;

type GuardedMutationResult = {
  selected: number;
  affected: number;
  backlog: boolean;
};

async function serverNow(client: Client) {
  const result = await client.query<{ now: Date }>(
    "SELECT pg_catalog.clock_timestamp() AS now",
  );
  const now = result.rows[0]?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("PostgreSQL server clock is unavailable");
  }
  return now;
}

async function readRetentionPolicy(client: Client) {
  const result = await client.query<StoredRetentionPolicy>(`
    SELECT auth_state_days AS "authStateDays",
           session_days AS "sessionDays",
           audit_info_days AS "auditInfoDays",
           audit_security_days AS "auditSecurityDays",
           rate_limit_days AS "rateLimitDays",
           payment_sensitive_days AS "paymentSensitiveDays",
           payment_operation_snapshot_days AS "paymentOperationSnapshotDays",
           payment_hold_disposed_days AS "paymentHoldDisposedDays"
      FROM ${qualifiedRetentionPolicy}
     WHERE singleton = TRUE
  `);
  if (result.rowCount === 0) return null;
  if (result.rowCount !== 1 || !result.rows[0]) {
    throw new Error("guarded retention policy singleton is invalid");
  }
  return result.rows[0];
}

async function upsertRetentionPolicy(
  client: Client,
  policy: StoredRetentionPolicy,
) {
  await client.query(`
    INSERT INTO ${qualifiedRetentionPolicy} (
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
  `, [
    policy.authStateDays,
    policy.sessionDays,
    policy.auditInfoDays,
    policy.auditSecurityDays,
    policy.rateLimitDays,
    policy.paymentSensitiveDays,
    policy.paymentOperationSnapshotDays,
    policy.paymentHoldDisposedDays,
  ]);
}

async function withRetentionPolicyLock(
  client: Client,
  work: () => Promise<void>,
) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_catalog.pg_advisory_xact_lock(72707369)");
    await work();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function runGuardedPaymentScrub(
  client: Client,
  untrustedCallerNow: Date,
) {
  // Deliberately ignore this value. The fixed-arity functions obtain their
  // timestamp and retention cutoffs from PostgreSQL, not from the caller.
  void untrustedCallerNow;
  const records = await client.query<GuardedMutationResult>(`
    SELECT selected, affected, backlog
      FROM ${qualifiedPaymentRecordScrub}()
  `);
  const operations = await client.query<GuardedMutationResult>(`
    SELECT selected, affected, backlog
      FROM ${qualifiedPaymentOperationScrub}()
  `);
  if (
    records.rowCount !== 1
    || operations.rowCount !== 1
    || !records.rows[0]
    || !operations.rows[0]
  ) {
    throw new Error("guarded payment retention returned an invalid result");
  }
  return {
    paymentRecords: records.rows[0],
    paymentOperations: operations.rows[0],
  };
}

async function updatePaymentRecordOperation(
  paymentRecordId: string,
  operationId: string | null,
) {
  const client = new Client({ connectionString: realDatabaseUrl });
  await client.connect();
  try {
    await client.query("SET search_path = pg_catalog");
    return await client.query(
      `UPDATE ${qualifiedPaymentRecord} SET "operationId" = $1 WHERE "id" = $2`,
      [operationId, paymentRecordId],
    );
  } finally {
    await client.end();
  }
}

describeWithPostgres("payment-sensitive retention PostgreSQL policy", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let trustedDatabaseClient: Client | undefined;
  let previousRetentionPolicy: StoredRetentionPolicy | null = null;
  let retentionPolicyConfigured = false;
  let userId = "";
  const retentionHoldIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;
    ({ prisma } = await import("@/backend/database/prisma"));
    const client = new Client({ connectionString: realDatabaseUrl });
    trustedDatabaseClient = client;
    await client.connect();
    await client.query("SET search_path = pg_catalog");
    await withRetentionPolicyLock(client, async () => {
      previousRetentionPolicy = await readRetentionPolicy(client);
      await upsertRetentionPolicy(
        client,
        standardRetentionPolicy,
      );
    });
    retentionPolicyConfigured = true;
  });

  afterAll(async () => {
    try {
      if (prisma && userId) {
        // Test teardown deliberately creates valid disposed tombstones before
        // deleting them; the production workflow still requires release+dispose.
        // Pointers and lifecycle rows must reach their final state in one
        // transaction because the database verifies the bidirectional invariant
        // with deferred constraint triggers at commit.
        const cleanupAt = new Date("2100-01-01T00:00:00.000Z");
        await prisma.$transaction(async (tx) => {
          await tx.paymentOperation.updateMany({
            where: { userId },
            data: { retentionHoldId: null, retentionHoldAt: null },
          });
          await tx.paymentRecord.updateMany({
            where: { userId },
            data: { retentionHoldId: null, retentionHoldAt: null },
          });
          await tx.paymentRetentionHold.updateMany({
            where: {
              status: "ACTIVE",
              OR: [
                { caseUserId: userId },
                { id: { in: retentionHoldIds } },
              ],
            },
            data: {
              status: "RELEASED",
              activeCaseKey: null,
              releasedBy: "integration-cleanup",
              releaseReason: "integration teardown",
              releasedAt: cleanupAt,
            },
          });
          await tx.paymentRetentionHold.updateMany({
            where: {
              status: "RELEASED",
              OR: [
                { caseUserId: userId },
                { id: { in: retentionHoldIds } },
              ],
            },
            data: {
              status: "DISPOSED",
              selectorKind: null,
              selectorId: null,
              activeCaseKey: null,
              caseUserId: null,
              caseOperationId: null,
              casePaymentRecordId: null,
              owner: null,
              reason: null,
              reviewAt: null,
              releasedBy: null,
              releaseReason: null,
              disposedBy: "integration-cleanup",
              disposition: "CASE_CLOSED",
              disposedAt: cleanupAt,
            },
          });
        }, { maxWait: 5_000, timeout: 15_000 });
        await prisma.paymentRetentionHold.deleteMany({
          where: {
            OR: [
              { caseUserId: userId },
              { id: { in: retentionHoldIds } },
            ],
          },
        });
        await prisma.paymentRecord.deleteMany({ where: { userId } });
        await prisma.paymentOperation.deleteMany({ where: { userId } });
        await prisma.webUser.delete({ where: { id: userId } })
          .catch(() => undefined);
      }
    } finally {
      try {
        if (prisma) await prisma.$disconnect();
      } finally {
        const client = trustedDatabaseClient;
        if (client) {
          try {
            if (retentionPolicyConfigured) {
              await withRetentionPolicyLock(client, async () => {
                if (previousRetentionPolicy) {
                  await upsertRetentionPolicy(client, previousRetentionPolicy);
                } else {
                  await client.query(
                    `DELETE FROM ${qualifiedRetentionPolicy} WHERE singleton = TRUE`,
                  );
                }
              });
            }
          } finally {
            await client.end();
          }
        }
      }
    }
  });

  it("scrubs only old terminal non-held markers and is idempotent", async () => {
    const databaseClient = trustedDatabaseClient;
    if (!databaseClient) {
      throw new Error("trusted PostgreSQL client is unavailable");
    }
    const marker = "PAYMENT_SECRET_MARKER";
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const lifecycleNow = await serverNow(databaseClient);
    const old = new Date(lifecycleNow.getTime() - 800 * DAY_MS);
    const recent = new Date(lifecycleNow.getTime() - DAY_MS);
    const providerFuture = new Date(lifecycleNow.getTime() + DAY_MS);
    const providerUpdate = new Date(lifecycleNow.getTime() + 2 * DAY_MS);
    const reviewAt = new Date(lifecycleNow.getTime() + 365 * DAY_MS);
    const releasedAt = new Date(lifecycleNow.getTime() + 60 * 60 * 1_000);
    const disposedAt = new Date(lifecycleNow.getTime() + 2 * 60 * 60 * 1_000);
    const farFutureCallerNow = new Date(
      lifecycleNow.getTime() + 100 * 365 * DAY_MS,
    );
    const user = await prisma.webUser.create({
      data: {
        email: `retention-${suffix}@example.com`,
        emailVerified: true,
        remnashopUserId: `retention-${suffix}`,
      },
    });
    userId = user.id;

    const operation = async (
      name: string,
      status: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
      completedAt = status === "OUTCOME_UNKNOWN" ? null : old,
      errorSnapshot: {
        code: string;
        status: number;
        message: string;
        name?: string;
      } = {
        code: "PLAN_UNAVAILABLE",
        status: 409,
        message: marker,
        name,
      },
    ) => prisma.paymentOperation.create({
      data: {
        userId,
        kind: "PURCHASE",
        idempotencyKeyHash: `idempotency-${name}-${suffix}`,
        requestFingerprint: `fingerprint-${name}`,
        requestPayload: { marker, name },
        upstreamKey: `upstream-${name}-${suffix}`,
        status,
        completedAt,
        outcomeUnknownAt: status === "OUTCOME_UNKNOWN" ? old : null,
        responseSnapshot: {
          payment_id: `payment-${name}-${suffix}`,
          payment_url: `https://pay.example.test/start?token=${marker}`,
          purchase_type: "NEW",
          status: "completed",
          is_free: false,
          final_amount: "100.00",
          currency: "RUB",
          marker,
          name,
        },
        errorSnapshot,
        reconcileErrorSnapshot: { marker, name },
      },
    });
    const [
      terminalOperation,
      unresolvedOperation,
      heldOperation,
      recentOperation,
      malformedFailureOperation,
    ] = await Promise.all([
      operation("terminal", "SUCCEEDED"),
      operation("unresolved", "OUTCOME_UNKNOWN"),
      operation("held", "SUCCEEDED"),
      operation("recent", "SUCCEEDED", recent),
      operation("malformed-failure", "FAILED_FINAL", old, {
        code: "not_uppercase",
        status: 999_999,
        message: marker.repeat(2_048),
      }),
    ]);

    const record = async (
      name: string,
      operationId: string,
      upstreamUpdatedAt = old,
      terminalObservedAt = old,
    ) => prisma.paymentRecord.create({
      data: {
        userId,
        paymentId: `payment-${name}-${suffix}`,
        purchaseType: "NEW",
        status: "COMPLETED",
        finalAmount: "100.00",
        currency: "RUB",
        gatewayType: "fixture",
        paymentUrl: `https://pay.example.test/start?token=${marker}#${marker}`,
        raw: { marker, name },
        operationId,
        upstreamCreatedAt: old,
        upstreamUpdatedAt,
        terminalObservedAt,
        createdAt: old,
        updatedAt: old,
      },
    });
    const [terminalRecord, unresolvedRecord, heldRecord, recentRecord] = await Promise.all([
      // A future provider clock must not keep locally old sensitive data alive.
      record("terminal", terminalOperation.id, providerFuture),
      record("unresolved", unresolvedOperation.id),
      record("held", heldOperation.id),
      record("recent", recentOperation.id, recent, recent),
    ]);

    const cleanupHoldId = randomUUID();
    await placePaymentRetentionHold(prisma, {
      operationId: heldOperation.id,
      holdId: cleanupHoldId,
      owner: "retention-integration-owner",
      reason: "durable hold must protect cleanup fixtures",
      reviewAt: reviewAt.toISOString(),
    }, lifecycleNow);
    const cleanupHold = await prisma.paymentRetentionHold.findFirstOrThrow({
      where: { caseOperationId: heldOperation.id, status: "ACTIVE" },
    });
    retentionHoldIds.push(cleanupHold.id);

    await expect(prisma.paymentRecord.delete({
      where: { id: heldRecord.id },
    })).rejects.toThrow();
    await expect(prisma.paymentOperation.delete({
      where: { id: heldOperation.id },
    })).rejects.toThrow();

    const firstScrubStartedAt = await serverNow(databaseClient);
    const first = await runGuardedPaymentScrub(
      databaseClient,
      farFutureCallerNow,
    );
    const firstScrubFinishedAt = await serverNow(databaseClient);
    expect(first).toEqual({
      paymentRecords: { selected: 1, affected: 1, backlog: false },
      paymentOperations: { selected: 2, affected: 2, backlog: false },
    });

    const records = await prisma.paymentRecord.findMany({
      where: {
        id: {
          in: [
            terminalRecord.id,
            unresolvedRecord.id,
            heldRecord.id,
            recentRecord.id,
          ],
        },
      },
      orderBy: { paymentId: "asc" },
    });
    const operations = await prisma.paymentOperation.findMany({
      where: {
        id: {
          in: [
            terminalOperation.id,
            unresolvedOperation.id,
            heldOperation.id,
            recentOperation.id,
            malformedFailureOperation.id,
          ],
        },
      },
      orderBy: { upstreamKey: "asc" },
    });
    const scrubbedRecord = records.find((value) => value.id === terminalRecord.id)!;
    const scrubbedOperation = operations.find((value) => value.id === terminalOperation.id)!;
    const scrubbedFailureOperation = operations.find(
      (value) => value.id === malformedFailureOperation.id,
    )!;
    expect(scrubbedRecord).toMatchObject({
      paymentUrl: null,
      raw: { retention: "scrubbed", version: 1 },
      finalAmount: terminalRecord.finalAmount,
      currency: "RUB",
    });
    expect(JSON.stringify(scrubbedOperation)).not.toContain(marker);
    expect(scrubbedOperation.responseSnapshot).toMatchObject({
      retention: "scrubbed",
      version: 2,
      outcome: "success",
      payment_id: terminalRecord.paymentId,
      payment_url: null,
    });
    expect(JSON.stringify(scrubbedFailureOperation)).not.toContain(marker);
    expect(scrubbedFailureOperation).toMatchObject({
      requestPayload: { retention: "scrubbed", version: 2 },
      responseSnapshot: { retention: "scrubbed", version: 2 },
      errorSnapshot: {
        retention: "scrubbed",
        version: 2,
        outcome: "failure",
        code: "INTERNAL_ERROR",
        status: 500,
      },
      reconcileErrorSnapshot: { retention: "scrubbed", version: 2 },
    });

    const expectServerOwnedTimestamp = (value: Date | null) => {
      expect(value).toBeInstanceOf(Date);
      expect(value?.getTime()).toBeGreaterThanOrEqual(firstScrubStartedAt.getTime());
      expect(value?.getTime()).toBeLessThanOrEqual(firstScrubFinishedAt.getTime());
      expect(value).not.toEqual(farFutureCallerNow);
    };
    expectServerOwnedTimestamp(scrubbedRecord.sensitiveDataScrubbedAt);
    expectServerOwnedTimestamp(scrubbedOperation.snapshotScrubbedAt);
    expectServerOwnedTimestamp(scrubbedFailureOperation.snapshotScrubbedAt);
    const recordScrubbedAt = scrubbedRecord.sensitiveDataScrubbedAt;
    const operationScrubbedAt = scrubbedOperation.snapshotScrubbedAt;

    const markerPattern = `%${marker}%`;
    const [recordMarkerScan] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "PaymentRecord"
      WHERE "id" = ${terminalRecord.id}
        AND (
          COALESCE("paymentUrl", '') LIKE ${markerPattern}
          OR COALESCE("raw"::text, '') LIKE ${markerPattern}
        )
    `;
    const [operationMarkerScan] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "PaymentOperation"
      WHERE "id" IN (${terminalOperation.id}, ${malformedFailureOperation.id})
        AND (
          "requestPayload"::text LIKE ${markerPattern}
          OR COALESCE("responseSnapshot"::text, '') LIKE ${markerPattern}
          OR COALESCE("errorSnapshot"::text, '') LIKE ${markerPattern}
          OR COALESCE("reconcileErrorSnapshot"::text, '') LIKE ${markerPattern}
        )
    `;
    expect(recordMarkerScan?.count).toBe(0);
    expect(operationMarkerScan?.count).toBe(0);

    await applyRemnashopTransaction(prisma, {
      userId,
      transaction: {
        payment_id: terminalRecord.paymentId,
        purchase_type: "NEW",
        status: "refunded",
        gateway_type: "fixture",
        final_amount: "100.00",
        currency: "RUB",
        plan_name: "Retention fixture",
        duration_days: 30,
        device_limit: 1,
        traffic_limit: null,
        created_at: old.toISOString(),
        updated_at: providerUpdate.toISOString(),
      },
      payment: {
        payment_id: terminalRecord.paymentId,
        payment_url: `https://pay.example.test/rehydrate?token=${marker}`,
        purchase_type: "NEW",
        status: "refunded",
        is_free: false,
        final_amount: "100.00",
        currency: "RUB",
      },
    });

    const resyncedRecord = await prisma.paymentRecord.findUniqueOrThrow({
      where: { id: terminalRecord.id },
    });
    expect(resyncedRecord).toMatchObject({
      status: "REFUNDED",
      paymentUrl: null,
      raw: { retention: "scrubbed", version: 1 },
      sensitiveDataScrubbedAt: recordScrubbedAt,
      terminalObservedAt: old,
    });
    const [postSyncMarkerScan] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "PaymentRecord"
      WHERE "id" = ${terminalRecord.id}
        AND (
          COALESCE("paymentUrl", '') LIKE ${markerPattern}
          OR COALESCE("raw"::text, '') LIKE ${markerPattern}
        )
    `;
    expect(postSyncMarkerScan?.count).toBe(0);

    for (const preservedId of [
      unresolvedRecord.id,
      heldRecord.id,
      recentRecord.id,
    ]) {
      const preserved = records.find((value) => value.id === preservedId)!;
      expect(JSON.stringify(preserved)).toContain(marker);
      expect(preserved.sensitiveDataScrubbedAt).toBeNull();
    }
    for (const preservedId of [
      unresolvedOperation.id,
      heldOperation.id,
      recentOperation.id,
    ]) {
      const preserved = operations.find((value) => value.id === preservedId)!;
      expect(JSON.stringify(preserved)).toContain(marker);
      expect(preserved.snapshotScrubbedAt).toBeNull();
    }

    const second = await runGuardedPaymentScrub(
      databaseClient,
      new Date("1900-01-01T00:00:00.000Z"),
    );
    expect(second).toEqual({
      paymentRecords: { selected: 0, affected: 0, backlog: false },
      paymentOperations: { selected: 0, affected: 0, backlog: false },
    });
    const idempotentRecord = await prisma.paymentRecord.findUniqueOrThrow({
      where: { id: terminalRecord.id },
    });
    const idempotentOperation = await prisma.paymentOperation.findUniqueOrThrow({
      where: { id: terminalOperation.id },
    });
    expect(idempotentRecord.sensitiveDataScrubbedAt).toEqual(recordScrubbedAt);
    expect(idempotentOperation.snapshotScrubbedAt).toEqual(operationScrubbedAt);
    expect(JSON.stringify(idempotentRecord)).not.toContain(marker);
    expect(JSON.stringify(idempotentOperation)).not.toContain(marker);

    const holdId = randomUUID();
    await expect(placePaymentRetentionHold(prisma, {
      operationId: terminalOperation.id,
      holdId,
      owner: "retention-integration-owner",
      reason: "synthetic lifecycle verification",
      reviewAt: reviewAt.toISOString(),
    }, lifecycleNow)).resolves.toMatchObject({ status: "ACTIVE" });
    const activeHold = await prisma.paymentRetentionHold.findFirstOrThrow({
      where: { caseOperationId: terminalOperation.id, status: "ACTIVE" },
    });
    retentionHoldIds.push(activeHold.id);
    expect(activeHold.holdIdHash).not.toBe(holdId);
    await expect(prisma.paymentRetentionHold.delete({
      where: { id: activeHold.id },
    })).rejects.toThrow("payment retention hold must be disposed before deletion");
    await expect(prisma.paymentRecord.update({
      where: { id: terminalRecord.id },
      data: { retentionHoldAt: null },
    })).rejects.toThrow();
    await expect(prisma.paymentRetentionHold.update({
      where: { id: activeHold.id },
      data: { caseUserId: "forged-case-owner" },
    })).rejects.toThrow("payment retention hold integrity violation");
    await expect(updatePaymentRecordOperation(
      terminalRecord.id,
      null,
    )).rejects.toMatchObject({ code: "23514" });
    expect((await prisma.paymentRecord.findUniqueOrThrow({
      where: { id: terminalRecord.id },
      select: { operationId: true },
    })).operationId).toBe(terminalOperation.id);
    await expect(placePaymentRetentionHold(prisma, {
      paymentRecordId: terminalRecord.id,
      holdId: randomUUID(),
      owner: "retention-integration-owner",
      reason: "overlap must fail",
      reviewAt: reviewAt.toISOString(),
    }, lifecycleNow)).rejects.toThrow("different active hold");
    await expect(releasePaymentRetentionHold(prisma, {
      paymentRecordId: terminalRecord.id,
      holdId,
      releasedBy: "retention-integration-owner",
      reason: "synthetic release",
    }, lifecycleNow)).rejects.toThrow("does not belong to the selected");
    await releasePaymentRetentionHold(prisma, {
      operationId: terminalOperation.id,
      holdId,
      releasedBy: "retention-integration-owner",
      reason: "synthetic release",
    }, releasedAt);
    await expect(prisma.paymentOperation.update({
      where: { id: terminalOperation.id },
      data: { retentionHoldId: activeHold.id, retentionHoldAt: activeHold.heldAt },
    })).rejects.toThrow("payment retention hold integrity violation");
    await expect(prisma.paymentRetentionHold.delete({
      where: { id: activeHold.id },
    })).rejects.toThrow("payment retention hold must be disposed before deletion");
    await expect(updatePaymentRecordOperation(
      terminalRecord.id,
      null,
    )).rejects.toMatchObject({ code: "23514" });
    await disposePaymentRetentionHold(prisma, {
      operationId: terminalOperation.id,
      holdId,
      disposedBy: "retention-integration-owner",
      disposition: "CASE_CLOSED",
    }, disposedAt);
    const disposedHold = await prisma.paymentRetentionHold.findUniqueOrThrow({
      where: { id: activeHold.id },
    });
    expect(disposedHold).toMatchObject({
      status: "DISPOSED",
      selectorKind: null,
      selectorId: null,
      caseUserId: null,
      caseOperationId: null,
      casePaymentRecordId: null,
      owner: null,
      reason: null,
      reviewAt: null,
      releasedBy: null,
      releaseReason: null,
      releasedAt,
      disposition: "CASE_CLOSED",
      disposedAt,
    });
    await expect(updatePaymentRecordOperation(
      terminalRecord.id,
      null,
    )).resolves.toMatchObject({ rowCount: 1 });
    expect((await prisma.paymentRecord.findUniqueOrThrow({
      where: { id: terminalRecord.id },
      select: { operationId: true },
    })).operationId).toBeNull();

    const releasedOperation = await operation("released-operation", "SUCCEEDED");
    const releasedLinkedOperation = await operation(
      "released-linked-operation",
      "SUCCEEDED",
    );
    const releasedLinkedRecord = await record(
      "released-linked-record",
      releasedLinkedOperation.id,
    );
    const releasedRecord = await prisma.paymentRecord.create({
      data: {
        userId,
        paymentId: `payment-released-record-${suffix}`,
        purchaseType: "NEW",
        status: "COMPLETED",
        finalAmount: "100.00",
        currency: "RUB",
        gatewayType: "fixture",
        raw: { marker, name: "released-record" },
        upstreamCreatedAt: old,
        upstreamUpdatedAt: old,
        terminalObservedAt: old,
        createdAt: old,
        updatedAt: old,
      },
    });
    const operationHoldId = randomUUID();
    const recordHoldId = randomUUID();
    const linkedHoldId = randomUUID();
    await placePaymentRetentionHold(prisma, {
      operationId: releasedOperation.id,
      holdId: operationHoldId,
      owner: "retention-integration-owner",
      reason: "released operation remains retained until disposition",
      reviewAt: reviewAt.toISOString(),
    }, lifecycleNow);
    await placePaymentRetentionHold(prisma, {
      paymentRecordId: releasedRecord.id,
      holdId: recordHoldId,
      owner: "retention-integration-owner",
      reason: "released record remains retained until disposition",
      reviewAt: reviewAt.toISOString(),
    }, lifecycleNow);
    await placePaymentRetentionHold(prisma, {
      operationId: releasedLinkedOperation.id,
      holdId: linkedHoldId,
      owner: "retention-integration-owner",
      reason: "released linked case remains retained until disposition",
      reviewAt: reviewAt.toISOString(),
    }, lifecycleNow);
    const operationHold = await prisma.paymentRetentionHold.findFirstOrThrow({
      where: { caseOperationId: releasedOperation.id, status: "ACTIVE" },
    });
    const recordHold = await prisma.paymentRetentionHold.findFirstOrThrow({
      where: { casePaymentRecordId: releasedRecord.id, status: "ACTIVE" },
    });
    const linkedHold = await prisma.paymentRetentionHold.findFirstOrThrow({
      where: { caseOperationId: releasedLinkedOperation.id, status: "ACTIVE" },
    });
    retentionHoldIds.push(operationHold.id, recordHold.id, linkedHold.id);
    await releasePaymentRetentionHold(prisma, {
      operationId: releasedOperation.id,
      holdId: operationHoldId,
      releasedBy: "retention-integration-owner",
      reason: "release operation evidence",
    }, releasedAt);
    await releasePaymentRetentionHold(prisma, {
      paymentRecordId: releasedRecord.id,
      holdId: recordHoldId,
      releasedBy: "retention-integration-owner",
      reason: "release record evidence",
    }, releasedAt);
    await releasePaymentRetentionHold(prisma, {
      operationId: releasedLinkedOperation.id,
      holdId: linkedHoldId,
      releasedBy: "retention-integration-owner",
      reason: "release linked evidence",
    }, releasedAt);

    const cleanupWhileReleased = await runGuardedPaymentScrub(
      databaseClient,
      farFutureCallerNow,
    );
    expect(cleanupWhileReleased).toEqual({
      paymentRecords: { selected: 0, affected: 0, backlog: false },
      paymentOperations: { selected: 0, affected: 0, backlog: false },
    });
    const releasedRows = await Promise.all([
      prisma.paymentOperation.findUniqueOrThrow({ where: { id: releasedOperation.id } }),
      prisma.paymentRecord.findUniqueOrThrow({ where: { id: releasedRecord.id } }),
      prisma.paymentOperation.findUniqueOrThrow({
        where: { id: releasedLinkedOperation.id },
      }),
      prisma.paymentRecord.findUniqueOrThrow({ where: { id: releasedLinkedRecord.id } }),
    ]);
    for (const releasedRow of releasedRows) {
      expect(JSON.stringify(releasedRow)).toContain(marker);
    }
    expect(releasedRows[0].snapshotScrubbedAt).toBeNull();
    expect(releasedRows[1].sensitiveDataScrubbedAt).toBeNull();
    expect(releasedRows[2].snapshotScrubbedAt).toBeNull();
    expect(releasedRows[3].sensitiveDataScrubbedAt).toBeNull();

    const linkError = await updatePaymentRecordOperation(
      releasedRecord.id,
      releasedOperation.id,
    ).then(() => null, (error: unknown) => error);
    expect(linkError).toMatchObject({ code: "23514" });
    expect((await prisma.paymentRecord.findUniqueOrThrow({
      where: { id: releasedRecord.id },
      select: { operationId: true },
    })).operationId).toBeNull();

    await disposePaymentRetentionHold(prisma, {
      operationId: releasedOperation.id,
      holdId: operationHoldId,
      disposedBy: "retention-integration-owner",
      disposition: "CASE_CLOSED",
    }, disposedAt);
    await disposePaymentRetentionHold(prisma, {
      paymentRecordId: releasedRecord.id,
      holdId: recordHoldId,
      disposedBy: "retention-integration-owner",
      disposition: "CASE_CLOSED",
    }, disposedAt);
    await expect(prisma.paymentRecord.update({
      where: { id: releasedRecord.id },
      data: { operationId: releasedOperation.id },
    })).resolves.toMatchObject({ operationId: releasedOperation.id });
    await disposePaymentRetentionHold(prisma, {
      operationId: releasedLinkedOperation.id,
      holdId: linkedHoldId,
      disposedBy: "retention-integration-owner",
      disposition: "CASE_CLOSED",
    }, disposedAt);

    const cleanupAfterDispose = await runGuardedPaymentScrub(
      databaseClient,
      new Date("1900-01-01T00:00:00.000Z"),
    );
    expect(cleanupAfterDispose).toEqual({
      paymentRecords: { selected: 2, affected: 2, backlog: false },
      paymentOperations: { selected: 2, affected: 2, backlog: false },
    });
    const disposedRows = await Promise.all([
      prisma.paymentOperation.findUniqueOrThrow({ where: { id: releasedOperation.id } }),
      prisma.paymentRecord.findUniqueOrThrow({ where: { id: releasedRecord.id } }),
      prisma.paymentOperation.findUniqueOrThrow({
        where: { id: releasedLinkedOperation.id },
      }),
      prisma.paymentRecord.findUniqueOrThrow({ where: { id: releasedLinkedRecord.id } }),
    ]);
    for (const disposedRow of disposedRows) {
      expect(JSON.stringify(disposedRow)).not.toContain(marker);
    }
  });
});
