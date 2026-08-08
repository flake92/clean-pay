import type { PaymentQueryRepository } from "@/backend/application/payments/ports/payment-query-repository";
import { prisma } from "@/backend/database/prisma";
export const prismaPaymentQueryRepository: PaymentQueryRepository = {
  findOperation(userId, operationId) { return prisma.paymentOperation.findFirst({
    where: operationId ? { id: operationId, userId } : { userId, status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] } },
    orderBy: operationId ? undefined : { createdAt: "desc" },
    select: { id: true, status: true, reconciledAt: true, reconcileErrorSnapshot: true, paymentRecord: true },
  }); },
  findRecord(userId, paymentId) { return prisma.paymentRecord.findFirst({ where: { userId, paymentId } }); },
  findLatestRecord(userId) { return prisma.paymentRecord.findFirst({ where: { userId }, orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }] }); },
  findRecentRecords(userId, limit) { return prisma.paymentRecord.findMany({ where: { userId }, orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }], take: limit }); },
  async findPendingPaymentIds(userId, limit) {
    const rows = await prisma.paymentRecord.findMany({ where: { userId, status: { in: ["PENDING", "UNKNOWN"] } }, orderBy: { createdAt: "desc" }, select: { paymentId: true }, take: limit });
    return rows.map(({ paymentId }) => paymentId);
  },
};
