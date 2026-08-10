import { Prisma } from "@prisma/client";

import {
  ServiceError,
  isServiceErrorCode,
} from "@/backend/errors/service-error";
import type {
  PaymentOperationDispatchFailureOutcome,
  PaymentOperationErrorSnapshot,
} from "@/backend/integrations/payments/payment-operation-contract";
import type { PaymentInitResponse } from "@/backend/integrations/remnashop/contracts";
import { sha256 } from "@/backend/security/crypto";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePaymentResponse(value: Prisma.JsonValue | null) {
  if (!isObject(value)) {
    throw new ServiceError(
      "INTERNAL_ERROR",
      500,
      "Stored payment operation response is missing",
    );
  }
  const paymentUrl = value.payment_url;
  if (
    typeof value.payment_id !== "string" ||
    (paymentUrl !== null && typeof paymentUrl !== "string") ||
    typeof value.purchase_type !== "string" ||
    typeof value.status !== "string" ||
    typeof value.is_free !== "boolean" ||
    typeof value.final_amount !== "string" ||
    typeof value.currency !== "string"
  ) {
    throw new ServiceError(
      "INTERNAL_ERROR",
      500,
      "Stored payment operation response is invalid",
    );
  }
  return {
    payment_id: value.payment_id,
    payment_url: paymentUrl,
    purchase_type: value.purchase_type,
    status: value.status,
    is_free: value.is_free,
    final_amount: value.final_amount,
    currency: value.currency,
  } satisfies PaymentInitResponse;
}

export function parseErrorSnapshot(
  value: Prisma.JsonValue | null,
): PaymentOperationErrorSnapshot {
  if (
    !isObject(value) ||
    !isServiceErrorCode(value.code) ||
    typeof value.status !== "number" ||
    !Number.isInteger(value.status) ||
    typeof value.message !== "string"
  ) {
    throw new ServiceError(
      "INTERNAL_ERROR",
      500,
      "Stored payment operation error is invalid",
    );
  }
  return { code: value.code, status: value.status, message: value.message };
}

export function secondsUntil(date: Date, now: Date) {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1_000));
}

export function claimTokenHash(claimToken: string) {
  return sha256(`clean-pay:payment-operation:claim:v1:${claimToken}`);
}

export function paymentResponseSnapshot(
  response: PaymentInitResponse,
): Prisma.InputJsonObject {
  return {
    payment_id: response.payment_id,
    payment_url: response.payment_url,
    purchase_type: response.purchase_type,
    status: response.status,
    is_free: response.is_free,
    final_amount: response.final_amount,
    currency: response.currency,
  };
}

export function errorSnapshot(error: unknown): PaymentOperationErrorSnapshot {
  if (error instanceof ServiceError) {
    return { code: error.code, status: error.status, message: error.prodMessage };
  }
  return {
    code: "INTERNAL_ERROR",
    status: 500,
    message: "Internal payment operation error",
  };
}

export function errorSnapshotJson(
  snapshot: PaymentOperationErrorSnapshot,
): Prisma.InputJsonObject {
  return {
    code: snapshot.code,
    status: snapshot.status,
    message: snapshot.message,
  };
}

export function paymentOperationConflict(message: string) {
  return new ServiceError("CONFLICT", 409, message);
}

export function paymentOperationDispatchFailureOutcome(
  error: unknown,
): PaymentOperationDispatchFailureOutcome {
  if (!(error instanceof ServiceError)) return "UNKNOWN";
  if (typeof error.debug?.upstreamStatus !== "number") return "UNKNOWN";
  if (
    error.code === "PAYMENT_OPERATION_IN_PROGRESS" ||
    error.code === "PAYMENT_OUTCOME_UNKNOWN" ||
    error.code === "IDEMPOTENCY_KEY_REUSED"
  ) {
    return "UNKNOWN";
  }
  if (error.status === 429) return "RETRYABLE";
  if (error.status >= 400 && error.status < 500 && error.status !== 408) {
    return "FINAL";
  }
  return "UNKNOWN";
}

export function paymentOperationErrorFromSnapshot(
  snapshot: PaymentOperationErrorSnapshot,
) {
  return new ServiceError(snapshot.code, snapshot.status, snapshot.message);
}
