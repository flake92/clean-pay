import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmedPaymentOffer } from "@/shared/domain/payment-offer";
import type { ExtendRequest, PurchaseRequest } from "@/shared/domain/payments";
import { executePaymentWorkflow } from "@/application/payments/execute-payment-workflow";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  assertEmailVerificationPolicy: vi.fn(),
  assertRateLimit: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  remnashopRequest: vi.fn(),
  parsePaymentInit: vi.fn(),
  beginPaymentOperation: vi.fn(),
  bindPaymentOperationUpstreamOwner: vi.fn(),
  completePaymentOperationSuccess: vi.fn(),
  markPaymentOperationDispatched: vi.fn(),
  paymentOperationDispatchFailureOutcome: vi.fn(),
  paymentOperationErrorFromSnapshot: vi.fn(),
  settlePaymentOperationAfterDispatchFailure: vi.fn(),
  settlePaymentOperationBeforeDispatchFailure: vi.fn(),
  paymentReturnUrl: vi.fn(),
  assertPaymentReturnUrl: vi.fn(),
  auditLog: vi.fn(),
  logTechnicalError: vi.fn(),
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession,
  assertEmailVerificationPolicy: mocks.assertEmailVerificationPolicy,
}));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  remnashopRequest: mocks.remnashopRequest,
  remnashopValidatedRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnashop/api-client-runtime", () => ({
  remnashopValidatedRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({ parsePaymentInit: mocks.parsePaymentInit }));
vi.mock("@/backend/integrations/payments/payment-idempotency-service", () => ({
  beginPaymentOperation: mocks.beginPaymentOperation,
  bindPaymentOperationUpstreamOwner: mocks.bindPaymentOperationUpstreamOwner,
  completePaymentOperationSuccess: mocks.completePaymentOperationSuccess,
  markPaymentOperationDispatched: mocks.markPaymentOperationDispatched,
  paymentOperationDispatchFailureOutcome: mocks.paymentOperationDispatchFailureOutcome,
  paymentOperationErrorFromSnapshot: mocks.paymentOperationErrorFromSnapshot,
  settlePaymentOperationAfterDispatchFailure: mocks.settlePaymentOperationAfterDispatchFailure,
  settlePaymentOperationBeforeDispatchFailure: mocks.settlePaymentOperationBeforeDispatchFailure,
}));
vi.mock("@/backend/payments/return-url", () => ({
  paymentReturnUrl: mocks.paymentReturnUrl,
  assertPaymentReturnUrl: mocks.assertPaymentReturnUrl,
}));
vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
  logTechnicalError: mocks.logTechnicalError,
}));

import { createProductionPaymentWorkflowGateway } from "@/backend/integrations/payments/payment-workflow-gateway";

const productionPaymentWorkflowGateway = createProductionPaymentWorkflowGateway();

const productionPaymentCommands = {
  purchase: (request: PurchaseRequest, idempotencyKey: string) => executePaymentWorkflow(
    productionPaymentWorkflowGateway,
    { kind: "PURCHASE" as const, request },
    idempotencyKey,
  ),
  extend: (request: ExtendRequest, idempotencyKey: string) => executePaymentWorkflow(
    productionPaymentWorkflowGateway,
    { kind: "EXTEND" as const, request },
    idempotencyKey,
  ),
};

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
  plan_code: "basic",
  duration_days: 30,
  gateway_type: "YOOKASSA",
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
  return_url: "https://app.example/payment/pending?operation_id=operation-1",
};

describe("production payment adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({
      userId: "user-1",
      user: { email: "u@example.com", telegramId: null, emailVerified: true },
    });
    mocks.beginPaymentOperation
      .mockResolvedValueOnce({ state: "missing" })
      .mockResolvedValueOnce({ state: "execute", operationId: "operation-1", claimToken: "claim-1", upstreamKey: "upstream-key" });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token", session: { userId: "user-1" } });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-user-1");
    mocks.remnashopRequest
      .mockResolvedValueOnce({ gateways: [], plans: [plan], has_current_subscription: false, current_subscription_status: null })
      .mockResolvedValueOnce(payment);
    mocks.parsePaymentInit.mockReturnValue(payment);
    mocks.paymentReturnUrl.mockReturnValue(payment.return_url);
    mocks.completePaymentOperationSuccess.mockResolvedValue(payment);
    mocks.paymentOperationDispatchFailureOutcome.mockReturnValue("UNKNOWN");
    mocks.auditLog.mockResolvedValue(undefined);
  });

  it("wires the provider, persistence, security and audit adapters", async () => {
    await expect(productionPaymentCommands.purchase(request, "key-1"))
      .resolves.toEqual({ status: "completed", operationId: "operation-1", payment });

    expect(mocks.assertEmailVerificationPolicy).not.toHaveBeenCalled();
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "subscription_purchase",
      email: "u@example.com",
    }));
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(2, "/subscription/purchase", expect.objectContaining({
      method: "POST",
      accessToken: "access-token",
      idempotencyKey: "upstream-key",
      body: expect.objectContaining({ plan_code: "basic", return_url: payment.return_url }),
    }));
    expect(mocks.assertPaymentReturnUrl).toHaveBeenCalledWith(payment.return_url, payment.return_url);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "subscription_purchase_created",
      userId: "user-1",
    }));
  });

  it("fails closed before any payment operation without a session", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);

    await expect(productionPaymentCommands.extend({
      duration_days: 30,
      gateway_type: "YOOKASSA",
      ...confirmedPaymentOffer(plan, 30, price),
    }, "key-2")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(mocks.beginPaymentOperation).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).not.toHaveBeenCalled();
  });

  it("keeps a persisted payment successful when the audit adapter throws", async () => {
    const auditError = new Error("audit unavailable");
    mocks.auditLog.mockRejectedValueOnce(auditError);

    await expect(productionPaymentCommands.purchase(request, "key-3"))
      .resolves.toEqual({ status: "completed", operationId: "operation-1", payment });
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "payment_operation_audit_failed",
      auditError,
      { operationId: "operation-1", kind: "PURCHASE" },
    );
    expect(mocks.settlePaymentOperationAfterDispatchFailure).not.toHaveBeenCalled();
  });

  it("translates provider-shaped failures and keeps settlement logging technical", async () => {
    const upstreamError = { code: "RATE_LIMITED", status: 429, message: "slow down" };

    await productionPaymentWorkflowGateway.settleBeforeDispatch({
      operationId: "operation-1",
      claimToken: "claim-1",
      error: upstreamError,
      final: false,
    });
    expect(mocks.settlePaymentOperationBeforeDispatchFailure).toHaveBeenCalledWith({
      operationId: "operation-1",
      claimToken: "claim-1",
      final: false,
      error: expect.objectContaining({ code: "RATE_LIMITED", status: 429 }),
    });

    expect(productionPaymentWorkflowGateway.errorFromSnapshot({
      code: "UNRECOGNIZED_PROVIDER_CODE",
      status: 502,
      message: "provider response",
    })).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });

    const settlementError = new Error("settlement unavailable");
    productionPaymentWorkflowGateway.logSettlementFailure(settlementError, {
      operationId: "operation-1",
      kind: "PURCHASE",
    });
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "payment_operation_settlement_failed",
      settlementError,
      { operationId: "operation-1", kind: "PURCHASE" },
    );
  });
});
