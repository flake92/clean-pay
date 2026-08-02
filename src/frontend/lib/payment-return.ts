import { BffClientError } from "@/frontend/lib/client-api";

type PaymentReturnSnapshot = {
  payment?: { status?: string } | null;
  operation?: { status?: string; retry_after_seconds?: number | null } | null;
};

export type PaymentReturnOutcome = "checking" | "success" | "failed" | "pending" | "unknown";

export function paymentReturnOutcome(snapshot: PaymentReturnSnapshot | null): PaymentReturnOutcome {
  if (!snapshot) return "checking";

  const operationStatus = snapshot.operation?.status;
  const paymentStatus = snapshot.payment?.status;

  if (paymentStatus === "completed") return "success";
  if (
    operationStatus === "failed"
    || paymentStatus === "failed"
    || paymentStatus === "canceled"
    || paymentStatus === "refunded"
  ) return "failed";
  if (operationStatus === "manual_required" || operationStatus === "outcome_unknown") return "unknown";
  if (
    operationStatus === "processing"
    || operationStatus === "retry_ready"
    || paymentStatus === "pending"
  ) return "pending";

  if (operationStatus === "succeeded") return "success";

  return "unknown";
}

export function shouldPollPaymentReturn(snapshot: PaymentReturnSnapshot | null) {
  if (!snapshot) return false;

  const operationStatus = snapshot.operation?.status;

  if (
    operationStatus === "failed"
    || operationStatus === "manual_required"
    || operationStatus === "retry_ready"
  ) {
    return false;
  }

  return operationStatus === "processing"
    || operationStatus === "outcome_unknown"
    || snapshot.payment?.status === "pending";
}

export function shouldRetryPaymentReturnError(error: unknown) {
  if (!(error instanceof BffClientError)) {
    return error instanceof TypeError;
  }

  return error.status === 408
    || error.status === 429
    || error.status >= 500;
}

export function paymentPollDelayMs(attempt: number, retryAfterSeconds?: number | null) {
  const serverDelay = typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
    ? retryAfterSeconds * 1_000
    : 0;
  const exponentialDelay = Math.min(30_000, 2_000 * (2 ** Math.min(attempt, 4)));

  return Math.max(serverDelay, exponentialDelay);
}
