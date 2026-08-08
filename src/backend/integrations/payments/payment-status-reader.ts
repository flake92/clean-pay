import type { PaymentStatusReader } from "@/backend/application/payments/ports/payment-status-reader";
import { prisma } from "@/backend/database/prisma";
import { getAuthorizedRemnashopTokens, getRemnashopUserIdFromAccessToken, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { getExactTransaction, getLegacyTransactions, getPaymentCapabilities } from "@/backend/integrations/remnashop/payment-recovery";
import { syncOnePaymentHistoryPage } from "@/backend/payments/history-sync";
import { isPaymentManualRequired } from "@/backend/payments/manual-review";
import { assertPaymentUpstreamIdentity } from "@/backend/payments/owner";
import { reconcileUnknownPayments } from "@/backend/payments/reconciliation";
import { serializePaymentRecord, syncExactPaymentRecordFromRemnashop, syncPaymentRecordsFromRemnashopTransactions } from "@/backend/payments/records";
import { assertEmailVerificationPolicy, getCurrentUser } from "@/backend/sessions/web-session";
import type { PaymentStatusViewModel } from "@/shared/presentation/payment-status";
import type { CurrentSubscriptionResponse } from "@/shared/remnashop/types";

const paymentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operationIdPattern = /^[a-z0-9_-]{1,191}$/i;

function operationStatus(operation: { id: string; status: string; reconciledAt: Date | null; reconcileErrorSnapshot: unknown }) {
  if (isPaymentManualRequired(operation)) return { operation_id: operation.id, status: "manual_required" as const, retry_after_seconds: null, requires_support: true, operator_action: "review_payment_operation" };
  const status: "succeeded" | "failed" | "retry_ready" | "outcome_unknown" | "processing" = operation.status === "SUCCEEDED" ? "succeeded" : operation.status === "FAILED_FINAL" ? "failed" : operation.status === "READY" ? "retry_ready" : operation.status === "OUTCOME_UNKNOWN" ? "outcome_unknown" : "processing";
  return { operation_id: operation.id, status, retry_after_seconds: status === "processing" || status === "outcome_unknown" ? 5 : null, requires_support: false, operator_action: null };
}

type OperationRecord = Awaited<ReturnType<typeof findOperation>>;
async function findOperation(userId: string, operationId: string | null) {
  return prisma.paymentOperation.findFirst({
    where: operationId ? { id: operationId, userId } : { userId, status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] } },
    orderBy: operationId ? undefined : { createdAt: "desc" },
    select: { id: true, status: true, reconciledAt: true, reconcileErrorSnapshot: true, paymentRecord: true },
  });
}

function terminal(operation: NonNullable<OperationRecord>, status: ReturnType<typeof operationStatus>) {
  const localStatus = operation.paymentRecord?.status;
  return status.status === "manual_required" || operation.status === "FAILED_FINAL" || (operation.status === "SUCCEEDED" && (!operation.paymentRecord || (localStatus !== "PENDING" && localStatus !== "UNKNOWN")));
}

function view(operation: OperationRecord, subscription: CurrentSubscriptionResponse | null, paymentRecord: NonNullable<OperationRecord>["paymentRecord"] | null): PaymentStatusViewModel {
  return {
    payment: paymentRecord ? serializePaymentRecord(paymentRecord) : null,
    operation: operation ? operationStatus(operation) : null,
    subscription,
  };
}

export const productionPaymentStatusReader: PaymentStatusReader = {
  async load({ paymentId, operationId }) {
    if (paymentId && !paymentIdPattern.test(paymentId)) throw new ServiceError("VALIDATION_ERROR", 400, "payment_id must be a UUID");
    if (operationId && !operationIdPattern.test(operationId)) throw new ServiceError("VALIDATION_ERROR", 400, "operation_id has an invalid format");
    const user = await getCurrentUser();
    if (!user) throw new ServiceError("UNAUTHORIZED", 401);
    assertEmailVerificationPolicy(user);

    let operation = operationId || !paymentId ? await findOperation(user.id, operationId) : null;
    const status = operation ? operationStatus(operation) : null;
    let operationPaymentId = operation?.paymentRecord?.paymentId ?? null;
    if (paymentId && operationId && operationPaymentId && paymentId !== operationPaymentId) throw new ServiceError("CONFLICT", 409, "Payment id does not belong to operation");
    let resolvedPaymentId = operationId ? operationPaymentId : paymentId;
    if (operation && status && terminal(operation, status)) return view(operation, null, operation.paymentRecord);

    let subscription: CurrentSubscriptionResponse | null = null;
    try {
      const { accessToken } = await getAuthorizedRemnashopTokens();
      const upstreamAccountId = getRemnashopUserIdFromAccessToken(accessToken);
      await assertPaymentUpstreamIdentity(user.id, upstreamAccountId);
      const capabilities = await getPaymentCapabilities(accessToken);
      if (capabilities) {
        if (resolvedPaymentId) {
          const exact = await getExactTransaction({ accessToken, paymentId: resolvedPaymentId });
          if (exact) await syncExactPaymentRecordFromRemnashop({ userId: user.id, upstreamAccountId, transaction: exact });
        } else {
          await syncOnePaymentHistoryPage({ userId: user.id, upstreamAccountId, accessToken, pageSize: Math.min(100, capabilities.transactions.max_page_size) });
        }
        await reconcileUnknownPayments({ limit: 1, userId: user.id, accessToken });
      } else {
        await syncPaymentRecordsFromRemnashopTransactions({ userId: user.id, upstreamAccountId, transactions: await getLegacyTransactions(accessToken) });
      }
      if (operation) {
        operation = await findOperation(user.id, operation.id);
        operationPaymentId = operation?.paymentRecord?.paymentId ?? null;
        resolvedPaymentId = operationId ? operationPaymentId : paymentId;
      }
      subscription = await remnashopRequest<CurrentSubscriptionResponse | null>("/subscription/current", { accessToken });
    } catch (error) {
      if (operation?.status === "SUCCEEDED") return view(operation, null, operation.paymentRecord);
      if (!(error instanceof ServiceError && error.code === "SUBSCRIPTION_NOT_FOUND")) throw error;
    }

    const record = resolvedPaymentId
      ? await prisma.paymentRecord.findFirst({ where: { userId: user.id, paymentId: resolvedPaymentId } })
      : operationId
        ? operation?.paymentRecord ?? null
        : await prisma.paymentRecord.findFirst({ where: { userId: user.id }, orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }] });
    return view(operation, subscription, record);
  },
};
