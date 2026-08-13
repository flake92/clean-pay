import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import {
  protectRemnashopToken,
  revealRemnashopToken,
} from "@/backend/integrations/remnashop/token-protection";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { randomToken, sha256 } from "@/backend/security/crypto";

type RefreshResult = {
  data: {
    expires_at: string;
    refresh_expires_at: string;
  };
  cookies: {
    accessToken: string;
    refreshToken: string;
  };
};

type LockedSession = Prisma.WebSessionGetPayload<{
  include: { user: true };
}>;

type TokenCandidate = {
  session: LockedSession;
  accessToken: string;
  refreshToken: string;
};

type TokenResult = TokenCandidate & {
  source: "stored" | "refresh";
};

type RefreshRecovery = {
  version: 1;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

type RefreshPlan = {
  session: LockedSession;
  refreshToken: string;
  previousRefreshTokenEncrypted: string;
  claimTokenHash: string;
  leaseExpiresAt: Date;
};

type Preparation =
  | { kind: "result"; result: TokenResult | null }
  | { kind: "refresh"; plan: RefreshPlan }
  | { kind: "wait"; retryAfterSeconds: number };

// Covers the 15s upstream timeout plus worst-case bounded recovery/finalization
// retries while leaving enough margin that a second worker cannot consume the
// same one-time refresh token during transient database degradation.
const REFRESH_LEASE_MS = 180_000;
const RECOVERY_WRITE_SAFETY_MS = 15_000;
const RECOVERY_WRITE_INITIAL_RETRY_MS = 50;
const RECOVERY_WRITE_MAX_RETRY_MS = 2_000;
const FINALIZATION_ATTEMPTS = 3;
const shortTransactionOptions = { maxWait: 5_000, timeout: 10_000 } as const;

const clearedTokenBundle = {
  remnashopAccessTokenEncrypted: null,
  remnashopRefreshTokenEncrypted: null,
  remnashopAccessExpiresAt: null,
  remnashopRefreshExpiresAt: null,
  remnashopRefreshClaimTokenHash: null,
  remnashopRefreshLeaseExpiresAt: null,
  remnashopRefreshDispatchedAt: null,
  remnashopRefreshRecoveryEncrypted: null,
} as const;

const clearedRefreshFence = {
  remnashopRefreshClaimTokenHash: null,
  remnashopRefreshLeaseExpiresAt: null,
  remnashopRefreshDispatchedAt: null,
  remnashopRefreshRecoveryEncrypted: null,
} as const;

function encryptedBundle(session: LockedSession) {
  return {
    remnashopAccessTokenEncrypted: session.remnashopAccessTokenEncrypted,
    remnashopRefreshTokenEncrypted: session.remnashopRefreshTokenEncrypted,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
  };
}

function tokenCandidate(session: LockedSession, now: Date) {
  const encryptedAccessToken = session.remnashopAccessTokenEncrypted;
  const encryptedRefreshToken = session.remnashopRefreshTokenEncrypted;

  if (!encryptedAccessToken || !encryptedRefreshToken) {
    return null;
  }

  if (
    session.remnashopRefreshExpiresAt &&
    session.remnashopRefreshExpiresAt <= now
  ) {
    return null;
  }

  try {
    return {
      session,
      accessToken: revealRemnashopToken(encryptedAccessToken),
      refreshToken: revealRemnashopToken(encryptedRefreshToken),
    } satisfies TokenCandidate;
  } catch {
    return null;
  }
}

function hasAnyTokenMaterial(session: LockedSession) {
  return Boolean(
    session.remnashopAccessTokenEncrypted ||
      session.remnashopRefreshTokenEncrypted ||
      session.remnashopAccessExpiresAt ||
      session.remnashopRefreshExpiresAt ||
      session.remnashopRefreshClaimTokenHash ||
      session.remnashopRefreshLeaseExpiresAt ||
      session.remnashopRefreshDispatchedAt ||
      session.remnashopRefreshRecoveryEncrypted,
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function refreshClaimHash(token: string) {
  return sha256(`clean-pay:remnashop-refresh:claim:v1:${token}`);
}

function parseRecoveryDate(value: string, field: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ServiceError(
      "UPSTREAM_ERROR",
      502,
      `Remnashop refresh returned an invalid ${field}`,
    );
  }

  return parsed;
}

function normalizeRefreshResult(refreshed: RefreshResult): RefreshRecovery {
  const accessToken = refreshed.cookies.accessToken;
  const refreshToken = refreshed.cookies.refreshToken;

  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 65_536 ||
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    refreshToken.length > 65_536
  ) {
    throw new ServiceError(
      "UPSTREAM_ERROR",
      502,
      "Remnashop refresh returned an invalid token bundle",
    );
  }

  const accessExpiresAt = parseRecoveryDate(
    refreshed.data.expires_at,
    "access expiry",
  );
  const refreshExpiresAt = parseRecoveryDate(
    refreshed.data.refresh_expires_at,
    "refresh expiry",
  );

  return {
    version: 1,
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

function decodeRefreshRecovery(encrypted: string): RefreshRecovery {
  const parsed = JSON.parse(revealRemnashopToken(encrypted)) as Partial<RefreshRecovery>;

  if (
    parsed.version !== 1 ||
    typeof parsed.accessToken !== "string" ||
    parsed.accessToken.length === 0 ||
    parsed.accessToken.length > 65_536 ||
    typeof parsed.refreshToken !== "string" ||
    parsed.refreshToken.length === 0 ||
    parsed.refreshToken.length > 65_536 ||
    typeof parsed.accessExpiresAt !== "string" ||
    typeof parsed.refreshExpiresAt !== "string"
  ) {
    throw new Error("Invalid Remnashop refresh recovery payload");
  }

  parseRecoveryDate(parsed.accessExpiresAt, "recovery access expiry");
  parseRecoveryDate(parsed.refreshExpiresAt, "recovery refresh expiry");

  return parsed as RefreshRecovery;
}

function encryptedRecovery(recovery: RefreshRecovery) {
  return protectRemnashopToken(JSON.stringify(recovery));
}

function refreshedBundle(recovery: RefreshRecovery) {
  return {
    remnashopAccessTokenEncrypted: protectRemnashopToken(recovery.accessToken),
    remnashopRefreshTokenEncrypted: protectRemnashopToken(recovery.refreshToken),
    remnashopAccessExpiresAt: new Date(recovery.accessExpiresAt),
    remnashopRefreshExpiresAt: new Date(recovery.refreshExpiresAt),
  };
}

function retryAfterSeconds(leaseExpiresAt: Date, now: Date) {
  return Math.min(
    5,
    Math.max(
      1,
      Math.ceil((leaseExpiresAt.getTime() - now.getTime()) / 1_000),
    ),
  );
}

async function finalizeRecoveryRow(
  tx: Prisma.TransactionClient,
  session: LockedSession,
): Promise<TokenResult | null> {
  const recoveryEncrypted = session.remnashopRefreshRecoveryEncrypted;

  if (!recoveryEncrypted) {
    return null;
  }

  let recovery: RefreshRecovery;

  try {
    recovery = decodeRefreshRecovery(recoveryEncrypted);
  } catch {
    const cleared = await tx.webSession.updateMany({
      where: {
        id: session.id,
        userId: session.userId,
        revokedAt: null,
        remnashopRefreshRecoveryEncrypted: recoveryEncrypted,
      },
      data: clearedTokenBundle,
    });

    if (cleared.count !== 1) {
      throw new ServiceError(
        "CONFLICT",
        409,
        "Remnashop refresh recovery ownership changed",
      );
    }

    authDebugLog("remnashop_token_refresh_recovery_corrupt", {
      sessionId: session.id,
      userId: session.userId,
    });
    return null;
  }

  const bundle = refreshedBundle(recovery);
  const finalized = await tx.webSession.updateMany({
    where: {
      id: session.id,
      userId: session.userId,
      revokedAt: null,
      remnashopRefreshClaimTokenHash:
        session.remnashopRefreshClaimTokenHash,
      remnashopRefreshRecoveryEncrypted: recoveryEncrypted,
    },
    data: {
      ...bundle,
      ...clearedRefreshFence,
    },
  });

  if (finalized.count !== 1) {
    throw new ServiceError(
      "CONFLICT",
      409,
      "Remnashop refresh recovery ownership changed",
    );
  }

  const finalizedSession = {
    ...session,
    ...bundle,
    ...clearedRefreshFence,
  };

  authDebugLog("remnashop_token_refresh_recovery_finalized", {
    sessionId: session.id,
    userId: session.userId,
    remnashopAccessExpiresAt: bundle.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: bundle.remnashopRefreshExpiresAt,
  });

  return {
    accessToken: recovery.accessToken,
    refreshToken: recovery.refreshToken,
    session: finalizedSession,
    source: "refresh",
  };
}

async function prepareTokenAcquisition({
  sessionId,
  userId,
  forceRefresh,
}: {
  sessionId: string;
  userId: string;
  forceRefresh: boolean;
}): Promise<Preparation> {
  const now = new Date();
  const refreshThreshold = new Date(now.getTime() + 60_000);

  return prisma.$transaction(async (tx) => {
    // This transaction only establishes local ownership. Provider I/O happens
    // after commit, while a durable lease fences every other refresh attempt.
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT session."id"
        FROM "WebUser" AS app_user
        JOIN "WebSession" AS session
          ON session."userId" = app_user."id"
        WHERE app_user."id" = ${userId}
          AND session."revokedAt" IS NULL
        ORDER BY session."id"
        FOR UPDATE OF app_user, session
      `,
    );
    const lockedIds = lockedRows.map(({ id }) => id);

    if (!lockedIds.includes(sessionId)) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session is no longer active",
      );
    }

    const sessions = await tx.webSession.findMany({
      where: { id: { in: lockedIds }, userId, revokedAt: null },
      include: { user: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });

    if (
      !sessions.some(({ id }) => id === sessionId) ||
      sessions.length !== lockedIds.length
    ) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session ownership changed",
      );
    }

    // A completed upstream response is always promoted before a new claim is
    // considered. If finalization previously failed, no second provider call
    // can consume the old refresh token.
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];

      if (!session?.remnashopRefreshRecoveryEncrypted) {
        continue;
      }

      const finalized = await finalizeRecoveryRow(tx, session);
      sessions[index] = finalized
        ? finalized.session
        : { ...session, ...clearedTokenBundle };
    }

    const activeClaim = sessions.find(
      (session) =>
        session.remnashopRefreshClaimTokenHash &&
        session.remnashopRefreshLeaseExpiresAt &&
        session.remnashopRefreshLeaseExpiresAt > now,
    );

    if (activeClaim?.remnashopRefreshLeaseExpiresAt) {
      return {
        kind: "wait",
        retryAfterSeconds: retryAfterSeconds(
          activeClaim.remnashopRefreshLeaseExpiresAt,
          now,
        ),
      };
    }

    // Once dispatch has been durably marked, the provider may already have
    // consumed the one-time refresh token even if this process never stored a
    // response. An expired dispatched claim without recovery must therefore
    // fail closed instead of replaying the old token. Other verified recovery
    // paths can establish a fresh provider session after this bundle is gone.
    const staleDispatchedIds = sessions
      .filter(
        (session) =>
          session.remnashopRefreshDispatchedAt &&
          !session.remnashopRefreshRecoveryEncrypted &&
          (
            !session.remnashopRefreshClaimTokenHash ||
            !session.remnashopRefreshLeaseExpiresAt ||
            session.remnashopRefreshLeaseExpiresAt <= now
          ),
      )
      .map(({ id }) => id);

    if (staleDispatchedIds.length > 0) {
      const cleared = await tx.webSession.updateMany({
        where: {
          id: { in: staleDispatchedIds },
          userId,
          revokedAt: null,
          remnashopRefreshDispatchedAt: { not: null },
          remnashopRefreshRecoveryEncrypted: null,
          OR: [
            { remnashopRefreshClaimTokenHash: null },
            { remnashopRefreshLeaseExpiresAt: null },
            { remnashopRefreshLeaseExpiresAt: { lte: now } },
          ],
        },
        data: clearedTokenBundle,
      });

      if (cleared.count !== staleDispatchedIds.length) {
        throw new ServiceError(
          "CONFLICT",
          409,
          "Remnashop refresh dispatch ownership changed",
        );
      }

      const staleIdSet = new Set(staleDispatchedIds);
      for (let index = 0; index < sessions.length; index += 1) {
        const session = sessions[index];
        if (session && staleIdSet.has(session.id)) {
          sessions[index] = { ...session, ...clearedTokenBundle };
        }
      }

      authDebugLog("remnashop_token_refresh_dispatched_without_recovery", {
        sessionId,
        userId,
        clearedSessionIds: staleDispatchedIds,
      });
    }

    const candidates: TokenCandidate[] = [];
    const invalidOwnerIds = new Set<string>();

    for (const session of sessions) {
      const candidate = tokenCandidate(session, now);

      if (candidate) {
        candidates.push(candidate);
      } else if (hasAnyTokenMaterial(session)) {
        invalidOwnerIds.add(session.id);
      }
    }

    const selected =
      candidates.find(({ session }) => session.id === sessionId) ??
      candidates[0] ??
      null;

    if (!selected) {
      if (invalidOwnerIds.size > 0) {
        await tx.webSession.updateMany({
          where: { id: { in: [...invalidOwnerIds] }, userId },
          data: clearedTokenBundle,
        });
      }

      authDebugLog("remnashop_token_owner_missing", {
        sessionId,
        userId,
        clearedInvalidOwnerCount: invalidOwnerIds.size,
      });
      return { kind: "result", result: null };
    }

    const duplicateOwnerIds = candidates
      .filter(
        (candidate) =>
          candidate.session.id !== selected.session.id &&
          candidate.refreshToken === selected.refreshToken,
      )
      .map(({ session }) => session.id);
    const ownersToClear = new Set([
      ...invalidOwnerIds,
      ...duplicateOwnerIds,
      ...(selected.session.id === sessionId ? [] : [selected.session.id]),
    ]);
    ownersToClear.delete(sessionId);

    if (ownersToClear.size > 0) {
      await tx.webSession.updateMany({
        where: { id: { in: [...ownersToClear] }, userId },
        data: clearedTokenBundle,
      });
    }

    const targetSession = sessions.find(({ id }) => id === sessionId);

    if (!targetSession) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session ownership changed",
      );
    }

    let ownedSession = targetSession;

    if (selected.session.id !== sessionId) {
      const transferredBundle = {
        ...encryptedBundle(selected.session),
        ...clearedRefreshFence,
      };
      const transferred = await tx.webSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: transferredBundle,
      });

      if (transferred.count !== 1) {
        throw new ServiceError(
          "UNAUTHORIZED",
          401,
          "Current session ownership changed",
        );
      }

      ownedSession = {
        ...targetSession,
        ...transferredBundle,
      };
      authDebugLog("remnashop_token_owner_transferred", {
        sessionId,
        userId,
        sourceSessionId: selected.session.id,
        deduplicatedOwnerCount: duplicateOwnerIds.length,
      });
    }

    const refreshRequired =
      forceRefresh ||
      !ownedSession.remnashopAccessExpiresAt ||
      ownedSession.remnashopAccessExpiresAt <= refreshThreshold;

    if (!refreshRequired) {
      if (
        ownedSession.remnashopRefreshClaimTokenHash ||
        ownedSession.remnashopRefreshLeaseExpiresAt ||
        ownedSession.remnashopRefreshRecoveryEncrypted
      ) {
        await tx.webSession.updateMany({
          where: { id: sessionId, userId, revokedAt: null },
          data: clearedRefreshFence,
        });
        ownedSession = { ...ownedSession, ...clearedRefreshFence };
      }

      return {
        kind: "result",
        result: {
          accessToken: selected.accessToken,
          refreshToken: selected.refreshToken,
          session: ownedSession,
          source: "stored",
        },
      };
    }

    const previousRefreshTokenEncrypted =
      ownedSession.remnashopRefreshTokenEncrypted;

    if (!previousRefreshTokenEncrypted) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Remnashop refresh token ownership changed",
      );
    }

    const claimTokenHash = refreshClaimHash(randomToken(32));
    const leaseExpiresAt = new Date(now.getTime() + REFRESH_LEASE_MS);
    const claimed = await tx.webSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        remnashopRefreshTokenEncrypted: previousRefreshTokenEncrypted,
        OR: [
          { remnashopRefreshClaimTokenHash: null },
          { remnashopRefreshLeaseExpiresAt: null },
          { remnashopRefreshLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        remnashopRefreshClaimTokenHash: claimTokenHash,
        remnashopRefreshLeaseExpiresAt: leaseExpiresAt,
        remnashopRefreshDispatchedAt: null,
        remnashopRefreshRecoveryEncrypted: null,
        remnashopRefreshAttemptCount: { increment: 1 },
      },
    });

    if (claimed.count !== 1) {
      throw new ServiceError(
        "UPSTREAM_UNAVAILABLE",
        503,
        "Another Remnashop refresh owns this session",
        { retryAfterSeconds: 1 },
      );
    }

    authDebugLog("remnashop_token_refresh_claimed", {
      sessionId,
      userId,
      leaseExpiresAt,
      remnashopAccessExpiresAt: ownedSession.remnashopAccessExpiresAt,
    });

    return {
      kind: "refresh",
      plan: {
        session: {
          ...ownedSession,
          remnashopRefreshClaimTokenHash: claimTokenHash,
          remnashopRefreshLeaseExpiresAt: leaseExpiresAt,
          remnashopRefreshDispatchedAt: null,
          remnashopRefreshRecoveryEncrypted: null,
          remnashopRefreshAttemptCount:
            ownedSession.remnashopRefreshAttemptCount + 1,
        },
        refreshToken: selected.refreshToken,
        previousRefreshTokenEncrypted,
        claimTokenHash,
        leaseExpiresAt,
      },
    };
  }, shortTransactionOptions);
}

type DispatchedRefreshPlan = RefreshPlan & { dispatchedAt: Date };

async function markRefreshDispatched(
  plan: RefreshPlan,
): Promise<DispatchedRefreshPlan> {
  const dispatchedAt = new Date();
  const marked = await prisma.$transaction(async (tx) => tx.webSession.updateMany({
    where: {
      id: plan.session.id,
      userId: plan.session.userId,
      revokedAt: null,
      remnashopRefreshTokenEncrypted: plan.previousRefreshTokenEncrypted,
      remnashopRefreshClaimTokenHash: plan.claimTokenHash,
      remnashopRefreshLeaseExpiresAt: { gt: dispatchedAt },
      remnashopRefreshDispatchedAt: null,
      remnashopRefreshRecoveryEncrypted: null,
    },
    data: { remnashopRefreshDispatchedAt: dispatchedAt },
  }), shortTransactionOptions);

  if (marked.count !== 1) {
    throw new ServiceError(
      "CONFLICT",
      409,
      "Remnashop refresh claim changed before provider dispatch",
    );
  }

  authDebugLog("remnashop_token_refresh_dispatched", {
    sessionId: plan.session.id,
    userId: plan.session.userId,
    dispatchedAt,
    leaseExpiresAt: plan.leaseExpiresAt,
  });

  return { ...plan, dispatchedAt };
}

async function persistRefreshRecovery({
  plan,
  recovery,
  recoveryEncrypted,
}: {
  plan: DispatchedRefreshPlan;
  recovery: RefreshRecovery;
  recoveryEncrypted: string;
}) {
  let lastError: unknown;
  let attemptCount = 0;
  let retryDelayMs = RECOVERY_WRITE_INITIAL_RETRY_MS;
  const retryDeadlineMs =
    plan.leaseExpiresAt.getTime() - RECOVERY_WRITE_SAFETY_MS;

  while (Date.now() < retryDeadlineMs) {
    attemptCount += 1;
    try {
      return await prisma.$transaction(async (tx) => {
        const stored = await tx.webSession.updateMany({
          where: {
            id: plan.session.id,
            userId: plan.session.userId,
            revokedAt: null,
            remnashopRefreshTokenEncrypted:
              plan.previousRefreshTokenEncrypted,
            remnashopRefreshClaimTokenHash: plan.claimTokenHash,
            remnashopRefreshDispatchedAt: plan.dispatchedAt,
          },
          data: {
            remnashopRefreshRecoveryEncrypted: recoveryEncrypted,
          },
        });

        if (stored.count === 1) {
          return null;
        }

        const current = await tx.webSession.findFirst({
          where: {
            id: plan.session.id,
            userId: plan.session.userId,
            revokedAt: null,
          },
          include: { user: true },
        });
        const currentCandidate = current
          ? tokenCandidate(current, new Date())
          : null;

        // Covers a commit-acknowledgement failure followed by another request
        // that already finalized the exact durable recovery.
        if (
          currentCandidate?.accessToken === recovery.accessToken &&
          currentCandidate.refreshToken === recovery.refreshToken
        ) {
          return currentCandidate.session;
        }

        throw new ServiceError(
          "UNAUTHORIZED",
          401,
          "Remnashop refresh claim changed before recovery was stored",
        );
      }, shortTransactionOptions);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        (error.code === "UNAUTHORIZED" || error.code === "CONFLICT")
      ) {
        throw error;
      }

      lastError = error;

      const remainingMs = retryDeadlineMs - Date.now();
      if (remainingMs <= 0) break;
      await delay(Math.min(retryDelayMs, remainingMs));
      retryDelayMs = Math.min(
        RECOVERY_WRITE_MAX_RETRY_MS,
        retryDelayMs * 2,
      );
    }
  }

  authDebugLog("remnashop_token_refresh_recovery_store_failed", {
    sessionId: plan.session.id,
    userId: plan.session.userId,
    attemptCount,
    retryDeadline: new Date(retryDeadlineMs),
  });
  throw lastError ?? new ServiceError(
    "UPSTREAM_UNAVAILABLE",
    503,
    "Remnashop refresh recovery could not be stored before its lease expired",
  );
}

async function finalizeRefreshClaim({
  plan,
  recovery,
  recoveryEncrypted,
}: {
  plan: DispatchedRefreshPlan;
  recovery: RefreshRecovery;
  recoveryEncrypted: string;
}) {
  let lastError: unknown;

  for (let attempt = 0; attempt < FINALIZATION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "WebSession"
            WHERE "id" = ${plan.session.id}
              AND "userId" = ${plan.session.userId}
              AND "revokedAt" IS NULL
            FOR UPDATE
          `,
        );

        if (locked.length !== 1) {
          throw new ServiceError(
            "UNAUTHORIZED",
            401,
            "Current session changed before Remnashop refresh finalization",
          );
        }

        const current = await tx.webSession.findFirst({
          where: {
            id: plan.session.id,
            userId: plan.session.userId,
            revokedAt: null,
          },
          include: { user: true },
        });

        if (!current) {
          throw new ServiceError(
            "UNAUTHORIZED",
            401,
            "Current session changed before Remnashop refresh finalization",
          );
        }

        if (!current.remnashopRefreshRecoveryEncrypted) {
          const candidate = tokenCandidate(current, new Date());

          if (
            candidate?.accessToken === recovery.accessToken &&
            candidate.refreshToken === recovery.refreshToken
          ) {
            return {
              ...candidate,
              source: "refresh" as const,
            };
          }

          throw new ServiceError(
            "CONFLICT",
            409,
            "Remnashop refresh recovery disappeared before finalization",
          );
        }

        if (
          current.remnashopRefreshClaimTokenHash !== plan.claimTokenHash ||
          current.remnashopRefreshRecoveryEncrypted !== recoveryEncrypted
        ) {
          throw new ServiceError(
            "CONFLICT",
            409,
            "Remnashop refresh recovery ownership changed",
          );
        }

        const finalized = await finalizeRecoveryRow(tx, current);

        if (!finalized) {
          throw new ServiceError(
            "UPSTREAM_ERROR",
            502,
            "Remnashop refresh recovery was invalid",
          );
        }

        return finalized;
      }, shortTransactionOptions);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        (error.code === "UNAUTHORIZED" || error.code === "CONFLICT")
      ) {
        throw error;
      }

      lastError = error;
    }
  }

  authDebugLog("remnashop_token_refresh_finalization_failed", {
    sessionId: plan.session.id,
    userId: plan.session.userId,
    attemptCount: FINALIZATION_ATTEMPTS,
  });
  throw lastError;
}

