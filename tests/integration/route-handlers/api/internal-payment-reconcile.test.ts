import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  claimReconciliation: vi.fn(), recoverPayment: vi.fn(), completeRecoveredPayment: vi.fn(), resetMissingPayment: vi.fn(),
  releaseReconciliation: vi.fn(), markReconciliationManual: vi.fn(), failReconciliation: vi.fn(), classifyReconciliationError: vi.fn(),
  listHistoryCandidates: vi.fn(),
  claimHistory: vi.fn(), authorizeHistory: vi.fn(), historyPageSize: vi.fn(), loadHistoryPage: vi.fn(),
  completeHistoryPage: vi.fn(), failHistory: vi.fn(), now: vi.fn(),
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
    listHistoryCandidates: mocks.listHistoryCandidates, claimHistory: mocks.claimHistory,
    authorizeHistory: mocks.authorizeHistory, historyPageSize: mocks.historyPageSize,
    loadHistoryPage: mocks.loadHistoryPage, completeHistoryPage: mocks.completeHistoryPage,
    failHistory: mocks.failHistory, now: mocks.now,
  },
}));
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
}));
vi.mock("@/backend/observability/logger", () => ({ logger: mocks.logger }));

import { POST } from "@/app/api/internal/payments/reconcile/route";
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
    mocks.listHistoryCandidates.mockResolvedValue([{ userId: "user-1", upstreamAccountId: "upstream-1" }]);
    mocks.claimHistory.mockResolvedValue({ context: {}, cursor: null });
    mocks.authorizeHistory.mockResolvedValue({ context: {} });
    mocks.historyPageSize.mockResolvedValue(100);
    mocks.loadHistoryPage.mockResolvedValue({ context: {} });
    mocks.completeHistoryPage.mockResolvedValue({ applied: 20, hasMore: true });
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
    expect(mocks.listHistoryCandidates).toHaveBeenCalledWith(1);
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
});
