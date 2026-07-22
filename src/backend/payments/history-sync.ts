import { Prisma, type PaymentHistorySyncState } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import {
  getPaymentCapabilities,
  getTransactionPage,
  type RemnashopTransactionPage,
} from "@/backend/integrations/remnashop/payment-recovery";
import {
  getRemnashopUserIdFromAccessToken,
  getJwtExpiresAt,
  revealRemnashopToken,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { applyRemnashopTransaction } from "@/backend/payments/records";
import { lockPaymentUpstreamOwner } from "@/backend/payments/owner";
import { randomToken, safeEqual, sha256 } from "@/backend/security/crypto";

// A backfill claim can perform two independently bounded 10s upstream calls and
// atomically apply the maximum 100-row page. Keep a full 100s of DB/application
// headroom after those network bounds; an expired worker is still fenced below.
const HISTORY_LEASE_MS = 120_000;
const HISTORY_TOKEN_MIN_TTL_MS = 30_000;
const HISTORY_REFRESH_INTERVAL_MS = 5 * 60_000;
const MAX_HISTORY_SESSION_CANDIDATES = 20;
const MAX_HISTORY_FAILURE_BACKOFF_MS = 15 * 60_000;

export type PaymentHistorySyncClaim = {
  userId: string;
  upstreamOwnerHash: string;
  generation: number;
  cursor: string | null;
  backfill: boolean;
  claimToken: string;
  leaseExpiresAt: Date;
};

function claimHash(token: string) {
  return sha256(`clean-pay:payment-history-sync:claim:v1:${token}`);
}

async function databaseNow(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Database did not return a valid current timestamp");
  }

  return now;
}

function retryDelayMs(failureCount: number) {
  return Math.min(
    MAX_HISTORY_FAILURE_BACKOFF_MS,
    5_000 * 2 ** Math.min(failureCount, 8),
  );
}

function safeFailureSnapshot(error: unknown): Prisma.InputJsonObject {
  if (error instanceof BffError) {
    return { code: error.code, status: error.status };
  }

  return {
    code: "INTERNAL_ERROR",
    name: error instanceof Error ? error.name : "UnknownError",
  };
}

