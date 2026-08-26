import type {
  PaymentAuthorization,
  PaymentOperationErrorSnapshot,
  PaymentWorkflowGateway,
} from "@/application/payments/ports/payment-workflow";
import { ServiceError, isServiceErrorCode } from "@/backend/errors/service-error";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
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
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

type ProviderAuthorization = {
  accessToken: string;
  localUserId: string;
  upstreamAccountId: string;
};

function providerAuthorization(authorization: PaymentAuthorization) {
  return authorization.context as ProviderAuthorization;
}

function serviceError(error: unknown) {
  if (error instanceof ServiceError) return error;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  if (isServiceErrorCode(candidate?.code) && typeof candidate.status === "number") {
    return new ServiceError(
      candidate.code,
      candidate.status,
      typeof candidate.message === "string" ? candidate.message : undefined,
    );
  }
  return error;
}

type PaymentAuthorizer = typeof getAuthorizedRemnashopTokens;

export function createProductionPaymentWorkflowGateway(
  authorizeSession: PaymentAuthorizer = getAuthorizedRemnashopTokens,
): PaymentWorkflowGateway {
  return {
  async loadActor() {
    const session = await getCurrentSession();
    if (!session) return null;
    return {
      userId: session.userId,
      email: session.user.email ?? null,
      emailVerified: session.user.emailVerified,
      telegramId: session.user.telegramId,
    };
  },

  async rateLimit(input) {
    await assertRateLimit({
      action: input.kind === "PURCHASE" ? "subscription_purchase" : "subscription_extend",
      email: input.email,
      tgId: input.telegramId,
      limit: 10,
      windowSeconds: 15 * 60,
    });
  },

  beginOperation: beginPaymentOperation,

  async authorize() {
    const { accessToken, session } = await authorizeSession();
    const context: ProviderAuthorization = {
      accessToken,
      localUserId: session.userId,
      upstreamAccountId: getRemnashopUserIdFromAccessToken(accessToken),
    };
    return {
      context,
      localUserId: context.localUserId,
      upstreamAccountId: context.upstreamAccountId,
    };
  },

  bindUpstreamOwner: bindPaymentOperationUpstreamOwner,

  async loadOffers(authorization) {
    return remnashopRequest<SubscriptionOffersResponse>("/subscription/offers", {
      accessToken: providerAuthorization(authorization).accessToken,
    });
  },

  async dispatch({ authorization, operationId, upstreamKey, operation }) {
    const endpoint = operation.kind === "PURCHASE"
      ? "/subscription/purchase"
      : "/subscription/extend";
    const upstreamBody = operation.kind === "PURCHASE"
      ? {
          plan_code: operation.request.plan_code,
          duration_days: operation.request.duration_days,
          gateway_type: operation.request.gateway_type,
          return_url: paymentReturnUrl(operationId),
        }
      : {
          duration_days: operation.request.duration_days,
          gateway_type: operation.request.gateway_type,
          return_url: paymentReturnUrl(operationId),
        };
    const payment = parsePaymentInit(await remnashopRequest<unknown>(endpoint, {
      method: "POST",
      accessToken: providerAuthorization(authorization).accessToken,
      idempotencyKey: upstreamKey,
      body: upstreamBody,
    }), endpoint);
    assertPaymentReturnUrl(paymentReturnUrl(operationId), payment.return_url);
    return payment;
  },

  markDispatched: markPaymentOperationDispatched,

  async completeSuccess(input) {
    return completePaymentOperationSuccess({
      operationId: input.operationId,
      claimToken: input.claimToken,
      payment: {
        userId: input.userId,
        gatewayType: input.gatewayType,
        durationDays: input.durationDays,
        plan: input.plan,
        payment: input.payment,
      },
    });
  },

  async auditSuccess(input) {
    await auditLog({
      action: input.kind === "PURCHASE"
        ? "subscription_purchase_created"
        : "subscription_extend_created",
      userId: input.userId,
      metadata: {
        operationId: input.operationId,
        gatewayType: input.gatewayType,
        durationDays: input.durationDays,
      },
    });
  },

  async settleBeforeDispatch(input) {
    await settlePaymentOperationBeforeDispatchFailure({ ...input, error: serviceError(input.error) });
  },

  dispatchFailureOutcome: paymentOperationDispatchFailureOutcome,

  async settleAfterDispatch(input) {
    await settlePaymentOperationAfterDispatchFailure({ ...input, error: serviceError(input.error) });
  },

  errorFromSnapshot(snapshot: PaymentOperationErrorSnapshot) {
    if (!isServiceErrorCode(snapshot.code)) return new ServiceError("INTERNAL_ERROR", 500);
    return paymentOperationErrorFromSnapshot({ ...snapshot, code: snapshot.code });
  },

  logAuditFailure(error, input) {
    logTechnicalError("payment_operation_audit_failed", error, input);
  },

  logSettlementFailure(error, input) {
    logTechnicalError("payment_operation_settlement_failed", error, input);
  },
  };
}

export const productionPaymentWorkflowGateway = createProductionPaymentWorkflowGateway();
