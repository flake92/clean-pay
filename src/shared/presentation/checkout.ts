import type { ExtendRequest, PaymentInitResponse, PurchaseRequest, SubscriptionOffersResponse } from "@/shared/remnashop/types";

export type CheckoutViewModel =
  | { status: "ready"; offers: SubscriptionOffersResponse }
  | { status: "account-action-required"; action: "login" | "linkEmail" | "verifyEmail"; message: string }
  | { status: "error"; message: string };

export type PaymentCommand =
  | { kind: "purchase"; request: PurchaseRequest; idempotencyKey: string }
  | { kind: "extend"; request: ExtendRequest; idempotencyKey: string };

export type PaymentCommandResult =
  | { ok: true; status: "completed"; payment: PaymentInitResponse; operationId: string }
  | { ok: true; status: "pending"; operationId: string; retryAfterSeconds: number }
  | { ok: true; status: "manual-review"; operationId: string }
  | { ok: false; code: string; message: string; retainIdempotencyKey: boolean };
