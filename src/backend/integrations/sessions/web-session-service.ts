import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { Prisma, WebSessionAssuranceLevel, WebSessionAuthMethod } from "@prisma/client";

import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { decryptSecret, encryptSecret, sha256, randomToken } from "@/backend/security/crypto";
import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { securityPolicy } from "@/backend/security/policy";
import { auditLog } from "@/backend/observability/audit";
import { recordOperationalEvent } from "@/backend/observability/metrics";
import {
  clearWebSessionCookies,
  revokedWebSessionData,
  sessionCookieNames,
} from "@/backend/integrations/sessions/web-session-revocation";
import {
  addDays,
  addMinutes,
  setAccessCookie,
  signAccessToken,
  verifyAccessToken,
} from "@/backend/integrations/sessions/web-session-token";

export {
  clearWebSessionCookies,
  revokeAllWebSessionsForUser,
} from "@/backend/integrations/sessions/web-session-revocation";
export {
  createWebSession,
  createWebSessionForRemnashopUser,
} from "@/backend/integrations/sessions/web-session-creation";
import { refreshTokenGraceMs } from "@/backend/integrations/sessions/web-session-policy";

export {
  assertEmailVerificationPolicy,
  refreshTokenGraceMs,
} from "@/backend/integrations/sessions/web-session-policy";

