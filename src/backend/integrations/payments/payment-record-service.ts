import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { lockPaymentUpstreamOwner } from "@/backend/integrations/payments/payment-owner-service";
import { logger } from "@/backend/observability/logger";
import type {
  PaymentInitResponse,
  PaymentTransactionResponse,
  PlanOffer,
} from "@/backend/integrations/remnashop/contracts";

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
  "$queryRaw" | "paymentOperation" | "paymentRecord"
>;

type ApplyTransactionInput = {
  userId: string;
  transaction: PaymentTransactionResponse;
  operationId?: string;
  payment?: PaymentInitResponse;
  planCode?: string;
};

const MAX_RECORD_PAYMENT_WRITE_ATTEMPTS = 3;
const terminalPaymentStatuses = new Set<PaymentRecordStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "REFUNDED",
]);

function firstTerminalObservation(
  status: PaymentRecordStatus,
  current: Date | null | undefined,
  now: Date,
) {
  return current ?? (terminalPaymentStatuses.has(status) ? now : null);
}

const allowedPaymentStatusTransitions: Record<
  PaymentRecordStatus,
  ReadonlySet<PaymentRecordStatus>
> = {
  UNKNOWN: new Set(["UNKNOWN", "PENDING", "COMPLETED", "FAILED", "CANCELED", "REFUNDED"]),
  PENDING: new Set(["PENDING", "COMPLETED", "FAILED", "CANCELED", "REFUNDED"]),
  FAILED: new Set(["FAILED", "COMPLETED", "REFUNDED"]),
  CANCELED: new Set(["CANCELED", "COMPLETED", "REFUNDED"]),
  COMPLETED: new Set(["COMPLETED", "REFUNDED"]),
  REFUNDED: new Set(["REFUNDED"]),
};

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function paymentConflict(message: string) {
  return new ServiceError("CONFLICT", 409, message);
}

