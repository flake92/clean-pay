import type { ExtendRequest, PurchaseRequest, SubscriptionOffersResponse } from "@/backend/integrations/remnashop/contracts";

import type { PaymentCommands, PaymentExecution } from "@/application/payments/ports/checkout";
import { getAuthorizedRemnashopTokens, getRemnashopUserIdFromAccessToken, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { parsePaymentInit } from "@/backend/integrations/remnashop/payment-recovery";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog, logTechnicalError } from "@/backend/observability/audit";
import {
  beginPaymentOperation,
  bindPaymentOperationUpstreamOwner,
  completePaymentOperationSuccess,
  markPaymentOperationDispatched,
  paymentOperationDispatchFailureOutcome,
  paymentOperationErrorFromSnapshot,
  settlePaymentOperationAfterDispatchFailure,
  settlePaymentOperationBeforeDispatchFailure,
} from "@/backend/integrations/payments/payment-idempotency-service";
import { assertPaymentReturnUrl, paymentReturnUrl } from "@/backend/payments/return-url";
import { assertEmailVerificationPolicy, getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import { paymentOfferMatches } from "@/shared/domain/payment-offer";

type OperationInput =
  | { kind: "PURCHASE"; request: PurchaseRequest }
  | { kind: "EXTEND"; request: ExtendRequest };

function isFinalBeforeDispatch(error: unknown) {
  return error instanceof ServiceError && ["OFFER_CHANGED", "PLAN_UNAVAILABLE", "PAYMENT_GATEWAY_UNAVAILABLE", "IDEMPOTENCY_KEY_REUSED"].includes(error.code);
}

async function execute(input: OperationInput, idempotencyKey: string): Promise<PaymentExecution> {
  const currentSession = await getCurrentSession();
  if (!currentSession) throw new ServiceError("UNAUTHORIZED", 401);
  assertEmailVerificationPolicy(currentSession.user, { requireVerifiedEmail: true });

  const operationPayload = input.kind === "PURCHASE"
    ? { kind: "PURCHASE" as const, payload: input.request }
    : { kind: "EXTEND" as const, payload: input.request };
  const operationInput = { userId: currentSession.userId, idempotencyKey, operation: operationPayload };
  let operation = await beginPaymentOperation({ ...operationInput, createIfMissing: false });
  let authorized: Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>> | null = null;

  if (operation.state === "missing") {
    await assertRateLimit({
      action: input.kind === "PURCHASE" ? "subscription_purchase" : "subscription_extend",
      email: currentSession.user.email ?? `user:${currentSession.userId}`,
      tgId: currentSession.user.telegramId,
      limit: 10,
      windowSeconds: 15 * 60,
    });
    authorized = await getAuthorizedRemnashopTokens();
    if (authorized.session.userId !== currentSession.userId) throw new ServiceError("UNAUTHORIZED", 401, "Payment session changed during operation");
    operation = await beginPaymentOperation({
      ...operationInput,
      createIfMissing: true,
      expectedUpstreamAccountId: getRemnashopUserIdFromAccessToken(authorized.accessToken),
    });
  }

  if (operation.state === "missing") throw new ServiceError("INTERNAL_ERROR", 500, "Payment operation was not created");
  if (operation.state === "replay") {
    if (operation.outcome === "failure") throw paymentOperationErrorFromSnapshot(operation.error);
    return { status: "completed", operationId: operation.operationId, payment: operation.response };
  }
  if (operation.state === "pending") return { status: "pending", operationId: operation.operationId, retryAfterSeconds: operation.retryAfterSeconds ?? 5 };
  if (operation.state === "manual_required") return { status: "manual-review", operationId: operation.operationId };

  let dispatched = false;
  try {
    if (!authorized) {
      await assertRateLimit({
        action: input.kind === "PURCHASE" ? "subscription_purchase" : "subscription_extend",
        email: currentSession.user.email ?? `user:${currentSession.userId}`,
        tgId: currentSession.user.telegramId,
        limit: 10,
        windowSeconds: 15 * 60,
      });
      authorized = await getAuthorizedRemnashopTokens();
    }
    const { accessToken, session } = authorized;
    if (session.userId !== currentSession.userId) throw new ServiceError("UNAUTHORIZED", 401, "Payment session changed during operation");
    await bindPaymentOperationUpstreamOwner({
      operationId: operation.operationId,
      claimToken: operation.claimToken,
      upstreamAccountId: getRemnashopUserIdFromAccessToken(accessToken),
    });

    const offers = await remnashopRequest<SubscriptionOffersResponse>("/subscription/offers", { accessToken });
    const plan = input.kind === "PURCHASE"
      ? offers.plans.find((item) => item.public_code === input.request.plan_code)
      : offers.plans.find((item) => item.recommended_purchase_type.toLowerCase() === "renew");
    const duration = plan?.durations.find((item) => item.days === input.request.duration_days);
    const price = duration?.prices.find((item) => item.gateway_type === input.request.gateway_type);
    if (!plan || !duration) throw new ServiceError("PLAN_UNAVAILABLE", 400, "Selected plan or duration is unavailable");
    if (!price) throw new ServiceError("PAYMENT_GATEWAY_UNAVAILABLE", 400, "Selected gateway is unavailable");
    if (!paymentOfferMatches(input.request, plan, duration.days, price)) throw new ServiceError("OFFER_CHANGED", 409, "Confirmed offer no longer matches current price");

    await markPaymentOperationDispatched({ operationId: operation.operationId, claimToken: operation.claimToken });
    dispatched = true;
    const endpoint = input.kind === "PURCHASE" ? "/subscription/purchase" : "/subscription/extend";
    const upstreamBody = input.kind === "PURCHASE"
      ? { plan_code: input.request.plan_code, duration_days: input.request.duration_days, gateway_type: input.request.gateway_type, return_url: paymentReturnUrl(operation.operationId) }
      : { duration_days: input.request.duration_days, gateway_type: input.request.gateway_type, return_url: paymentReturnUrl(operation.operationId) };
    const payment = parsePaymentInit(await remnashopRequest<unknown>(endpoint, {
      method: "POST",
      accessToken,
      idempotencyKey: operation.upstreamKey,
      body: upstreamBody,
    }), endpoint);
    assertPaymentReturnUrl(paymentReturnUrl(operation.operationId), payment.return_url);
    const persistedPayment = await completePaymentOperationSuccess({
      operationId: operation.operationId,
      claimToken: operation.claimToken,
      payment: { userId: session.userId, gatewayType: input.request.gateway_type, durationDays: input.request.duration_days, plan, payment },
    });
    await auditLog({
      action: input.kind === "PURCHASE" ? "subscription_purchase_created" : "subscription_extend_created",
      userId: session.userId,
      metadata: { operationId: operation.operationId, gatewayType: input.request.gateway_type, durationDays: input.request.duration_days },
    });
    return { status: "completed", operationId: operation.operationId, payment: persistedPayment };
  } catch (error) {
    if (!dispatched) {
      await settlePaymentOperationBeforeDispatchFailure({ operationId: operation.operationId, claimToken: operation.claimToken, error, final: isFinalBeforeDispatch(error) });
      throw error;
    }
    const outcome = paymentOperationDispatchFailureOutcome(error);
    try {
      await settlePaymentOperationAfterDispatchFailure({ operationId: operation.operationId, claimToken: operation.claimToken, error, outcome });
    } catch (settlementError) {
      logTechnicalError("payment_operation_settlement_failed", settlementError, { operationId: operation.operationId, kind: input.kind });
      return { status: "pending", operationId: operation.operationId, retryAfterSeconds: 5 };
    }
    if (outcome !== "UNKNOWN") throw error;
    return { status: "pending", operationId: operation.operationId, retryAfterSeconds: 5 };
  }
}

export const productionPaymentCommands: PaymentCommands = {
  purchase: (request, idempotencyKey) => execute({ kind: "PURCHASE", request }, idempotencyKey),
  extend: (request, idempotencyKey) => execute({ kind: "EXTEND", request }, idempotencyKey),
};
