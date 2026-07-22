import { beforeEach, describe, expect, it, vi } from "vitest";

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
  revealRemnashopToken: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getJwtExpiresAt: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/payments/records", () => ({
  applyRemnashopTransaction: mocks.applyRemnashopTransaction,
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  getTransactionPage: mocks.getTransactionPage,
  getPaymentCapabilities: mocks.getPaymentCapabilities,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  revealRemnashopToken: mocks.revealRemnashopToken,
  getRemnashopUserIdFromAccessToken:
    mocks.getRemnashopUserIdFromAccessToken,
  getJwtExpiresAt: mocks.getJwtExpiresAt,
}));

import {
  claimPaymentHistorySync,
  completePaymentHistoryPage,
  continuePaymentHistoryBackfills,
} from "@/backend/payments/history-sync";
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

    await continuePaymentHistoryBackfills({ limit: 1, deadlineMs: 1_000 });

    const sql = mocks.prisma.$queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
    };
    const query = sql.strings?.join(" ") ?? "";
    expect(query).not.toContain('"cursor"');
    expect(query).toContain('sync_state."backfillCompletedAt" IS NULL');
    expect(query).toContain("COALESCE(");
    expect(query).toContain('sync_state."lastSyncedAt"');
    expect(query).toContain(
      'sync_state."userId", web_user."remnashopUserId"',
    );
  });

  it("asks the database for due rows so an earlier backoff cannot starve a ready user", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);

    await continuePaymentHistoryBackfills({ limit: 1, deadlineMs: 1_000 });

    const sql = mocks.prisma.$queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
    };
    const query = sql.strings?.join(" ") ?? "";
    expect(query).toContain(
      'sync_state."nextAttemptAt" <= clock_timestamp()',
    );
    expect(query).toContain("AND EXISTS (");
    expect(query).toContain(
      'web_session."remnashopAccessTokenEncrypted" IS NOT NULL',
    );
    expect(query).toContain(
      'web_session."remnashopAccessExpiresAt" > clock_timestamp()',
    );
    expect(query.indexOf("AND EXISTS (")).toBeLessThan(
      query.indexOf("LIMIT"),
    );
  });

  it("claims before capability discovery and backs off when discovery fails", async () => {
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([
        { userId: "user-1", remnashopUserId: "owner-1" },
      ])
      .mockResolvedValueOnce([
        {
          remnashopUserId: "owner-1",
          encryptedToken: "encrypted-access-token",
          databaseNow: now,
        },
      ]);
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(state());
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([state()])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue({
      failureCount: 0,
    });
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });
    mocks.revealRemnashopToken.mockReturnValue("access-token");
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    mocks.getPaymentCapabilities.mockResolvedValue(null);

    await expect(
      continuePaymentHistoryBackfills({ limit: 1, deadlineMs: 1_000 }),
    ).resolves.toEqual({ attempted: 1, applied: 0, completed: 0, failed: 1 });

    expect(mocks.getPaymentCapabilities).toHaveBeenCalledWith("access-token");
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
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([
        { userId: "user-1", remnashopUserId: "owner-1" },
      ])
      .mockResolvedValueOnce([
        {
          remnashopUserId: "owner-1",
          encryptedToken: "encrypted-wrong-owner",
          databaseNow: now,
        },
        {
          remnashopUserId: "owner-1",
          encryptedToken: "encrypted-current-owner",
          databaseNow: now,
        },
      ]);
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(state());
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([state()])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue({
      failureCount: 0,
    });
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });
    mocks.revealRemnashopToken.mockImplementation((encrypted: string) =>
      encrypted === "encrypted-wrong-owner" ? "token-wrong" : "token-current",
    );
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    mocks.getJwtExpiresAt.mockImplementation((token: string) =>
      token === "token-wrong"
        ? new Date(now.getTime() + 1_000)
        : new Date(now.getTime() + 3_600_000),
    );
    mocks.getPaymentCapabilities.mockResolvedValue(null);

    await expect(
      continuePaymentHistoryBackfills({ limit: 1, deadlineMs: 1_000 }),
    ).resolves.toEqual({ attempted: 1, applied: 0, completed: 0, failed: 1 });

    expect(mocks.revealRemnashopToken).toHaveBeenNthCalledWith(
      1,
      "encrypted-wrong-owner",
    );
    expect(mocks.revealRemnashopToken).toHaveBeenNthCalledWith(
      2,
      "encrypted-current-owner",
    );
    expect(mocks.getPaymentCapabilities).toHaveBeenCalledWith("token-current");
    const credentialSql = mocks.prisma.$queryRaw.mock.calls[1]?.[0] as {
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

  it("backs off a claimed row whose session vanished and continues to the next due user", async () => {
    const ownerHash2 = paymentUpstreamOwnerHash("owner-2");
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([
        { userId: "user-1", remnashopUserId: "owner-1" },
        { userId: "user-2", remnashopUserId: "owner-2" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          remnashopUserId: "owner-2",
          encryptedToken: "encrypted-access-token-2",
          databaseNow: now,
        },
      ]);
    mocks.tx.paymentHistorySyncState.upsert.mockResolvedValue(state());
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "owner-1" }])
      .mockResolvedValueOnce([state()])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ remnashopUserId: "owner-2" }])
      .mockResolvedValueOnce([
        state({
          userId: "user-2",
          upstreamOwnerHash: ownerHash2,
        }),
      ])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentHistorySyncState.findUnique.mockResolvedValue({
      failureCount: 0,
    });
    mocks.tx.paymentHistorySyncState.updateMany.mockResolvedValue({ count: 1 });
    mocks.revealRemnashopToken.mockReturnValue("access-token-2");
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-2");
    mocks.getPaymentCapabilities.mockResolvedValue(null);

    await expect(
      continuePaymentHistoryBackfills({ limit: 2, deadlineMs: 1_000 }),
    ).resolves.toEqual({ attempted: 2, applied: 0, completed: 0, failed: 2 });

    expect(mocks.revealRemnashopToken).toHaveBeenCalledOnce();
    expect(mocks.revealRemnashopToken).toHaveBeenCalledWith(
      "encrypted-access-token-2",
    );
    expect(mocks.getPaymentCapabilities).toHaveBeenCalledOnce();
    expect(mocks.getTransactionPage).not.toHaveBeenCalled();
  });
});
