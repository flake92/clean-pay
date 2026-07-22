import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { lockPaymentUpstreamOwner } from "@/backend/payments/owner";
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

export type PaymentRecordClient = Pick<
  Prisma.TransactionClient,
  "paymentRecord"
>;

type ApplyTransactionInput = {
  userId: string;
  transaction: PaymentTransactionResponse;
  operationId?: string;
  payment?: PaymentInitResponse;
  planCode?: string;
};

const MAX_RECORD_PAYMENT_WRITE_ATTEMPTS = 3;

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function paymentConflict(message: string) {
  return new BffError("CONFLICT", 409, message);
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.InputJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Prisma.InputJsonObject;
}

function transactionDates(transaction: PaymentTransactionResponse) {
  const upstreamCreatedAt = new Date(transaction.created_at);
  const upstreamUpdatedAt = new Date(transaction.updated_at);

  if (
    !Number.isFinite(upstreamCreatedAt.getTime()) ||
    !Number.isFinite(upstreamUpdatedAt.getTime()) ||
    upstreamUpdatedAt < upstreamCreatedAt
  ) {
    throw new BffError(
      "UPSTREAM_ERROR",
      502,
      "Remnashop transaction timestamps are invalid",
    );
  }

  return { upstreamCreatedAt, upstreamUpdatedAt };
}

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

/**
 * Applies one strictly validated upstream row without ever changing ownership.
 * Callers that pass an interactive transaction get page-level atomicity.
 */
