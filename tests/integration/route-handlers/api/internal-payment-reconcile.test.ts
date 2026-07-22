import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  reconcileUnknownPayments: vi.fn(),
  continuePaymentHistoryBackfills: vi.fn(),
  logTechnicalError: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/config/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/backend/payments/reconciliation", () => ({
  reconcileUnknownPayments: mocks.reconcileUnknownPayments,
}));
vi.mock("@/backend/payments/history-sync", () => ({
  continuePaymentHistoryBackfills: mocks.continuePaymentHistoryBackfills,
}));
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
}));
vi.mock("@/backend/observability/logger", () => ({ logger: mocks.logger }));

import { POST } from "@/app/api/internal/payments/reconcile/route";

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
    mocks.getEnv.mockReturnValue({
      paymentReconciliation: {
        enabled: true,
        secret,
        batchSize: 7,
      },
    });
    mocks.reconcileUnknownPayments.mockResolvedValue({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    mocks.continuePaymentHistoryBackfills.mockResolvedValue({
      attempted: 1,
      applied: 20,
      completed: 0,
      failed: 0,
    });
  });

  it("is indistinguishable from not-found while disabled", async () => {
    mocks.getEnv.mockReturnValue({
      paymentReconciliation: { enabled: false, secret: null, batchSize: 7 },
    });

    const response = await POST(request(secret));

    expect(response.status).toBe(404);
    expect(mocks.reconcileUnknownPayments).not.toHaveBeenCalled();
  });

  it("rejects missing and wrong secrets without running a batch", async () => {
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request("wrong"))).status).toBe(404);
    expect(mocks.reconcileUnknownPayments).not.toHaveBeenCalled();
  });

  it("runs a bounded batch only with the timing-safe secret", async () => {
    const response = await POST(request(secret));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.reconcileUnknownPayments).toHaveBeenCalledWith({
      limit: 7,
      deadlineMs: 12_000,
    });
    expect(mocks.continuePaymentHistoryBackfills).toHaveBeenCalledWith({
      limit: 1,
      deadlineMs: 12_000,
    });
    expect(payload).toMatchObject({
      data: { claimed: 1, succeeded: 1, history: { applied: 20 } },
    });
  });
});
