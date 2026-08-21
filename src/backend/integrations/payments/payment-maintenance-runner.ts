import type {
  PaymentHistoryAuthorization,
  PaymentHistoryClaim,
  PaymentHistoryExact,
  PaymentHistoryPage,
  PaymentMaintenanceRunner,
  PaymentReconciliationClaim,
} from "@/application/payments/ports/payment-maintenance";
import {
  completeReconciledPayment,
  claimUnknownPaymentOperation,
  failPaymentReconciliation,
  markPaymentReconciliationManual,
  PaymentReconciliationManualError,
  readPaymentReconciliationBacklog,
  releaseReconciliationClaim,
  resetMissingUpstreamOperation,
  type PaymentReconciliationClaim as BackendReconciliationClaim,
} from "@/backend/integrations/payments/payment-reconciliation-service";
import {
  claimPaymentHistorySync,
  completePaymentHistoryPage,
  deferPaymentHistorySync,
  failPaymentHistorySync,
  listDuePaymentHistoryCandidates,
  loadCurrentPaymentHistoryCredential,
  type PaymentHistorySyncClaim,
} from "@/backend/integrations/payments/payment-history-sync-service";
import { prismaPaymentQueryRepository } from "@/backend/integrations/payments/prisma-payment-query-repository";
import { syncExactPaymentRecordFromRemnashop } from "@/backend/integrations/payments/payment-record-service";
import {
  getExactTransaction, getLegacyTransactions, getPaymentCapabilities, getTransactionPage, reconcilePaymentOperation,
  reconcilePaymentOperationAsAdmin, type RemnashopPaymentRecovery, type RemnashopTransactionPage,
} from "@/backend/integrations/remnashop/payment-recovery";
import { ServiceError } from "@/backend/errors/service-error";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { safeEqual } from "@/backend/security/crypto";
import { logger } from "@/backend/observability/logger";

function reconciliation(value: PaymentReconciliationClaim) { return value.context as BackendReconciliationClaim; }
function historyClaim(value: PaymentHistoryClaim) { return value.context as PaymentHistorySyncClaim; }
function historyAuthorization(value: PaymentHistoryAuthorization) { return value.context as { accessToken: string }; }
function historyPage(value: PaymentHistoryPage) { return value.context as RemnashopTransactionPage; }
function historyExact(value: PaymentHistoryExact) { return value.context as import("@/backend/integrations/remnashop/contracts").PaymentTransactionResponse; }
function recovery(value: { context: unknown }) { return value.context as RemnashopPaymentRecovery; }

