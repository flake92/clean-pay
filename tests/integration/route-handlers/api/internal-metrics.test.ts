import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  logTechnicalError: vi.fn(),
  readReconciliationBacklog: vi.fn(),
}));

vi.mock("@/backend/config/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/backend/database/pools", () => ({
  runtimeDatabasePoolMetrics: () => [{
    role: "application",
    active: 2,
    idle: 1,
    waiting: 0,
    maximum: 8,
    exhausted: 0,
  }],
}));
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
}));
vi.mock("@/backend/integrations/payments/payment-maintenance-runner", () => ({
  productionPaymentMaintenanceRunner: {
    readReconciliationBacklog: mocks.readReconciliationBacklog,
  },
}));

import { GET } from "@/app/api/internal/metrics/route";

const secret = "metrics-readiness-secret".repeat(2);

function request(suppliedSecret?: string) {
  return new Request("http://clean-pay.local/api/internal/metrics", {
    headers: suppliedSecret
      ? { "x-clean-pay-readiness-secret": suppliedSecret }
      : undefined,
  });
}

describe("internal Prometheus metrics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnv.mockReturnValue({ readiness: { internalSecret: secret } });
    mocks.readReconciliationBacklog.mockResolvedValue({
      pending: 2,
      due: 1,
      manualRequired: 0,
      oldestAgeSeconds: 15,
      maximumAttemptCount: 1,
      totalFailureCount: 0,
    });
  });

  it("hides the endpoint from requests without the internal secret", async () => {
    for (const supplied of [undefined, "wrong-secret"]) {
      const response = await GET(request(supplied));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(mocks.readReconciliationBacklog).not.toHaveBeenCalled();
  });

  it("renders live reconciliation backlog in Prometheus format", async () => {
    const response = await GET(request(secret));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain(
      'clean_pay_payment_reconciliation_backlog{state="pending"} 2',
    );
    expect(body).toContain(
      'clean_pay_database_pool_connections{role="application",state="active"} 2',
    );
    expect(mocks.readReconciliationBacklog).toHaveBeenCalledTimes(1);
  });

  it("fails closed and records a scrape dependency failure", async () => {
    const error = new Error("database unavailable");
    mocks.readReconciliationBacklog.mockRejectedValue(error);

    const response = await GET(request(secret));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("metrics unavailable\n");
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "internal_metrics_failed",
      error,
    );
  });
});
