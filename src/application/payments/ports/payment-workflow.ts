import type { PaymentExecution } from "@/application/payments/ports/checkout";
import type { ExtendRequest, PaymentInitResponse, PurchaseRequest } from "@/shared/domain/payments";
import type { PlanOffer, SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export type PaymentOperationRequest =
  | { kind: "PURCHASE"; payload: PurchaseRequest }
  | { kind: "EXTEND"; payload: ExtendRequest };

export type PaymentOperationErrorSnapshot = {
  code: string;
  status: number;
  message: string;
};

export type PaymentOperationBeginResult =
  | { state: "missing" }
  | { state: "execute"; operationId: string; claimToken: string; upstreamKey: string }
  | { state: "replay"; outcome: "success"; operationId: string; responseStatus: number; response: PaymentInitResponse }
  | { state: "replay"; outcome: "failure"; operationId: string; responseStatus: number; error: PaymentOperationErrorSnapshot }
  | { state: "pending"; operationId: string; reason: "IN_PROGRESS" | "OUTCOME_UNKNOWN"; retryAfterSeconds?: number }
  | { state: "manual_required"; operationId: string };

export type PaymentAuthorization = {
  /** Opaque provider session. Only the outer adapter may inspect it. */
  context: unknown;
  localUserId: string;
  upstreamAccountId: string;
};

export type PaymentWorkflowInput =
  | { kind: "PURCHASE"; request: PurchaseRequest }
  | { kind: "EXTEND"; request: ExtendRequest };

export interface PaymentWorkflowGateway {
  loadActor(): Promise<{ userId: string; email: string | null; telegramId: string | number | bigint | null }>;
  rateLimit(input: { kind: PaymentWorkflowInput["kind"]; email: string; telegramId: string | number | bigint | null }): Promise<void>;
  beginOperation(input: {
    userId: string;
    idempotencyKey: string;
    operation: PaymentOperationRequest;
    createIfMissing: boolean;
    expectedUpstreamAccountId?: string;
  }): Promise<PaymentOperationBeginResult>;
  authorize(): Promise<PaymentAuthorization>;
  bindUpstreamOwner(input: { operationId: string; claimToken: string; upstreamAccountId: string }): Promise<void>;
  loadOffers(authorization: PaymentAuthorization): Promise<SubscriptionOffersResponse>;
  dispatch(input: {
    authorization: PaymentAuthorization;
    operationId: string;
    upstreamKey: string;
    operation: PaymentWorkflowInput;
  }): Promise<PaymentInitResponse>;
  markDispatched(input: { operationId: string; claimToken: string }): Promise<void>;
  completeSuccess(input: {
    operationId: string;
    claimToken: string;
    userId: string;
    gatewayType: string;
    durationDays: number;
    plan: PlanOffer;
    payment: PaymentInitResponse;
  }): Promise<PaymentInitResponse>;
  auditSuccess(input: { kind: PaymentWorkflowInput["kind"]; userId: string; operationId: string; gatewayType: string; durationDays: number }): Promise<void>;
  settleBeforeDispatch(input: { operationId: string; claimToken: string; error: unknown; final: boolean }): Promise<void>;
  dispatchFailureOutcome(error: unknown): "FINAL" | "RETRYABLE" | "UNKNOWN";
  settleAfterDispatch(input: { operationId: string; claimToken: string; error: unknown; outcome: "FINAL" | "RETRYABLE" | "UNKNOWN" }): Promise<void>;
  errorFromSnapshot(snapshot: PaymentOperationErrorSnapshot): Error;
  logAuditFailure(error: unknown, input: { operationId: string; kind: PaymentWorkflowInput["kind"] }): void;
  logSettlementFailure(error: unknown, input: { operationId: string; kind: PaymentWorkflowInput["kind"] }): void;
}

export type PaymentWorkflow = (input: PaymentWorkflowInput, idempotencyKey: string) => Promise<PaymentExecution>;
