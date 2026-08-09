import type { PaymentMaintenanceRunner } from "@/application/payments/ports/payment-maintenance";
import type { PaymentHistoryGateway } from "@/application/payments/ports/payment-history";
import { processPaymentHistoryPage } from "@/application/payments/run-payment-maintenance";

export async function loadPaymentHistory(
  gateway: PaymentHistoryGateway,
  maintenance: PaymentMaintenanceRunner,
  userId: string,
) {
  let stale = false;
  try {
    const authorization = await gateway.authorize(userId);
    const capabilities = await gateway.loadCapabilities(authorization);
    if (capabilities) {
      const pending = await gateway.findPendingPaymentIds(userId, 5);
      for (const [index, paymentId] of pending.entries()) {
        try {
          const exact = await gateway.loadExactTransaction(authorization, paymentId);
          if (exact) await gateway.persistExactTransaction(userId, authorization, exact);
        } catch (error) {
          stale = true;
          gateway.logExactFailure(error, index);
        }
      }
      await processPaymentHistoryPage(
        maintenance,
        { userId, upstreamAccountId: authorization.upstreamAccountId },
        authorization.context,
        capabilities.maxPageSize,
      );
    } else {
      const transactions = await gateway.loadLegacyTransactions(authorization);
      await gateway.persistLegacyTransactions(userId, authorization, transactions);
    }
  } catch (error) {
    stale = true;
    gateway.logDegraded(error);
  }
  return { records: await gateway.loadRecent(userId, 20), stale };
}
