import type { Prisma, PaymentOperationStatus, PaymentOperationKind, PaymentRecord } from "@prisma/client";

export interface PaymentOperationRecord {
  id: string;
  userId: string;
  kind: PaymentOperationKind;
  idempotencyKeyHash: string;
  upstreamOwnerHash: string | null;
  upstreamKey: string;
  status: PaymentOperationStatus;
  attemptCount: number;
  claimTokenHash: string | null;
  leaseExpiresAt: Date | null;
  dispatchedAt: Date | null;
  outcomeUnknownAt: Date | null;
  completedAt: Date | null;
  responseStatus: number | null;
  responseSnapshot: Prisma.JsonValue | null;
  errorSnapshot: Prisma.JsonValue | null;
  reconcileClaimTokenHash: string | null;
  reconcileLeaseExpiresAt: Date | null;
  reconcileNextAttemptAt: Date | null;
  reconcileErrorSnapshot: Prisma.JsonValue | null;
  reconcileAttemptCount: number;
  reconcileFailureCount: number;
  reconcileLastAttemptAt: Date | null;
  reconciledAt: Date | null;
  requestFingerprint: string;
  requestPayload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

export interface FindByUserAndKeyInput {
  userId: string;
  idempotencyKeyHash: string;
}

export interface UpdateWhereInput {
  id: string;
  status?: string | { in: string[] };
  claimTokenHash?: string | null;
  upstreamOwnerHash?: string | null | { not: null };
  leaseExpiresAt?: { gt: Date } | { lte: Date } | null;
  OR?: Array<{ leaseExpiresAt: Date | null } | { leaseExpiresAt: { lte: Date } }>;
}

export interface UpdateDataInput {
  status?: string;
  claimTokenHash?: string | null;
  leaseExpiresAt?: Date | null;
  upstreamOwnerHash?: string;
  outcomeUnknownAt?: Date | null;
  dispatchedAt?: Date;
  reconcileNextAttemptAt?: Date;
  responseStatus?: number | null;
  responseSnapshot?: Prisma.InputJsonValue | Prisma.NullTypes.DbNull;
  errorSnapshot?: Prisma.InputJsonValue | Prisma.NullTypes.DbNull;
  completedAt?: Date | null;
  attemptCount?: { increment: number };
}

export interface PaymentOperationWithRecord extends PaymentOperationRecord {
  paymentRecord: PaymentRecord | null;
}

export interface PaymentOperationStore {
  findByUserAndKey(input: FindByUserAndKeyInput): Promise<PaymentOperationRecord | null>;
  findById(id: string): Promise<Pick<PaymentOperationRecord, "id" | "status" | "claimTokenHash" | "upstreamOwnerHash"> | null>;
  findReconcileFailureCount(id: string): Promise<number | null>;
  findWithRecordByUser(userId: string, operationId?: string): Promise<PaymentOperationWithRecord | null>;
  updateMany(where: UpdateWhereInput, data: UpdateDataInput): Promise<number>;
}
