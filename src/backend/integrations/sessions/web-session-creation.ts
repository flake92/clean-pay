import { cookies, headers } from "next/headers";
import {
  Prisma,
  WebSessionAssuranceLevel,
  WebSessionAuthMethod,
} from "@prisma/client";

import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { randomToken, sha256 } from "@/backend/security/crypto";
import { securityPolicy } from "@/backend/security/policy";
import {
  revokeAllWebSessionsForUser,
  sessionCookieNames,
} from "@/backend/integrations/sessions/web-session-revocation";
import {
  addDays,
  addMinutes,
  setAccessCookie,
} from "@/backend/integrations/sessions/web-session-token";

export async function createWebSession(
  userId: string,
  {
    authMethod = WebSessionAuthMethod.EMAIL,
    assuranceLevel = WebSessionAssuranceLevel.FULL,
  }: {
    authMethod?: WebSessionAuthMethod;
    assuranceLevel?: WebSessionAssuranceLevel;
  } = {},
) {
  const env = getEnv();
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const now = new Date();
  const accessTokenExpiresAt = addMinutes(
    now,
    securityPolicy.accessSessionTtlMinutes,
  );
  const refreshExpiresAt = addDays(now, securityPolicy.refreshSessionTtlDays);
  const refreshToken = randomToken(48);

  authDebugLog("session_create_started", {
    userId,
    authMethod,
    assuranceLevel,
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: false,
  });
  const session = await prisma.webSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      userAgent: requestHeaders.get("user-agent"),
      authMethod,
      assuranceLevel,
      accessTokenExpiresAt,
      refreshExpiresAt,
    },
  });
  const user = await prisma.webUser.findUnique({
    where: { id: userId },
    select: { emailVerified: true, telegramId: true },
  });

  await setAccessCookie({
    sessionId: session.id,
    userId,
    expiresAt: accessTokenExpiresAt,
    assuranceLevel,
    emailVerified: user?.emailVerified,
    telegramId: user?.telegramId,
  });
  cookieStore.set(sessionCookieNames.refresh, refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: refreshExpiresAt,
  });
  authDebugLog("session_create_success", {
    sessionId: session.id,
    userId,
    authMethod: session.authMethod,
    assuranceLevel: session.assuranceLevel,
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: Boolean(
      session.remnashopAccessTokenEncrypted &&
      session.remnashopRefreshTokenEncrypted
    ),
  });
  return session;
}

export async function createWebSessionForRemnashopUser({
  userId,
  remnashopAccessTokenEncrypted,
  remnashopRefreshTokenEncrypted,
  remnashopAccessExpiresAt,
  remnashopRefreshExpiresAt,
  tx,
  authMethod = WebSessionAuthMethod.EMAIL,
  assuranceLevel = WebSessionAssuranceLevel.FULL,
  replaceExistingSessions = false,
}: {
  userId: string;
  remnashopAccessTokenEncrypted: string;
  remnashopRefreshTokenEncrypted: string;
  remnashopAccessExpiresAt: Date;
  remnashopRefreshExpiresAt: Date;
  tx?: Prisma.TransactionClient;
  authMethod?: WebSessionAuthMethod;
  assuranceLevel?: WebSessionAssuranceLevel;
  replaceExistingSessions?: boolean;
}) {
  const env = getEnv();
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const db = tx ?? prisma;
  const now = new Date();
  const accessTokenExpiresAt = addMinutes(
    now,
    securityPolicy.accessSessionTtlMinutes,
  );
  const refreshExpiresAt = addDays(now, securityPolicy.refreshSessionTtlDays);
  const refreshToken = randomToken(48);

  authDebugLog("session_create_started", {
    userId,
    authMethod,
    assuranceLevel,
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: true,
    remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt,
    replaceExistingSessions,
  });
  if (replaceExistingSessions) {
    if (!tx) {
      throw new Error(
        "Replacing existing Remnashop sessions requires an existing database transaction",
      );
    }
    const lockedUser = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT app_user."id"
        FROM "WebUser" AS app_user
        WHERE app_user."id" = ${userId}
        FOR UPDATE
      `,
    );
    if (lockedUser.length !== 1 || lockedUser[0]?.id !== userId) {
      throw new ServiceError(
        "CONFLICT",
        409,
        "Local account changed while replacing password-reset sessions",
      );
    }
    const revokedSessions = await revokeAllWebSessionsForUser(userId, {
      client: tx,
      now,
    });
    authDebugLog("session_reset_existing_sessions_revoked", {
      userId,
      revokedSessionCount: revokedSessions.count,
    });
  }

  const session = await db.webSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      remnashopAccessTokenEncrypted,
      remnashopRefreshTokenEncrypted,
      remnashopAccessExpiresAt,
      remnashopRefreshExpiresAt,
      authMethod,
      assuranceLevel,
      userAgent: requestHeaders.get("user-agent"),
      accessTokenExpiresAt,
      refreshExpiresAt,
    },
  });
  const user = await db.webUser.findUnique({
    where: { id: userId },
    select: { emailVerified: true, telegramId: true },
  });
  await setAccessCookie({
    sessionId: session.id,
    userId,
    expiresAt: accessTokenExpiresAt,
    assuranceLevel,
    emailVerified: user?.emailVerified,
    telegramId: user?.telegramId,
  });
  cookieStore.set(sessionCookieNames.refresh, refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: refreshExpiresAt,
  });
  authDebugLog("session_create_success", {
    sessionId: session.id,
    userId,
    authMethod: session.authMethod,
    assuranceLevel: session.assuranceLevel,
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: true,
  });
  return session;
}
