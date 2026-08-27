import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { sha256 } from "@/backend/security/crypto";
import {
  clearedPaymentOwnerChangeFence,
  findInFlightPaymentMergeOperation,
  type LockedPaymentMergeOperation,
  type LockedPaymentMergeUser,
  mergedPaymentOperationIdempotencyHash,
  normalizedOwnerFenceUserIds,
  normalizedPaymentMergeUserIds,
  normalizedPaymentSourceUserIds,
  paymentMergeRequired,
  paymentOwnerFenceLeaseMs,
  paymentOwnerFenceTransactionOptions,
  paymentOwnerLocalFinalizeCommitted,
} from "@/backend/integrations/payments/payment-user-merge-transitions";

export type PaymentUserMergeTransactionClient = Prisma.TransactionClient;

async function lockPaymentOwnerAdvisoryFence(
  tx: Prisma.TransactionClient,
  rawUserIds: string[],
) {
  const userIds = normalizedOwnerFenceUserIds(rawUserIds);

  for (const userId of userIds) {
    const lockIdentity = `clean-pay:payment-owner:v1:${userId}`;
    await tx.$queryRaw<Array<{ locked: number }>>(
      Prisma.sql`
        SELECT 1 AS "locked"
        FROM (
          SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))
        ) AS "paymentOwnerLock"
      `,
    );
  }

  return userIds;
}

/** Clears only an expired barrier after the caller has durably proven that the
 * owner-changing workflow itself completed. Used by idempotent replay paths. */
export async function reconcileCompletedPaymentOwnerChange(
  userIds: string[],
  operationKey: string,
) {
  const normalized = normalizedOwnerFenceUserIds(userIds);
  if (normalized.length === 0) return;
  const operationHash = sha256(operationKey);
  await prisma.$transaction(async (tx) => {
    await lockPaymentOwnerAdvisoryFence(tx, normalized);
    const now = new Date();
    const users = await tx.webUser.findMany({
      where: { id: { in: normalized } },
      select: {
        id: true,
        paymentOwnerChangeTokenHash: true,
        paymentOwnerChangeLeaseExpiresAt: true,
        paymentOwnerChangeMutationStartedAt: true,
        paymentOwnerChangeOperationHash: true,
        paymentOwnerChangeExpectedOwnerHash: true,
      },
    });
    if (users.length !== normalized.length) {
      paymentMergeRequired("Completed owner change no longer has its local owner");
    }
    const pending = users.filter((user) => user.paymentOwnerChangeTokenHash);
    if (pending.length === 0) return;
    if (pending.some((user) =>
      user.paymentOwnerChangeOperationHash !== operationHash
      || !user.paymentOwnerChangeMutationStartedAt
    )) {
      paymentMergeRequired("Completed owner change does not own the current payment fence");
    }
    if (pending.some((user) =>
      !user.paymentOwnerChangeLeaseExpiresAt
      || user.paymentOwnerChangeLeaseExpiresAt > now
    )) {
      paymentMergeRequired("Completed owner change is still finalizing");
    }
    const reconciled = await tx.webUser.updateMany({
      where: {
        id: { in: pending.map(({ id }) => id) },
        paymentOwnerChangeTokenHash: { not: null },
        paymentOwnerChangeLeaseExpiresAt: { lte: now },
        paymentOwnerChangeMutationStartedAt: { not: null },
        paymentOwnerChangeOperationHash: operationHash,
      },
      data: clearedPaymentOwnerChangeFence(),
    });
    if (reconciled.count !== pending.length) {
      paymentMergeRequired("Completed owner change fence changed during reconciliation");
    }
  }, paymentOwnerFenceTransactionOptions);
}

/**
 * Serializes payment dispatch against owner changes and fails closed while a
 * durable owner-change barrier exists. Expired owner-change leases may only be
 * taken over by another owner-change attempt; a payment must never clear one.
 */
