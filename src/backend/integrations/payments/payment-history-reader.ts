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
import { syncOnePaymentHistoryPage } from "@/backend/payments/history-sync";
import { assertPaymentUpstreamIdentity } from "@/backend/payments/owner";
import {
  serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions,
} from "@/backend/payments/records";
import { getServiceRegistry } from "@/backend/services/registry";

export async function loadPaymentHistory(userId: string) {
  let stale = false;

  try {
    const { accessToken } = await getAuthorizedRemnashopTokens();
    const upstreamAccountId = getRemnashopUserIdFromAccessToken(accessToken);
    await assertPaymentUpstreamIdentity(userId, upstreamAccountId);
    const capabilities = await getPaymentCapabilities(accessToken);

    if (capabilities) {
      const { paymentRecordStore } = getServiceRegistry();
      const pending = await paymentRecordStore.findPendingForUser(userId, 5);

      for (const [index, record] of pending.entries()) {
        try {
          const exact = await getExactTransaction({ accessToken, paymentId: record.paymentId });
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

  const { paymentRecordStore } = getServiceRegistry();
  const records = await paymentRecordStore.findManyForUser(userId, 20);

  return { records: records.map(serializePaymentRecord), stale };
}