async function revokeSessionByRefreshToken(refreshToken: string) {
  const tokenHash = sha256(refreshToken);
  const now = new Date();
  const session = await prisma.webSession.findFirst({
    where: {
      revokedAt: null,
      OR: [
        { refreshTokenHash: tokenHash },
        {
          refreshTokenHistory: {
            some: {
              tokenHash,
              graceExpiresAt: { gte: now },
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  if (!session) {
    return;
  }

  await prisma.webSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: revokedWebSessionData(now),
  });
}


export async function rotateRefreshTokenFamily(refreshToken: string, now = new Date()) {
  const tokenHash = sha256(refreshToken);
  const accessTokenExpiresAt = addMinutes(now, securityPolicy.accessSessionTtlMinutes);

  const rotateOnce = () => prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT session."id"
        FROM "WebSession" AS session
        LEFT JOIN "WebRefreshToken" AS consumed
          ON consumed."sessionId" = session."id"
          AND consumed."tokenHash" = ${tokenHash}
        WHERE session."refreshTokenHash" = ${tokenHash}
          OR consumed."tokenHash" = ${tokenHash}
        FOR UPDATE OF session
      `,
    );

    if (locked.length !== 1) return null;
    const session = await tx.webSession.findUnique({
      where: { id: locked[0].id },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.refreshExpiresAt <= now) return null;

    if (session.refreshTokenHash === tokenHash) {
      const successorToken = randomToken(48);
      await tx.webRefreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash,
          successorTokenEncrypted: encryptSecret(successorToken, getEnv().webRefreshSecret),
          graceExpiresAt: new Date(now.getTime() + refreshTokenGraceMs),
          consumedAt: now,
        },
      });
      const updatedSession = await tx.webSession.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: sha256(successorToken),
          refreshRotatedAt: now,
          accessTokenExpiresAt,
        },
        include: { user: true },
      });

      return { status: "ok" as const, session: updatedSession, successorToken, reusedPrevious: false };
    }

    const consumed = await tx.webRefreshToken.findUnique({ where: { tokenHash } });

    if (consumed && consumed.sessionId === session.id && consumed.graceExpiresAt >= now) {
      const successorToken = decryptSecret(consumed.successorTokenEncrypted, getEnv().webRefreshSecret);
      const updatedSession = await tx.webSession.update({
        where: { id: session.id },
        data: { accessTokenExpiresAt },
        include: { user: true },
      });
      return { status: "ok" as const, session: updatedSession, successorToken, reusedPrevious: true };
    }

    await tx.webSession.update({
      where: { id: session.id },
      data: { revokedAt: now, accessTokenExpiresAt: now, refreshExpiresAt: now },
    });
    return { status: "reuse" as const, sessionId: session.id, userId: session.userId };
  }, { maxWait: 5_000, timeout: 15_000 });

  // At READ COMMITTED a statement that began before another rotation commits
  // can lose the WHERE recheck after waiting for the row lock. A second
  // transaction observes the newly-created consumed-token row and returns the
  // same successor; it never creates a second branch.
  try {
    return await rotateOnce() ?? await rotateOnce();
  } catch (error) {
    recordOperationalEvent("refresh_token_rotation_failed");
    throw error;
  }
}

async function getSessionByRefreshToken() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(sessionCookieNames.refresh)?.value;

  if (!refreshToken) {
    authDebugLog("session_refresh_lookup_skipped", { reason: "missing_refresh_cookie" });
    return null;
  }

  authDebugLog("session_refresh_lookup_started", { hasRefreshCookie: true });
  const rotated = await rotateRefreshTokenFamily(refreshToken);

  if (!rotated) {
    authDebugLog("session_refresh_lookup_miss", { reason: "not_found_revoked_or_expired" });
    await clearWebSessionCookies();
    return null;
  }

  if (rotated.status === "reuse") {
    recordOperationalEvent("refresh_token_reuse_detected");
    cookieStore.delete(sessionCookieNames.access);
    cookieStore.delete(sessionCookieNames.refresh);
    await auditLog({
      action: "refresh_token_reuse_detected",
      severity: "WARN",
      userId: rotated.userId,
      metadata: { sessionId: rotated.sessionId },
    });
    authDebugLog("session_refresh_reuse_detected", {
      sessionId: rotated.sessionId,
      userId: rotated.userId,
    });
    return null;
  }

  const updatedSession = rotated.session;
  await setAccessCookie({
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    expiresAt: updatedSession.accessTokenExpiresAt,
    assuranceLevel: updatedSession.assuranceLevel,
    emailVerified: updatedSession.user.emailVerified,
    telegramId: updatedSession.user.telegramId,
  });
  cookieStore.set(sessionCookieNames.refresh, rotated.successorToken, {
    httpOnly: true,
    secure: getEnv().cookieSecure,
    sameSite: getEnv().cookieSameSite,
    path: "/",
    expires: updatedSession.refreshExpiresAt,
  });

  authDebugLog("session_refresh_lookup_success", {
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    authMethod: updatedSession.authMethod,
    assuranceLevel: updatedSession.assuranceLevel,
    accessTokenExpiresAt: updatedSession.accessTokenExpiresAt,
    refreshExpiresAt: updatedSession.refreshExpiresAt,
    reusedPrevious: rotated.reusedPrevious,
    hasRemnashopTokens: Boolean(updatedSession.remnashopAccessTokenEncrypted && updatedSession.remnashopRefreshTokenEncrypted),
  });

  return updatedSession;
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;

  if (!accessToken) {
    authDebugLog("session_current_user_access_missing", {});
    const session = await getSessionByRefreshToken();

    authDebugLog("session_current_user_result", {
      source: "refresh",
      found: Boolean(session),
      sessionId: session?.id,
      userId: session?.userId,
    });

    return session?.user ?? null;
  }

  const payload = verifyAccessToken(accessToken);

  if (!payload) {
    authDebugLog("session_current_user_access_invalid", {});
    const session = await getSessionByRefreshToken();

    authDebugLog("session_current_user_result", {
      source: "refresh_after_invalid_access",
      found: Boolean(session),
      sessionId: session?.id,
      userId: session?.userId,
    });

    return session?.user ?? null;
  }

  authDebugLog("session_current_user_access_valid", {
    sessionId: payload.sid,
    userId: payload.uid,
    expiresAtEpochSeconds: payload.exp,
  });
  const session = await prisma.webSession.findFirst({
    where: {
      id: payload.sid,
      userId: payload.uid,
      revokedAt: null,
      accessTokenExpiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (session) {
    authDebugLog("session_current_user_result", {
      source: "access",
      found: true,
      sessionId: session.id,
      userId: session.userId,
    });

    return session.user;
  }

  authDebugLog("session_current_user_access_db_miss", {
    sessionId: payload.sid,
    userId: payload.uid,
  });
  const refreshedSession = await getSessionByRefreshToken();

  authDebugLog("session_current_user_result", {
    source: "refresh_after_access_db_miss",
    found: Boolean(refreshedSession),
    sessionId: refreshedSession?.id,
    userId: refreshedSession?.userId,
  });

  return refreshedSession?.user ?? null;
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;

  if (!accessToken) {
    authDebugLog("session_current_access_missing", {});
    return getSessionByRefreshToken();
  }

  const payload = verifyAccessToken(accessToken);

  if (!payload) {
    authDebugLog("session_current_access_invalid", {});
    return getSessionByRefreshToken();
  }

  authDebugLog("session_current_access_valid", {
    sessionId: payload.sid,
    userId: payload.uid,
    expiresAtEpochSeconds: payload.exp,
  });
  const session = await prisma.webSession.findFirst({
    where: {
      id: payload.sid,
      userId: payload.uid,
      revokedAt: null,
      accessTokenExpiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (session) {
    authDebugLog("session_current_result", {
      source: "access",
      found: true,
      sessionId: session.id,
      userId: session.userId,
      authMethod: session.authMethod,
      hasRemnashopTokens: Boolean(session.remnashopAccessTokenEncrypted && session.remnashopRefreshTokenEncrypted),
    });

    return session;
  }

  authDebugLog("session_current_access_db_miss", {
    sessionId: payload.sid,
    userId: payload.uid,
  });

  return getSessionByRefreshToken();
}

export async function refreshCurrentAccessCookie() {
  authDebugLog("session_access_cookie_refresh_started", {});
  const session = await getCurrentSession();

  if (!session) {
    authDebugLog("session_access_cookie_refresh_skipped", { reason: "missing_session" });
    return null;
  }

  const user = await prisma.webUser.findUnique({
    where: { id: session.userId },
    select: { emailVerified: true, telegramId: true },
  });

  await setAccessCookie({
    sessionId: session.id,
    userId: session.userId,
    expiresAt: session.accessTokenExpiresAt,
    assuranceLevel: session.assuranceLevel,
    emailVerified: user?.emailVerified,
    telegramId: user?.telegramId,
  });

  authDebugLog("session_access_cookie_refresh_success", {
    sessionId: session.id,
    userId: session.userId,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
  });

  return session;
}

export async function createWebSessionOnResponse(
  response: NextResponse,
  userId: string,
  options: {
    authMethod?: WebSessionAuthMethod;
    remnashopSession?: {
      accessTokenEncrypted: string;
      refreshTokenEncrypted: string;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
    };
  } = {},
) {
  const env = getEnv();
  const requestHeaders = await headers();
  authDebugLog("session_response_create_started", {
    userId,
    hasProvidedRemnashopSession: Boolean(options.remnashopSession),
  });
  const now = new Date();
  const accessTokenExpiresAt = addMinutes(
    now,
    securityPolicy.accessSessionTtlMinutes,
  );
  const refreshExpiresAt = addDays(now, securityPolicy.refreshSessionTtlDays);
  const refreshToken = randomToken(48);

  authDebugLog("session_response_create_persist_started", {
    userId,
    authMethod: options.authMethod ?? WebSessionAuthMethod.TELEGRAM,
    assuranceLevel: WebSessionAssuranceLevel.FULL,
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasProvidedRemnashopSession: Boolean(options.remnashopSession),
  });

  const session = await prisma.webSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      remnashopAccessTokenEncrypted: options.remnashopSession?.accessTokenEncrypted,
      remnashopRefreshTokenEncrypted: options.remnashopSession?.refreshTokenEncrypted,
      remnashopAccessExpiresAt: options.remnashopSession?.accessExpiresAt,
      remnashopRefreshExpiresAt: options.remnashopSession?.refreshExpiresAt,
      authMethod: options.authMethod ?? WebSessionAuthMethod.TELEGRAM,
      assuranceLevel: WebSessionAssuranceLevel.FULL,
      userAgent: requestHeaders.get("user-agent"),
      accessTokenExpiresAt,
      refreshExpiresAt,
    },
  });
  const user = await prisma.webUser.findUnique({
    where: { id: userId },
    select: { emailVerified: true, telegramId: true },
  });
  const accessToken = signAccessToken({
    sid: session.id,
    uid: userId,
    exp: Math.floor(accessTokenExpiresAt.getTime() / 1000),
    al: WebSessionAssuranceLevel.FULL,
    ev: Boolean(user?.emailVerified),
    tg: Boolean(user?.telegramId),
  });

  response.cookies.set(sessionCookieNames.access, accessToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: accessTokenExpiresAt,
  });
  response.cookies.set(sessionCookieNames.refresh, refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: refreshExpiresAt,
  });

  authDebugLog("session_response_create_success", {
    sessionId: session.id,
    userId,
    authMethod: session.authMethod,
    assuranceLevel: session.assuranceLevel,
    hasProvidedRemnashopSession: Boolean(options.remnashopSession),
    accessTokenExpiresAt,
    refreshExpiresAt,
  });

  return session;
}

export async function upgradeCurrentSessionToFull() {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  const updatedSession = await prisma.webSession.update({
    where: { id: session.id },
    data: {
      authMethod: WebSessionAuthMethod.PASSKEY,
      assuranceLevel: WebSessionAssuranceLevel.FULL,
      accessTokenExpiresAt: addMinutes(new Date(), securityPolicy.accessSessionTtlMinutes),
    },
    include: { user: true },
  });

  await setAccessCookie({
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    expiresAt: updatedSession.accessTokenExpiresAt,
    assuranceLevel: updatedSession.assuranceLevel,
    emailVerified: updatedSession.user.emailVerified,
    telegramId: updatedSession.user.telegramId,
  });

  authDebugLog("session_upgraded_to_full", {
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
  });

  return updatedSession;
}

export async function replaceWebSessionAfterPasswordChange({
  sessionId,
  userId,
  remnashopAccessTokenEncrypted,
  remnashopRefreshTokenEncrypted,
  remnashopAccessExpiresAt,
  remnashopRefreshExpiresAt,
}: {
  sessionId: string;
  userId: string;
  remnashopAccessTokenEncrypted: string;
  remnashopRefreshTokenEncrypted: string;
  remnashopAccessExpiresAt: Date;
  remnashopRefreshExpiresAt: Date;
}) {
  const env = getEnv();
  const cookieStore = await cookies();
  const now = new Date();
  const accessTokenExpiresAt = addMinutes(
    now,
    securityPolicy.accessSessionTtlMinutes,
  );
  const refreshExpiresAt = addDays(now, securityPolicy.refreshSessionTtlDays);
  const refreshToken = randomToken(48);
  const revokedSessionData = revokedWebSessionData(now);

  const replaceSession = () => prisma.$transaction(async (tx) => {
    const lockedSession = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT session."id"
        FROM "WebUser" AS app_user
        JOIN "WebSession" AS session
          ON session."userId" = app_user."id"
        WHERE app_user."id" = ${userId}
          AND session."id" = ${sessionId}
        FOR UPDATE OF app_user, session
      `,
    );

    if (lockedSession.length !== 1 || lockedSession[0]?.id !== sessionId) {
      throw new ServiceError("UNAUTHORIZED", 401, "Current session is no longer active");
    }

    const currentSession = await tx.webSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (
      !currentSession ||
      currentSession.userId !== userId ||
      currentSession.revokedAt
    ) {
      throw new ServiceError("UNAUTHORIZED", 401, "Current session is no longer active");
    }

    const revokedSessions = await tx.webSession.updateMany({
      where: { userId, revokedAt: null },
      data: revokedSessionData,
    });

    if (revokedSessions.count < 1) {
      throw new ServiceError("UNAUTHORIZED", 401, "Current session is no longer active");
    }

    const newSession = await tx.webSession.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        remnashopAccessTokenEncrypted,
        remnashopRefreshTokenEncrypted,
        remnashopAccessExpiresAt,
        remnashopRefreshExpiresAt,
        authMethod: currentSession.authMethod,
        assuranceLevel: currentSession.assuranceLevel,
        userAgent: currentSession.userAgent,
        ipHash: currentSession.ipHash,
        accessTokenExpiresAt,
        refreshExpiresAt,
      },
    });

    return {
      newSession,
      user: currentSession.user,
      revokedSessionCount: revokedSessions.count,
    };
  });

  let replacement: Awaited<ReturnType<typeof replaceSession>>;

  try {
    replacement = await replaceSession();
  } catch (error) {
    // The upstream password is already changed at this point. If creating the
    // replacement fails, fail closed by revoking every still-active local
    // session and clearing this browser's credentials.
    try {
      await prisma.webSession.updateMany({
        where: { userId, revokedAt: null },
        data: revokedSessionData,
      });
    } finally {
      cookieStore.delete(sessionCookieNames.access);
      cookieStore.delete(sessionCookieNames.refresh);
    }

    throw error;
  }

  await setAccessCookie({
    sessionId: replacement.newSession.id,
    userId,
    expiresAt: accessTokenExpiresAt,
    assuranceLevel: replacement.newSession.assuranceLevel,
    emailVerified: replacement.user.emailVerified,
    telegramId: replacement.user.telegramId,
  });
  cookieStore.set(sessionCookieNames.refresh, refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: refreshExpiresAt,
  });

  authDebugLog("session_replaced_after_password_change", {
    oldSessionId: sessionId,
    newSessionId: replacement.newSession.id,
    userId,
    revokedSessionCount: replacement.revokedSessionCount,
    accessTokenExpiresAt,
    refreshExpiresAt,
  });

  return {
    session: replacement.newSession,
    revokedSessionCount: replacement.revokedSessionCount,
  };
}

