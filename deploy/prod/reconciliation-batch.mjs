const PAYMENT_COUNT_FIELDS = [
  "claimed",
  "succeeded",
  "inProgress",
  "unknown",
  "manualRequired",
  "retryReady",
  "failed",
];
const HISTORY_COUNT_FIELDS = ["attempted", "applied", "completed", "failed"];

function objectValue(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Payment reconciliation response ${field} must be an object`);
  }

  return value;
}

function countValue(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Payment reconciliation response ${field} must be a non-negative safe integer`,
    );
  }

  return value;
}

export function parseReconciliationBatch(value) {
  const envelope = objectValue(value, "envelope");
  const data = objectValue(envelope.data, "data");
  const history = objectValue(data.history, "data.history");
  const parsed = {};

  for (const field of PAYMENT_COUNT_FIELDS) {
    parsed[field] = countValue(data[field], `data.${field}`);
  }

  parsed.history = {};

  for (const field of HISTORY_COUNT_FIELDS) {
    parsed.history[field] = countValue(
      history[field],
      `data.history.${field}`,
    );
  }

  if (
    !Array.isArray(data.manualRequiredOperationIds) ||
    data.manualRequiredOperationIds.length > 100 ||
    data.manualRequiredOperationIds.some(
      (operationId) =>
        typeof operationId !== "string" ||
        operationId.length < 1 ||
        operationId.length > 191,
    )
  ) {
    throw new Error(
      "Payment reconciliation response data.manualRequiredOperationIds is invalid",
    );
  }

  parsed.manualRequiredOperationIds = [...data.manualRequiredOperationIds];

  if (
    parsed.manualRequiredOperationIds.length !== parsed.manualRequired ||
    parsed.succeeded +
      parsed.inProgress +
      parsed.unknown +
      parsed.manualRequired +
      parsed.retryReady +
      parsed.failed !==
      parsed.claimed ||
    parsed.history.completed + parsed.history.failed > parsed.history.attempted
  ) {
    throw new Error("Payment reconciliation response counters are inconsistent");
  }

  return parsed;
}
