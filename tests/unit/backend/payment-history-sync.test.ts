import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPaymentMaintenance } from "@/application/payments/run-payment-maintenance";
import { productionPaymentMaintenanceRunner } from "@/backend/integrations/payments/payment-maintenance-runner";

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    paymentHistorySyncState: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  applyRemnashopTransaction: vi.fn(),
  getTransactionPage: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  getExactTransaction: vi.fn(),
  getLegacyTransactions: vi.fn(),
  findPendingPaymentIds: vi.fn(),
  syncExactPaymentRecordFromRemnashop: vi.fn(),
  revealRemnashopToken: vi.fn(),
  remnashopRefreshTokens: vi.fn(),
  acquireRemnashopTokensForSession: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getJwtExpiresAt: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/payments/payment-record-service", () => ({
  applyRemnashopTransaction: mocks.applyRemnashopTransaction,
  syncExactPaymentRecordFromRemnashop:
    mocks.syncExactPaymentRecordFromRemnashop,
}));
vi.mock("@/backend/integrations/payments/prisma-payment-query-repository", () => ({
  prismaPaymentQueryRepository: {
    findPendingPaymentIds: mocks.findPendingPaymentIds,
  },
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  getTransactionPage: mocks.getTransactionPage,
  getPaymentCapabilities: mocks.getPaymentCapabilities,
  getExactTransaction: mocks.getExactTransaction,
  getLegacyTransactions: mocks.getLegacyTransactions,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getRemnashopUserIdFromAccessToken:
    mocks.getRemnashopUserIdFromAccessToken,
  getJwtExpiresAt: mocks.getJwtExpiresAt,
  remnashopRefreshTokens: mocks.remnashopRefreshTokens,
}));
vi.mock("@/backend/integrations/remnashop/session-token-lifecycle", () => ({
  acquireRemnashopTokensForSession: mocks.acquireRemnashopTokensForSession,
}));
vi.mock("@/backend/integrations/remnashop/token-protection", () => ({
  revealRemnashopToken: mocks.revealRemnashopToken,
}));

import {
  claimPaymentHistorySync,
  completePaymentHistoryPage,
  listDuePaymentHistoryCandidates,
  loadCurrentPaymentHistoryCredential,
} from "@/backend/integrations/payments/payment-history-sync-service";

async function continuePaymentHistoryBackfills(input: { limit: number; deadlineMs: number }) {
  const result = await runPaymentMaintenance({
    ...productionPaymentMaintenanceRunner,
    claimReconciliation: async () => null,
    listHistoryCandidates: () => productionPaymentMaintenanceRunner.listHistoryCandidates(input.limit),
  }, { paymentLimit: 1, deadlineMs: input.deadlineMs });
  return result.history;
}
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { sha256 } from "@/backend/security/crypto";

const now = new Date("2026-07-17T10:00:00.000Z");
const ownerHash = paymentUpstreamOwnerHash("owner-1");

