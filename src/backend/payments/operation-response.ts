import { bffJson } from "@/backend/http/bff-response";
import type { PaymentInitResponse } from "@/shared/remnashop/types";

type PendingReason = "IN_PROGRESS" | "OUTCOME_UNKNOWN";

function operationHeaders(operationId: string, replayed: boolean) {
  return {
    "cache-control": "no-store",
    "idempotency-replayed": replayed ? "true" : "false",
    "x-payment-operation-id": operationId,
  };
}

export function paymentOperationSuccessResponse({
  operationId,
  payment,
  replayed,
}: {
  operationId: string;
  payment: PaymentInitResponse;
  replayed: boolean;
}) {
  return bffJson(payment, {
    headers: operationHeaders(operationId, replayed),
  });
}

export function paymentOperationPendingResponse({
  operationId,
  reason,
  retryAfterSeconds = 5,
}: {
  operationId: string;
  reason: PendingReason;
  retryAfterSeconds?: number;
}) {
  return bffJson(
    {
      operation_id: operationId,
      status: reason === "IN_PROGRESS" ? "processing" : "outcome_unknown",
      retry_after_seconds: retryAfterSeconds,
    },
    {
      status: 202,
      headers: {
        ...operationHeaders(operationId, true),
        "retry-after": String(retryAfterSeconds),
      },
    },
  );
}
