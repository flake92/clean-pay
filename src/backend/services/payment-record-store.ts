import type { PaymentRecordStatus, Prisma } from "@prisma/client";

export interface PaymentRecordSummary {
  id: string;
  userId: string;
  paymentId: string;
  purchaseType: string;
  status: PaymentRecordStatus;
  finalAmount: Prisma.Decimal;
  currency: string;
  gatewayType: string;
  planCode: string | null;
  planName: string | null;
  durationDays: number | null;
  deviceLimit: number | null;
  trafficLimit: number | null;
  paymentUrl: string | null;
  isFree: boolean;
  raw: Prisma.JsonValue;
  operationId: string | null;
  upstreamCreatedAt: Date;
  upstreamUpdatedAt: Date;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentRecordStore {
  findByPaymentId(userId: string, paymentId: string): Promise<PaymentRecordSummary | null>;
  findLatestForUser(userId: string): Promise<PaymentRecordSummary | null>;
  findPendingForUser(userId: string, limit: number): Promise<Pick<PaymentRecordSummary, "paymentId">[]>;
  findManyForUser(userId: string, limit: number): Promise<PaymentRecordSummary[]>;
}