export async function lockPaymentOwnerFence(
  tx: Prisma.TransactionClient,
  rawUserIds: string[],
) {
  const userIds = await lockPaymentOwnerAdvisoryFence(tx, rawUserIds);

  if (userIds.length === 0) {
    return userIds;
  }

  const now = new Date();
  const staleUsers = await tx.webUser.findMany({
    where: {
      id: { in: userIds },
      paymentOwnerChangeTokenHash: { not: null },
      paymentOwnerChangeLeaseExpiresAt: { lte: now },
    },
    select: {
      id: true,
      remnashopUserId: true,
      paymentOwnerChangeTokenHash: true,
      paymentOwnerChangeMutationStartedAt: true,
      paymentOwnerChangeLocalFinalizedAt: true,
      paymentOwnerChangeExpectedOwnerHash: true,
    },
  });

  // An expired pre-dispatch claim is safe to remove. A post-dispatch claim is
  // removed only when the surviving local row already carries the expected
  // payment owner, proving that the local finalize transaction committed.
  for (const user of staleUsers) {
    if (
      user.paymentOwnerChangeMutationStartedAt
      && !paymentOwnerLocalFinalizeCommitted(user)
    ) {
      continue;
    }
    await tx.webUser.updateMany({
      where: {
        id: user.id,
        paymentOwnerChangeTokenHash: user.paymentOwnerChangeTokenHash,
        paymentOwnerChangeLeaseExpiresAt: { lte: now },
      },
      data: clearedPaymentOwnerChangeFence(),
    });
  }

  const activeOwnerChange = await tx.webUser.findFirst({
    where: {
      id: { in: userIds },
      paymentOwnerChangeTokenHash: { not: null },
    },
    select: { id: true },
  });

  if (activeOwnerChange) {
    paymentMergeRequired(
      "Payment owner change is incomplete; payment dispatch remains fenced",
    );
  }

  return userIds;
}

export async function assertPaymentOwnerChangeFenceTokenHeld(
  tx: Prisma.TransactionClient,
  rawUserIds: string[],
  tokenHash: string,
) {
  const userIds = await lockPaymentOwnerAdvisoryFence(tx, rawUserIds);
  const now = new Date();
  const users = await tx.webUser.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      paymentOwnerChangeTokenHash: true,
      paymentOwnerChangeLeaseExpiresAt: true,
    },
  });

  if (
    users.length !== userIds.length
    || users.some((user) =>
      user.paymentOwnerChangeTokenHash !== tokenHash
      || !user.paymentOwnerChangeLeaseExpiresAt
      || user.paymentOwnerChangeLeaseExpiresAt <= now
    )
  ) {
    paymentMergeRequired("Payment owner fence lease was lost");
  }
}

export async function markPaymentOwnerChangeTokenLocalFinalized(
  tx: Prisma.TransactionClient,
  rawUserIds: string[],
  tokenHash: string,
) {
  const userIds = normalizedOwnerFenceUserIds(rawUserIds);
  const now = new Date();
  const users = await tx.webUser.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      remnashopUserId: true,
      paymentOwnerChangeTokenHash: true,
      paymentOwnerChangeLeaseExpiresAt: true,
      paymentOwnerChangeMutationStartedAt: true,
      paymentOwnerChangeExpectedOwnerHash: true,
    },
  });
  if (
    users.length !== userIds.length
    || users.some((user) =>
      user.paymentOwnerChangeTokenHash !== tokenHash
      || !user.paymentOwnerChangeLeaseExpiresAt
      || user.paymentOwnerChangeLeaseExpiresAt <= now
      || !user.paymentOwnerChangeMutationStartedAt
      || !user.remnashopUserId
      || user.paymentOwnerChangeExpectedOwnerHash
        !== paymentUpstreamOwnerHash(user.remnashopUserId)
    )
  ) {
    paymentMergeRequired("Local payment owner finalize does not match its fence");
  }
  const marked = await tx.webUser.updateMany({
    where: {
      id: { in: userIds },
      paymentOwnerChangeTokenHash: tokenHash,
      paymentOwnerChangeLeaseExpiresAt: { gt: now },
      paymentOwnerChangeMutationStartedAt: { not: null },
    },
    data: { paymentOwnerChangeLocalFinalizedAt: now },
  });
  if (marked.count !== users.length) {
    paymentMergeRequired("Local payment owner finalize changed concurrently");
  }
}

