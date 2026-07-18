import { Prisma } from "@prisma/client";

import { BffError } from "@/backend/integrations/remnashop/errors";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";

type LockedPaymentMergeUser = {
  id: string;
  remnashopUserId: string | null;
};

type LockedPaymentMergeOperation = {
  id: string;
  userId: string;
  idempotencyKeyHash: string;
};

function normalizedMergeUserIds(
  targetUserId: string,
  sourceUserIds: string[],
) {
  return [
    targetUserId,
    ...new Set(sourceUserIds.filter((userId) => userId !== targetUserId)),
  ].sort();
}

function paymentMergeRequired(message: string): never {
  throw new BffError("ACCOUNT_MERGE_REQUIRED", 409, message);
}

/**
 * Establishes the local payment barrier that must remain open while an
 * upstream account merge is dispatched. New operations lock their WebUser,
 * so the user locks below prevent an operation from appearing after the
 * operation rows have been inspected.
 */
export async function preflightPaymentOperationsForUserMerge(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  sourceUserIds: string[],
) {
  const userIds = normalizedMergeUserIds(targetUserId, sourceUserIds);
  const lockedUsers = await tx.$queryRaw<LockedPaymentMergeUser[]>(
    Prisma.sql`
      SELECT "id", "remnashopUserId"
      FROM "WebUser"
      WHERE "id" IN (${Prisma.join(userIds)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );
  const lockedUserIds = new Set(lockedUsers.map(({ id }) => id));

  if (
    lockedUserIds.size !== userIds.length ||
    userIds.some((userId) => !lockedUserIds.has(userId))
  ) {
    paymentMergeRequired("Payment merge owner changed before preflight");
  }

  const lockedOperations = await tx.$queryRaw<LockedPaymentMergeOperation[]>(
    Prisma.sql`
      SELECT "id", "userId", "idempotencyKeyHash"
      FROM "PaymentOperation"
      WHERE "userId" IN (${Prisma.join(userIds)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );

  await tx.$queryRaw<Array<{ userId: string }>>(
    Prisma.sql`
      SELECT "userId"
      FROM "PaymentHistorySyncState"
      WHERE "userId" IN (${Prisma.join(userIds)})
      ORDER BY "userId"
      FOR UPDATE
    `,
  );

  const operationByKey = new Map<string, LockedPaymentMergeOperation>();

  for (const operation of lockedOperations) {
    const existing = operationByKey.get(operation.idempotencyKeyHash);

    if (existing && existing.id !== operation.id) {
      paymentMergeRequired(
        "Payment operation keys conflict during account merge",
      );
    }

    operationByKey.set(operation.idempotencyKeyHash, operation);
  }

  return {
    targetUpstreamAccountId:
      lockedUsers.find(({ id }) => id === targetUserId)?.remnashopUserId ??
      null,
  };
}

export async function transferPaymentOperationsForUserMerge(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  targetUpstreamAccountId: string | null,
  rawSourceUserIds: string[],
) {
  const sourceUserIds = [
    ...new Set(
      rawSourceUserIds.filter((userId) => userId !== targetUserId),
    ),
  ];

  try {
    const preflight = await preflightPaymentOperationsForUserMerge(
      tx,
      targetUserId,
      sourceUserIds,
    );
    const targetOwnerChanged =
      preflight.targetUpstreamAccountId !== targetUpstreamAccountId;
    const operationUserIds = [
      ...(targetOwnerChanged ? [targetUserId] : []),
      ...sourceUserIds,
    ];

    if (!targetUpstreamAccountId) {
      const operationCount =
        operationUserIds.length === 0
          ? 0
          : await tx.paymentOperation.count({
              where: { userId: { in: operationUserIds } },
            });

      if (operationCount > 0) {
        paymentMergeRequired(
          "Payment operations cannot be rebound without a proven upstream owner",
        );
      }

      // History state is derived and cannot remain bound to an owner that is
      // no longer proven.
      if (sourceUserIds.length > 0 || targetOwnerChanged) {
        await tx.paymentHistorySyncState.deleteMany({
          where: {
            userId: {
              in: normalizedMergeUserIds(targetUserId, sourceUserIds),
            },
          },
        });
      }

      return;
    }

    const targetOwnerHash = paymentUpstreamOwnerHash(
      targetUpstreamAccountId,
    );

    // Sync state is derived data. Removing source rows and resetting the
    // target generation is safer than carrying an owner-bound cursor across
    // identities, and fences workers that fetched a page before the merge.
    if (sourceUserIds.length > 0) {
      await tx.paymentHistorySyncState.deleteMany({
        where: { userId: { in: sourceUserIds } },
      });
    }
    if (sourceUserIds.length > 0 || targetOwnerChanged) {
      await tx.paymentHistorySyncState.updateMany({
        where: { userId: targetUserId },
        data: {
          upstreamOwnerHash: targetOwnerHash,
          cursor: null,
          generation: { increment: 1 },
          claimTokenHash: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastAttemptAt: null,
          lastSyncedAt: null,
          backfillCompletedAt: null,
          attemptCount: 0,
          failureCount: 0,
          errorSnapshot: Prisma.DbNull,
        },
      });
    }

    if (operationUserIds.length === 0) {
      return;
    }

    // A foreground leader cannot finish after its local user id is merged.
    // Same-owner operations remain recoverable by exact upstream lookup. An
    // operation already frozen for manual review must never be reopened.
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE "PaymentOperation"
        SET "userId" = ${targetUserId},
            "status" = 'OUTCOME_UNKNOWN',
            "claimTokenHash" = NULL,
            "leaseExpiresAt" = NULL,
            "outcomeUnknownAt" = COALESCE("outcomeUnknownAt", clock_timestamp()),
            "reconcileClaimTokenHash" = NULL,
            "reconcileLeaseExpiresAt" = NULL,
            "reconcileNextAttemptAt" = clock_timestamp(),
            "reconcileErrorSnapshot" = NULL,
            "reconciledAt" = NULL,
            "updatedAt" = clock_timestamp()
        WHERE "userId" IN (${Prisma.join(operationUserIds)})
          AND "upstreamOwnerHash" = ${targetOwnerHash}
          AND "status" IN ('DISPATCHING', 'OUTCOME_UNKNOWN')
          AND (
            "reconciledAt" IS NULL
            OR ("reconcileErrorSnapshot" ->> 'code') IS DISTINCT FROM 'MANUAL_REQUIRED'
          )
      `,
    );

    // A changed owner cannot prove whether the old account crossed the
    // provider boundary. Keep the key and require an operator decision.
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE "PaymentOperation"
        SET "userId" = ${targetUserId},
            "upstreamOwnerHash" = ${targetOwnerHash},
            "status" = 'OUTCOME_UNKNOWN',
            "claimTokenHash" = NULL,
            "leaseExpiresAt" = NULL,
            "outcomeUnknownAt" = COALESCE("outcomeUnknownAt", clock_timestamp()),
            "reconcileClaimTokenHash" = NULL,
            "reconcileLeaseExpiresAt" = NULL,
            "reconcileNextAttemptAt" = NULL,
            "reconcileFailureCount" = "reconcileFailureCount" + 1,
            "reconcileErrorSnapshot" = jsonb_build_object(
              'code', 'MANUAL_REQUIRED',
              'reason', 'UPSTREAM_OWNER_REBOUND',
              'operator_action', 'REVIEW_PAYMENT_OPERATION'
            ),
            "reconciledAt" = clock_timestamp(),
            "updatedAt" = clock_timestamp()
        WHERE "userId" IN (${Prisma.join(operationUserIds)})
          AND "upstreamOwnerHash" IS DISTINCT FROM ${targetOwnerHash}
          AND "status" IN ('DISPATCHING', 'OUTCOME_UNKNOWN')
      `,
    );

    await tx.paymentOperation.updateMany({
      where: { userId: { in: operationUserIds } },
      data: {
        userId: targetUserId,
        upstreamOwnerHash: targetOwnerHash,
        claimTokenHash: null,
        leaseExpiresAt: null,
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      paymentMergeRequired(
        "Payment operation keys conflict during account merge",
      );
    }

    throw error;
  }
}
