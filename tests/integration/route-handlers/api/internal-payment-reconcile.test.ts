import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  claimReconciliation: vi.fn(), recoverPayment: vi.fn(), completeRecoveredPayment: vi.fn(), resetMissingPayment: vi.fn(),
  releaseReconciliation: vi.fn(), markReconciliationManual: vi.fn(), failReconciliation: vi.fn(), classifyReconciliationError: vi.fn(),
  readReconciliationBacklog: vi.fn(),
  listHistoryCandidates: vi.fn(),
  claimHistory: vi.fn(), authorizeHistory: vi.fn(), historyPageSize: vi.fn(), loadHistoryPage: vi.fn(),
  findPendingHistoryPaymentIds: vi.fn(), loadExactHistoryPayment: vi.fn(),
  persistExactHistoryPayment: vi.fn(), loadLegacyHistory: vi.fn(),
  completeHistoryPage: vi.fn(), classifyHistoryError: vi.fn(),
  deferHistory: vi.fn(), failHistory: vi.fn(), now: vi.fn(),
  logTechnicalError: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/config/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/backend/integrations/payments/payment-maintenance-runner", () => ({
  productionPaymentMaintenanceRunner: {
    claimReconciliation: mocks.claimReconciliation, recoverPayment: mocks.recoverPayment,
    completeRecoveredPayment: mocks.completeRecoveredPayment, resetMissingPayment: mocks.resetMissingPayment,
    releaseReconciliation: mocks.releaseReconciliation, markReconciliationManual: mocks.markReconciliationManual,
    failReconciliation: mocks.failReconciliation, classifyReconciliationError: mocks.classifyReconciliationError,
    readReconciliationBacklog: mocks.readReconciliationBacklog,
    listHistoryCandidates: mocks.listHistoryCandidates, claimHistory: mocks.claimHistory,
    authorizeHistory: mocks.authorizeHistory, historyPageSize: mocks.historyPageSize,
    findPendingHistoryPaymentIds: mocks.findPendingHistoryPaymentIds,
    loadExactHistoryPayment: mocks.loadExactHistoryPayment,
    persistExactHistoryPayment: mocks.persistExactHistoryPayment,
    loadLegacyHistory: mocks.loadLegacyHistory,
    loadHistoryPage: mocks.loadHistoryPage, completeHistoryPage: mocks.completeHistoryPage,
    classifyHistoryError: mocks.classifyHistoryError,
    deferHistory: mocks.deferHistory, failHistory: mocks.failHistory, now: mocks.now,
  },
}));
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
}));
vi.mock("@/backend/observability/logger", () => ({ logger: mocks.logger }));

import { POST } from "@/app/api/internal/payments/reconcile/route";
import { ServiceError } from "@/backend/errors/service-error";
import { parseReconciliationBatch } from "../../../../deploy/prod/reconciliation-batch.mjs";

const secret = "a".repeat(48);

function request(value?: string) {
  return new Request("http://clean-pay.local/api/internal/payments/reconcile", {
    method: "POST",
    headers: value
      ? { "x-clean-pay-reconciliation-secret": value }
      : undefined,
  });
}