export async function claimPaymentHistorySync(input: {
  userId: string;
  upstreamAccountId: string;
}): Promise<PaymentHistorySyncClaim | null> {
  const upstreamOwnerHash = paymentUpstreamOwnerHash(input.upstreamAccountId);

  return prisma.$transaction(async (tx) => {
    const lockedOwners = await tx.$queryRaw<
      Array<{ remnashopUserId: string | null }>
    >(Prisma.sql`
      SELECT "remnashopUserId"
      FROM "WebUser"
      WHERE "id" = ${input.userId}
      FOR KEY SHARE
    `);
    const lockedOwner = lockedOwners[0]?.remnashopUserId;

    if (
      !lockedOwner ||
      !safeEqual(
        paymentUpstreamOwnerHash(lockedOwner),
        upstreamOwnerHash,
      )
    ) {
      throw new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Remnashop identity changed before payment history sync",
      );
    }

    await tx.paymentHistorySyncState.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        upstreamOwnerHash,
      },
      update: {},
    });
    const lockedStates = await tx.$queryRaw<PaymentHistorySyncState[]>(
      Prisma.sql`SELECT * FROM "PaymentHistorySyncState" WHERE "userId" = ${input.userId} FOR UPDATE`,
    );
    let state = lockedStates[0];

    if (!state) {
      return null;
    }
    const now = await databaseNow(tx);

    if (!safeEqual(state.upstreamOwnerHash, upstreamOwnerHash)) {
      const reset = await tx.paymentHistorySyncState.updateMany({
        where: {
          userId: input.userId,
          upstreamOwnerHash: state.upstreamOwnerHash,
          generation: state.generation,
        },
        data: {
          upstreamOwnerHash,
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

      if (reset.count !== 1) {
        return null;
      }

      const refreshed = await tx.paymentHistorySyncState.findUnique({
        where: { userId: input.userId },
      });

      if (!refreshed) {
        return null;
      }

      state = refreshed;
    }

    if (
      (state.leaseExpiresAt && state.leaseExpiresAt > now) ||
      (state.nextAttemptAt && state.nextAttemptAt > now)
    ) {
      return null;
    }

    if (state.backfillCompletedAt !== null) {
      const lastCompletedSync = state.lastSyncedAt ?? state.backfillCompletedAt;

      if (
        lastCompletedSync.getTime() >
        now.getTime() - HISTORY_REFRESH_INTERVAL_MS
      ) {
        return null;
      }

      const restarted = await tx.paymentHistorySyncState.updateMany({
        where: {
          userId: input.userId,
          upstreamOwnerHash,
          generation: state.generation,
          backfillCompletedAt: state.backfillCompletedAt,
        },
        data: {
          cursor: null,
          generation: { increment: 1 },
          claimTokenHash: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          backfillCompletedAt: null,
          failureCount: 0,
          errorSnapshot: Prisma.DbNull,
        },
      });

      if (restarted.count !== 1) {
        return null;
      }

      const restartedState = await tx.paymentHistorySyncState.findUnique({
        where: { userId: input.userId },
      });

      if (!restartedState) {
        return null;
      }

      state = restartedState;
    }

    const claimToken = randomToken(32);
    const leaseExpiresAt = new Date(now.getTime() + HISTORY_LEASE_MS);
    const claimed = await tx.paymentHistorySyncState.updateMany({
      where: {
        userId: input.userId,
        upstreamOwnerHash,
        generation: state.generation,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: now } },
            ],
          },
        ],
      },
      data: {
        claimTokenHash: claimHash(claimToken),
        leaseExpiresAt,
        lastAttemptAt: now,
        attemptCount: { increment: 1 },
      },
    });

    if (claimed.count !== 1) {
      return null;
    }

    return {
      userId: input.userId,
      upstreamOwnerHash,
      generation: state.generation,
      cursor: state.cursor,
      backfill: true,
      claimToken,
      leaseExpiresAt,
    };
  });
}

export async function completePaymentHistoryPage(
  claim: PaymentHistorySyncClaim,
  page: RemnashopTransactionPage,
) {
  return prisma.$transaction(async (tx) => {
    await lockPaymentUpstreamOwner(
      tx,
      claim.userId,
      claim.upstreamOwnerHash,
    );
    const tokenHash = claimHash(claim.claimToken);
    const lockedStates = await tx.$queryRaw<PaymentHistorySyncState[]>(
      Prisma.sql`
        SELECT *
        FROM "PaymentHistorySyncState"
        WHERE "userId" = ${claim.userId}
        FOR UPDATE
      `,
    );
    const state = lockedStates[0];
    const now = await databaseNow(tx);

    if (
      !state ||
      state.generation !== claim.generation ||
      !safeEqual(state.upstreamOwnerHash, claim.upstreamOwnerHash) ||
      !state.claimTokenHash ||
      !safeEqual(state.claimTokenHash, tokenHash) ||
      !state.leaseExpiresAt ||
      state.leaseExpiresAt <= now
    ) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment history sync lease is no longer owned by this worker",
      );
    }

    for (const transaction of page.items) {
      await applyRemnashopTransaction(tx, {
        userId: claim.userId,
        transaction,
      });
    }

    const completionNow = await databaseNow(tx);

    const completed = await tx.paymentHistorySyncState.updateMany({
      where: {
        userId: claim.userId,
        upstreamOwnerHash: claim.upstreamOwnerHash,
        generation: claim.generation,
        claimTokenHash: tokenHash,
        leaseExpiresAt: { gt: completionNow },
      },
      data: {
        cursor: page.next_cursor,
        claimTokenHash: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastSyncedAt: completionNow,
        failureCount: 0,
        errorSnapshot: Prisma.DbNull,
        backfillCompletedAt:
          page.next_cursor === null ? completionNow : null,
      },
    });

    if (completed.count !== 1) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment history sync was fenced by another worker",
      );
    }

    return {
      applied: page.items.length,
      hasMore: page.next_cursor !== null,
    };
  });
}