export async function getWebSessionUserIdFromAccessCookie() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;

  return accessToken ? verifyAccessToken(accessToken)?.uid ?? null : null;
}

export async function clearWebSession() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;
  const refreshToken = cookieStore.get(sessionCookieNames.refresh)?.value;
  const payload = accessToken ? verifyAccessToken(accessToken) : null;

  authDebugLog("session_clear_started", {
    hasAccessCookie: Boolean(accessToken),
    hasRefreshCookie: Boolean(refreshToken),
    accessPayloadValid: Boolean(payload),
    sessionId: payload?.sid,
    userId: payload?.uid,
  });

  try {
    if (payload) {
      const session = await prisma.webSession.findFirst({
        where: {
          id: payload.sid,
          userId: payload.uid,
          revokedAt: null,
          accessTokenExpiresAt: { gt: new Date() },
        },
        select: { id: true, userId: true },
      });

      if (session) {
        const now = new Date();
        await prisma.webSession.updateMany({
          where: {
            id: session.id,
            userId: session.userId,
            revokedAt: null,
          },
          data: revokedWebSessionData(now),
        });
      } else if (refreshToken) {
        await revokeSessionByRefreshToken(refreshToken);
      }
    } else if (refreshToken) {
      await revokeSessionByRefreshToken(refreshToken);
    }
    authDebugLog("session_clear_success", {
      revokedBy: payload ? "access" : refreshToken ? "refresh" : "cookies_only",
      sessionId: payload?.sid,
    });
  } finally {
    cookieStore.delete(sessionCookieNames.access);
    cookieStore.delete(sessionCookieNames.refresh);
  }
}
