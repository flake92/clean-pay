import { auditLog, logTechnicalError } from "@/backend/observability/audit";
import { bffError } from "@/backend/http/bff-response";
import {
  beginPaymentOperation,
  bindPaymentOperationUpstreamOwner,
  completePaymentOperationSuccess,
  markPaymentOperationDispatched,
  paymentOperationDispatchFailureOutcome,
  paymentOperationErrorFromSnapshot,
  settlePaymentOperationAfterDispatchFailure,
  settlePaymentOperationBeforeDispatchFailure,
} from "@/backend/payments/idempotency";
import {
  paymentOperationManualRequiredResponse,
  paymentOperationPendingResponse,
  paymentOperationSuccessResponse,
} from "@/backend/payments/operation-response";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { getCurrentSession } from "@/backend/sessions/web-session";
import { assertPaymentReturnUrl, paymentReturnUrl } from "@/backend/payments/return-url";
import type {
  ExtendRequest,
  PaymentInitResponse,
  SubscriptionOffersResponse,
} from "@/shared/remnashop/types";

export const runtime = "nodejs";

function isFinalBeforeDispatch(error: unknown) {
  return (
    error instanceof BffError &&
    error.code !== "RATE_LIMITED" &&
    error.status >= 400 &&
    error.status < 500
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtendRequest;
    const paymentRequest: ExtendRequest = {
      duration_days: body.duration_days,
      gateway_type: body.gateway_type,
    };
    const currentSession = await getCurrentSession();

    if (!currentSession) {
      throw new BffError("UNAUTHORIZED", 401);
    }

    const operationInput = {
      userId: currentSession.userId,
      idempotencyKey: request.headers.get("idempotency-key"),
      operation: { kind: "EXTEND" as const, payload: paymentRequest },
    };
    let operation = await beginPaymentOperation({
      ...operationInput,
      createIfMissing: false,
    });
    let authorizedRemnashop: Awaited<
      ReturnType<typeof getAuthorizedRemnashopTokens>
    > | null = null;

    if (operation.state === "missing") {
      await assertRateLimit({
        action: "subscription_extend",
        email: currentSession.user.email ?? `user:${currentSession.userId}`,
        tgId: currentSession.user.telegramId,
        limit: 10,
        windowSeconds: 15 * 60,
      });
      authorizedRemnashop = await getAuthorizedRemnashopTokens();

      if (authorizedRemnashop.session.userId !== currentSession.userId) {
        throw new BffError(
          "UNAUTHORIZED",
          401,
          "Payment session changed during operation",
        );
      }

      operation = await beginPaymentOperation({
        ...operationInput,
        createIfMissing: true,
      });
    }

    if (operation.state === "missing") {
      throw new BffError(
        "INTERNAL_ERROR",
        500,
        "Payment operation was not created after the anti-abuse gate",
      );
    }

    if (operation.state === "replay") {
      if (operation.outcome === "failure") {
        throw paymentOperationErrorFromSnapshot(operation.error);
      }

      return paymentOperationSuccessResponse({
        operationId: operation.operationId,
        payment: operation.response,
        replayed: true,
      });
    }

    if (operation.state === "pending") {
      return paymentOperationPendingResponse({
        operationId: operation.operationId,
        reason: operation.reason,
        retryAfterSeconds: operation.retryAfterSeconds,
      });
    }

    if (operation.state === "manual_required") {
      return paymentOperationManualRequiredResponse({
        operationId: operation.operationId,
      });
    }

    let dispatched = false;

    try {
      if (!authorizedRemnashop) {
        await assertRateLimit({
          action: "subscription_extend",
          email: currentSession.user.email ?? `user:${currentSession.userId}`,
          tgId: currentSession.user.telegramId,
          limit: 10,
          windowSeconds: 15 * 60,
        });
        authorizedRemnashop = await getAuthorizedRemnashopTokens();
      }

      const { accessToken, session } = authorizedRemnashop;

      if (session.userId !== currentSession.userId) {
        throw new BffError("UNAUTHORIZED", 401, "Payment session changed during operation");
      }

      await bindPaymentOperationUpstreamOwner({
        operationId: operation.operationId,
        claimToken: operation.claimToken,
        upstreamAccountId: getRemnashopUserIdFromAccessToken(accessToken),
      });

      const offers = await remnashopRequest<SubscriptionOffersResponse>(
        "/subscription/offers",
        { accessToken },
      );
      const plan = offers.plans.find(
        (item) => item.recommended_purchase_type === "renew",
      );

      await markPaymentOperationDispatched({
        operationId: operation.operationId,
        claimToken: operation.claimToken,
      });
      dispatched = true;

      const payment = await remnashopRequest<PaymentInitResponse>(
        "/subscription/extend",
        {
          method: "POST",
          accessToken,
          idempotencyKey: operation.upstreamKey,
          body: {
            ...paymentRequest,
            return_url: paymentReturnUrl(operation.operationId),
          },
        },
      );
      assertPaymentReturnUrl(
        paymentReturnUrl(operation.operationId),
        payment.return_url,
      );
      const persistedPayment = await completePaymentOperationSuccess({
        operationId: operation.operationId,
        claimToken: operation.claimToken,
        payment: {
          userId: session.userId,
          gatewayType: paymentRequest.gateway_type,
          durationDays: paymentRequest.duration_days,
          plan,
          payment,
        },
      });

      await auditLog({
        action: "subscription_extend_created",
        userId: session.userId,
        metadata: {
          operationId: operation.operationId,
          gatewayType: paymentRequest.gateway_type,
          durationDays: paymentRequest.duration_days,
        },
      });

      return paymentOperationSuccessResponse({
        operationId: operation.operationId,
        payment: persistedPayment,
        replayed: false,
      });
    } catch (error) {
      if (!dispatched) {
        await settlePaymentOperationBeforeDispatchFailure({
          operationId: operation.operationId,
          claimToken: operation.claimToken,
          error,
          final: isFinalBeforeDispatch(error),
        });
        throw error;
      }

      const outcome = paymentOperationDispatchFailureOutcome(error);

      try {
        await settlePaymentOperationAfterDispatchFailure({
          operationId: operation.operationId,
          claimToken: operation.claimToken,
          error,
          outcome,
        });
      } catch (settlementError) {
        logTechnicalError("payment_operation_settlement_failed", settlementError, {
          operationId: operation.operationId,
          kind: "EXTEND",
        });

        return paymentOperationPendingResponse({
          operationId: operation.operationId,
          reason: "OUTCOME_UNKNOWN",
        });
      }

      if (outcome !== "UNKNOWN") {
        throw error;
      }

      return paymentOperationPendingResponse({
        operationId: operation.operationId,
        reason: "OUTCOME_UNKNOWN",
      });
    }
  } catch (error) {
    return bffError(error);
  }
}
