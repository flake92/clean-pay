import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  remnashopRequest: vi.fn(),
  parsePaymentInit: vi.fn(),
  assertRateLimit: vi.fn(),
  auditLog: vi.fn(),
  logTechnicalError: vi.fn(),
  beginPaymentOperation: vi.fn(),
  bindPaymentOperationUpstreamOwner: vi.fn(),
  completePaymentOperationSuccess: vi.fn(),
  markPaymentOperationDispatched: vi.fn(),
  paymentOperationDispatchFailureOutcome: vi.fn(),
  paymentOperationErrorFromSnapshot: vi.fn(),
  settlePaymentOperationAfterDispatchFailure: vi.fn(),
  settlePaymentOperationBeforeDispatchFailure: vi.fn(),
  assertPaymentReturnUrl: vi.fn(),
  paymentReturnUrl: vi.fn(),
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
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
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
  logTechnicalError: mocks.logTechnicalError,
}));
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
  assertPaymentReturnUrl: mocks.assertPaymentReturnUrl,
  paymentReturnUrl: mocks.paymentReturnUrl,
}));

import { ServiceError } from "@/backend/errors/service-error";
import { createProductionPaymentWorkflowGateway } from "@/backend/integrations/payments/payment-workflow-gateway";

const gateway = createProductionPaymentWorkflowGateway();

const authorization = {
  context: { accessToken: "access-token", localUserId: "user-1", upstreamAccountId: "upstream-1" },
  localUserId: "user-1",
  upstreamAccountId: "upstream-1",
};

