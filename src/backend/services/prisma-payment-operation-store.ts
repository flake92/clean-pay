import { prisma } from "@/backend/database/prisma";
import type {
  FindByUserAndKeyInput,
  PaymentOperationRecord,
  PaymentOperationStore,
  PaymentOperationWithRecord,
  UpdateDataInput,
  UpdateWhereInput,
} from "@/backend/services/payment-operation-store";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const prismaPaymentOperationStore: PaymentOperationStore = {
  async findByUserAndKey(input: FindByUserAndKeyInput): Promise<PaymentOperationRecord | null> {
    return prisma.paymentOperation.findUnique({
      where: {
        userId_idempotencyKeyHash: {
          userId: input.userId,
          idempotencyKeyHash: input.idempotencyKeyHash,
        },
      },
    }) as Promise<PaymentOperationRecord | null>;
  },

  async findById(id: string): Promise<Pick<PaymentOperationRecord, "id" | "status" | "claimTokenHash" | "upstreamOwnerHash"> | null> {
    return prisma.paymentOperation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        claimTokenHash: true,
        upstreamOwnerHash: true,
      },
    }) as Promise<Pick<PaymentOperationRecord, "id" | "status" | "claimTokenHash" | "upstreamOwnerHash"> | null>;
  },

  async findReconcileFailureCount(id: string): Promise<number | null> {
    const row = await prisma.paymentOperation.findUnique({
      where: { id },
      select: { reconcileFailureCount: true },
    });
    return row?.reconcileFailureCount ?? null;
  },

  async findWithRecordByUser(userId: string, operationId?: string): Promise<PaymentOperationWithRecord | null> {
    return prisma.paymentOperation.findFirst({
      where: operationId
        ? { id: operationId, userId }
        : { userId, status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] } },
      orderBy: operationId ? undefined : { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        kind: true,
        idempotencyKeyHash: true,
        upstreamOwnerHash: true,
        upstreamKey: true,
        status: true,
        attemptCount: true,
        claimTokenHash: true,
        leaseExpiresAt: true,
        dispatchedAt: true,
        outcomeUnknownAt: true,
        completedAt: true,
        responseStatus: true,
        responseSnapshot: true,
        errorSnapshot: true,
        reconcileClaimTokenHash: true,
        reconcileLeaseExpiresAt: true,
        reconcileNextAttemptAt: true,
        reconcileErrorSnapshot: true,
        reconcileAttemptCount: true,
        reconcileFailureCount: true,
        reconcileLastAttemptAt: true,
        reconciledAt: true,
        requestFingerprint: true,
        requestPayload: true,
        createdAt: true,
        updatedAt: true,
        paymentRecord: true,
      },
    }) as Promise<PaymentOperationWithRecord | null>;
  },

  async updateMany(where: UpdateWhereInput, data: UpdateDataInput): Promise<number> {
    const result = await prisma.paymentOperation.updateMany({
      where: where as any,
      data: data as any,
    });
    return result.count;
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */
