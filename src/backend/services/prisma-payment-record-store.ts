import { prisma } from "@/backend/database/prisma";
import type {
  PaymentRecordStore,
  PaymentRecordSummary,
} from "@/backend/services/payment-record-store";

export const prismaPaymentRecordStore: PaymentRecordStore = {
  async findByPaymentId(userId: string, paymentId: string): Promise<PaymentRecordSummary | null> {
    return prisma.paymentRecord.findFirst({
      where: { userId, paymentId },
    }) as Promise<PaymentRecordSummary | null>;
  },

  async findLatestForUser(userId: string): Promise<PaymentRecordSummary | null> {
    return prisma.paymentRecord.findFirst({
      where: { userId },
      orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }],
    }) as Promise<PaymentRecordSummary | null>;
  },

  async findPendingForUser(userId: string, limit: number): Promise<Pick<PaymentRecordSummary, "paymentId">[]> {
    return prisma.paymentRecord.findMany({
      where: { userId, status: { in: ["PENDING", "UNKNOWN"] } },
      orderBy: { createdAt: "desc" },
      select: { paymentId: true },
      take: limit,
    }) as Promise<Pick<PaymentRecordSummary, "paymentId">[]>;
  },

  async findManyForUser(userId: string, limit: number): Promise<PaymentRecordSummary[]> {
    return prisma.paymentRecord.findMany({
      where: { userId },
      orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }],
      take: limit,
    }) as Promise<PaymentRecordSummary[]>;
  },
};
