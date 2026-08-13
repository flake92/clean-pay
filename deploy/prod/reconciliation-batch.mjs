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
const BACKLOG_COUNT_FIELDS = [
  "pending",
  "due",
  "manualRequired",
  "oldestAgeSeconds",
  "maximumAttemptCount",
  "totalFailureCount",
];

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
  const data = objectValue(value, "data");
  const history = objectValue(data.history, "data.history");
  const backlog = objectValue(data.backlog, "data.backlog");
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

  parsed.backlog = {};
  for (const field of BACKLOG_COUNT_FIELDS) {
    parsed.backlog[field] = countValue(
      backlog[field],
      `data.backlog.${field}`,
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

export function classifyReconciliationBatchHealth(batch) {
  const attempted = batch.claimed + batch.history.attempted;
  const processedWithoutFailure =
    batch.claimed - batch.failed +
    batch.history.attempted - batch.history.failed;

  if (processedWithoutFailure > 0) {
    return { healthy: true, outcome: "progress" };
  }

  if (attempted > 0) {
    return { healthy: false, outcome: "failed" };
  }

  if (batch.backlog.due === 0) {
    return { healthy: true, outcome: "idle" };
  }

  return { healthy: false, outcome: "no_progress" };
}
