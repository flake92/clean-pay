import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { authDebugLog } from "@/lib/auth-debug-log";
import { sha256, hmacSha256, jsonBase64Url, parseJsonBase64Url, randomToken, safeEqual } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { securityPolicy } from "@/lib/security-policy";

const sessionCookieNames = {
  access: "clean_pay_access",
  refresh: "clean_pay_refresh",
} as const;

type AccessPayload = {
  sid: string;
  uid: string;
  exp: number;
  ev?: boolean;
  tg?: boolean;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function signAccessToken(payload: AccessPayload) {
  const env = getEnv();
  const encodedPayload = jsonBase64Url(payload);
  const signature = hmacSha256(encodedPayload, env.webJwtSecret);

  return `${encodedPayload}.${signature}`;
}

async function setAccessCookie({
  sessionId,
  userId,
  expiresAt,
  emailVerified,
  telegramId,
}: {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  emailVerified?: boolean | null;
  telegramId?: number | string | null;
}) {
  const env = getEnv();
  const cookieStore = await cookies();
  const accessToken = signAccessToken({
    sid: sessionId,
    uid: userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    ev: Boolean(emailVerified),
    tg: Boolean(telegramId),
  });

  cookieStore.set(sessionCookieNames.access, accessToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: expiresAt,
  });
  authDebugLog("session_access_cookie_set", {
    sessionId,
    userId,
    expiresAt,
    emailVerified: Boolean(emailVerified),
    hasTelegramId: Boolean(telegramId),
  });
}

function verifyAccessToken(token: string) {
  const env = getEnv();
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = hmacSha256(encodedPayload, env.webJwtSecret);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  const payload = parseJsonBase64Url<AccessPayload>(encodedPayload);

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

async function getSessionByRefreshToken() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(sessionCookieNames.refresh)?.value;

  if (!refreshToken) {
    authDebugLog("session_refresh_lookup_skipped", { reason: "missing_refresh_cookie" });
    return null;
  }

  authDebugLog("session_refresh_lookup_started", { hasRefreshCookie: true });
  const session = await prisma.webSession.findFirst({
    where: {
      refreshTokenHash: sha256(refreshToken),
      revokedAt: null,
      refreshExpiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session) {
    authDebugLog("session_refresh_lookup_miss", { reason: "not_found_revoked_or_expired" });
    return null;
  }

  const accessTokenExpiresAt = addMinutes(
    new Date(),
    securityPolicy.accessSessionTtlMinutes,
  );

  const updatedSession = await prisma.webSession.update({
    where: { id: session.id },
    data: { accessTokenExpiresAt },
    include: { user: true },
  });

  await setAccessCookie({
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    expiresAt: accessTokenExpiresAt,
    emailVerified: updatedSession.user.emailVerified,
    telegramId: updatedSession.user.telegramId,
  });

  authDebugLog("session_refresh_lookup_success", {
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    authMethod: updatedSession.authMethod,
    accessTokenExpiresAt,
    refreshExpiresAt: updatedSession.refreshExpiresAt,
    hasRemnashopTokens: Boolean(updatedSession.remnashopAccessTokenEncrypted && updatedSession.remnashopRefreshTokenEncrypted),
  });

  return updatedSession;
}

export async function createWebSession(userId: string) {
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
    authMethod: "EMAIL",
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: false,
  });

  const session = await prisma.webSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      userAgent: requestHeaders.get("user-agent"),
      authMethod: "EMAIL",
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
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: false,
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
}: {
  userId: string;
  remnashopAccessTokenEncrypted: string;
  remnashopRefreshTokenEncrypted: string;
  remnashopAccessExpiresAt: Date;
  remnashopRefreshExpiresAt: Date;
  tx?: Prisma.TransactionClient;
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
    authMethod: "EMAIL",
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: true,
    remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt,
  });

  const session = await db.webSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      remnashopAccessTokenEncrypted,
      remnashopRefreshTokenEncrypted,
      remnashopAccessExpiresAt,
      remnashopRefreshExpiresAt,
      authMethod: "EMAIL",
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
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasRemnashopTokens: true,
  });

  return session;
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

export async function createWebSessionOnResponse(response: NextResponse, userId: string) {
  const env = getEnv();
  const requestHeaders = await headers();
  const currentSession = await getCurrentSession();
  authDebugLog("session_response_create_started", {
    userId,
    hasCurrentSession: Boolean(currentSession),
    currentSessionId: currentSession?.id,
    currentSessionUserId: currentSession?.userId,
  });
  const reusableSession =
    currentSession?.userId === userId && currentSession.remnashopAccessTokenEncrypted && currentSession.remnashopRefreshTokenEncrypted
      ? currentSession
      : await prisma.webSession.findFirst({
          where: {
            userId,
            revokedAt: null,
            remnashopAccessTokenEncrypted: { not: null },
            remnashopRefreshTokenEncrypted: { not: null },
            refreshExpiresAt: { gt: new Date() },
          },
          orderBy: { updatedAt: "desc" },
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
    authMethod: "TELEGRAM",
    accessTokenExpiresAt,
    refreshExpiresAt,
    reusableSessionId: reusableSession?.id,
    reusedRemnashopTokens: Boolean(reusableSession),
  });

  const session = await prisma.webSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      remnashopAccessTokenEncrypted: reusableSession?.remnashopAccessTokenEncrypted,
      remnashopRefreshTokenEncrypted: reusableSession?.remnashopRefreshTokenEncrypted,
      remnashopAccessExpiresAt: reusableSession?.remnashopAccessExpiresAt,
      remnashopRefreshExpiresAt: reusableSession?.remnashopRefreshExpiresAt,
      authMethod: "TELEGRAM",
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
    reusedRemnashopTokens: Boolean(reusableSession),
    accessTokenExpiresAt,
    refreshExpiresAt,
  });

  return session;
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

  if (payload) {
    await prisma.webSession.updateMany({
      where: { id: payload.sid },
      data: { revokedAt: new Date() },
    });
  } else if (refreshToken) {
    await prisma.webSession.updateMany({
      where: { refreshTokenHash: sha256(refreshToken) },
      data: { revokedAt: new Date() },
    });
  }

  cookieStore.delete(sessionCookieNames.access);
  cookieStore.delete(sessionCookieNames.refresh);
  authDebugLog("session_clear_success", {
    revokedBy: payload ? "access" : refreshToken ? "refresh" : "cookies_only",
    sessionId: payload?.sid,
  });
}
