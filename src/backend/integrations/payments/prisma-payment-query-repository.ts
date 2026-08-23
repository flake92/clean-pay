import { prisma } from "@/backend/database/prisma";

const PAYMENT_HISTORY_STALE_AFTER_MS = 15 * 60_000;

export const prismaPaymentQueryRepository = {
  findOperation(userId: string, operationId: string | null) { return prisma.paymentOperation.findFirst({
    where: operationId ? { id: operationId, userId } : { userId, status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] } },
    orderBy: operationId ? undefined : { createdAt: "desc" },
    select: { id: true, status: true, reconciledAt: true, reconcileErrorSnapshot: true, paymentRecord: true },
  }); },
  findRecord(userId: string, paymentId: string) { return prisma.paymentRecord.findFirst({ where: { userId, paymentId } }); },
  findLatestRecord(userId: string) { return prisma.paymentRecord.findFirst({ where: { userId }, orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }] }); },
  findRecentRecords(userId: string, limit: number) { return prisma.paymentRecord.findMany({ where: { userId }, orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }], take: limit }); },
  async findPendingPaymentIds(userId: string, limit: number) {
    const rows = await prisma.paymentRecord.findMany({ where: { userId, status: { in: ["PENDING", "UNKNOWN"] } }, orderBy: { createdAt: "desc" }, select: { paymentId: true }, take: limit });
    return rows.map(({ paymentId }) => paymentId);
  },
  async readHistorySnapshotStatus(userId: string) {
    const state = await prisma.paymentHistorySyncState.findUnique({
      where: { userId },
      select: {
        backfillCompletedAt: true,
        lastSyncedAt: true,
        errorSnapshot: true,
      },
    });

    if (state?.errorSnapshot !== null && state?.errorSnapshot !== undefined) {
      return "unavailable" as const;
    }

    if (!state || !state.backfillCompletedAt || !state.lastSyncedAt) {
      return "refreshing" as const;
    }

    return state.lastSyncedAt <= new Date(Date.now() - PAYMENT_HISTORY_STALE_AFTER_MS)
      ? "refreshing" as const
      : "current" as const;
  },
};
