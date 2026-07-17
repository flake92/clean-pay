import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import type { Prisma } from "@prisma/client";
import type {
  PaymentInitResponse,
  PaymentTransactionResponse,
  PlanOffer,
} from "@/shared/remnashop/types";

type PaymentRecordStatus =
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED"
  | "UNKNOWN";

export type RecordPaymentInput = {
  userId: string;
  gatewayType: string;
  durationDays?: number;
  plan?: PlanOffer;
  payment: PaymentInitResponse;
};

type PaymentRecordClient = Pick<Prisma.TransactionClient, "paymentRecord">;

export function toPaymentStatus(status: string): PaymentRecordStatus {
  const normalized = status.toUpperCase();

  if (
    normalized === "PENDING" ||
    normalized === "COMPLETED" ||
    normalized === "FAILED" ||
    normalized === "CANCELED" ||
    normalized === "REFUNDED"
  ) {
    return normalized;
  }

  return "UNKNOWN";
}

export async function syncPaymentRecordsFromRemnashopTransactions({
  userId,
  transactions,
}: {
  userId: string;
  transactions: PaymentTransactionResponse[];
}) {
  await Promise.all(
    transactions.map((transaction) =>
      prisma.paymentRecord.updateMany({
        where: {
          userId,
          paymentId: transaction.payment_id,
        },
        data: {
          purchaseType: transaction.purchase_type,
          status: toPaymentStatus(transaction.status),
          finalAmount: transaction.final_amount,
          currency: transaction.currency,
          gatewayType: transaction.gateway_type,
          planName: transaction.plan_name,
          durationDays: transaction.duration_days,
          deviceLimit: transaction.device_limit,
          trafficLimit: transaction.traffic_limit,
          raw: {
            remnashopTransaction: transaction,
          },
        },
      }),
    ),
  );
}

export async function recordPayment(
  input: RecordPaymentInput,
  options: {
    client?: PaymentRecordClient;
    operationId?: string;
  } = {},
) {
  const client = options.client ?? prisma;
  const operationLink = options.operationId
    ? { operationId: options.operationId }
    : {};
  const existing = await client.paymentRecord.findUnique({
    where: { paymentId: input.payment.payment_id },
    select: {
      id: true,
      userId: true,
      operationId: true,
    },
  });
  const mutableData = {
    purchaseType: input.payment.purchase_type,
    status: toPaymentStatus(input.payment.status),
    finalAmount: input.payment.final_amount,
    currency: input.payment.currency,
    gatewayType: input.gatewayType,
    planCode: input.plan?.public_code,
    planName: input.plan?.name,
    durationDays: input.durationDays,
    deviceLimit: input.plan?.device_limit,
    trafficLimit: input.plan?.traffic_limit,
    paymentUrl: input.payment.payment_url,
    isFree: input.payment.is_free,
    raw: input.payment,
    ...operationLink,
  };

  if (existing) {
    if (
      existing.userId !== input.userId ||
      (options.operationId &&
        existing.operationId !== null &&
        existing.operationId !== options.operationId)
    ) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment record is owned by another user or operation",
      );
    }

    const updated = await client.paymentRecord.updateMany({
      where: {
        id: existing.id,
        userId: input.userId,
        ...(options.operationId
          ? {
              OR: [
                { operationId: null },
                { operationId: options.operationId },
              ],
            }
          : {}),
      },
      data: mutableData,
    });

    if (updated.count !== 1) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment record ownership changed during update",
      );
    }

    return client.paymentRecord.findUnique({
      where: { id: existing.id },
    });
  }

  return client.paymentRecord.create({
    data: {
      userId: input.userId,
      paymentId: input.payment.payment_id,
      ...mutableData,
    },
  });
}

export function serializePaymentRecord(record: {
  id: string;
  paymentId: string;
  purchaseType: string;
  status: PaymentRecordStatus;
  finalAmount: unknown;
  currency: string;
  gatewayType: string;
  planCode: string | null;
  planName: string | null;
  durationDays: number | null;
  deviceLimit: number | null;
  trafficLimit: number | null;
  isFree: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    payment_id: record.paymentId,
    purchase_type: record.purchaseType,
    status: record.status.toLowerCase(),
    final_amount: String(record.finalAmount),
    currency: record.currency,
    gateway_type: record.gatewayType,
    plan_code: record.planCode,
    plan_name: record.planName,
    duration_days: record.durationDays,
    device_limit: record.deviceLimit,
    traffic_limit: record.trafficLimit,
    is_free: record.isFree,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