export async function failPaymentHistorySync(
  claim: PaymentHistorySyncClaim,
  error: unknown,
) {
  await prisma.$transaction(async (tx) => {
    const now = await databaseNow(tx);
    const state = await tx.paymentHistorySyncState.findUnique({
      where: { userId: claim.userId },
      select: { failureCount: true },
    });
    const delayMs = retryDelayMs(state?.failureCount ?? 0);

    const released = await tx.paymentHistorySyncState.updateMany({
      where: {
        userId: claim.userId,
        upstreamOwnerHash: claim.upstreamOwnerHash,
        generation: claim.generation,
        claimTokenHash: claimHash(claim.claimToken),
        leaseExpiresAt: { gt: now },
      },
      data: {
        claimTokenHash: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(now.getTime() + delayMs),
        failureCount: { increment: 1 },
        errorSnapshot: safeFailureSnapshot(error),
      },
    });

    if (released.count === 1) {
      await tx.auditLog.create({
        data: {
          userId: claim.userId,
          action: "payment_history_sync_failed",
          severity: "ERROR",
          metadata: {
            generation: claim.generation,
            cursor_present: claim.cursor !== null,
            failure_count: (state?.failureCount ?? 0) + 1,
            error: safeFailureSnapshot(error),
          },
        },
      });
    }

    return released.count === 1;
  });
}

export async function syncOnePaymentHistoryPage(input: {
  userId: string;
  upstreamAccountId: string;
  accessToken: string;
  pageSize: number;
}) {
  const claim = await claimPaymentHistorySync(input);

  if (!claim) {
    return { claimed: false, applied: 0, hasMore: false } as const;
  }

  try {
    const page = await getTransactionPage({
      accessToken: input.accessToken,
      cursor: claim.cursor,
      limit: input.pageSize,
    });
    const result = await completePaymentHistoryPage(claim, page);

    return { claimed: true, ...result } as const;
  } catch (error) {
    await failPaymentHistorySync(claim, error);
    throw error;
  }
}

async function loadCurrentPaymentHistoryCredential(
  userId: string,
  expectedOwnerHash: string,
) {
  const rows = await prisma.$queryRaw<Array<{
    remnashopUserId: string;
    encryptedToken: string;
    databaseNow: Date;
  }>>(Prisma.sql`
    SELECT
      web_user."remnashopUserId",
      valid_session."remnashopAccessTokenEncrypted" AS "encryptedToken",
      clock_timestamp() AS "databaseNow"
    FROM "WebUser" AS web_user
    CROSS JOIN LATERAL (
      SELECT
        web_session."remnashopAccessTokenEncrypted",
        web_session."updatedAt",
        web_session."id"
      FROM "WebSession" AS web_session
      WHERE web_session."userId" = web_user."id"
        AND web_session."revokedAt" IS NULL
        AND web_session."remnashopAccessTokenEncrypted" IS NOT NULL
        AND web_session."remnashopAccessExpiresAt" > clock_timestamp() + INTERVAL '60 seconds'
      ORDER BY web_session."updatedAt" DESC, web_session."id" DESC
      LIMIT ${MAX_HISTORY_SESSION_CANDIDATES}
    ) AS valid_session
    WHERE web_user."id" = ${userId}
      AND web_user."remnashopUserId" IS NOT NULL
    ORDER BY valid_session."updatedAt" DESC, valid_session."id" DESC
    FOR KEY SHARE OF web_user
  `);

  if (rows.length === 0) {
    return null;
  }

  if (
    !safeEqual(
      paymentUpstreamOwnerHash(rows[0]!.remnashopUserId),
      expectedOwnerHash,
    )
  ) {
    throw new BffError(
      "ACCOUNT_MERGE_REQUIRED",
      409,
      "Remnashop identity changed during payment history recovery",
    );
  }

  for (const candidate of rows) {
    try {
      const accessToken = revealRemnashopToken(candidate.encryptedToken);
      const tokenOwner = getRemnashopUserIdFromAccessToken(accessToken);
      const tokenExpiresAt = getJwtExpiresAt(accessToken);

      if (
        tokenExpiresAt &&
        Number.isFinite(tokenExpiresAt.getTime()) &&
        candidate.databaseNow instanceof Date &&
        tokenExpiresAt.getTime() >
          candidate.databaseNow.getTime() + HISTORY_TOKEN_MIN_TTL_MS &&
        safeEqual(tokenOwner, candidate.remnashopUserId)
      ) {
        return accessToken;
      }
    } catch {
      // A different valid session can still carry the current owner identity.
    }
  }

  throw new BffError(
    "UNAUTHORIZED",
    401,
    "No current owner-matching Remnashop session is available for payment history recovery",
  );
}

