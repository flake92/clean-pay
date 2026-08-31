import type { PaymentHistoryGateway } from "@/application/payments/ports/payment-history";
import { prismaPaymentQueryRepository } from "@/backend/integrations/payments/prisma-payment-query-repository";
import { serializePaymentRecord } from "@/backend/integrations/payments/payment-record-service";

export function createProductionPaymentHistoryGateway(): PaymentHistoryGateway {
  return {
    async loadRecent(userId, limit) {
      return (await prismaPaymentQueryRepository.findRecentRecords(userId, limit))
        .map((record) => serializePaymentRecord(record));
    },
    readSnapshotStatus: (userId) =>
      prismaPaymentQueryRepository.readHistorySnapshotStatus(userId),
  };
}