function state(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    upstreamOwnerHash: ownerHash,
    cursor: "fresh-cursor",
    generation: 4,
    attemptCount: 2,
    failureCount: 0,
    claimTokenHash: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastSyncedAt: null,
    backfillCompletedAt: null,
    errorSnapshot: null,
    user: { remnashopUserId: "owner-1" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function transactionItem(index: number, status: "completed" | "pending" = "completed") {
  return {
    payment_id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    purchase_type: "NEW" as const,
    status,
    gateway_type: "YOOKASSA",
    final_amount: "100.00",
    currency: "₽",
    plan_name: null,
    duration_days: 30,
    device_limit: 3,
    traffic_limit: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:01:00.000Z",
  };
}

describe("payment history sync fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    mocks.getJwtExpiresAt.mockReturnValue(new Date(now.getTime() + 3_600_000));
    mocks.revealRemnashopToken.mockImplementation((value: string) => value);
    mocks.findPendingPaymentIds.mockResolvedValue([]);
    mocks.getLegacyTransactions.mockResolvedValue([]);
    mocks.tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("returns cursor from the locked current row, never from a stale upsert result", async () => {
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(
      state({ cursor: "stale-cursor" }),
    );
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([state({ cursor: "fresh-cursor" })])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      claimPaymentHistorySync({
        userId: "user-1",
        upstreamAccountId: "owner-1",
      }),
    ).resolves.toMatchObject({ cursor: "fresh-cursor", generation: 4 });

    const queries = mocks.tx.$queryRaw.mock.calls.map(
      (call) => (call[0] as { strings?: string[] }).strings?.join(" ") ?? "",
    );
    expect(queries[0]).toContain('FROM "WebUser"');
    expect(queries[1]).toContain('FROM "PaymentHistorySyncState"');
    expect(queries[2]).toContain("clock_timestamp()");
    expect(mocks.tx.paymentHistorySyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaseExpiresAt: new Date(now.getTime() + 120_000),
        }),
      }),
    );
  });

  it("starts a fresh bounded generation after a completed sync becomes due", async () => {
    const completedAt = new Date(now.getTime() - 10 * 60_000);
    const completed = state({
      cursor: null,
      backfillCompletedAt: completedAt,
      lastSyncedAt: completedAt,
    });
    const restarted = state({
      cursor: null,
      generation: 5,
      backfillCompletedAt: null,
      lastSyncedAt: completedAt,
    });
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([completed])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue(restarted);

    await expect(
      claimPaymentHistorySync({
        userId: "user-1",
        upstreamAccountId: "owner-1",
      }),
    ).resolves.toMatchObject({
      generation: 5,
      cursor: null,
      backfill: true,
    });

    expect(mocks.tx.paymentHistorySyncState.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          generation: 4,
          backfillCompletedAt: completedAt,
        }),
        data: expect.objectContaining({
          cursor: null,
          generation: { increment: 1 },
          backfillCompletedAt: null,
        }),
      }),
    );
  });

  it("does not hot-loop a recently completed generation", async () => {
    const completedAt = new Date(now.getTime() - 60_000);
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([
        state({
          cursor: null,
          backfillCompletedAt: completedAt,
          lastSyncedAt: completedAt,
        }),
      ])
      .mockResolvedValueOnce([{ now }]);

    await expect(
      claimPaymentHistorySync({
        userId: "user-1",
        upstreamAccountId: "owner-1",
      }),
    ).resolves.toBeNull();
    expect(mocks.tx.paymentHistorySyncState.updateMany).not.toHaveBeenCalled();
  });

  it("resets owner-bound state and counters before claiming a rebound identity", async () => {
    const old = state({ upstreamOwnerHash: "old-owner", failureCount: 7 });
    const reset = state({ cursor: null, generation: 5, attemptCount: 0 });
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(old);
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([old])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue(reset);

    await claimPaymentHistorySync({
      userId: "user-1",
      upstreamAccountId: "owner-1",
    });

    expect(mocks.tx.paymentHistorySyncState.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: null,
          attemptCount: 0,
          failureCount: 0,
          generation: { increment: 1 },
        }),
      }),
    );
  });

  it("applies an entire page and advances its cursor in the same transaction", async () => {
    const claimToken = "history-claim";
    const claim = {
      userId: "user-1",
      upstreamOwnerHash: ownerHash,
      generation: 4,
      cursor: "cursor-1",
      backfill: true,
      claimToken,
      leaseExpiresAt: new Date("2026-07-17T10:01:00.000Z"),
    };
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([
        state({
          claimTokenHash: sha256(
            `clean-pay:payment-history-sync:claim:v1:${claimToken}`,
          ),
          leaseExpiresAt: claim.leaseExpiresAt,
        }),
      ])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 1_000) }]);
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });
    const item = {
      payment_id: "11111111-1111-4111-8111-111111111111",
      purchase_type: "NEW",
      status: "completed",
      gateway_type: "YOOKASSA",
      final_amount: "100.00",
      currency: "\u20BD",
      plan_name: null,
      duration_days: 30,
      device_limit: 3,
      traffic_limit: null,
      created_at: "2026-07-17T09:00:00.000Z",
      updated_at: "2026-07-17T09:01:00.000Z",
    };

    await expect(
      completePaymentHistoryPage(claim, {
        items: [item],
        next_cursor: "cursor-2",
      }),
    ).resolves.toEqual({ applied: 1, hasMore: true });

    expect(mocks.applyRemnashopTransaction).toHaveBeenCalledWith(
      mocks.tx,
      { userId: "user-1", transaction: item },
    );
    expect(mocks.tx.paymentHistorySyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: "cursor-2",
          claimTokenHash: null,
          leaseExpiresAt: null,
        }),
      }),
    );
  });

  it("walks past page one and applies old pending and previously missing records", async () => {
    const firstToken = "history-page-1";
    const secondToken = "history-page-2";
    const lease = new Date(now.getTime() + 60_000);
    const firstClaim = {
      userId: "user-1",
      upstreamOwnerHash: ownerHash,
      generation: 4,
      cursor: null,
      backfill: true,
      claimToken: firstToken,
      leaseExpiresAt: lease,
    };
    const secondClaim = {
      ...firstClaim,
      cursor: "page-2",
      claimToken: secondToken,
    };
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      transactionItem(index + 1),
    );
    const oldPending = transactionItem(101, "pending");
    const previouslyMissing = transactionItem(102);

    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([
        state({
          cursor: null,
          claimTokenHash: sha256(
            `clean-pay:payment-history-sync:claim:v1:${firstToken}`,
          ),
          leaseExpiresAt: lease,
        }),
      ])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 1_000) }])
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([
        state({
          cursor: "page-2",
          claimTokenHash: sha256(
            `clean-pay:payment-history-sync:claim:v1:${secondToken}`,
          ),
          leaseExpiresAt: lease,
        }),
      ])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 2_000) }])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 3_000) }]);
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      completePaymentHistoryPage(firstClaim, {
        items: firstPage,
        next_cursor: "page-2",
      }),
    ).resolves.toEqual({ applied: 100, hasMore: true });
    await expect(
      completePaymentHistoryPage(secondClaim, {
        items: [oldPending, previouslyMissing],
        next_cursor: null,
      }),
    ).resolves.toEqual({ applied: 2, hasMore: false });

    expect(mocks.applyRemnashopTransaction).toHaveBeenCalledTimes(102);
    expect(mocks.applyRemnashopTransaction).toHaveBeenNthCalledWith(
      101,
      mocks.tx,
      { userId: "user-1", transaction: oldPending },
    );
    expect(mocks.applyRemnashopTransaction).toHaveBeenNthCalledWith(
      102,
      mocks.tx,
      { userId: "user-1", transaction: previouslyMissing },
    );
    expect(mocks.tx.paymentHistorySyncState.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: "page-2",
          backfillCompletedAt: null,
        }),
      }),
    );
    expect(mocks.tx.paymentHistorySyncState.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: null,
          backfillCompletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("rejects a stale page after its lease was reclaimed", async () => {
    const claimToken = "stale-claim";
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([
        state({
          claimTokenHash: sha256(
            `clean-pay:payment-history-sync:claim:v1:${claimToken}`,
          ),
          leaseExpiresAt: new Date(now.getTime() - 1),
        }),
      ])
      .mockResolvedValueOnce([{ now }]);

    await expect(
      completePaymentHistoryPage(
        {
          userId: "user-1",
          upstreamOwnerHash: ownerHash,
          generation: 4,
          cursor: null,
          backfill: true,
          claimToken,
          leaseExpiresAt: new Date(now.getTime() - 1),
        },
        { items: [], next_cursor: null },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.applyRemnashopTransaction).not.toHaveBeenCalled();
  });

  it("fences a page when the current user identity changed during HTTP", async () => {
    const claimToken = "identity-race";
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-2" }]);

    await expect(
      completePaymentHistoryPage(
        {
          userId: "user-1",
          upstreamOwnerHash: ownerHash,
          generation: 4,
          cursor: null,
          backfill: true,
          claimToken,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
        },
        { items: [], next_cursor: null },
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.applyRemnashopTransaction).not.toHaveBeenCalled();
  });

  it("discovers backfills whose initial page failed before a cursor existed", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);

    await listDuePaymentHistoryCandidates(1);

    const sql = mocks.prisma.$queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
    };
    const query = sql.strings?.join(" ") ?? "";
    expect(query).not.toContain('"cursor"');
    expect(query).toContain('sync_state."backfillCompletedAt" IS NULL');
    expect(query).toContain("COALESCE(");
    expect(query).toContain('sync_state."lastSyncedAt"');
    expect(query).toContain(
      'web_user."id" AS "userId", web_user."remnashopUserId"',
    );
    expect(query).toContain('FROM "WebUser" AS web_user');
    expect(query).toContain('LEFT JOIN "PaymentHistorySyncState" AS sync_state');
    expect(query).toContain('sync_state."userId" IS NULL');
  });

  it("asks the database for due rows so an earlier backoff cannot starve a ready user", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);

    await listDuePaymentHistoryCandidates(1);

    const sql = mocks.prisma.$queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
    };
    const query = sql.strings?.join(" ") ?? "";
    expect(query).toContain(
      'sync_state."nextAttemptAt" <= clock_timestamp()',
    );
    expect(query).toContain("AND EXISTS (");
    expect(query).toContain(
      'web_session."refreshExpiresAt" > clock_timestamp()',
    );
    expect(query).toContain('web_session."assuranceLevel" = \'FULL\'');
    expect(query).not.toContain('web_session."remnashopAccessTokenEncrypted"');
    expect(query).not.toContain('web_session."remnashopAccessExpiresAt"');
    expect(query).not.toContain('web_session."remnashopRefreshRecoveryEncrypted"');
    expect(query).not.toContain('web_session."remnashopRefreshTokenEncrypted"');
    expect(query).toContain('web_user."emailVerified" = TRUE');
    expect(query).toContain('web_session."userId" = web_user."id"');
    expect(query.indexOf("AND EXISTS (")).toBeLessThan(
      query.indexOf("LIMIT"),
    );
  });

  it("bounds the number of history candidates selected per maintenance batch", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);

    await listDuePaymentHistoryCandidates(1_000);

    const sql = mocks.prisma.$queryRaw.mock.calls[0]?.[0] as {
      values?: unknown[];
    };
    expect(sql.values?.at(-1)).toBe(100);
  });

  it("uses only a fresh owner-matching access token for headless history work", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ set_config: "745ms" }])
      .mockResolvedValueOnce([{
        remnashopUserId: "owner-1",
        encryptedToken: "fresh-access",
        databaseNow: now,
      }]);
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    mocks.getJwtExpiresAt.mockReturnValue(new Date(now.getTime() + 60_000));

    await expect(loadCurrentPaymentHistoryCredential(
      "user-1",
      ownerHash,
      1_000,
    )).resolves.toBe("fresh-access");

    expect(mocks.revealRemnashopToken).toHaveBeenCalledWith("fresh-access");
    const timeoutSql = mocks.tx.$queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    expect(timeoutSql.strings?.join(" ")).toContain("set_config(");
    expect(timeoutSql.strings?.join(" ")).toContain("statement_timeout");
    expect(timeoutSql.values).toContain("745");
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 250, timeout: 750 },
    );
    const credentialSql = mocks.tx.$queryRaw.mock.calls[1]?.[0] as {
      strings?: string[];
    };
    const credentialQuery = credentialSql.strings?.join(" ") ?? "";
    expect(credentialQuery).toContain(
      'web_session."remnashopAccessTokenEncrypted" IS NOT NULL',
    );
    expect(credentialQuery).toContain(
      'web_session."remnashopAccessExpiresAt" > clock_timestamp()',
    );
    expect(credentialQuery).not.toContain("remnashopRefreshTokenEncrypted");
    expect(credentialQuery).not.toContain("remnashopRefreshRecoveryEncrypted");
    expect(mocks.acquireRemnashopTokensForSession).not.toHaveBeenCalled();
    expect(mocks.remnashopRefreshTokens).not.toHaveBeenCalled();
  });

  it("surfaces stored access-token corruption as an unexpected internal error", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ set_config: "9750ms" }])
      .mockResolvedValueOnce([{
        remnashopUserId: "owner-1",
        encryptedToken: "corrupt-access",
        databaseNow: now,
      }]);
    mocks.revealRemnashopToken.mockImplementationOnce(() => {
      throw new Error("invalid encrypted payload");
    });

    await expect(loadCurrentPaymentHistoryCredential(
      "user-1",
      ownerHash,
    )).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    expect(mocks.acquireRemnashopTokensForSession).not.toHaveBeenCalled();
    expect(mocks.remnashopRefreshTokens).not.toHaveBeenCalled();
  });

  it("refuses credential discovery when the remaining deadline is too small", async () => {
    await expect(loadCurrentPaymentHistoryCredential(
      "user-1",
      ownerHash,
      9,
    )).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 503 });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("claims before capability discovery and backs off when discovery fails", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { userId: "user-1", remnashopUserId: "owner-1" },
    ]);
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(state());
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([state()])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ set_config: "745ms" }])
      .mockResolvedValueOnce([
        {
          remnashopUserId: "owner-1",
          encryptedToken: "access-token",
          databaseNow: now,
        },
      ])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue({
      failureCount: 0,
    });
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    mocks.getPaymentCapabilities.mockRejectedValue(new Error("offline"));

    await expect(
      continuePaymentHistoryBackfills({ limit: 1, deadlineMs: 1_000 }),
    ).resolves.toEqual({ attempted: 1, applied: 0, completed: 0, failed: 1, deferred: 0 });

    expect(mocks.getPaymentCapabilities).toHaveBeenCalledWith(
      "access-token",
      expect.any(Number),
    );
    expect(mocks.getTransactionPage).not.toHaveBeenCalled();
    expect(
      mocks.tx.paymentHistorySyncState.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.getPaymentCapabilities.mock.invocationCallOrder[0]);
    expect(mocks.tx.paymentHistorySyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimTokenHash: null,
          leaseExpiresAt: null,
          nextAttemptAt: expect.any(Date),
          failureCount: { increment: 1 },
        }),
      }),
    );
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "payment_history_sync_failed",
        severity: "ERROR",
        metadata: expect.objectContaining({
          generation: 4,
          failure_count: 1,
        }),
      }),
    });
  });

  it("uses DB time to skip an expired JWT and falls through to another owner-matching session", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { userId: "user-1", remnashopUserId: "owner-1" },
    ]);
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(state());
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([state()])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ set_config: "745ms" }])
      .mockResolvedValueOnce([
        {
          remnashopUserId: "owner-1",
          encryptedToken: "token-wrong",
          databaseNow: now,
        },
        {
          remnashopUserId: "owner-1",
          encryptedToken: "token-current",
          databaseNow: now,
        },
      ])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue({
      failureCount: 0,
    });
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    mocks.getJwtExpiresAt.mockImplementation((token: string) =>
      token === "token-wrong"
        ? new Date(now.getTime() + 1_000)
        : new Date(now.getTime() + 3_600_000),
    );
    mocks.getPaymentCapabilities.mockRejectedValue(new Error("offline"));

    await expect(
      continuePaymentHistoryBackfills({ limit: 1, deadlineMs: 1_000 }),
    ).resolves.toEqual({ attempted: 1, applied: 0, completed: 0, failed: 1, deferred: 0 });

    expect(mocks.revealRemnashopToken).toHaveBeenCalledTimes(2);
    expect(mocks.getPaymentCapabilities).toHaveBeenCalledWith(
      "token-current",
      expect.any(Number),
    );
    const credentialSql = mocks.tx.$queryRaw.mock.calls.find((call) => {
      const sql = call[0] as { strings?: string[] };
      return sql.strings?.join(" ").includes('FROM "WebSession"');
    })?.[0] as {
      strings?: string[];
    };
    const credentialQuery = credentialSql.strings?.join(" ") ?? "";
    expect(credentialQuery).toContain("FOR KEY SHARE OF web_user");
    expect(credentialQuery).toContain("LIMIT");
    expect(credentialQuery).toContain(
      'web_session."remnashopAccessExpiresAt" > clock_timestamp()',
    );
    expect(credentialQuery).toContain(
      'clock_timestamp() AS "databaseNow"',
    );
  });

  it("defers a stale-access active session without refresh and continues to the next due user", async () => {
    const ownerHash2 = paymentUpstreamOwnerHash("owner-2");
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      { userId: "user-1", remnashopUserId: "owner-1" },
      { userId: "user-2", remnashopUserId: "owner-2" },
    ]);
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(state());
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([state()])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ set_config: "745ms" }])
      // The candidate was selected because its local FULL session remains
      // active, but no access token is fresh enough for background use.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ remnashopUserId: "owner-2" }])
      .mockResolvedValueOnce([
        state({
          userId: "user-2",
          upstreamOwnerHash: ownerHash2,
        }),
      ])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ set_config: "745ms" }])
      .mockResolvedValueOnce([
        {
          remnashopUserId: "owner-2",
          encryptedToken: "access-token-2",
          databaseNow: now,
        },
      ])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue({
      failureCount: 0,
    });
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-2");
    mocks.getPaymentCapabilities.mockRejectedValue(new Error("offline"));

    await expect(
      continuePaymentHistoryBackfills({ limit: 2, deadlineMs: 1_000 }),
    ).resolves.toEqual({
      attempted: 2,
      applied: 0,
      completed: 0,
      failed: 2,
      deferred: 1,
    });

    expect(mocks.revealRemnashopToken).toHaveBeenCalledOnce();
    expect(mocks.getPaymentCapabilities).toHaveBeenCalledOnce();
    expect(mocks.getTransactionPage).not.toHaveBeenCalled();
    expect(mocks.acquireRemnashopTokensForSession).not.toHaveBeenCalled();
    expect(mocks.remnashopRefreshTokens).not.toHaveBeenCalled();
    const deferredUpdate = mocks.tx.paymentHistorySyncState.updateMany.mock.calls
      .map((call) => call[0])
      .find((input) => input.data?.errorSnapshot?.code === "UNAUTHORIZED");
    expect(deferredUpdate).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        claimTokenHash: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
      }),
    }));
    expect(deferredUpdate?.data).not.toHaveProperty("failureCount");
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "payment_history_sync_deferred",
        severity: "INFO",
      }),
    });
  });
});
