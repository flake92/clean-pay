import type {
  PaymentHistoryAuthorization,
  PaymentHistoryGateway,
  PaymentHistoryTransaction,
} from "@/application/payments/ports/payment-history";
import { prismaPaymentQueryRepository } from "@/backend/integrations/payments/prisma-payment-query-repository";
import { getAuthorizedRemnashopTokens, getRemnashopUserIdFromAccessToken } from "@/backend/integrations/remnashop/client";
import { getExactTransaction, getLegacyTransactions, getPaymentCapabilities } from "@/backend/integrations/remnashop/payment-recovery";
import { logger } from "@/backend/observability/logger";
import { assertPaymentUpstreamIdentity } from "@/backend/integrations/payments/payment-owner-service";
import { serializePaymentRecord, syncExactPaymentRecordFromRemnashop, syncPaymentRecordsFromRemnashopTransactions } from "@/backend/integrations/payments/payment-record-service";
import type { PaymentTransactionResponse } from "@/backend/integrations/remnashop/contracts";

type Authorized = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;
function authorized(value: PaymentHistoryAuthorization) { return value.context as Authorized; }
function transaction(value: PaymentHistoryTransaction) { return value.context as PaymentTransactionResponse; }

export const productionPaymentHistoryGateway: PaymentHistoryGateway = {
  async authorize(userId) {
    const result = await getAuthorizedRemnashopTokens();
    const upstreamAccountId = getRemnashopUserIdFromAccessToken(result.accessToken);
    await assertPaymentUpstreamIdentity(userId, upstreamAccountId);
    return { context: result, upstreamAccountId };
  },
  async loadCapabilities(value) {
    const capabilities = await getPaymentCapabilities(authorized(value).accessToken);
    return capabilities ? { maxPageSize: capabilities.transactions.max_page_size } : null;
  },
  findPendingPaymentIds: (userId, limit) => prismaPaymentQueryRepository.findPendingPaymentIds(userId, limit),
  async loadExactTransaction(value, paymentId) {
    const item = await getExactTransaction({ accessToken: authorized(value).accessToken, paymentId });
    return item ? { context: item } : null;
  },
  async persistExactTransaction(userId, value, item) {
    await syncExactPaymentRecordFromRemnashop({ userId, upstreamAccountId: value.upstreamAccountId, transaction: transaction(item) });
  },
  async loadLegacyTransactions(value) {
    return (await getLegacyTransactions(authorized(value).accessToken)).map((item) => ({ context: item }));
  },
  async persistLegacyTransactions(userId, value, items) {
    await syncPaymentRecordsFromRemnashopTransactions({ userId, upstreamAccountId: value.upstreamAccountId, transactions: items.map(transaction) });
  },
  async loadRecent(userId, limit) {
    return (await prismaPaymentQueryRepository.findRecentRecords(userId, limit)).map(serializePaymentRecord);
  },
  logExactFailure(error, index) {
    logger.warn("payment_history_exact_sync_failed", { index, errorName: error instanceof Error ? error.name : "UnknownError" }, {
      category: "upstream", source: "payments.history", message: "Exact payment-history sync failed; continuing with page sync",
    });
  },
  logDegraded(error) {
    logger.warn("payment_history_sync_degraded", { errorName: error instanceof Error ? error.name : "UnknownError" }, {
      category: "upstream", source: "payments.history", message: "Serving owner-bound cached payment history after sync failure",
    });
  },
};