export async function continuePaymentHistoryBackfills(input: {
  limit: number;
  deadlineMs: number;
}) {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 20 ||
    !Number.isSafeInteger(input.deadlineMs) ||
    input.deadlineMs < 1_000 ||
    input.deadlineMs > 30_000
  ) {
    throw new BffError(
      "VALIDATION_ERROR",
      400,
      "Invalid payment history backfill bounds",
    );
  }

  const dueRows = await prisma.$queryRaw<Array<{
    userId: string;
    remnashopUserId: string;
  }>>(Prisma.sql`
    SELECT sync_state."userId", web_user."remnashopUserId"
    FROM "PaymentHistorySyncState" AS sync_state
    INNER JOIN "WebUser" AS web_user
      ON web_user."id" = sync_state."userId"
    WHERE (
        sync_state."backfillCompletedAt" IS NULL
        OR COALESCE(
          sync_state."lastSyncedAt",
          sync_state."backfillCompletedAt"
        ) <= clock_timestamp() - (${HISTORY_REFRESH_INTERVAL_MS} * INTERVAL '1 millisecond')
      )
      AND web_user."remnashopUserId" IS NOT NULL
      AND (
        sync_state."leaseExpiresAt" IS NULL
        OR sync_state."leaseExpiresAt" <= clock_timestamp()
      )
      AND (
        sync_state."nextAttemptAt" IS NULL
        OR sync_state."nextAttemptAt" <= clock_timestamp()
      )
      AND EXISTS (
        SELECT 1
        FROM "WebSession" AS web_session
        WHERE web_session."userId" = sync_state."userId"
          AND web_session."revokedAt" IS NULL
          AND web_session."remnashopAccessTokenEncrypted" IS NOT NULL
          AND web_session."remnashopAccessExpiresAt" > clock_timestamp() + INTERVAL '60 seconds'
      )
    ORDER BY sync_state."lastAttemptAt" ASC NULLS FIRST, sync_state."userId" ASC
    LIMIT ${input.limit}
  `);

  if (dueRows.length === 0) {
    return { attempted: 0, applied: 0, completed: 0, failed: 0 };
  }
  const deadlineAt = Date.now() + input.deadlineMs;
  const counts = { attempted: 0, applied: 0, completed: 0, failed: 0 };

  for (const candidate of dueRows) {
    if (Date.now() >= deadlineAt) break;

    const claim = await claimPaymentHistorySync({
      userId: candidate.userId,
      upstreamAccountId: candidate.remnashopUserId,
    });

    if (!claim) continue;

    counts.attempted += 1;

    try {
      const accessToken = await loadCurrentPaymentHistoryCredential(
        candidate.userId,
        claim.upstreamOwnerHash,
      );

      if (!accessToken) {
        throw new BffError(
          "UNAUTHORIZED",
          401,
          "No current Remnashop session is available for payment history recovery",
        );
      }

      const capabilities = await getPaymentCapabilities(accessToken);

      if (!capabilities) {
        throw new BffError(
          "UPSTREAM_ERROR",
          502,
          "Remnashop keyset history capability is temporarily unavailable",
        );
      }

      const page = await getTransactionPage({
        accessToken,
        cursor: claim.cursor,
        limit: Math.min(100, capabilities.transactions.max_page_size),
      });
      const result = await completePaymentHistoryPage(claim, page);
      counts.applied += result.applied;
      if (!result.hasMore) counts.completed += 1;
    } catch (error) {
      await failPaymentHistorySync(claim, error);
      counts.failed += 1;
    }
  }

  return counts;
}
