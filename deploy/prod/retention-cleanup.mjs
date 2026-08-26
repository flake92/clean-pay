const RETENTION_BATCH_SIZE = 500;
const RETENTION_RETRY_BASE_MS = 5_000;
const RETENTION_RETRY_MAX_MS = 60_000;

function boundedDays(env, name, fallback, min, max) {
  const raw = env[name]?.trim();

  if (!raw) return fallback;

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}

export function retentionPolicy(env = process.env) {
  const policy = {
    authStateDays: boundedDays(env, "AUTH_STATE_RETENTION_DAYS", 7, 1, 30),
    sessionDays: boundedDays(env, "SESSION_RETENTION_DAYS", 90, 30, 365),
    auditInfoDays: boundedDays(env, "AUDIT_INFO_RETENTION_DAYS", 180, 30, 730),
    auditSecurityDays: boundedDays(env, "AUDIT_SECURITY_RETENTION_DAYS", 365, 90, 2_555),
    rateLimitDays: boundedDays(env, "RATE_LIMIT_RETENTION_DAYS", 30, 1, 180),
    paymentSensitiveDays: boundedDays(
      env,
      "PAYMENT_SENSITIVE_RETENTION_DAYS",
      30,
      7,
      365,
    ),
    paymentOperationSnapshotDays: boundedDays(
      env,
      "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
      90,
      30,
      730,
    ),
    paymentHoldDisposedDays: boundedDays(
      env,
      "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
      365,
      90,
      2_555,
    ),
  };

  if (policy.auditSecurityDays < policy.auditInfoDays) {
    throw new Error("AUDIT_SECURITY_RETENTION_DAYS must be at least AUDIT_INFO_RETENTION_DAYS");
  }

  return policy;
}

export function retentionRetryDelayMs(consecutiveFailures) {
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new Error("consecutiveFailures must be a positive integer");
  }

  const exponent = Math.min(consecutiveFailures - 1, 10);
  return Math.min(
    RETENTION_RETRY_MAX_MS,
    RETENTION_RETRY_BASE_MS * (2 ** exponent),
  );
}

export class RetentionProgressError extends Error {
  constructor(cause) {
    super("Retention cleanup progress reporting failed", { cause });
    this.name = "RetentionProgressError";
  }
}

class RetentionCleanupPhaseError extends Error {
  constructor(phase, cause) {
    super(`Retention cleanup phase failed: ${phase}`, { cause });
    this.name = "RetentionCleanupPhaseError";
    this.phase = phase;
  }
}

export class RetentionCleanupAggregateError extends AggregateError {
  constructor(errors) {
    const phases = errors.map(({ phase }) => phase);
    super(errors, `Retention cleanup phases failed: ${phases.join(", ")}`);
    this.name = "RetentionCleanupAggregateError";
    this.phases = Object.freeze(phases);
  }
}

function retentionProgressReporter(options) {
  const onProgress = options?.onProgress;
  if (onProgress === undefined) return async () => {};
  if (typeof onProgress !== "function") {
    throw new RetentionProgressError(
      new TypeError("retention cleanup onProgress must be a function"),
    );
  }
  return async (phase, stage, processed = 0) => {
    try {
      await onProgress(Object.freeze({ phase, stage, processed }));
    } catch (error) {
      if (error instanceof RetentionProgressError) throw error;
      throw new RetentionProgressError(error);
    }
  };
}

async function captureRetentionPhase(failures, phase, work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RetentionProgressError) throw error;
    failures.push(new RetentionCleanupPhaseError(phase, error));
    return null;
  }
}

function guardedMutationResult(rows, phase) {
  if (
    !Array.isArray(rows)
    || rows.length !== 1
    || !Number.isInteger(rows[0]?.selected)
    || rows[0].selected < 0
    || rows[0].selected > RETENTION_BATCH_SIZE
    || !Number.isInteger(rows[0]?.affected)
    || rows[0].affected < 0
    || rows[0].affected > rows[0].selected
    || typeof rows[0]?.backlog !== "boolean"
  ) {
    throw new Error(`Guarded retention phase ${phase} returned an invalid result`);
  }
  return rows[0];
}

async function deleteRetentionBatch(prisma, reportProgress, phase) {
  await reportProgress(phase, "selecting");
  const rows = await prisma.$queryRaw`
    SELECT selected, affected, backlog
      FROM "clean_pay_retention_delete_batch"(${phase}::text)
  `;
  const result = guardedMutationResult(rows, phase);
  await reportProgress(phase, "selected", result.selected);
  await reportProgress(phase, "mutated", result.affected);
  return { deleted: result.affected, backlog: result.backlog };
}

async function scrubTelegramCallbacks(prisma, reportProgress) {
  const phase = "telegramCallbackResults";
  await reportProgress(phase, "selecting");
  const rows = await prisma.$queryRaw`
    SELECT selected, affected, backlog
      FROM "clean_pay_retention_scrub_telegram_callbacks"()
  `;
  const result = guardedMutationResult(rows, phase);
  await reportProgress(phase, "selected", result.selected);
  await reportProgress(phase, "mutated", result.affected);
  return { scrubbed: result.affected, backlog: result.backlog };
}

async function scrubPaymentRecords(prisma, reportProgress) {
  await reportProgress("paymentRecords", "selecting");
  const rows = await prisma.$queryRaw`
    SELECT selected, affected, backlog
      FROM "clean_pay_retention_scrub_payment_records"()
  `;
  const result = guardedMutationResult(rows, "paymentRecords");
  await reportProgress("paymentRecords", "selected", result.selected);
  await reportProgress("paymentRecords", "mutated", result.affected);
  return { scrubbed: result.affected, backlog: result.backlog };
}