describe("productionPaymentWorkflowGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paymentReturnUrl.mockImplementation((id: string) => `https://pay.test/payment/${id}`);
  });

  it("loads the local actor and preserves an anonymous session", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null).mockResolvedValueOnce({
      userId: "user-1",
      user: { email: "u@example.com", emailVerified: true, telegramId: "777" },
    });

    await expect(gateway.loadActor()).resolves.toBeNull();
    await expect(gateway.loadActor()).resolves.toEqual({
      userId: "user-1", email: "u@example.com", emailVerified: true, telegramId: "777",
    });
  });

  it("applies distinct purchase and extension rate-limit actions", async () => {
    await gateway.rateLimit({ kind: "PURCHASE", email: "u@example.com", telegramId: "777" });
    await gateway.rateLimit({ kind: "EXTEND", email: "", telegramId: null });

    expect(mocks.assertRateLimit).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: "subscription_purchase" }));
    expect(mocks.assertRateLimit).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "subscription_extend" }));
  });

  it("authorizes and loads offers with the provider access token", async () => {
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token", session: { userId: "user-1" } });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-1");
    const offers = { gateways: [], plans: [], has_current_subscription: false, current_subscription_status: null };
    mocks.remnashopRequest.mockResolvedValueOnce(offers);

    await expect(gateway.authorize()).resolves.toEqual(authorization);
    await expect(gateway.loadOffers(authorization)).resolves.toBe(offers);
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/offers", { accessToken: "access-token" });
  });

  it.each([
    ["PURCHASE" as const, "/subscription/purchase", { plan_code: "pro", duration_days: 30, gateway_type: "CARD", return_url: "https://pay.test/payment/op-1" }],
    ["EXTEND" as const, "/subscription/extend", { duration_days: 30, gateway_type: "CARD", return_url: "https://pay.test/payment/op-1" }],
  ])("dispatches %s with a bound return URL", async (kind, endpoint, body) => {
    const providerResponse = { raw: true };
    const payment = { payment_id: "payment-1", return_url: "https://pay.test/payment/op-1" };
    mocks.remnashopRequest.mockResolvedValue(providerResponse);
    mocks.parsePaymentInit.mockReturnValue(payment);
    const commonRequest = {
      duration_days: 30, gateway_type: "CARD", confirmed_amount: "100",
      confirmed_currency: "RUB", offer_version: "v1",
    };
    const operation = kind === "PURCHASE"
      ? { kind, request: { ...commonRequest, plan_code: "pro" } }
      : { kind, request: commonRequest };

    await expect(gateway.dispatch({
      authorization,
      operationId: "op-1",
      upstreamKey: "upstream-key",
      operation,
    })).resolves.toBe(payment);
    expect(mocks.remnashopRequest).toHaveBeenCalledWith(endpoint, {
      method: "POST", accessToken: "access-token", idempotencyKey: "upstream-key", body,
    });
    expect(mocks.parsePaymentInit).toHaveBeenCalledWith(providerResponse, endpoint);
    expect(mocks.assertPaymentReturnUrl).toHaveBeenCalledWith(body.return_url, payment.return_url);
  });

  it("completes and audits purchase and extension operations", async () => {
    const payment = {
      payment_id: "payment-1", payment_url: "https://provider.test/pay", purchase_type: "NEW",
      status: "PENDING", is_free: false, final_amount: "100", currency: "RUB",
    };
    const plan = {
      id: 1, public_code: "pro", name: "Pro", description: null, traffic_limit: 0,
      device_limit: 5, type: "STANDARD", recommended_purchase_type: "NEW", durations: [],
    };
    mocks.completePaymentOperationSuccess.mockResolvedValue("completed");
    await expect(gateway.completeSuccess({
      operationId: "op-1", claimToken: "claim", userId: "user-1", gatewayType: "CARD",
      durationDays: 30, plan, payment,
    })).resolves.toBe("completed");
    expect(mocks.completePaymentOperationSuccess).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "op-1",
      payment: expect.objectContaining({ userId: "user-1", payment }),
    }));

    await gateway.auditSuccess({ kind: "PURCHASE", userId: "user-1", operationId: "op-1", gatewayType: "CARD", durationDays: 30 });
    await gateway.auditSuccess({ kind: "EXTEND", userId: "user-1", operationId: "op-2", gatewayType: "CARD", durationDays: 60 });
    expect(mocks.auditLog).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: "subscription_purchase_created" }));
    expect(mocks.auditLog).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "subscription_extend_created" }));
  });

  it("normalizes provider-shaped failures before settlement", async () => {
    const shaped = { code: "UPSTREAM_UNAVAILABLE", status: 503, message: "temporary" };
    await gateway.settleBeforeDispatch({ operationId: "op-1", claimToken: "claim", error: shaped, final: true });
    await gateway.settleAfterDispatch({ operationId: "op-2", claimToken: "claim", error: shaped, outcome: "RETRYABLE" });

    expect(mocks.settlePaymentOperationBeforeDispatchFailure).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(ServiceError),
    }));
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(ServiceError),
    }));

    const existing = new ServiceError("RATE_LIMITED", 429);
    await gateway.settleBeforeDispatch({ operationId: "op-3", claimToken: "claim", error: existing, final: false });
    expect(mocks.settlePaymentOperationBeforeDispatchFailure).toHaveBeenLastCalledWith(expect.objectContaining({ error: existing }));
  });

  it("restores only recognized error snapshots and logs technical failures", () => {
    const restored = new ServiceError("RATE_LIMITED", 429);
    mocks.paymentOperationErrorFromSnapshot.mockReturnValue(restored);
    expect(gateway.errorFromSnapshot({ code: "RATE_LIMITED", status: 429, message: "limited" })).toBe(restored);
    expect(gateway.errorFromSnapshot({ code: "UNKNOWN", status: 500, message: "unknown" })).toMatchObject({ code: "INTERNAL_ERROR" });

    const failure = new Error("audit");
    gateway.logAuditFailure(failure, { operationId: "op-1", kind: "PURCHASE" });
    gateway.logSettlementFailure(failure, { operationId: "op-2", kind: "EXTEND" });
    expect(mocks.logTechnicalError).toHaveBeenNthCalledWith(1, "payment_operation_audit_failed", failure, { operationId: "op-1", kind: "PURCHASE" });
    expect(mocks.logTechnicalError).toHaveBeenNthCalledWith(2, "payment_operation_settlement_failed", failure, { operationId: "op-2", kind: "EXTEND" });
  });
});
