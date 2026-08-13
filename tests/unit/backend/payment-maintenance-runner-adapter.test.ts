import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPaymentReconciliationBacklog: vi.fn(),
  claimUnknownPaymentOperation: vi.fn(), failPaymentReconciliation: vi.fn(), completeReconciledPayment: vi.fn(),
  resetMissingUpstreamOperation: vi.fn(), releaseReconciliationClaim: vi.fn(), markPaymentReconciliationManual: vi.fn(),
  listDuePaymentHistoryCandidates: vi.fn(), claimPaymentHistorySync: vi.fn(), loadCurrentPaymentHistoryCredential: vi.fn(),
  completePaymentHistoryPage: vi.fn(), failPaymentHistorySync: vi.fn(), getPaymentCapabilities: vi.fn(),
  getExactTransaction: vi.fn(), getLegacyTransactions: vi.fn(), getTransactionPage: vi.fn(),
  reconcilePaymentOperation: vi.fn(), reconcilePaymentOperationAsAdmin: vi.fn(),
  findPendingPaymentIds: vi.fn(), syncExactPaymentRecordFromRemnashop: vi.fn(), warn: vi.fn(),
}));

vi.mock("@/backend/integrations/payments/payment-reconciliation-service", () => {
  class PaymentReconciliationManualError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  }
  return {
    PaymentReconciliationManualError,
    readPaymentReconciliationBacklog: mocks.readPaymentReconciliationBacklog,
    claimUnknownPaymentOperation: mocks.claimUnknownPaymentOperation,
    failPaymentReconciliation: mocks.failPaymentReconciliation,
    completeReconciledPayment: mocks.completeReconciledPayment,
    resetMissingUpstreamOperation: mocks.resetMissingUpstreamOperation,
    releaseReconciliationClaim: mocks.releaseReconciliationClaim,
    markPaymentReconciliationManual: mocks.markPaymentReconciliationManual,
  };
});
vi.mock("@/backend/integrations/payments/payment-history-sync-service", () => ({
  listDuePaymentHistoryCandidates: mocks.listDuePaymentHistoryCandidates,
  claimPaymentHistorySync: mocks.claimPaymentHistorySync,
  loadCurrentPaymentHistoryCredential: mocks.loadCurrentPaymentHistoryCredential,
  completePaymentHistoryPage: mocks.completePaymentHistoryPage,
  failPaymentHistorySync: mocks.failPaymentHistorySync,
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  getPaymentCapabilities: mocks.getPaymentCapabilities, getTransactionPage: mocks.getTransactionPage,
  getExactTransaction: mocks.getExactTransaction, getLegacyTransactions: mocks.getLegacyTransactions,
  reconcilePaymentOperation: mocks.reconcilePaymentOperation, reconcilePaymentOperationAsAdmin: mocks.reconcilePaymentOperationAsAdmin,
}));
vi.mock("@/backend/integrations/payments/prisma-payment-query-repository", () => ({
  prismaPaymentQueryRepository: { findPendingPaymentIds: mocks.findPendingPaymentIds },
}));
vi.mock("@/backend/integrations/payments/payment-record-service", () => ({
  syncExactPaymentRecordFromRemnashop: mocks.syncExactPaymentRecordFromRemnashop,
}));
vi.mock("@/backend/observability/logger", () => ({ logger: { warn: mocks.warn } }));

import { ServiceError } from "@/backend/errors/service-error";
import { PaymentReconciliationManualError } from "@/backend/integrations/payments/payment-reconciliation-service";
import { productionPaymentMaintenanceRunner as runner } from "@/backend/integrations/payments/payment-maintenance-runner";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";

const backendClaim = {
  operationId: "operation-1", userId: "user-1", remnashopUserId: "owner-1", operation: "PURCHASE",
  upstreamKey: "key-1", upstreamOwnerHash: paymentUpstreamOwnerHash("owner-1"), failureCount: 2,
};
const applicationClaim = { context: backendClaim, operationId: "operation-1", failureCount: 2, ownerMatches: true } as never;

