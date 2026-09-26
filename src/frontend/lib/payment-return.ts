type PaymentReturnSnapshot = {
  payment?: { status?: string } | null;
  operation?: { status?: string; retry_after_seconds?: number | null } | null;
};

export type PaymentReturnOutcome = "checking" | "success" | "failed" | "pending" | "unknown";

// Covers roughly 4.5 minutes with the default backoff. After that the user can
// still request an explicit refresh without keeping a forgotten tab polling
// the server indefinitely.
export const PAYMENT_RETURN_MAX_AUTO_POLL_ATTEMPTS = 12;

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

export function paymentPollDelayMs(attempt: number, retryAfterSeconds?: number | null) {
  const serverDelay = typeof retryAfterSeconds === "number"
    && Number.isFinite(retryAfterSeconds)
    && retryAfterSeconds > 0
    ? Math.min(30_000, retryAfterSeconds * 1_000)
    : 0;
  const exponentialDelay = Math.min(30_000, 2_000 * (2 ** Math.min(attempt, 4)));

  return Math.max(serverDelay, exponentialDelay);
}

export function canAutoPollPaymentReturn(attempt: number) {
  return Number.isInteger(attempt)
    && attempt >= 0
    && attempt < PAYMENT_RETURN_MAX_AUTO_POLL_ATTEMPTS;
}
