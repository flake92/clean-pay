import { Prisma } from "@prisma/client";

import { BffError } from "@/backend/integrations/remnashop/errors";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";

export async function transferPaymentOperationsForUserMerge(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  targetUpstreamAccountId: string | null,
  sourceUserIds: string[],
) {
  if (sourceUserIds.length === 0) {
    return;
  }

  try {
    const lockedTarget = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "WebUser"
        WHERE "id" = ${targetUserId}
        FOR UPDATE
      `,
    );

    if (!lockedTarget[0]) {
      throw new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Payment merge target no longer exists",
      );
    }

    // Sync state is derived data. Removing source rows and resetting the
    // target generation is safer than carrying an owner-bound cursor across
    // identities, and fences workers that fetched a page before the merge.
    await tx.paymentHistorySyncState.deleteMany({
      where: { userId: { in: sourceUserIds } },
    });
    await tx.paymentHistorySyncState.updateMany({
      where: { userId: targetUserId },
      data: {
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

    if (!targetUpstreamAccountId) {
      const sourceOperationCount = await tx.paymentOperation.count({
        where: { userId: { in: sourceUserIds } },
      });

      if (sourceOperationCount > 0) {
        throw new BffError(
          "ACCOUNT_MERGE_REQUIRED",
          409,
          "Payment operations cannot be rebound without a proven upstream owner",
        );
      }

      return;
    }

    const targetOwnerHash = paymentUpstreamOwnerHash(
      targetUpstreamAccountId,
    );

    // A foreground leader cannot finish after its local user id is merged.
    // Same-owner operations remain recoverable by exact upstream lookup.
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
        WHERE "userId" IN (${Prisma.join(sourceUserIds)})
          AND "upstreamOwnerHash" = ${targetOwnerHash}
          AND "status" IN ('DISPATCHING', 'OUTCOME_UNKNOWN')
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
        WHERE "userId" IN (${Prisma.join(sourceUserIds)})
          AND "upstreamOwnerHash" IS DISTINCT FROM ${targetOwnerHash}
          AND "status" IN ('DISPATCHING', 'OUTCOME_UNKNOWN')
      `,
    );

    await tx.paymentOperation.updateMany({
      where: { userId: { in: sourceUserIds } },
      data: {
        userId: targetUserId,
        upstreamOwnerHash: targetOwnerHash,
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Payment operation keys conflict during account merge",
      );
    }

    throw error;
  }
}
