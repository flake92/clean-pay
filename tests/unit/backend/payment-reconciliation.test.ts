import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    paymentOperation: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentRecord: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  prisma: {
    $transaction: vi.fn(),
    paymentOperation: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  applyRemnashopTransaction: vi.fn(),
  reconcilePaymentOperation: vi.fn(),
  reconcilePaymentOperationAsAdmin: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/payments/records", () => ({
  applyRemnashopTransaction: mocks.applyRemnashopTransaction,
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  reconcilePaymentOperation: mocks.reconcilePaymentOperation,
  reconcilePaymentOperationAsAdmin: mocks.reconcilePaymentOperationAsAdmin,
}));

import {
  claimUnknownPaymentOperation,
  completeReconciledPayment,
  processPaymentReconciliationClaim,
  settlePaymentReconciliation,
} from "@/backend/payments/reconciliation";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { sha256 } from "@/backend/security/crypto";

const now = new Date("2026-07-17T10:00:00.000Z");
const lease = new Date("2026-07-17T10:01:00.000Z");
const upstreamOwnerHash = paymentUpstreamOwnerHash("42");
const transaction = {
  payment_id: "11111111-1111-4111-8111-111111111111",
  purchase_type: "NEW",
  status: "completed",
  gateway_type: "YOOKASSA",
  final_amount: "100.00",
  currency: "\u20BD",
  plan_name: "Basic",
  duration_days: 30,
  device_limit: 3,
  traffic_limit: null,
  created_at: "2026-07-17T09:00:00.000Z",
  updated_at: "2026-07-17T09:01:00.000Z",
};
const payment = {
  payment_id: transaction.payment_id,
  payment_url: "https://pay.test/checkout",
  purchase_type: "NEW",
  status: "completed",
  is_free: false,
  final_amount: "100.00",
  currency: "\u20BD",
};

function claimedRow(id: string) {
  return {
    id,
    userId: "user-1",
    kind: "PURCHASE",
    upstreamKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    upstreamOwnerHash,
    requestPayload: { plan_code: "basic" },
    reconcileLeaseExpiresAt: lease,
    reconcileAttemptCount: 3,
    reconcileFailureCount: 1,
    remnashopUserId: "42",
  };
}

function claim(claimToken = "reconcile-claim") {
  return {
    operationId: "operation-1",
    userId: "user-1",
    remnashopUserId: "42",
    operation: "PURCHASE" as const,
    upstreamKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    upstreamOwnerHash,
    requestPayload: { plan_code: "basic" },
    claimToken,
    leaseExpiresAt: lease,
    attemptCount: 3,
    failureCount: 1,
  };
}

function operationForClaim(claimToken: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "operation-1",
    userId: "user-1",
    kind: "PURCHASE",
    upstreamKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    upstreamOwnerHash,
    requestPayload: { plan_code: "basic" },
    status: "OUTCOME_UNKNOWN",
    reconcileClaimTokenHash: sha256(
      `clean-pay:payment-reconciliation:claim:v1:${claimToken}`,
    ),
    reconcileLeaseExpiresAt: lease,
    user: { remnashopUserId: "42" },
    ...overrides,
  };
}

