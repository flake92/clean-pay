import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import {
  protectRemnashopToken,
  revealRemnashopToken,
} from "@/backend/integrations/remnashop/token-protection";
import { authDebugLog } from "@/backend/observability/auth-debug-log";

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

const clearedTokenBundle = {
  remnashopAccessTokenEncrypted: null,
  remnashopRefreshTokenEncrypted: null,
  remnashopAccessExpiresAt: null,
  remnashopRefreshExpiresAt: null,
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
      session.remnashopRefreshExpiresAt,
  );
}

export async function acquireRemnashopTokensForSession({
  session: requestedSession,
  refresh,
}: {
  session: Pick<LockedSession, "id" | "userId">;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
}) {
  const sessionId = requestedSession.id;
  const userId = requestedSession.userId;
  const now = new Date();
  const refreshThreshold = new Date(now.getTime() + 60_000);

  return prisma.$transaction(async (tx) => {
    // Lock the user and every active local session in stable order. This makes
    // ownership transfer and one-time upstream refresh a single mutex-protected
    // operation without ever storing the same refresh token in two rows.
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
      throw new BffError("UNAUTHORIZED", 401, "Current session is no longer active");
    }

    const sessions = await tx.webSession.findMany({
      where: { id: { in: lockedIds }, userId, revokedAt: null },
      include: { user: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    const targetSession = sessions.find(({ id }) => id === sessionId);

    if (!targetSession || sessions.length !== lockedIds.length) {
      throw new BffError("UNAUTHORIZED", 401, "Current session ownership changed");
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
      return null;
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

    let ownedSession = targetSession;

    if (selected.session.id !== sessionId) {
      const transferred = await tx.webSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: encryptedBundle(selected.session),
      });

      if (transferred.count !== 1) {
        throw new BffError("UNAUTHORIZED", 401, "Current session ownership changed");
      }

      ownedSession = {
        ...targetSession,
        ...encryptedBundle(selected.session),
      };
      authDebugLog("remnashop_token_owner_transferred", {
        sessionId,
        userId,
        sourceSessionId: selected.session.id,
        deduplicatedOwnerCount: duplicateOwnerIds.length,
      });
    }

    const refreshRequired =
      !ownedSession.remnashopAccessExpiresAt ||
      ownedSession.remnashopAccessExpiresAt <= refreshThreshold;

    if (!refreshRequired) {
      return {
        accessToken: selected.accessToken,
        refreshToken: selected.refreshToken,
        session: ownedSession,
        source: "stored" as const,
      };
    }

    authDebugLog("remnashop_tokens_refresh_locked", {
      sessionId,
      userId,
      remnashopAccessExpiresAt: ownedSession.remnashopAccessExpiresAt,
      threshold: refreshThreshold,
    });
    const refreshed = await refresh(selected.refreshToken);
    const refreshedBundle = {
      remnashopAccessTokenEncrypted: protectRemnashopToken(
        refreshed.cookies.accessToken,
      ),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(
        refreshed.cookies.refreshToken,
      ),
      remnashopAccessExpiresAt: new Date(refreshed.data.expires_at),
      remnashopRefreshExpiresAt: new Date(refreshed.data.refresh_expires_at),
    };
    const stored = await tx.webSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        remnashopRefreshTokenEncrypted:
          ownedSession.remnashopRefreshTokenEncrypted,
      },
      data: refreshedBundle,
    });

    if (stored.count !== 1) {
      throw new BffError(
        "UNAUTHORIZED",
        401,
        "Remnashop refresh token ownership changed",
      );
    }

    return {
      accessToken: refreshed.cookies.accessToken,
      refreshToken: refreshed.cookies.refreshToken,
      session: { ...ownedSession, ...refreshedBundle },
      source: "refresh" as const,
    };
  }, {
    maxWait: 5_000,
    timeout: 20_000,
  });
}
