import type { ExtendRequest, PaymentInitResponse, PurchaseRequest } from "@/shared/domain/payments";
import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export type PaymentExecution =
  | { status: "completed"; payment: PaymentInitResponse; operationId: string }
  | { status: "pending"; operationId: string; retryAfterSeconds: number }
  | { status: "manual-review"; operationId: string };

export interface CheckoutReader {
  loadAccount(): Promise<{ authenticated: boolean; emailVerified: boolean; accountSyncPending: boolean }>;
  loadOffers(): Promise<SubscriptionOffersResponse>;
}

export interface PaymentCommands {
  purchase(request: PurchaseRequest, idempotencyKey: string): Promise<PaymentExecution>;
  extend(request: ExtendRequest, idempotencyKey: string): Promise<PaymentExecution>;
}
