import { prismaPaymentQueryRepository } from "@/backend/integrations/payments/prisma-payment-query-repository";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
} from "@/backend/integrations/remnashop/client";
import {
  getExactTransaction,
  getLegacyTransactions,
  getPaymentCapabilities,
} from "@/backend/integrations/remnashop/payment-recovery";
import { logger } from "@/backend/observability/logger";
import { syncOnePaymentHistoryPage } from "@/backend/integrations/payments/payment-history-sync-service";
import { assertPaymentUpstreamIdentity } from "@/backend/integrations/payments/payment-owner-service";
import {
  serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions,
} from "@/backend/integrations/payments/payment-record-service";

export async function loadPaymentHistory(userId: string) {
  let stale = false;

  try {
    const { accessToken } = await getAuthorizedRemnashopTokens();
    const upstreamAccountId = getRemnashopUserIdFromAccessToken(accessToken);
    await assertPaymentUpstreamIdentity(userId, upstreamAccountId);
    const capabilities = await getPaymentCapabilities(accessToken);

    if (capabilities) {
      const pending = await prismaPaymentQueryRepository.findPendingPaymentIds(userId, 5);

      for (const [index, paymentId] of pending.entries()) {
        try {
          const exact = await getExactTransaction({ accessToken, paymentId });
          if (exact) {
            await syncExactPaymentRecordFromRemnashop({ userId, upstreamAccountId, transaction: exact });
          }
        } catch (error) {
          stale = true;
          logger.warn("payment_history_exact_sync_failed", {
            index,
            errorName: error instanceof Error ? error.name : "UnknownError",
          }, {
            category: "upstream",
            source: "payments.history",
            message: "Exact payment-history sync failed; continuing with page sync",
          });
        }
      }

      await syncOnePaymentHistoryPage({
        userId,
        upstreamAccountId,
        accessToken,
        pageSize: Math.min(100, capabilities.transactions.max_page_size),
      });
    } else {
      await syncPaymentRecordsFromRemnashopTransactions({
        userId,
        upstreamAccountId,
        transactions: await getLegacyTransactions(accessToken),
      });
    }
  } catch (error) {
    stale = true;
    logger.warn("payment_history_sync_degraded", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "payments.history",
      message: "Serving owner-bound cached payment history after sync failure",
    });
  }

  const records = await prismaPaymentQueryRepository.findRecentRecords(userId, 20);

  return { records: records.map(serializePaymentRecord), stale };
}