describe("payment outcome reconciliation fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("atomically normalizes and claims a hard-crashed DISPATCHING operation with DB time", async () => {
    mocks.tx.$queryRaw.mockResolvedValueOnce([claimedRow("operation-1")]);

    await expect(claimUnknownPaymentOperation()).resolves.toMatchObject({
      operationId: "operation-1",
      remnashopUserId: "42",
      leaseExpiresAt: lease,
    });

    const sql = mocks.tx.$queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
    };
    expect(sql.strings?.join(" ")).toContain("FOR UPDATE OF operation SKIP LOCKED");
    expect(sql.strings?.join(" ")).toContain("RETURNING operation.*");
    expect(sql.strings?.join(" ")).toContain(
      "operation.\"status\" IN ('DISPATCHING', 'OUTCOME_UNKNOWN')",
    );
    expect(sql.strings?.join(" ")).toContain(
      "operation.\"leaseExpiresAt\" <= clock_timestamp()",
    );
    expect(sql.strings?.join(" ")).toContain(
      'SET "status" = \'OUTCOME_UNKNOWN\'',
    );
  });

  it("lets concurrent claimers receive different unlocked candidates", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([claimedRow("operation-1")])
      .mockResolvedValueOnce([claimedRow("operation-2")]);

    const [first, second] = await Promise.all([
      claimUnknownPaymentOperation(),
      claimUnknownPaymentOperation(),
    ]);

    expect([first?.operationId, second?.operationId]).toEqual([
      "operation-1",
      "operation-2",
    ]);
  });

  it("atomically links the transaction and settles a successful operation", async () => {
    const ownedClaim = claim();
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 1_000) }]);
    mocks.tx.paymentOperation.findUnique.mockResolvedValue(
      operationForClaim(ownedClaim.claimToken),
    );
    mocks.tx.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await completeReconciledPayment(ownedClaim, {
      operation: "PURCHASE",
      state: "SUCCEEDED",
      payment,
      transaction,
      retry_after_seconds: null,
    });

    expect(mocks.applyRemnashopTransaction).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        userId: "user-1",
        operationId: "operation-1",
        planCode: "basic",
        transaction,
      }),
    );
    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "OUTCOME_UNKNOWN",
          reconcileLeaseExpiresAt: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          status: "SUCCEEDED",
          claimTokenHash: null,
          reconcileClaimTokenHash: null,
        }),
      }),
    );
  });

  it("fences a worker when the upstream owner changed during its HTTP request", async () => {
    const ownedClaim = claim();
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "99" }]);

    await expect(
      completeReconciledPayment(ownedClaim, {
        operation: "PURCHASE",
        state: "SUCCEEDED",
        payment,
        transaction,
        retry_after_seconds: null,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.applyRemnashopTransaction).not.toHaveBeenCalled();
  });

  it("loses safely when a late foreground leader already completed", async () => {
    const ownedClaim = claim();
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentOperation.findUnique.mockResolvedValue(
      operationForClaim(ownedClaim.claimToken, { status: "SUCCEEDED" }),
    );

    await expect(
      completeReconciledPayment(ownedClaim, {
        operation: "PURCHASE",
        state: "SUCCEEDED",
        payment,
        transaction,
        retry_after_seconds: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.tx.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("uses the upstream retry_after_seconds for an UNKNOWN outcome", async () => {
    const ownedClaim = claim();
    mocks.prisma.paymentOperation.findUnique.mockResolvedValue({
      reconcileFailureCount: 7,
    });
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      settlePaymentReconciliation(ownedClaim, {
        operation: "PURCHASE",
        state: "UNKNOWN",
        payment: null,
        transaction: null,
        retry_after_seconds: 30,
      }),
    ).resolves.toBe("UNKNOWN");

    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          upstreamOwnerHash,
          reconcileLeaseExpiresAt: { gt: now },
        }),
        data: expect.objectContaining({
          reconcileNextAttemptAt: new Date(now.getTime() + 30_000),
          reconcileFailureCount: { increment: 1 },
          reconcileErrorSnapshot: { code: "UPSTREAM_OUTCOME_UNKNOWN" },
        }),
      }),
    );
  });

  it("resets a missing claimed operation only while the locked owner is unchanged", async () => {
    const ownedClaim = claim();
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      settlePaymentReconciliation(ownedClaim, null),
    ).resolves.toBe("RETRY_READY");
    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "operation-1",
        status: "OUTCOME_UNKNOWN",
        reconciledAt: null,
        upstreamOwnerHash,
        reconcileClaimTokenHash: sha256(
          `clean-pay:payment-reconciliation:claim:v1:${ownedClaim.claimToken}`,
        ),
        reconcileLeaseExpiresAt: { gt: now },
      }),
      data: expect.objectContaining({
        status: "READY",
        claimTokenHash: null,
        dispatchedAt: null,
        outcomeUnknownAt: null,
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
        reconcileNextAttemptAt: null,
      }),
    });
    expect(
      mocks.tx.paymentOperation.updateMany.mock.calls[0]?.[0]?.data,
    ).not.toHaveProperty("upstreamKey");
  });

  it("cannot reset a missing operation after another winner fenced the claim", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      settlePaymentReconciliation(claim(), null),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never resets READY when the owner changes before the 404 is settled", async () => {
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ remnashopUserId: "99" }]);

    await expect(
      settlePaymentReconciliation(claim(), null),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.tx.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("marks an upstream-owner mismatch for manual review without calling upstream", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "99" }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      processPaymentReconciliationClaim(
        { ...claim(), remnashopUserId: "99" },
        { accessToken: "access" },
      ),
    ).resolves.toBe("MANUAL_REQUIRED");

    expect(mocks.reconcilePaymentOperation).not.toHaveBeenCalled();
    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reconcileNextAttemptAt: null,
          reconciledAt: now,
          reconcileErrorSnapshot: expect.objectContaining({
            code: "MANUAL_REQUIRED",
            reason: "UPSTREAM_OWNER_MISMATCH",
          }),
        }),
      }),
    );
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "payment_reconciliation_manual_required",
        severity: "ERROR",
        metadata: expect.objectContaining({
          operation_id: "operation-1",
          reconcile_attempt_count: 3,
          reconcile_failure_count: 2,
        }),
      }),
    });
  });

  it("locks the changed current owner and terminally fences release after an HTTP race", async () => {
    const ownedClaim = claim();
    mocks.reconcilePaymentOperation.mockResolvedValue({
      operation: "PURCHASE",
      state: "IN_PROGRESS",
      payment: null,
      transaction: null,
      retry_after_seconds: 5,
    });
    mocks.tx.$queryRaw
      // Normal release revalidates and observes the owner change.
      .mockResolvedValueOnce([{ remnashopUserId: "99" }])
      // The explicit terminal path locks the same changed owner as proof.
      .mockResolvedValueOnce([{ remnashopUserId: "99" }])
      .mockResolvedValueOnce([{ now }]);
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      processPaymentReconciliationClaim(ownedClaim, { accessToken: "access" }),
    ).resolves.toBe("MANUAL_REQUIRED");

    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledOnce();
    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reconciledAt: now,
          reconcileErrorSnapshot: expect.objectContaining({
            reason: "UPSTREAM_OWNER_CHANGED_DURING_SETTLEMENT",
          }),
        }),
      }),
    );
  });

  it("durably releases and backs off when successful settlement cannot be applied", async () => {
    const ownedClaim = claim();
    const writeFailure = new Error("database write failed");
    mocks.reconcilePaymentOperation.mockResolvedValue({
      operation: "PURCHASE",
      state: "SUCCEEDED",
      payment,
      transaction,
      retry_after_seconds: null,
    });
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 1_000) }]);
    mocks.tx.paymentOperation.findUnique.mockResolvedValue(
      operationForClaim(ownedClaim.claimToken),
    );
    mocks.tx.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.applyRemnashopTransaction.mockRejectedValue(writeFailure);
    mocks.prisma.paymentOperation.findUnique.mockResolvedValue({
      reconcileFailureCount: 1,
    });
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      processPaymentReconciliationClaim(ownedClaim, { accessToken: "access" }),
    ).rejects.toBe(writeFailure);

    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reconcileClaimTokenHash: null,
          reconcileLeaseExpiresAt: null,
          reconcileNextAttemptAt: expect.any(Date),
          reconcileFailureCount: { increment: 1 },
          reconcileErrorSnapshot: expect.objectContaining({
            code: "INTERNAL_ERROR",
          }),
        }),
      }),
    );
  });

  it("turns a deterministic payment-owner collision into terminal manual review", async () => {
    const ownedClaim = claim();
    mocks.reconcilePaymentOperation.mockResolvedValue({
      operation: "PURCHASE",
      state: "SUCCEEDED",
      payment,
      transaction,
      retry_after_seconds: null,
    });
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ remnashopUserId: "42" }])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 1_000) }]);
    mocks.tx.paymentOperation.findUnique.mockResolvedValue(
      operationForClaim(ownedClaim.claimToken),
    );
    mocks.tx.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.applyRemnashopTransaction.mockRejectedValue(
      new BffError("CONFLICT", 409, "payment belongs to another owner"),
    );
    mocks.tx.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      processPaymentReconciliationClaim(ownedClaim, { accessToken: "access" }),
    ).resolves.toBe("MANUAL_REQUIRED");

    expect(mocks.tx.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reconciledAt: new Date(now.getTime() + 1_000),
          reconcileErrorSnapshot: expect.objectContaining({
            code: "MANUAL_REQUIRED",
            reason: "PAYMENT_RECORD_OWNER_OR_ID_COLLISION",
          }),
        }),
      }),
    );
    expect(mocks.tx.auditLog.create).toHaveBeenCalledOnce();
  });
});