export async function assertNoActivePaymentDispatches(
  tx: Prisma.TransactionClient,
  rawUserIds: string[],
) {
  const userIds = normalizedOwnerFenceUserIds(rawUserIds);

  if (userIds.length === 0) {
    return;
  }

  const now = new Date();
  const active = await tx.paymentOperation.findFirst({
    where: {
      userId: { in: userIds },
      OR: [
        { status: "DISPATCHING" },
        { status: "READY", leaseExpiresAt: { gt: now } },
      ],
    },
    select: { id: true },
  });

  if (active) {
    paymentMergeRequired(
      "Upstream account cannot change while a payment dispatch is in progress",
    );
  }
}

export async function claimPaymentOwnerChangeFence({
  explicitUserIds,
  normalizedUpstreamIds,
  normalizedEmails,
  normalizedTelegramIds,
  tokenHash,
  operationHash,
  expectedOwnerHash,
  claimGuard,
}: {
  explicitUserIds: string[];
  normalizedUpstreamIds: string[];
  normalizedEmails: string[];
  normalizedTelegramIds: string[];
  tokenHash: string;
  operationHash: string;
  expectedOwnerHash: string;
  claimGuard?: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  return prisma.$transaction(async (tx) => {
    const ownerSelectors: Prisma.WebUserWhereInput[] = [];
    if (explicitUserIds.length > 0) {
      ownerSelectors.push({ id: { in: explicitUserIds } });
    }
    if (normalizedUpstreamIds.length > 0) {
      ownerSelectors.push({ remnashopUserId: { in: normalizedUpstreamIds } });
    }
    if (normalizedEmails.length > 0) {
      ownerSelectors.push({ email: { in: normalizedEmails } });
    }
    if (normalizedTelegramIds.length > 0) {
      ownerSelectors.push({ telegramId: { in: normalizedTelegramIds } });
    }

    const mappedUsers = ownerSelectors.length > 0
      ? await tx.webUser.findMany({
          where: { OR: ownerSelectors },
          select: { id: true },
        })
      : [];
    const fencedUserIds = await lockPaymentOwnerAdvisoryFence(tx, [
      ...explicitUserIds,
      ...mappedUsers.map(({ id }) => id),
    ]);

    if (fencedUserIds.length === 0) {
      paymentMergeRequired("Payment owner fence has no proven local owner");
    }

    // Coordinate with workflow rows which use the WebUser row as their
    // serialization point (for example account-merge confirmation claims).
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "WebUser"
        WHERE "id" IN (${Prisma.join(fencedUserIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
    await claimGuard?.(tx);

    // Owner-changing paths use the same advisory key. Re-read after acquiring
    // all locks and fail closed if the mapping changed while the plan formed.
    const currentMappedUsers = ownerSelectors.length > 0
      ? await tx.webUser.findMany({
          where: { OR: ownerSelectors },
          select: { id: true },
        })
      : [];
    if (currentMappedUsers.some(({ id }) => !fencedUserIds.includes(id))) {
      paymentMergeRequired("Payment merge owner changed before fencing");
    }

    const now = new Date();
    const fencedUsers = await tx.webUser.findMany({
      where: { id: { in: fencedUserIds } },
      select: {
        id: true,
        remnashopUserId: true,
        paymentOwnerChangeTokenHash: true,
        paymentOwnerChangeLeaseExpiresAt: true,
        paymentOwnerChangeMutationStartedAt: true,
        paymentOwnerChangeLocalFinalizedAt: true,
        paymentOwnerChangeOperationHash: true,
        paymentOwnerChangeExpectedOwnerHash: true,
      },
    });
    if (fencedUsers.length !== fencedUserIds.length) {
      paymentMergeRequired("Payment owner fence has an unproven local owner");
    }
    if (fencedUsers.some((user) =>
      user.paymentOwnerChangeTokenHash !== null
      && (
        !user.paymentOwnerChangeLeaseExpiresAt
        || user.paymentOwnerChangeLeaseExpiresAt > now
      )
    )) {
      paymentMergeRequired("Another payment owner change is still in progress");
    }

    for (const user of fencedUsers) {
      if (!user.paymentOwnerChangeTokenHash || !user.paymentOwnerChangeMutationStartedAt) {
        continue;
      }
      if (paymentOwnerLocalFinalizeCommitted(user)) {
        const cleared = await tx.webUser.updateMany({
          where: {
            id: user.id,
            paymentOwnerChangeTokenHash: user.paymentOwnerChangeTokenHash,
            paymentOwnerChangeLeaseExpiresAt: { lte: now },
          },
          data: clearedPaymentOwnerChangeFence(),
        });
        if (cleared.count !== 1) {
          paymentMergeRequired("Completed payment owner fence changed during retry");
        }
        user.paymentOwnerChangeTokenHash = null;
        user.paymentOwnerChangeMutationStartedAt = null;
        user.paymentOwnerChangeOperationHash = null;
        user.paymentOwnerChangeExpectedOwnerHash = null;
        continue;
      }
      if (
        user.paymentOwnerChangeOperationHash !== operationHash
        || user.paymentOwnerChangeExpectedOwnerHash !== expectedOwnerHash
      ) {
        paymentMergeRequired(
          "An incomplete payment owner change requires its exact retry",
        );
      }
    }

    const resumedAfterMutation = fencedUsers.some(
      (user) => Boolean(user.paymentOwnerChangeMutationStartedAt),
    );

    await assertNoActivePaymentDispatches(tx, fencedUserIds);
    const claimed = await tx.webUser.updateMany({
      where: {
        id: { in: fencedUserIds },
        OR: [
          { paymentOwnerChangeTokenHash: null },
          { paymentOwnerChangeLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        paymentOwnerChangeTokenHash: tokenHash,
        paymentOwnerChangeLeaseExpiresAt: new Date(
          now.getTime() + paymentOwnerFenceLeaseMs,
        ),
        paymentOwnerChangeStartedAt: now,
        paymentOwnerChangeMutationStartedAt: resumedAfterMutation ? now : null,
        paymentOwnerChangeLocalFinalizedAt: null,
        paymentOwnerChangeOperationHash: operationHash,
        paymentOwnerChangeExpectedOwnerHash: expectedOwnerHash,
        paymentOwnerChangeAttemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== fencedUserIds.length) {
      paymentMergeRequired("Payment owner fence changed before it was claimed");
    }

    return { userIds: fencedUserIds, resumedAfterMutation };
  }, paymentOwnerFenceTransactionOptions);
}

export async function markPaymentOwnerChangeMutation(
  userIds: string[],
  tokenHash: string,
) {
  await prisma.$transaction(async (tx) => {
    await lockPaymentOwnerAdvisoryFence(tx, userIds);
    const now = new Date();
    const users = await tx.webUser.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        remnashopUserId: true,
        paymentOwnerChangeTokenHash: true,
        paymentOwnerChangeLeaseExpiresAt: true,
        paymentOwnerChangeMutationStartedAt: true,
        paymentOwnerChangeLocalFinalizedAt: true,
        paymentOwnerChangeExpectedOwnerHash: true,
      },
    });
    if (users.length !== userIds.length || users.some((user) =>
      user.paymentOwnerChangeTokenHash !== tokenHash
      || !user.paymentOwnerChangeLeaseExpiresAt
      || user.paymentOwnerChangeLeaseExpiresAt <= now
    )) {
      paymentMergeRequired("Payment owner fence lease was lost before upstream mutation");
    }
    const marked = await tx.webUser.updateMany({
      where: {
        id: { in: userIds },
        paymentOwnerChangeTokenHash: tokenHash,
        paymentOwnerChangeLeaseExpiresAt: { gt: now },
      },
      data: { paymentOwnerChangeMutationStartedAt: now },
    });
    if (marked.count !== users.length) {
      paymentMergeRequired("Payment owner fence changed before upstream mutation");
    }
  }, paymentOwnerFenceTransactionOptions);
}

export async function releasePaymentOwnerChangeFence(
  userIds: string[],
  tokenHash: string,
) {
  await prisma.$transaction(async (tx) => {
    await lockPaymentOwnerAdvisoryFence(tx, userIds);
    await tx.webUser.updateMany({
      where: {
        id: { in: userIds },
        paymentOwnerChangeTokenHash: tokenHash,
      },
      data: clearedPaymentOwnerChangeFence(),
    });
  }, paymentOwnerFenceTransactionOptions);
}

export async function renewPaymentOwnerChangeFence(
  userIds: string[],
  tokenHash: string,
) {
  await prisma.$transaction(async (tx) => {
    await lockPaymentOwnerAdvisoryFence(tx, userIds);
    const now = new Date();
    const currentUsers = await tx.webUser.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        remnashopUserId: true,
        paymentOwnerChangeTokenHash: true,
        paymentOwnerChangeLeaseExpiresAt: true,
        paymentOwnerChangeMutationStartedAt: true,
        paymentOwnerChangeLocalFinalizedAt: true,
        paymentOwnerChangeExpectedOwnerHash: true,
      },
    });
    if (
      currentUsers.length === 0
      || currentUsers.some((user) =>
        user.paymentOwnerChangeTokenHash !== tokenHash
        || !user.paymentOwnerChangeLeaseExpiresAt
        || user.paymentOwnerChangeLeaseExpiresAt <= now
      )
    ) {
      paymentMergeRequired("Payment owner fence lease was lost before renewal");
    }

    const renewed = await tx.webUser.updateMany({
      where: {
        id: { in: currentUsers.map(({ id }) => id) },
        paymentOwnerChangeTokenHash: tokenHash,
        paymentOwnerChangeLeaseExpiresAt: { gt: now },
      },
      data: {
        paymentOwnerChangeLeaseExpiresAt: new Date(
          now.getTime() + paymentOwnerFenceLeaseMs,
        ),
      },
    });
    if (renewed.count !== currentUsers.length) {
      paymentMergeRequired("Payment owner fence changed during renewal");
    }
  }, paymentOwnerFenceTransactionOptions);
}

export async function finalizePaymentOwnerChangeFence(
  userIds: string[],
  tokenHash: string,
) {
  await prisma.$transaction(async (tx) => {
    await lockPaymentOwnerAdvisoryFence(tx, userIds);
    const now = new Date();
    const currentUsers = await tx.webUser.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        remnashopUserId: true,
        paymentOwnerChangeTokenHash: true,
        paymentOwnerChangeLeaseExpiresAt: true,
        paymentOwnerChangeMutationStartedAt: true,
        paymentOwnerChangeLocalFinalizedAt: true,
        paymentOwnerChangeExpectedOwnerHash: true,
      },
    });
    if (
      currentUsers.length === 0
      || currentUsers.some((user) =>
        user.paymentOwnerChangeTokenHash !== tokenHash
        || !user.paymentOwnerChangeLeaseExpiresAt
        || user.paymentOwnerChangeLeaseExpiresAt <= now
      )
    ) {
      paymentMergeRequired("Payment owner fence was lost before finalization");
    }
    if (currentUsers.some((user) =>
      user.paymentOwnerChangeMutationStartedAt
      && !paymentOwnerLocalFinalizeCommitted(user)
    )) {
      paymentMergeRequired(
        "Payment owner change local finalize was not durably committed",
      );
    }

    // A successful local merge may have deleted one or more claimed source
    // users. Deleted rows no longer need a barrier; every surviving row must
    // still carry this attempt's token before it can be cleared.
    const finalized = await tx.webUser.updateMany({
      where: {
        id: { in: currentUsers.map(({ id }) => id) },
        paymentOwnerChangeTokenHash: tokenHash,
      },
      data: clearedPaymentOwnerChangeFence(),
    });
    if (finalized.count !== currentUsers.length) {
      paymentMergeRequired("Payment owner fence changed during finalization");
    }
  }, paymentOwnerFenceTransactionOptions);
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
  const userIds = normalizedPaymentMergeUserIds(targetUserId, sourceUserIds);
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
    lockedUserIds.size !== userIds.length
    || userIds.some((userId) => !lockedUserIds.has(userId))
  ) {
    paymentMergeRequired("Payment merge owner changed before preflight");
  }

  const lockedOperations = await tx.$queryRaw<LockedPaymentMergeOperation[]>(
    Prisma.sql`
      SELECT "id", "userId", "idempotencyKeyHash", "upstreamKey", "status", "leaseExpiresAt"
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

  return {
    targetUpstreamAccountId:
      lockedUsers.find(({ id }) => id === targetUserId)?.remnashopUserId ?? null,
    lockedOperations,
  };
}

async function rekeyCollidingSourcePaymentOperations(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  lockedOperations: LockedPaymentMergeOperation[],
) {
  const retainedKeys = new Set(
    lockedOperations
      .filter(({ userId }) => userId === targetUserId)
      .map(({ idempotencyKeyHash }) => idempotencyKeyHash),
  );
  const occupiedKeys = new Set(
    lockedOperations.map(({ idempotencyKeyHash }) => idempotencyKeyHash),
  );

  for (const operation of lockedOperations) {
    if (operation.userId === targetUserId) {
      continue;
    }

    if (!retainedKeys.has(operation.idempotencyKeyHash)) {
      retainedKeys.add(operation.idempotencyKeyHash);
      continue;
    }

    let counter = 0;
    let replacement: string;
    do {
      replacement = mergedPaymentOperationIdempotencyHash(operation, counter);
      counter += 1;
    } while (occupiedKeys.has(replacement));

    const updated = await tx.paymentOperation.updateMany({
      where: {
        id: operation.id,
        userId: operation.userId,
        idempotencyKeyHash: operation.idempotencyKeyHash,
      },
      data: { idempotencyKeyHash: replacement },
    });
    if (updated.count !== 1) {
      paymentMergeRequired("Payment operation changed during account merge");
    }
    retainedKeys.add(replacement);
    occupiedKeys.add(replacement);
  }
}

export async function transferPaymentOperationsForUserMerge(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  targetUpstreamAccountId: string | null,
  rawSourceUserIds: string[],
) {
  const sourceUserIds = normalizedPaymentSourceUserIds(
    targetUserId,
    rawSourceUserIds,
  );

  try {
    const preflight = await preflightPaymentOperationsForUserMerge(
      tx,
      targetUserId,
      sourceUserIds,
    );
    const targetOwnerChanged =
      preflight.targetUpstreamAccountId !== targetUpstreamAccountId;
    const now = new Date();
    const inFlightOperation = findInFlightPaymentMergeOperation(
      preflight.lockedOperations,
      now,
    );

    if ((targetOwnerChanged || sourceUserIds.length > 0) && inFlightOperation) {
      paymentMergeRequired(
        "Upstream account cannot change while a payment dispatch is in progress",
      );
    }

    await rekeyCollidingSourcePaymentOperations(
      tx,
      targetUserId,
      preflight.lockedOperations,
    );
    const operationUserIds = [
      ...(targetOwnerChanged ? [targetUserId] : []),
      ...sourceUserIds,
    ];

    if (!targetUpstreamAccountId) {
      const operationCount = operationUserIds.length === 0
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
              in: normalizedPaymentMergeUserIds(targetUserId, sourceUserIds),
            },
          },
        });
      }

      return;
    }

    const targetOwnerHash = paymentUpstreamOwnerHash(targetUpstreamAccountId);

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
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      paymentMergeRequired(
        "Payment operation keys conflict during account merge",
      );
    }

    throw error;
  }
}