async function assertNewOperationLinkIsUnheld(
  client: PaymentRecordClient,
  operationId: string | undefined,
  record: {
    id: string;
    operationId: string | null;
    retentionHoldAt: Date | null;
    retentionHoldId: string | null;
  } | null,
) {
  if (!operationId || record?.operationId === operationId) return;

  const operation = await client.paymentOperation.findUnique({
    where: { id: operationId },
    select: {
      retentionHoldAt: true,
      retentionHoldId: true,
    },
  });
  const retainedCases = await client.$queryRaw<Array<{ retained: boolean }>>(
    Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "PaymentRetentionHold" AS hold
        WHERE hold."status" IN (
          'ACTIVE'::"PaymentRetentionHoldStatus",
          'RELEASED'::"PaymentRetentionHoldStatus"
        )
          AND (
            hold."caseOperationId" = ${operationId}
            ${record
              ? Prisma.sql`OR hold."casePaymentRecordId" = ${record.id}`
              : Prisma.empty}
          )
      ) AS "retained"
    `,
  );
  if (retainedCases.length !== 1 || typeof retainedCases[0]?.retained !== "boolean") {
    throw new Error("Payment retention case probe returned an invalid result");
  }
  if (
    record?.retentionHoldAt
    || record?.retentionHoldId
    || operation?.retentionHoldAt
    || operation?.retentionHoldId
    || retainedCases[0].retained
  ) {
    throw paymentConflict(
      "A retained payment record and operation cannot be linked until every hold is disposed",
    );
  }
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.InputJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Prisma.InputJsonObject;
}

function sensitiveScrubMarkerCondition(value: Date | null | undefined) {
  return value === undefined ? {} : { sensitiveDataScrubbedAt: value };
}

function sensitiveDataWasScrubbed(value: Date | null | undefined) {
  return value !== null && value !== undefined;
}

function transactionDates(transaction: PaymentTransactionResponse) {
  const upstreamCreatedAt = new Date(transaction.created_at);
  const upstreamUpdatedAt = new Date(transaction.updated_at);

  if (
    !Number.isFinite(upstreamCreatedAt.getTime()) ||
    !Number.isFinite(upstreamUpdatedAt.getTime()) ||
    upstreamUpdatedAt < upstreamCreatedAt
  ) {
    throw new ServiceError(
      "UPSTREAM_ERROR",
      502,
      "Remnashop transaction timestamps are invalid",
    );
  }

  return { upstreamCreatedAt, upstreamUpdatedAt };
}

function toPaymentStatus(status: string): PaymentRecordStatus {
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
  const incomingStatus = toPaymentStatus(input.transaction.status);
  const existing = await client.paymentRecord.findUnique({
    where: { paymentId: input.transaction.payment_id },
    select: {
      id: true,
      userId: true,
      operationId: true,
      status: true,
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
      terminalObservedAt: true,
      sensitiveDataScrubbedAt: true,
      retentionHoldAt: true,
      retentionHoldId: true,
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

  await assertNewOperationLinkIsUnheld(client, input.operationId, existing);

  if (existing) {
    const transitionAllowed =
      allowedPaymentStatusTransitions[existing.status].has(incomingStatus);

    if (
      existing.lastSyncedAt !== null &&
      (upstreamUpdatedAt < existing.upstreamUpdatedAt ||
        !transitionAllowed)
    ) {
      if (!transitionAllowed) {
        logger.warn("payment_status_transition_rejected", {
          paymentRecordId: existing.id,
          currentStatus: existing.status,
          incomingStatus,
          currentUpstreamUpdatedAt: existing.upstreamUpdatedAt,
          incomingUpstreamUpdatedAt: upstreamUpdatedAt,
        });
      }
      const touched = await client.paymentRecord.updateMany({
        where: {
          id: existing.id,
          userId: input.userId,
          ...(input.operationId
            ? {
                OR: [
                  { operationId: null },
                  { operationId: input.operationId },
                ],
              }
            : {}),
        },
        data: {
          lastSyncedAt: syncedAt,
          // A newer history row may already exist before an ambiguous payment
          // operation is reconciled. Preserve that newer authoritative state,
          // but still establish the one-to-one operation relation.
          ...(input.operationId ? { operationId: input.operationId } : {}),
        },
      });

      if (touched.count !== 1) {
        throw paymentConflict(
          "Payment record ownership changed during stale update",
        );
      }

      return client.paymentRecord.findUnique({ where: { id: existing.id } });
    }

    const preserveSensitiveScrub = sensitiveDataWasScrubbed(
      existing.sensitiveDataScrubbedAt,
    );
    const updated = await client.paymentRecord.updateMany({
      where: {
        id: existing.id,
        userId: input.userId,
        ...sensitiveScrubMarkerCondition(existing.sensitiveDataScrubbedAt),
        ...(existing.lastSyncedAt === null
          ? { lastSyncedAt: null }
          : {
              upstreamUpdatedAt: existing.upstreamUpdatedAt,
              lastSyncedAt: existing.lastSyncedAt,
              status: existing.status,
            }),
        ...(input.operationId
          ? { OR: [{ operationId: null }, { operationId: input.operationId }] }
          : {}),
      },
      data: {
        purchaseType: input.transaction.purchase_type,
        status: incomingStatus,
        terminalObservedAt: firstTerminalObservation(
          incomingStatus,
          existing.terminalObservedAt,
          syncedAt,
        ),
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
        isFree:
          input.payment?.is_free ??
          (existing.lastSyncedAt === null
            ? Number(input.transaction.final_amount) === 0
            : existing.isFree),
        ...(preserveSensitiveScrub
          ? {}
          : {
              paymentUrl: input.payment?.payment_url ?? existing.paymentUrl,
              raw: {
                ...jsonObject(existing.raw),
                ...(input.payment ? { payment: input.payment } : {}),
                remnashopTransaction: input.transaction,
              },
            }),
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
        terminalObservedAt: firstTerminalObservation(
          toPaymentStatus(input.transaction.status),
          null,
          syncedAt,
        ),
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
      terminalObservedAt: true,
      sensitiveDataScrubbedAt: true,
      retentionHoldAt: true,
      retentionHoldId: true,
      upstreamCreatedAt: true,
      upstreamUpdatedAt: true,
      lastSyncedAt: true,
    },
  });
  const now = new Date();

  if (
    existing
    && (
      existing.userId !== input.userId
      || (
        options.operationId
        && existing.operationId !== null
        && existing.operationId !== options.operationId
      )
    )
  ) {
    throw paymentConflict(
      "Payment record is owned by another user or operation",
    );
  }
  await assertNewOperationLinkIsUnheld(client, options.operationId, existing);

  const directNonSensitiveData = {
    purchaseType: input.payment.purchase_type,
    status: toPaymentStatus(input.payment.status),
    terminalObservedAt: firstTerminalObservation(
      toPaymentStatus(input.payment.status),
      existing?.terminalObservedAt,
      now,
    ),
    finalAmount: input.payment.final_amount,
    currency: input.payment.currency,
    gatewayType: input.gatewayType,
    planCode: input.plan?.public_code,
    planName: input.plan?.name,
    durationDays: input.durationDays,
    deviceLimit: input.plan?.device_limit,
    trafficLimit: input.plan?.traffic_limit,
    isFree: input.payment.is_free,
    upstreamCreatedAt: now,
    upstreamUpdatedAt: now,
    ...operationLink,
  };
  const directSensitiveData = {
    paymentUrl: input.payment.payment_url,
    raw: input.payment,
  };
  const directData = { ...directNonSensitiveData, ...directSensitiveData };

  if (existing) {
    const preserveSensitiveScrub = sensitiveDataWasScrubbed(
      existing.sensitiveDataScrubbedAt,
    );
    const mutableData = existing.lastSyncedAt
      ? {
          purchaseType: existing.purchaseType,
          status: existing.status,
          terminalObservedAt: firstTerminalObservation(
            existing.status,
            existing.terminalObservedAt,
            now,
          ),
          finalAmount: existing.finalAmount,
          currency: existing.currency,
          gatewayType: existing.gatewayType,
          planCode: existing.planCode ?? input.plan?.public_code,
          planName: existing.planName ?? input.plan?.name,
          durationDays: existing.durationDays ?? input.durationDays,
          deviceLimit: existing.deviceLimit ?? input.plan?.device_limit,
          trafficLimit: existing.trafficLimit ?? input.plan?.traffic_limit,
          isFree: existing.isFree || input.payment.is_free,
          ...(preserveSensitiveScrub
            ? {}
            : {
                paymentUrl: existing.paymentUrl ?? input.payment.payment_url,
                raw: {
                  ...jsonObject(existing.raw),
                  payment: input.payment,
                },
              }),
          upstreamCreatedAt: existing.upstreamCreatedAt,
          upstreamUpdatedAt: existing.upstreamUpdatedAt,
          ...operationLink,
        }
      : {
          ...directNonSensitiveData,
          ...(preserveSensitiveScrub ? {} : directSensitiveData),
          upstreamCreatedAt: existing.upstreamCreatedAt,
        };
    const updated = await client.paymentRecord.updateMany({
      where: {
        id: existing.id,
        userId: input.userId,
        lastSyncedAt: existing.lastSyncedAt,
        upstreamUpdatedAt: existing.upstreamUpdatedAt,
        ...sensitiveScrubMarkerCondition(existing.sensitiveDataScrubbedAt),
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