export async function applyRemnashopTransaction(
  client: PaymentRecordClient,
  input: ApplyTransactionInput,
  optimisticRetry = 0,
) {
  const { upstreamCreatedAt, upstreamUpdatedAt } = transactionDates(
    input.transaction,
  );
  const syncedAt = new Date();
  const existing = await client.paymentRecord.findUnique({
    where: { paymentId: input.transaction.payment_id },
    select: {
      id: true,
      userId: true,
      operationId: true,
      upstreamCreatedAt: true,
      upstreamUpdatedAt: true,
      lastSyncedAt: true,
      planName: true,
      planCode: true,
      durationDays: true,
      deviceLimit: true,
      trafficLimit: true,
      paymentUrl: true,
      isFree: true,
      raw: true,
    },
  });

  if (existing?.userId !== undefined && existing.userId !== input.userId) {
    throw paymentConflict("Upstream payment id belongs to another local user");
  }

  if (
    existing?.operationId &&
    input.operationId &&
    existing.operationId !== input.operationId
  ) {
    throw paymentConflict("Upstream payment id belongs to another operation");
  }

  if (existing) {
    if (
      existing.lastSyncedAt !== null &&
      upstreamUpdatedAt < existing.upstreamUpdatedAt
    ) {
      const touched = await client.paymentRecord.updateMany({
        where: { id: existing.id, userId: input.userId },
        data: { lastSyncedAt: syncedAt },
      });

      if (touched.count !== 1) {
        throw paymentConflict(
          "Payment record ownership changed during stale update",
        );
      }

      return client.paymentRecord.findUnique({ where: { id: existing.id } });
    }

    const updated = await client.paymentRecord.updateMany({
      where: {
        id: existing.id,
        userId: input.userId,
        ...(existing.lastSyncedAt === null
          ? { lastSyncedAt: null }
          : { upstreamUpdatedAt: { lte: upstreamUpdatedAt } }),
        ...(input.operationId
          ? { OR: [{ operationId: null }, { operationId: input.operationId }] }
          : {}),
      },
      data: {
        purchaseType: input.transaction.purchase_type,
        status: toPaymentStatus(input.transaction.status),
        finalAmount: input.transaction.final_amount,
        currency: input.transaction.currency,
        gatewayType: input.transaction.gateway_type,
        planCode: input.planCode ?? existing.planCode,
        planName: input.transaction.plan_name ?? existing.planName,
        durationDays:
          input.transaction.duration_days ?? existing.durationDays,
        deviceLimit: input.transaction.device_limit ?? existing.deviceLimit,
        trafficLimit:
          input.transaction.traffic_limit ?? existing.trafficLimit,
        paymentUrl: input.payment?.payment_url ?? existing.paymentUrl,
        isFree:
          input.payment?.is_free ??
          (existing.lastSyncedAt === null
            ? Number(input.transaction.final_amount) === 0
            : existing.isFree),
        raw: {
          ...jsonObject(existing.raw),
          ...(input.payment ? { payment: input.payment } : {}),
          remnashopTransaction: input.transaction,
        },
        ...(input.operationId ? { operationId: input.operationId } : {}),
        upstreamCreatedAt:
          existing.lastSyncedAt === null
            ? upstreamCreatedAt
            : existing.upstreamCreatedAt,
        upstreamUpdatedAt,
        lastSyncedAt: syncedAt,
      },
    });

    if (updated.count !== 1) {
      if (optimisticRetry < 2) {
        return applyRemnashopTransaction(
          client,
          input,
          optimisticRetry + 1,
        );
      }

      throw paymentConflict(
        "Payment record changed while applying upstream transaction",
      );
    }

    return client.paymentRecord.findUnique({ where: { id: existing.id } });
  }

  try {
    return await client.paymentRecord.create({
      data: {
        userId: input.userId,
        paymentId: input.transaction.payment_id,
        purchaseType: input.transaction.purchase_type,
        status: toPaymentStatus(input.transaction.status),
        finalAmount: input.transaction.final_amount,
        currency: input.transaction.currency,
        gatewayType: input.transaction.gateway_type,
        planCode: input.planCode,
        planName: input.transaction.plan_name,
        durationDays: input.transaction.duration_days,
        deviceLimit: input.transaction.device_limit,
        trafficLimit: input.transaction.traffic_limit,
        paymentUrl: input.payment?.payment_url,
        isFree:
          input.payment?.is_free ?? Number(input.transaction.final_amount) === 0,
        raw: {
          ...(input.payment ? { payment: input.payment } : {}),
          remnashopTransaction: input.transaction,
        },
        operationId: input.operationId,
        upstreamCreatedAt,
        upstreamUpdatedAt,
        lastSyncedAt: syncedAt,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    // Outside an interactive transaction the competing insert has committed,
    // so reread and verify ownership. Interactive callers retry the whole page.
    if (client !== prisma) {
      throw error;
    }

    const winner = await client.paymentRecord.findUnique({
      where: { paymentId: input.transaction.payment_id },
      select: { userId: true },
    });

    if (!winner) {
      throw error;
    }

    if (winner.userId !== input.userId) {
      throw paymentConflict("Concurrent payment insert belongs to another user");
    }

    return applyRemnashopTransaction(client, input);
  }
}

export async function syncPaymentRecordsFromRemnashopTransactions({
  userId,
  upstreamAccountId,
  transactions,
}: {
  userId: string;
  upstreamAccountId: string;
  transactions: PaymentTransactionResponse[];
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        await lockPaymentUpstreamOwner(
          tx,
          userId,
          paymentUpstreamOwnerHash(upstreamAccountId),
        );
        for (const transaction of transactions) {
          await applyRemnashopTransaction(tx, { userId, transaction });
        }
      });
      return;
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 1) {
        throw error;
      }
    }
  }
}

export async function syncExactPaymentRecordFromRemnashop(input: {
  userId: string;
  upstreamAccountId: string;
  transaction: PaymentTransactionResponse;
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockPaymentUpstreamOwner(
          tx,
          input.userId,
          paymentUpstreamOwnerHash(input.upstreamAccountId),
        );

        return applyRemnashopTransaction(tx, input);
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 1) {
        throw error;
      }
    }
  }
}