describe("production payment maintenance runner adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readPaymentReconciliationBacklog.mockResolvedValue({
      pending: 0, due: 0, manualRequired: 0, oldestAgeSeconds: 0,
      maximumAttemptCount: 0, totalFailureCount: 0,
    });
    mocks.claimUnknownPaymentOperation.mockResolvedValue(backendClaim);
    mocks.failPaymentReconciliation.mockResolvedValue(undefined);
  });

  it("maps claimed reconciliation ownership and absent work", async () => {
    await expect(runner.readReconciliationBacklog!()).resolves.toMatchObject({ pending: 0 });
    await expect(runner.claimReconciliation("user-1")).resolves.toMatchObject({
      operationId: "operation-1", failureCount: 2, ownerMatches: true,
    });
    mocks.claimUnknownPaymentOperation.mockResolvedValueOnce({ ...backendClaim, upstreamOwnerHash: "wrong" });
    await expect(runner.claimReconciliation()).resolves.toMatchObject({ ownerMatches: false });
    mocks.claimUnknownPaymentOperation.mockResolvedValueOnce(null);
    await expect(runner.claimReconciliation()).resolves.toBeNull();
  });

  it("uses the user endpoint when an access token is available and admin otherwise", async () => {
    const recovery = { operation: "PURCHASE", state: "IN_PROGRESS", payment: null, transaction: null, retry_after_seconds: 5 };
    mocks.reconcilePaymentOperation.mockResolvedValueOnce(recovery);
    await expect(runner.recoverPayment(applicationClaim, { accessToken: "access" })).resolves.toMatchObject({ state: "IN_PROGRESS", retryAfterSeconds: 5 });
    expect(mocks.reconcilePaymentOperation).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "access", trigger: true }));
    mocks.reconcilePaymentOperationAsAdmin.mockResolvedValueOnce(recovery).mockResolvedValueOnce(null);
    await expect(runner.recoverPayment(applicationClaim)).resolves.toMatchObject({ state: "IN_PROGRESS" });
    await expect(runner.recoverPayment(applicationClaim, { accessToken: 123 })).resolves.toBeNull();
    expect(mocks.reconcilePaymentOperationAsAdmin).toHaveBeenCalledWith(expect.objectContaining({ remnashopUserId: "owner-1" }));
  });

  it("unwraps reconciliation contexts for every persistence operation", async () => {
    const result = { context: { state: "SUCCEEDED" } } as never;
    await runner.completeRecoveredPayment(applicationClaim, result);
    await runner.resetMissingPayment(applicationClaim);
    await runner.releaseReconciliation(applicationClaim, { delayMs: 5_000, failure: true, errorCode: "UNKNOWN" });
    await runner.releaseReconciliation(applicationClaim, { delayMs: 1_000, failure: false });
    await runner.markReconciliationManual(applicationClaim, "REVIEW", true);
    expect(mocks.completeReconciledPayment).toHaveBeenCalledWith(backendClaim, { state: "SUCCEEDED" });
    expect(mocks.resetMissingUpstreamOperation).toHaveBeenCalledWith(backendClaim);
    expect(mocks.releaseReconciliationClaim).toHaveBeenNthCalledWith(1, backendClaim, {
      nextAttemptDelayMs: 5_000, failure: true, errorSnapshot: { code: "UNKNOWN" },
    });
    expect(mocks.releaseReconciliationClaim).toHaveBeenNthCalledWith(2, backendClaim, {
      nextAttemptDelayMs: 1_000, failure: false,
    });
    expect(mocks.markPaymentReconciliationManual).toHaveBeenCalledWith(backendClaim, "REVIEW", { allowOwnerMismatch: true });
  });

  it("classifies claim release and settlement failures", async () => {
    await expect(runner.failReconciliation(applicationClaim, new Error("failed"))).resolves.toBe("released");
    mocks.failPaymentReconciliation.mockRejectedValueOnce(new ServiceError("ACCOUNT_MERGE_REQUIRED", 409));
    await expect(runner.failReconciliation(applicationClaim, new Error("failed"))).resolves.toBe("owner_changed");
    const unexpected = new TypeError("db failed");
    mocks.failPaymentReconciliation.mockRejectedValueOnce(unexpected);
    await expect(runner.failReconciliation(applicationClaim, new Error("failed"))).rejects.toBe(unexpected);
    expect(runner.classifyReconciliationError(new PaymentReconciliationManualError("MANUAL"))).toEqual({ kind: "manual", reason: "MANUAL" });
    expect(runner.classifyReconciliationError(new ServiceError("ACCOUNT_MERGE_REQUIRED", 409))).toEqual({ kind: "owner_changed" });
    expect(runner.classifyReconciliationError(new Error())).toEqual({ kind: "other" });
  });

  it("maps history candidates, claims and credentials", async () => {
    mocks.listDuePaymentHistoryCandidates.mockResolvedValue([{ userId: "user-1", remnashopUserId: "owner-1" }]);
    await expect(runner.listHistoryCandidates(10)).resolves.toEqual([{ userId: "user-1", upstreamAccountId: "owner-1" }]);
    const historyClaim = { userId: "user-1", upstreamOwnerHash: "hash", cursor: "cursor" };
    mocks.claimPaymentHistorySync.mockResolvedValueOnce(historyClaim).mockResolvedValueOnce(null);
    const claimed = await runner.claimHistory({ userId: "user-1", upstreamAccountId: "owner-1" });
    await expect(runner.claimHistory({ userId: "user-1", upstreamAccountId: "owner-1" })).resolves.toBeNull();
    expect(claimed).toMatchObject({ cursor: "cursor" });
    mocks.loadCurrentPaymentHistoryCredential.mockResolvedValueOnce("access").mockResolvedValueOnce(null);
    await expect(runner.authorizeHistory(claimed!)).resolves.toEqual({ context: { accessToken: "access" } });
    await expect(runner.authorizeHistory(claimed!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("loads capabilities and applies or fails history pages", async () => {
    const authorization = { context: { accessToken: "access" } } as never;
    mocks.getPaymentCapabilities.mockResolvedValueOnce({ transactions: { max_page_size: 80 } }).mockResolvedValueOnce(null);
    await expect(runner.historyPageSize(authorization)).resolves.toBe(80);
    await expect(runner.historyPageSize(authorization)).resolves.toBeNull();
    const page = { items: [], next_cursor: null };
    mocks.getTransactionPage.mockResolvedValue(page);
    const loaded = await runner.loadHistoryPage(authorization, "cursor", 50);
    expect(loaded).toEqual({ context: page });
    expect(mocks.getTransactionPage).toHaveBeenCalledWith({ accessToken: "access", cursor: "cursor", limit: 50 });
    const claim = { context: { id: "history-claim" }, cursor: null } as never;
    await runner.completeHistoryPage(claim, loaded);
    await runner.failHistory(claim, new Error("failed"));
    expect(mocks.completePaymentHistoryPage).toHaveBeenCalledWith({ id: "history-claim" }, page);
    expect(mocks.failPaymentHistorySync).toHaveBeenCalledWith({ id: "history-claim" }, expect.any(Error));
    expect(typeof runner.now()).toBe("number");
  });

  it("loads pending, exact and legacy recovery paths with timeout propagation", async () => {
    const authorization = { context: { accessToken: "access" } } as never;
    const candidate = { userId: "user-1", upstreamAccountId: "owner-1" };
    mocks.findPendingPaymentIds.mockResolvedValue(["payment-1"]);
    const exact = { id: "payment-1" };
    mocks.getExactTransaction.mockResolvedValueOnce(exact).mockResolvedValueOnce(null);
    const legacy = [{ id: "legacy-1" }];
    mocks.getLegacyTransactions.mockResolvedValue(legacy);

    await expect(runner.findPendingHistoryPaymentIds("user-1", 7)).resolves.toEqual(["payment-1"]);
    const loaded = await runner.loadExactHistoryPayment(authorization, "payment-1", 1_500);
    await expect(runner.loadExactHistoryPayment(authorization, "missing", 900)).resolves.toBeNull();
    expect(loaded).toEqual({ context: exact });
    await runner.persistExactHistoryPayment(candidate, loaded!);
    await expect(runner.loadLegacyHistory(authorization, 2_000)).resolves.toEqual({
      context: { items: legacy, next_cursor: null },
    });

    expect(mocks.findPendingPaymentIds).toHaveBeenCalledWith("user-1", 7);
    expect(mocks.getExactTransaction).toHaveBeenNthCalledWith(1, {
      accessToken: "access", paymentId: "payment-1", timeoutMs: 1_500,
    });
    expect(mocks.syncExactPaymentRecordFromRemnashop).toHaveBeenCalledWith({
      userId: "user-1", upstreamAccountId: "owner-1", transaction: exact,
    });
    expect(mocks.getLegacyTransactions).toHaveBeenCalledWith("access", 2_000);
  });

  it("logs typed and unknown exact-history failures", () => {
    runner.logHistoryExactFailure?.(new TypeError("failed"), 1);
    runner.logHistoryExactFailure?.("failed", 2);

    expect(mocks.warn).toHaveBeenNthCalledWith(
      1,
      "payment_history_worker_exact_sync_failed",
      { index: 1, errorName: "TypeError" },
      expect.objectContaining({ source: "payments.history.worker" }),
    );
    expect(mocks.warn).toHaveBeenNthCalledWith(
      2,
      "payment_history_worker_exact_sync_failed",
      { index: 2, errorName: "UnknownError" },
      expect.any(Object),
    );
  });
});
