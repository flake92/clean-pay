import { beforeEach, describe, expect, it, vi } from "vitest";

import { executePaymentWorkflow } from "@/application/payments/execute-payment-workflow";
import type { PaymentWorkflowGateway } from "@/application/payments/ports/payment-workflow";
import { confirmedPaymentOffer } from "@/shared/domain/payment-offer";

const price = {
  gateway_type: "YOOKASSA",
  currency: "RUB",
  currency_symbol: "₽",
  original_amount: "100.00",
  discount_percent: 0,
  final_amount: "100.00",
  is_free: false,
};

const plan = {
  id: 1,
  public_code: "basic",
  name: "Basic",
  description: null,
  traffic_limit: 100,
  device_limit: 3,
  type: "standard",
  recommended_purchase_type: "renew",
  durations: [{ days: 30, prices: [price] }],
};

const request = {
  plan_code: plan.public_code,
  duration_days: 30,
  gateway_type: price.gateway_type,
  ...confirmedPaymentOffer(plan, 30, price),
};

const payment = {
  payment_id: "payment-1",
  payment_url: "https://pay.example/checkout",
  purchase_type: "NEW",
  status: "pending",
  is_free: false,
  final_amount: "100.00",
  currency: "RUB",
};

function gateway(overrides: Partial<PaymentWorkflowGateway> = {}): PaymentWorkflowGateway {
  return {
    loadActor: vi.fn(async () => ({ userId: "user-1", email: "u@example.com", emailVerified: true, telegramId: null })),
    rateLimit: vi.fn(async () => undefined),
    beginOperation: vi.fn()
      .mockResolvedValueOnce({ state: "missing" })
      .mockResolvedValueOnce({ state: "execute", operationId: "operation-1", claimToken: "claim-1", upstreamKey: "upstream-1" }),
    authorize: vi.fn(async () => ({
      context: { secret: "opaque" },
      localUserId: "user-1",
      upstreamAccountId: "upstream-user-1",
    })),
    bindUpstreamOwner: vi.fn(async () => undefined),
    loadOffers: vi.fn(async () => ({
      gateways: [],
      plans: [plan],
      has_current_subscription: false,
      current_subscription_status: null,
    })),
    dispatch: vi.fn(async () => payment),
    markDispatched: vi.fn(async () => undefined),
    completeSuccess: vi.fn(async ({ payment: result }) => result),
    auditSuccess: vi.fn(async () => undefined),
    settleBeforeDispatch: vi.fn(async () => undefined),
    dispatchFailureOutcome: vi.fn((): "UNKNOWN" => "UNKNOWN"),
    settleAfterDispatch: vi.fn(async () => undefined),
    errorFromSnapshot: vi.fn((snapshot) => Object.assign(new Error(snapshot.message), { code: snapshot.code })),
    logAuditFailure: vi.fn(),
    logSettlementFailure: vi.fn(),
    ...overrides,
  };
}