async function scrubPaymentOperationSnapshots(prisma, reportProgress) {
  await reportProgress("paymentOperations", "selecting");
  const rows = await prisma.$queryRaw`
    SELECT selected, affected, backlog
      FROM "clean_pay_retention_scrub_payment_operation_snapshots"()
  `;
  const result = guardedMutationResult(rows, "paymentOperations");
  await reportProgress("paymentOperations", "selected", result.selected);
  await reportProgress("paymentOperations", "mutated", result.affected);
  return { scrubbed: result.affected, backlog: result.backlog };
}

export async function runRetentionCleanup(
  prisma,
  policy,
  now = new Date(),
  options = {},
) {
  // The runtime values remain validated by retentionPolicy for configuration
  // parity, but no caller-supplied clock or cutoff reaches a mutation. The
  // guarded database functions use the exact private policy row and server UTC.
  void policy;
  void now;
  const reportProgress = retentionProgressReporter(options);
  const results = {};
  const genericBacklogSources = [];
  const failures = [];

  async function captureDelete({
    phase,
    resultKey,
    backlogSource = phase,
  }) {
    const result = await captureRetentionPhase(
      failures,
      phase,
      () => deleteRetentionBatch(prisma, reportProgress, phase),
    );
    if (result === null) return null;
    results[resultKey] = (results[resultKey] ?? 0) + result.deleted;
    if (
      result.backlog
      && backlogSource !== null
      && !genericBacklogSources.includes(backlogSource)
    ) {
      genericBacklogSources.push(backlogSource);
    }
    return result;
  }

  await captureDelete({
    phase: "webAuthnChallengesExpired",
    resultKey: "webAuthnChallenges",
    backlogSource: "webAuthnChallenges",
  });
  await captureDelete({
    phase: "webAuthnChallengesConsumed",
    resultKey: "webAuthnChallenges",
    backlogSource: "webAuthnChallenges",
  });

  const telegramCallbacks = await captureRetentionPhase(
    failures,
    "telegramCallbackResults",
    () => scrubTelegramCallbacks(prisma, reportProgress),
  );
  if (telegramCallbacks !== null) {
    results.telegramCallbackResultsScrubbed = telegramCallbacks.scrubbed;
    results.telegramCallbackRetentionBacklog = telegramCallbacks.backlog;
  }

  await captureDelete({
    phase: "telegramAuthStatesExpired",
    resultKey: "telegramAuthStates",
    backlogSource: "telegramAuthStates",
  });
  await captureDelete({
    phase: "telegramAuthStatesConsumed",
    resultKey: "telegramAuthStates",
    backlogSource: "telegramAuthStates",
  });
  await captureDelete({
    phase: "emailVerificationCodesExpired",
    resultKey: "emailVerificationCodes",
    backlogSource: "emailVerificationCodes",
  });
  await captureDelete({
    phase: "emailVerificationCodesConsumed",
    resultKey: "emailVerificationCodes",
    backlogSource: "emailVerificationCodes",
  });
  await captureDelete({
    phase: "accountMergeConfirmations",
    resultKey: "accountMergeConfirmations",
  });
  await captureDelete({
    phase: "webSessionsRevoked",
    resultKey: "webSessions",
    backlogSource: "webSessions",
  });
  await captureDelete({
    phase: "webSessionsExpired",
    resultKey: "webSessions",
    backlogSource: "webSessions",
  });
  await captureDelete({
    phase: "auditInfo",
    resultKey: "auditInfo",
  });
  await captureDelete({
    phase: "auditSecurity",
    resultKey: "auditSecurity",
  });

  const disposedHolds = await captureDelete({
    phase: "paymentRetentionHolds",
    resultKey: "paymentRetentionHoldsDisposed",
    backlogSource: null,
  });
  if (disposedHolds !== null) {
    results.paymentRetentionHoldBacklog = disposedHolds.backlog;
  }

  await captureDelete({
    phase: "rateLimitEvents",
    resultKey: "rateLimitEvents",
  });

  const paymentRecords = await captureRetentionPhase(
    failures,
    "paymentRecords",
    () => scrubPaymentRecords(prisma, reportProgress),
  );
  if (paymentRecords !== null) {
    results.paymentRecordsScrubbed = paymentRecords.scrubbed;
  }
  const paymentOperations = await captureRetentionPhase(
    failures,
    "paymentOperations",
    () => scrubPaymentOperationSnapshots(prisma, reportProgress),
  );
  if (paymentOperations !== null) {
    results.paymentOperationsScrubbed = paymentOperations.scrubbed;
  }

  results.paymentRetentionBacklog = Boolean(
    paymentRecords?.backlog || paymentOperations?.backlog,
  );
  results.genericRetentionBacklogSources = genericBacklogSources;
  results.genericRetentionBacklog = genericBacklogSources.length > 0;
  results.retentionBacklog = Boolean(
    results.genericRetentionBacklog
    || results.telegramCallbackRetentionBacklog
    || results.paymentRetentionHoldBacklog
    || results.paymentRetentionBacklog,
  );

  if (failures.length > 0) {
    throw new RetentionCleanupAggregateError(failures);
  }
  await reportProgress("cleanup", "completed");
  return results;
}
