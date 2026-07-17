import { bffError, bffJson } from "@/backend/http/bff-response";
import {
  serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions,
} from "@/backend/payments/records";
import { prisma } from "@/backend/database/prisma";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import {
  getExactTransaction,
  getLegacyTransactions,
  getPaymentCapabilities,
} from "@/backend/integrations/remnashop/payment-recovery";
import { BffError } from "@/backend/integrations/remnashop/errors";
import type { CurrentSubscriptionResponse } from "@/shared/remnashop/types";
import { getCurrentUser } from "@/backend/sessions/web-session";
import { syncOnePaymentHistoryPage } from "@/backend/payments/history-sync";
import { reconcileUnknownPayments } from "@/backend/payments/reconciliation";
import { assertPaymentUpstreamIdentity } from "@/backend/payments/owner";
import { isPaymentManualRequired } from "@/backend/payments/manual-review";

export const runtime = "nodejs";

function isSubscriptionNotFound(error: unknown) {
  return error instanceof BffError && error.code === "SUBSCRIPTION_NOT_FOUND";
}

const PAYMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_OPERATION_ID_PATTERN = /^[a-z0-9_-]{1,191}$/i;

function serializePaymentOperationStatus(operation: {
  id: string;
  status: string;
  reconciledAt: Date | null;
  reconcileErrorSnapshot: unknown;
}) {
  if (isPaymentManualRequired(operation)) {
    return {
      operation_id: operation.id,
      status: "manual_required",
      retry_after_seconds: null,
      requires_support: true,
      operator_action: "review_payment_operation",
    };
  }

  let status = "processing";

  if (operation.status === "SUCCEEDED") status = "succeeded";
  if (operation.status === "FAILED_FINAL") status = "failed";
  if (operation.status === "READY") status = "retry_ready";
  if (operation.status === "OUTCOME_UNKNOWN") status = "outcome_unknown";

  return {
    operation_id: operation.id,
    status,
    retry_after_seconds:
      status === "processing" || status === "outcome_unknown" ? 5 : null,
    requires_support: false,
    operator_action: null,
  };
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return bffError(new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт."));
    }

    const searchParams = new URL(request.url).searchParams;
    const paymentId = searchParams.get("payment_id");
    const operationId = searchParams.get("operation_id");

    if (
      paymentId !== null &&
      !PAYMENT_ID_PATTERN.test(paymentId)
    ) {
      throw new BffError(
        "VALIDATION_ERROR",
        400,
        "payment_id must be a UUID",
      );
    }

    if (
      operationId !== null &&
      !PAYMENT_OPERATION_ID_PATTERN.test(operationId)
    ) {
      throw new BffError(
        "VALIDATION_ERROR",
        400,
        "operation_id has an invalid format",
      );
    }

    // Terminal operation state is authoritative local data. Reading it before
    // Remnashop keeps success/manual-review callbacks usable during an upstream
    // outage and avoids turning a settled payment into a transient 5xx page.
    const operation = operationId
      ? await prisma.paymentOperation.findFirst({
          where: { id: operationId, userId: user.id },
          select: {
            id: true,
            status: true,
            reconciledAt: true,
            reconcileErrorSnapshot: true,
            paymentRecord: true,
          },
        })
      : null;
    const operationStatus = operation
      ? serializePaymentOperationStatus(operation)
      : null;

    if (
      operation &&
      (operationStatus?.status === "manual_required" ||
        operation.status === "SUCCEEDED" ||
        operation.status === "FAILED_FINAL")
    ) {
      return bffJson({
        payment: operation.paymentRecord
          ? serializePaymentRecord(operation.paymentRecord)
          : null,
        operation: operationStatus,
        subscription: null,
        source: "local_terminal_payment_operation",
      });
    }

    let subscription: CurrentSubscriptionResponse | null = null;

    try {
      const { accessToken } = await getAuthorizedRemnashopTokens();
      const upstreamAccountId =
        getRemnashopUserIdFromAccessToken(accessToken);
      await assertPaymentUpstreamIdentity(user.id, upstreamAccountId);
      const capabilities = await getPaymentCapabilities(accessToken);

      if (capabilities) {
        if (paymentId) {
          const exact = await getExactTransaction({ accessToken, paymentId });

          if (exact) {
            await syncExactPaymentRecordFromRemnashop({
              userId: user.id,
              upstreamAccountId,
              transaction: exact,
            });
          }
        } else {
          await syncOnePaymentHistoryPage({
            userId: user.id,
            upstreamAccountId,
            accessToken,
            pageSize: Math.min(
              100,
              capabilities.transactions.max_page_size,
            ),
          });
        }

        await reconcileUnknownPayments({
          limit: 1,
          userId: user.id,
          accessToken,
        });
      } else {
        const transactions = await getLegacyTransactions(accessToken);
        await syncPaymentRecordsFromRemnashopTransactions({
          userId: user.id,
          upstreamAccountId,
          transactions,
        });
      }
      subscription = await remnashopRequest<CurrentSubscriptionResponse | null>(
        "/subscription/current",
        { accessToken },
      );
    } catch (error) {
      if (!isSubscriptionNotFound(error)) {
        throw error;
      }
    }

    let record = null;

    if (paymentId) {
      record = await prisma.paymentRecord.findFirst({
        where: { userId: user.id, paymentId },
      });
    } else if (operationId) {
      record = operation?.paymentRecord ?? null;
    } else {
      record = await prisma.paymentRecord.findFirst({
        where: { userId: user.id },
        orderBy: [
          { upstreamCreatedAt: "desc" },
          { paymentId: "desc" },
        ],
      });
    }

    return bffJson({
      payment: record ? serializePaymentRecord(record) : null,
      operation: operationStatus,
      subscription,
      source: "local_payment_record_and_current_subscription",
    });
  } catch (error) {
    return bffError(error);
  }
}