describe("internal payment reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimReconciliation.mockReset();
    mocks.getEnv.mockReturnValue({
      paymentReconciliation: {
        enabled: true,
        secret,
        batchSize: 7,
      },
    });
    let now = 1_000;
    mocks.now.mockImplementation(() => now++);
    mocks.claimReconciliation.mockResolvedValueOnce({ context: {}, operationId: "op-1", ownerMatches: true, failureCount: 0 }).mockResolvedValue(null);
    mocks.recoverPayment.mockResolvedValue({ context: {}, state: "SUCCEEDED", retryAfterSeconds: null });
    mocks.classifyReconciliationError.mockReturnValue({ kind: "other" });
    mocks.classifyHistoryError.mockImplementation((error: unknown) =>
      error instanceof ServiceError &&
      (
        error.code === "UNAUTHORIZED" ||
        error.code === "ACCOUNT_MERGE_REQUIRED" ||
        error.code === "CONFLICT"
      )
        ? { kind: "deferred" }
        : { kind: "unexpected" },
    );
    mocks.readReconciliationBacklog.mockResolvedValue({
      pending: 0,
      due: 0,
      manualRequired: 0,
      oldestAgeSeconds: 0,
      maximumAttemptCount: 0,
      totalFailureCount: 0,
    });
    mocks.listHistoryCandidates.mockResolvedValue([{ userId: "user-1", upstreamAccountId: "upstream-1" }]);
    mocks.claimHistory.mockResolvedValue({ context: {}, cursor: null });
    mocks.authorizeHistory.mockResolvedValue({ context: {} });
    mocks.historyPageSize.mockResolvedValue(100);
    mocks.findPendingHistoryPaymentIds.mockResolvedValue([]);
    mocks.loadHistoryPage.mockResolvedValue({ context: {} });
    mocks.completeHistoryPage.mockResolvedValue({ applied: 20, hasMore: false });
  });

  it("is indistinguishable from not-found while disabled", async () => {
    mocks.getEnv.mockReturnValue({
      paymentReconciliation: { enabled: false, secret: null, batchSize: 7 },
    });

    const response = await POST(request(secret));

    expect(response.status).toBe(404);
    expect(mocks.claimReconciliation).not.toHaveBeenCalled();
  });

  it("rejects missing and wrong secrets without running a batch", async () => {
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request("wrong"))).status).toBe(404);
    expect(mocks.claimReconciliation).not.toHaveBeenCalled();
  });

  it("runs a bounded batch only with the timing-safe secret", async () => {
    const response = await POST(request(secret));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.claimReconciliation).toHaveBeenCalledTimes(2);
    expect(mocks.listHistoryCandidates).toHaveBeenCalledWith(20);
    expect(payload).toMatchObject({
      claimed: 1,
      succeeded: 1,
      history: { applied: 20 },
    });
    expect(payload).not.toHaveProperty("data");
    expect(parseReconciliationBatch(payload)).toMatchObject({
      claimed: 1,
      succeeded: 1,
      history: { applied: 20 },
    });
  });

  it("returns a non-success status when every claimed operation fails", async () => {
    mocks.recoverPayment.mockRejectedValue(new Error("provider unavailable"));

    const response = await POST(request(secret));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      claimed: 1,
      failed: 1,
      history: { attempted: 1, failed: 0 },
    });
  });

  it("keeps the route available when a stale history credential is deferred", async () => {
    mocks.claimReconciliation.mockReset().mockResolvedValue(null);
    mocks.authorizeHistory.mockRejectedValue(
      new ServiceError("UNAUTHORIZED", 401, "Invalid or expired refresh token"),
    );

    const response = await POST(request(secret));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      claimed: 0,
      failed: 0,
      history: { attempted: 1, failed: 1, deferred: 1 },
      backlog: { due: 0 },
    });
    expect(mocks.deferHistory).toHaveBeenCalledOnce();
    expect(mocks.failHistory).not.toHaveBeenCalled();
  });

  it.each([
    new ServiceError("INTERNAL_ERROR", 500, "Stored token decryption failed"),
    new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Upstream returned 5xx"),
  ])("fails closed for unexpected history failure %#", async (failure) => {
    mocks.claimReconciliation.mockReset().mockResolvedValue(null);
    mocks.authorizeHistory.mockRejectedValue(failure);

    const response = await POST(request(secret));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      claimed: 0,
      history: { attempted: 1, failed: 1, deferred: 0 },
      backlog: { due: 0 },
    });
    expect(mocks.failHistory).toHaveBeenCalledOnce();
    expect(mocks.deferHistory).not.toHaveBeenCalled();
  });

  it("does not hide a due core payment operation behind history progress", async () => {
    mocks.claimReconciliation.mockReset().mockResolvedValue(null);
    mocks.readReconciliationBacklog.mockResolvedValue({
      pending: 1,
      due: 1,
      manualRequired: 0,
      oldestAgeSeconds: 30,
      maximumAttemptCount: 0,
      totalFailureCount: 0,
    });

    const response = await POST(request(secret));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      claimed: 0,
      history: { attempted: 1, failed: 0 },
      backlog: { pending: 1, due: 1 },
    });
  });
});
