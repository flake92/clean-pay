import { Prisma } from "@prisma/client";

import { ServiceError, type ServiceErrorCode } from "@/backend/errors/service-error";
import type {
  ExtendRequest,
  PaymentInitResponse,
  PurchaseRequest,
} from "@/backend/integrations/remnashop/contracts";
import { sha256 } from "@/backend/security/crypto";

const PAYMENT_OPERATION_CONTRACT_VERSION = 2;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PaymentOperationRequest =
  | {
      kind: "PURCHASE";
      payload: Pick<
        PurchaseRequest,
        | "plan_code"
        | "duration_days"
        | "gateway_type"
        | "confirmed_amount"
        | "confirmed_currency"
        | "offer_version"
      >;
    }
  | {
      kind: "EXTEND";
      payload: Pick<
        ExtendRequest,
        | "duration_days"
        | "gateway_type"
        | "confirmed_amount"
        | "confirmed_currency"
        | "offer_version"
      >;
    };

export type PaymentOperationErrorSnapshot = {
  code: ServiceErrorCode;
  status: number;
  message: string;
};

export type PaymentOperationDispatchFailureOutcome =
  | "FINAL"
  | "RETRYABLE"
  | "UNKNOWN";

export type PaymentOperationBeginResult =
  | { state: "missing" }
  | {
      state: "execute";
      operationId: string;
      claimToken: string;
      upstreamKey: string;
    }
  | {
      state: "replay";
      outcome: "success";
      operationId: string;
      responseStatus: number;
      response: PaymentInitResponse;
    }
  | {
      state: "replay";
      outcome: "failure";
      operationId: string;
      responseStatus: number;
      error: PaymentOperationErrorSnapshot;
    }
  | {
      state: "pending";
      operationId: string;
      reason: "IN_PROGRESS" | "OUTCOME_UNKNOWN";
      retryAfterSeconds?: number;
    }
  | { state: "manual_required"; operationId: string };

type NormalizedOperation = {
  kind: "PURCHASE" | "EXTEND";
  payload: Prisma.InputJsonObject;
  fingerprint: string;
};

export type OperationIdentity = NormalizedOperation & {
  idempotencyKeyHash: string;
};

function paymentHash(value: string, purpose: string) {
  return sha256(`clean-pay:payment-operation:${purpose}:v1:${value}`);
}

function normalizeIdempotencyKey(value: string | null) {
  if (value === null || value.trim() === "") {
    throw new ServiceError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "Idempotency-Key header is required",
    );
  }
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new ServiceError(
      "IDEMPOTENCY_KEY_INVALID",
      400,
      "Idempotency-Key must be a UUID",
    );
  }
  return normalized;
}

export function normalizedString(value: unknown, field: string, maxLength: number) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      `${field} must be a non-empty string up to ${maxLength} characters`,
    );
  }
  return value;
}

function normalizedDuration(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "duration_days must be a non-negative integer",
    );
  }
  return Number(value);
}

function normalizeOperation(
  operation: PaymentOperationRequest,
): NormalizedOperation {
  const durationDays = normalizedDuration(operation.payload.duration_days);
  const gatewayType = normalizedString(
    operation.payload.gateway_type,
    "gateway_type",
    100,
  );
  const confirmedAmount = normalizedString(
    operation.payload.confirmed_amount,
    "confirmed_amount",
    64,
  );
  const confirmedCurrency = normalizedString(
    operation.payload.confirmed_currency,
    "confirmed_currency",
    12,
  );
  const offerVersion = normalizedString(
    operation.payload.offer_version,
    "offer_version",
    2_048,
  );

  if (operation.kind === "PURCHASE") {
    const payload: Prisma.InputJsonObject = {
      plan_code: normalizedString(operation.payload.plan_code, "plan_code", 200),
      duration_days: durationDays,
      gateway_type: gatewayType,
      confirmed_amount: confirmedAmount,
      confirmed_currency: confirmedCurrency,
      offer_version: offerVersion,
    };
    return {
      kind: operation.kind,
      payload,
      fingerprint: sha256(JSON.stringify([
        "clean-pay.payment-operation",
        PAYMENT_OPERATION_CONTRACT_VERSION,
        operation.kind,
        payload.plan_code,
        payload.duration_days,
        payload.gateway_type,
        payload.confirmed_amount,
        payload.confirmed_currency,
        payload.offer_version,
      ])),
    };
  }

  const payload: Prisma.InputJsonObject = {
    duration_days: durationDays,
    gateway_type: gatewayType,
    confirmed_amount: confirmedAmount,
    confirmed_currency: confirmedCurrency,
    offer_version: offerVersion,
  };
  return {
    kind: operation.kind,
    payload,
    fingerprint: sha256(JSON.stringify([
      "clean-pay.payment-operation",
      PAYMENT_OPERATION_CONTRACT_VERSION,
      operation.kind,
      payload.duration_days,
      payload.gateway_type,
      payload.confirmed_amount,
      payload.confirmed_currency,
      payload.offer_version,
    ])),
  };
}

export function operationIdentity(input: {
  idempotencyKey: string | null;
  operation: PaymentOperationRequest;
}): OperationIdentity {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  return {
    ...normalizeOperation(input.operation),
    idempotencyKeyHash: paymentHash(idempotencyKey, "client-key"),
  };
}
