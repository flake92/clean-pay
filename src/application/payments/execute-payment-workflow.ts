import type { PaymentExecution } from "@/application/payments/ports/checkout";
import type {
  PaymentAuthorization,
  PaymentOperationBeginResult,
  PaymentWorkflowGateway,
  PaymentWorkflowInput,
} from "@/application/payments/ports/payment-workflow";
import { paymentOfferMatches } from "@/shared/domain/payment-offer";

class PaymentWorkflowError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
  }
}

const finalBeforeDispatchCodes = new Set([
  "OFFER_CHANGED",
  "PLAN_UNAVAILABLE",
  "PAYMENT_GATEWAY_UNAVAILABLE",
  "IDEMPOTENCY_KEY_REUSED",
]);

function workflowError(code: string, status: number, message: string) {
  return new PaymentWorkflowError(code, status, message);
}

function errorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : null;
}

function existingResult(gateway: PaymentWorkflowGateway, operation: PaymentOperationBeginResult): PaymentExecution | null {
  if (operation.state === "replay") {
    if (operation.outcome === "failure") throw gateway.errorFromSnapshot(operation.error);
    return { status: "completed", operationId: operation.operationId, payment: operation.response };
  }
  if (operation.state === "pending") {
    return { status: "pending", operationId: operation.operationId, retryAfterSeconds: operation.retryAfterSeconds ?? 5 };
  }
  if (operation.state === "manual_required") {
    return { status: "manual-review", operationId: operation.operationId };
  }
  return null;
}

function assertSameActor(actorId: string, authorization: PaymentAuthorization) {
  if (authorization.localUserId !== actorId) {
    throw workflowError("UNAUTHORIZED", 401, "Payment session changed during operation");
  }
}

export async function executePaymentWorkflow(
  gateway: PaymentWorkflowGateway,
  input: PaymentWorkflowInput,
  idempotencyKey: string,
): Promise<PaymentExecution> {
  const actor = await gateway.loadActor();
  const operationRequest = input.kind === "PURCHASE"
    ? { kind: "PURCHASE" as const, payload: input.request }
    : { kind: "EXTEND" as const, payload: input.request };
  const operationInput = { userId: actor.userId, idempotencyKey, operation: operationRequest };
  let operation = await gateway.beginOperation({ ...operationInput, createIfMissing: false });
  let authorization: PaymentAuthorization | null = null;

  if (operation.state === "missing") {
    await gateway.rateLimit({
      kind: input.kind,
      email: actor.email ?? `user:${actor.userId}`,
      telegramId: actor.telegramId,
    });
    authorization = await gateway.authorize();
    assertSameActor(actor.userId, authorization);
    operation = await gateway.beginOperation({
      ...operationInput,
      createIfMissing: true,
      expectedUpstreamAccountId: authorization.upstreamAccountId,
    });
  }

  if (operation.state === "missing") {
    throw workflowError("INTERNAL_ERROR", 500, "Payment operation was not created");
  }
  const result = existingResult(gateway, operation);
  if (result) return result;
  if (operation.state !== "execute") {
    throw workflowError("INTERNAL_ERROR", 500, "Unsupported payment operation state");
  }

  let dispatched = false;
  try {
    if (!authorization) {
      await gateway.rateLimit({
        kind: input.kind,
        email: actor.email ?? `user:${actor.userId}`,
        telegramId: actor.telegramId,
      });
      authorization = await gateway.authorize();
    }
    assertSameActor(actor.userId, authorization);
    await gateway.bindUpstreamOwner({
      operationId: operation.operationId,
      claimToken: operation.claimToken,
      upstreamAccountId: authorization.upstreamAccountId,
    });

    const offers = await gateway.loadOffers(authorization);
    const plan = input.kind === "PURCHASE"
      ? offers.plans.find((item) => item.public_code === input.request.plan_code)
      : offers.plans.find((item) => item.recommended_purchase_type.toLowerCase() === "renew");
    const duration = plan?.durations.find((item) => item.days === input.request.duration_days);
    const price = duration?.prices.find((item) => item.gateway_type === input.request.gateway_type);
    if (!plan || !duration) throw workflowError("PLAN_UNAVAILABLE", 400, "Selected plan or duration is unavailable");
    if (!price) throw workflowError("PAYMENT_GATEWAY_UNAVAILABLE", 400, "Selected gateway is unavailable");
    if (!paymentOfferMatches(input.request, plan, duration.days, price)) {
      throw workflowError("OFFER_CHANGED", 409, "Confirmed offer no longer matches current price");
    }

    await gateway.markDispatched({ operationId: operation.operationId, claimToken: operation.claimToken });
    dispatched = true;
    const payment = await gateway.dispatch({
      authorization,
      operationId: operation.operationId,
      upstreamKey: operation.upstreamKey,
      operation: input,
    });
    const persistedPayment = await gateway.completeSuccess({
      operationId: operation.operationId,
      claimToken: operation.claimToken,
      userId: actor.userId,
      gatewayType: input.request.gateway_type,
      durationDays: input.request.duration_days,
      plan,
      payment,
    });
    try {
      await gateway.auditSuccess({
        kind: input.kind,
        userId: actor.userId,
        operationId: operation.operationId,
        gatewayType: input.request.gateway_type,
        durationDays: input.request.duration_days,
      });
    } catch (auditError) {
      gateway.logAuditFailure(auditError, { operationId: operation.operationId, kind: input.kind });
    }
    return { status: "completed", operationId: operation.operationId, payment: persistedPayment };
  } catch (error) {
    if (!dispatched) {
      await gateway.settleBeforeDispatch({
        operationId: operation.operationId,
        claimToken: operation.claimToken,
        error,
        final: finalBeforeDispatchCodes.has(errorCode(error) ?? ""),
      });
      throw error;
    }
    const outcome = gateway.dispatchFailureOutcome(error);
    try {
      await gateway.settleAfterDispatch({
        operationId: operation.operationId,
        claimToken: operation.claimToken,
        error,
        outcome,
      });
    } catch (settlementError) {
      gateway.logSettlementFailure(settlementError, { operationId: operation.operationId, kind: input.kind });
      return { status: "pending", operationId: operation.operationId, retryAfterSeconds: 5 };
    }
    if (outcome !== "UNKNOWN") throw error;
    return { status: "pending", operationId: operation.operationId, retryAfterSeconds: 5 };
  }
}
