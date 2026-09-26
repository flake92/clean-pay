import { createHmac } from "node:crypto";

const HANDLE_CONTEXT = "clean-pay:manual-payment-operation:v1";

/**
 * Produces a stable, non-reversible review handle for ordinary worker logs.
 * Exact operation IDs remain available only through the authenticated
 * reconciliation API/operator workflow.
 */
export function reconciliationSupportHandle(operationId, secret) {
  if (typeof operationId !== "string" || !operationId) {
    throw new Error("operationId must be a non-empty string");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("support-handle secret must contain at least 32 characters");
  }

  return createHmac("sha256", secret)
    .update(HANDLE_CONTEXT)
    .update("\0")
    .update(operationId)
    .digest("hex")
    .slice(0, 16);
}

export function reconciliationSupportHandles(operationIds, secret) {
  return operationIds.map((operationId) =>
    reconciliationSupportHandle(operationId, secret)
  );
}