export async function acquireRemnashopTokensForSession({
  session: requestedSession,
  refresh,
  forceRefresh = false,
}: {
  session: Pick<LockedSession, "id" | "userId">;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  forceRefresh?: boolean;
}) {
  const prepared = await prepareTokenAcquisition({
    sessionId: requestedSession.id,
    userId: requestedSession.userId,
    forceRefresh,
  });

  if (prepared.kind === "result") {
    return prepared.result;
  }

  if (prepared.kind === "wait") {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Another Remnashop token refresh is still in progress",
      { retryAfterSeconds: prepared.retryAfterSeconds },
    );
  }

  // The one-time provider call is deliberately outside every Prisma
  // transaction. Persist the dispatch phase first: once this marker commits,
  // an expired claim can never replay the possibly-consumed provider token.
  const dispatchedPlan = await markRefreshDispatched(prepared.plan);
  const refreshed = await refresh(dispatchedPlan.refreshToken);
  const recovery = normalizeRefreshResult(refreshed);
  const recoveryEncrypted = encryptedRecovery(recovery);
  const alreadyFinalized = await persistRefreshRecovery({
    plan: dispatchedPlan,
    recovery,
    recoveryEncrypted,
  });

  if (alreadyFinalized) {
    return {
      accessToken: recovery.accessToken,
      refreshToken: recovery.refreshToken,
      session: alreadyFinalized,
      source: "refresh" as const,
    };
  }

  return finalizeRefreshClaim({
    plan: dispatchedPlan,
    recovery,
    recoveryEncrypted,
  });
}
