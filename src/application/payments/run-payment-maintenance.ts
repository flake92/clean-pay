import type { PaymentMaintenanceRunner, PaymentReconciliationGateway } from "@/application/payments/ports/payment-maintenance";

function assertBounds(input: { paymentLimit: number; deadlineMs: number }) {
  if (!Number.isSafeInteger(input.paymentLimit) || input.paymentLimit < 1 || input.paymentLimit > 100
    || !Number.isSafeInteger(input.deadlineMs) || input.deadlineMs < 1_000 || input.deadlineMs > 30_000) {
    throw Object.assign(new Error("Invalid payment maintenance bounds"), { code: "VALIDATION_ERROR" });
  }
}

function retryDelayMs(failureCount: number) {
  return Math.min(60 * 60_000, 15_000 * 2 ** Math.min(failureCount, 8));
}

export async function processPaymentReconciliation(
  runner: PaymentReconciliationGateway,
  claim: NonNullable<Awaited<ReturnType<PaymentReconciliationGateway["claimReconciliation"]>>>,
  authorizationContext?: unknown,
) {
  if (!claim.ownerMatches) {
    await runner.markReconciliationManual(claim, "UPSTREAM_OWNER_MISMATCH", true);
    return "MANUAL_REQUIRED" as const;
  }
  let recovery;
  try {
    recovery = await runner.recoverPayment(claim, authorizationContext);
  } catch (error) {
    if (await runner.failReconciliation(claim, error) === "owner_changed") {
      await runner.markReconciliationManual(claim, "UPSTREAM_OWNER_CHANGED_DURING_REQUEST", true);
      return "MANUAL_REQUIRED" as const;
    }
    throw error;
  }
  try {
    if (recovery?.state === "SUCCEEDED") {
      await runner.completeRecoveredPayment(claim, recovery);
      return "SUCCEEDED" as const;
    }
    if (recovery === null) {
      await runner.resetMissingPayment(claim);
      return "RETRY_READY" as const;
    }
    if (recovery.state === "IN_PROGRESS") {
      await runner.releaseReconciliation(claim, { delayMs: Math.max(1, recovery.retryAfterSeconds ?? 5) * 1_000, failure: false });
      return "IN_PROGRESS" as const;
    }
    if (recovery.state === "UNKNOWN") {
      await runner.releaseReconciliation(claim, {
        delayMs: (recovery.retryAfterSeconds ?? 0) > 0 ? recovery.retryAfterSeconds! * 1_000 : retryDelayMs(claim.failureCount),
        failure: true,
        errorCode: "UPSTREAM_OUTCOME_UNKNOWN",
      });
      return "UNKNOWN" as const;
    }
    await runner.markReconciliationManual(claim, "UPSTREAM_MANUAL_REQUIRED");
    return "MANUAL_REQUIRED" as const;
  } catch (error) {
    const classified = runner.classifyReconciliationError(error);
    if (classified.kind === "manual") {
      await runner.markReconciliationManual(claim, classified.reason);
      return "MANUAL_REQUIRED" as const;
    }
    if (classified.kind === "owner_changed") {
      await runner.markReconciliationManual(claim, "UPSTREAM_OWNER_CHANGED_DURING_SETTLEMENT", true);
      return "MANUAL_REQUIRED" as const;
    }
    if (await runner.failReconciliation(claim, error) === "owner_changed") {
      await runner.markReconciliationManual(claim, "UPSTREAM_OWNER_CHANGED_AFTER_SETTLEMENT_FAILURE", true);
      return "MANUAL_REQUIRED" as const;
    }
    throw error;
  }
}

export async function processPaymentHistoryPage(
  runner: PaymentMaintenanceRunner,
  candidate: { userId: string; upstreamAccountId: string },
  authorizationContext: unknown,
  pageSize: number,
) {
  const claim = await runner.claimHistory(candidate);
  if (!claim) return { claimed: false, applied: 0, hasMore: false } as const;
  try {
    const page = await runner.loadHistoryPage({ context: authorizationContext }, claim.cursor, Math.min(100, pageSize));
    return { claimed: true, ...await runner.completeHistoryPage(claim, page) } as const;
  } catch (error) {
    await runner.failHistory(claim, error);
    throw error;
  }
}

export async function runPaymentMaintenance(
  runner: PaymentMaintenanceRunner,
  input: { paymentLimit: number; deadlineMs: number },
) {
  assertBounds(input);
  const deadlineAt = runner.now() + input.deadlineMs;
  const payments = {
    claimed: 0, succeeded: 0, inProgress: 0, unknown: 0, manualRequired: 0,
    retryReady: 0, failed: 0, manualRequiredOperationIds: [] as string[],
  };
  for (let index = 0; index < input.paymentLimit && runner.now() < deadlineAt; index += 1) {
    const claim = await runner.claimReconciliation();
    if (!claim) break;
    payments.claimed += 1;
    try {
      const result = await processPaymentReconciliation(runner, claim);
      if (result === "SUCCEEDED") payments.succeeded += 1;
      else if (result === "IN_PROGRESS") payments.inProgress += 1;
      else if (result === "UNKNOWN") payments.unknown += 1;
      else if (result === "RETRY_READY") payments.retryReady += 1;
      else {
        payments.manualRequired += 1;
        payments.manualRequiredOperationIds.push(claim.operationId);
      }
    } catch {
      payments.failed += 1;
    }
  }

  const history = { attempted: 0, applied: 0, completed: 0, failed: 0 };
  const candidates = await runner.listHistoryCandidates(1);
  for (const candidate of candidates) {
    if (runner.now() >= deadlineAt) break;
    const claim = await runner.claimHistory(candidate);
    if (!claim) continue;
    history.attempted += 1;
    try {
      const authorization = await runner.authorizeHistory(claim);
      const pageSize = await runner.historyPageSize(authorization);
      if (!pageSize) throw Object.assign(new Error("History capability unavailable"), { code: "UPSTREAM_ERROR" });
      const page = await runner.loadHistoryPage(authorization, claim.cursor, Math.min(100, pageSize));
      const result = await runner.completeHistoryPage(claim, page);
      history.applied += result.applied;
      if (!result.hasMore) history.completed += 1;
    } catch (error) {
      await runner.failHistory(claim, error);
      history.failed += 1;
    }
  }
  return { ...payments, history };
}