describe("application payment workflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owns the complete create-and-dispatch order", async () => {
    const port = gateway();

    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request }, "key-1"))
      .resolves.toEqual({ status: "completed", operationId: "operation-1", payment });

    expect(port.rateLimit).toHaveBeenCalledWith({
      kind: "PURCHASE",
      email: "u@example.com",
      telegramId: null,
    });
    expect(port.beginOperation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      createIfMissing: true,
      expectedUpstreamAccountId: "upstream-user-1",
    }));
    expect(port.bindUpstreamOwner).toHaveBeenCalledBefore(vi.mocked(port.loadOffers));
    expect(port.markDispatched).toHaveBeenCalledBefore(vi.mocked(port.dispatch));
    expect(port.completeSuccess).toHaveBeenCalledBefore(vi.mocked(port.auditSuccess));
  });

  it.each([
    [
      { state: "replay", outcome: "success", operationId: "op-replay", responseStatus: 200, response: payment },
      { status: "completed", operationId: "op-replay", payment },
    ],
    [
      { state: "pending", operationId: "op-pending", reason: "IN_PROGRESS" },
      { status: "pending", operationId: "op-pending", retryAfterSeconds: 5 },
    ],
    [
      { state: "manual_required", operationId: "op-manual" },
      { status: "manual-review", operationId: "op-manual" },
    ],
  ] as const)("returns an existing operation state %# without provider dispatch", async (state, expected) => {
    const port = gateway({ beginOperation: vi.fn(async () => state) });
    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request }, "key-1"))
      .resolves.toEqual(expected);
    expect(port.authorize).not.toHaveBeenCalled();
    expect(port.dispatch).not.toHaveBeenCalled();
  });

  it("rethrows a persisted failure through the adapter error contract", async () => {
    const error = Object.assign(new Error("persisted"), { code: "OFFER_CHANGED" });
    const port = gateway({
      beginOperation: vi.fn(async () => ({
        state: "replay",
        outcome: "failure",
        operationId: "op-failed",
        responseStatus: 409,
        error: { code: "OFFER_CHANGED", status: 409, message: "changed" },
      } as const)),
      errorFromSnapshot: vi.fn(() => error),
    });

    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request }, "key-1"))
      .rejects.toBe(error);
  });

  it("settles a changed offer as final before provider mutation", async () => {
    const port = gateway();
    const changed = { ...request, confirmed_amount: "99.00" };

    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request: changed }, "key-1"))
      .rejects.toMatchObject({ code: "OFFER_CHANGED", status: 409 });
    expect(port.settleBeforeDispatch).toHaveBeenCalledWith(expect.objectContaining({ final: true }));
    expect(port.markDispatched).not.toHaveBeenCalled();
    expect(port.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a session identity change before binding or dispatch", async () => {
    const port = gateway({
      authorize: vi.fn(async () => ({ context: {}, localUserId: "user-2", upstreamAccountId: "upstream-2" })),
    });

    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request }, "key-1"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(port.bindUpstreamOwner).not.toHaveBeenCalled();
    expect(port.dispatch).not.toHaveBeenCalled();
  });

  it("keeps an unknown post-dispatch result pending", async () => {
    const upstreamError = Object.assign(new Error("timeout"), { code: "UPSTREAM_UNAVAILABLE" });
    const port = gateway({ dispatch: vi.fn(async () => { throw upstreamError; }) });

    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request }, "key-1"))
      .resolves.toEqual({ status: "pending", operationId: "operation-1", retryAfterSeconds: 5 });
    expect(port.settleAfterDispatch).toHaveBeenCalledWith(expect.objectContaining({
      error: upstreamError,
      outcome: "UNKNOWN",
    }));
  });

  it("does not downgrade a completed payment when best-effort audit fails", async () => {
    const auditError = new Error("audit storage unavailable");
    const port = gateway({ auditSuccess: vi.fn(async () => { throw auditError; }) });

    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request }, "key-1"))
      .resolves.toEqual({ status: "completed", operationId: "operation-1", payment });
    expect(port.logAuditFailure).toHaveBeenCalledWith(auditError, {
      operationId: "operation-1",
      kind: "PURCHASE",
    });
    expect(port.settleAfterDispatch).not.toHaveBeenCalled();
  });

  it("returns pending and logs when post-dispatch settlement itself fails", async () => {
    const upstreamError = new Error("timeout");
    const settlementError = new Error("database unavailable");
    const port = gateway({
      dispatch: vi.fn(async () => { throw upstreamError; }),
      settleAfterDispatch: vi.fn(async () => { throw settlementError; }),
    });

    await expect(executePaymentWorkflow(port, { kind: "PURCHASE", request }, "key-1"))
      .resolves.toMatchObject({ status: "pending" });
    expect(port.logSettlementFailure).toHaveBeenCalledWith(settlementError, {
      operationId: "operation-1",
      kind: "PURCHASE",
    });
  });
});