export const productionPaymentMaintenanceRunner: PaymentMaintenanceRunner = {
  readReconciliationBacklog: readPaymentReconciliationBacklog,
  async claimReconciliation(userId) {
    const claim = await claimUnknownPaymentOperation({ userId });
    return claim ? {
      context: claim,
      operationId: claim.operationId,
      failureCount: claim.failureCount,
      ownerMatches: safeEqual(paymentUpstreamOwnerHash(claim.remnashopUserId), claim.upstreamOwnerHash),
    } : null;
  },
  async recoverPayment(value, authorizationContext) {
    const claim = reconciliation(value);
    const accessToken = (authorizationContext as { accessToken?: unknown } | undefined)?.accessToken;
    const result = typeof accessToken === "string"
      ? await reconcilePaymentOperation({ accessToken, operation: claim.operation, idempotencyKey: claim.upstreamKey, trigger: true })
      : await reconcilePaymentOperationAsAdmin({
          remnashopUserId: claim.remnashopUserId,
          operation: claim.operation,
          idempotencyKey: claim.upstreamKey,
          trigger: true,
        });
    return result ? { context: result, state: result.state, retryAfterSeconds: result.retry_after_seconds } : null;
  },
  async completeRecoveredPayment(claim, result) {
    await completeReconciledPayment(reconciliation(claim), recovery(result));
  },
  resetMissingPayment: (claim) => resetMissingUpstreamOperation(reconciliation(claim)),
  releaseReconciliation: (claim, input) => releaseReconciliationClaim(reconciliation(claim), {
    nextAttemptDelayMs: input.delayMs,
    failure: input.failure,
    ...(input.errorCode ? { errorSnapshot: { code: input.errorCode } } : {}),
  }),
  markReconciliationManual: (claim, reason, allowOwnerMismatch) => markPaymentReconciliationManual(
    reconciliation(claim), reason, { allowOwnerMismatch },
  ),
  async failReconciliation(claim, error) {
    try {
      await failPaymentReconciliation(reconciliation(claim), error);
      return "released";
    } catch (releaseError) {
      if (releaseError instanceof ServiceError && releaseError.code === "ACCOUNT_MERGE_REQUIRED") return "owner_changed";
      throw releaseError;
    }
  },
  classifyReconciliationError(error) {
    if (error instanceof PaymentReconciliationManualError) return { kind: "manual", reason: error.reason };
    if (error instanceof ServiceError && error.code === "ACCOUNT_MERGE_REQUIRED") return { kind: "owner_changed" };
    return { kind: "other" };
  },
  async listHistoryCandidates(limit) {
    return (await listDuePaymentHistoryCandidates(limit)).map((item) => ({ userId: item.userId, upstreamAccountId: item.remnashopUserId }));
  },
  async claimHistory(candidate) {
    const claim = await claimPaymentHistorySync(candidate);
    return claim ? { context: claim, cursor: claim.cursor } : null;
  },
  async authorizeHistory(claim, timeoutMs) {
    const backendClaim = historyClaim(claim);
    const accessToken = await loadCurrentPaymentHistoryCredential(
      backendClaim.userId,
      backendClaim.upstreamOwnerHash,
      timeoutMs,
    );
    if (!accessToken) throw new ServiceError("UNAUTHORIZED", 401, "No current Remnashop session is available for payment history recovery");
    return { context: { accessToken } };
  },
  async historyPageSize(value, timeoutMs) {
    const capabilities = await getPaymentCapabilities(
      historyAuthorization(value).accessToken,
      timeoutMs,
    );
    return capabilities?.transactions.max_page_size ?? null;
  },
  findPendingHistoryPaymentIds: (userId, limit) =>
    prismaPaymentQueryRepository.findPendingPaymentIds(userId, limit),
  async loadExactHistoryPayment(value, paymentId, timeoutMs) {
    const item = await getExactTransaction({
      accessToken: historyAuthorization(value).accessToken,
      paymentId,
      timeoutMs,
    });
    return item ? { context: item } : null;
  },
  async persistExactHistoryPayment(candidate, item) {
    await syncExactPaymentRecordFromRemnashop({
      userId: candidate.userId,
      upstreamAccountId: candidate.upstreamAccountId,
      transaction: historyExact(item),
    });
  },
  async loadLegacyHistory(value, timeoutMs) {
    const items = await getLegacyTransactions(
      historyAuthorization(value).accessToken,
      timeoutMs,
    );
    return { context: { items, next_cursor: null } };
  },
  async loadHistoryPage(value, cursor, limit, timeoutMs) {
    return { context: await getTransactionPage({ accessToken: historyAuthorization(value).accessToken, cursor, limit, timeoutMs }) };
  },
  completeHistoryPage: (claim, page) => completePaymentHistoryPage(historyClaim(claim), historyPage(page)),
  classifyHistoryError(error) {
    if (
      error instanceof ServiceError &&
      (
        error.code === "UNAUTHORIZED" ||
        error.code === "ACCOUNT_MERGE_REQUIRED" ||
        error.code === "CONFLICT"
      )
    ) {
      return { kind: "deferred" };
    }

    return { kind: "unexpected" };
  },
  deferHistory: (claim, error) => deferPaymentHistorySync(historyClaim(claim), error),
  failHistory: (claim, error) => failPaymentHistorySync(historyClaim(claim), error),
  logHistoryExactFailure(error, index) {
    logger.warn("payment_history_worker_exact_sync_failed", {
      index,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "payments.history.worker",
      message: "Exact payment-history recovery failed; continuing with the bounded page",
    });
  },
  now: Date.now,
};