async function recordPaymentAttempt(
  input: RecordPaymentInput,
  options: {
    client?: PaymentRecordClient;
    operationId?: string;
  },
  writeAttempt: number,
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
      purchaseType: true,
      status: true,
      finalAmount: true,
      currency: true,
      gatewayType: true,
      planCode: true,
      planName: true,
      durationDays: true,
      deviceLimit: true,
      trafficLimit: true,
      paymentUrl: true,
      isFree: true,
      raw: true,
      upstreamCreatedAt: true,
      upstreamUpdatedAt: true,
      lastSyncedAt: true,
    },
  });
  const now = new Date();
  const directData = {
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
    upstreamCreatedAt: now,
    upstreamUpdatedAt: now,
    ...operationLink,
  };

  if (existing) {
    if (
      existing.userId !== input.userId ||
      (options.operationId &&
        existing.operationId !== null &&
        existing.operationId !== options.operationId)
    ) {
      throw paymentConflict(
        "Payment record is owned by another user or operation",
      );
    }

    const mutableData = existing.lastSyncedAt
      ? {
          purchaseType: existing.purchaseType,
          status: existing.status,
          finalAmount: existing.finalAmount,
          currency: existing.currency,
          gatewayType: existing.gatewayType,
          planCode: existing.planCode ?? input.plan?.public_code,
          planName: existing.planName ?? input.plan?.name,
          durationDays: existing.durationDays ?? input.durationDays,
          deviceLimit: existing.deviceLimit ?? input.plan?.device_limit,
          trafficLimit: existing.trafficLimit ?? input.plan?.traffic_limit,
          paymentUrl: existing.paymentUrl ?? input.payment.payment_url,
          isFree: existing.isFree || input.payment.is_free,
          raw: {
            ...jsonObject(existing.raw),
            payment: input.payment,
          },
          upstreamCreatedAt: existing.upstreamCreatedAt,
          upstreamUpdatedAt: existing.upstreamUpdatedAt,
          ...operationLink,
        }
      : {
          ...directData,
          upstreamCreatedAt: existing.upstreamCreatedAt,
        };
    const updated = await client.paymentRecord.updateMany({
      where: {
        id: existing.id,
        userId: input.userId,
        lastSyncedAt: existing.lastSyncedAt,
        upstreamUpdatedAt: existing.upstreamUpdatedAt,
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
      if (writeAttempt + 1 < MAX_RECORD_PAYMENT_WRITE_ATTEMPTS) {
        return recordPaymentAttempt(input, options, writeAttempt + 1);
      }

      throw paymentConflict("Payment record ownership changed during update");
    }

    return client.paymentRecord.findUnique({ where: { id: existing.id } });
  }

  try {
    return await client.paymentRecord.create({
      data: {
        userId: input.userId,
        paymentId: input.payment.payment_id,
        ...directData,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error) || client !== prisma) {
      throw error;
    }

    const winner = await client.paymentRecord.findUnique({
      where: { paymentId: input.payment.payment_id },
      select: { userId: true, operationId: true },
    });

    if (
      !winner ||
      winner.userId !== input.userId ||
      (options.operationId &&
        winner.operationId !== null &&
        winner.operationId !== options.operationId)
    ) {
      throw paymentConflict("Concurrent payment insert has a different owner");
    }

    if (writeAttempt + 1 < MAX_RECORD_PAYMENT_WRITE_ATTEMPTS) {
      return recordPaymentAttempt(input, options, writeAttempt + 1);
    }

    throw paymentConflict("Payment record kept changing during insert");
  }
}

export async function recordPayment(
  input: RecordPaymentInput,
  options: {
    client?: PaymentRecordClient;
    operationId?: string;
  } = {},
) {
  return recordPaymentAttempt(input, options, 0);
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
  upstreamCreatedAt: Date;
  upstreamUpdatedAt: Date;
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
    created_at: record.upstreamCreatedAt.toISOString(),
    updated_at: record.upstreamUpdatedAt.toISOString(),
  };
}
