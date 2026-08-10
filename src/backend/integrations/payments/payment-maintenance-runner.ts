import type {
  PaymentHistoryAuthorization,
  PaymentHistoryClaim,
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
  failPaymentHistorySync,
  listDuePaymentHistoryCandidates,
  loadCurrentPaymentHistoryCredential,
  type PaymentHistorySyncClaim,
} from "@/backend/integrations/payments/payment-history-sync-service";
import {
  getPaymentCapabilities, getTransactionPage, reconcilePaymentOperation,
  reconcilePaymentOperationAsAdmin, type RemnashopPaymentRecovery, type RemnashopTransactionPage,
} from "@/backend/integrations/remnashop/payment-recovery";
import { ServiceError } from "@/backend/errors/service-error";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { safeEqual } from "@/backend/security/crypto";

function reconciliation(value: PaymentReconciliationClaim) { return value.context as BackendReconciliationClaim; }
function historyClaim(value: PaymentHistoryClaim) { return value.context as PaymentHistorySyncClaim; }
function historyAuthorization(value: PaymentHistoryAuthorization) { return value.context as { accessToken: string }; }
function historyPage(value: PaymentHistoryPage) { return value.context as RemnashopTransactionPage; }
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
  async authorizeHistory(claim) {
    const backendClaim = historyClaim(claim);
    const accessToken = await loadCurrentPaymentHistoryCredential(backendClaim.userId, backendClaim.upstreamOwnerHash);
    if (!accessToken) throw new ServiceError("UNAUTHORIZED", 401, "No current Remnashop session is available for payment history recovery");
    return { context: { accessToken } };
  },
  async historyPageSize(value) {
    const capabilities = await getPaymentCapabilities(historyAuthorization(value).accessToken);
    return capabilities?.transactions.max_page_size ?? null;
  },
  async loadHistoryPage(value, cursor, limit) {
    return { context: await getTransactionPage({ accessToken: historyAuthorization(value).accessToken, cursor, limit }) };
  },
  completeHistoryPage: (claim, page) => completePaymentHistoryPage(historyClaim(claim), historyPage(page)),
  failHistory: (claim, error) => failPaymentHistorySync(historyClaim(claim), error),
  now: Date.now,
};
