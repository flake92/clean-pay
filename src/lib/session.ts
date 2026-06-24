import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";

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
    return null;
  }

  const session = await prisma.webSession.findFirst({
    where: {
      refreshTokenHash: sha256(refreshToken),
      revokedAt: null,
      refreshExpiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session) {
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

  return session;
}

export async function createWebSessionForRemnashopUser({
  userId,
  remnashopAccessTokenEncrypted,
  remnashopRefreshTokenEncrypted,
  remnashopAccessExpiresAt,
  remnashopRefreshExpiresAt,
}: {
  userId: string;
  remnashopAccessTokenEncrypted: string;
  remnashopRefreshTokenEncrypted: string;
  remnashopAccessExpiresAt: Date;
  remnashopRefreshExpiresAt: Date;
}) {
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

  const session = await prisma.webSession.create({
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

  return session;
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;

  if (!accessToken) {
    return (await getSessionByRefreshToken())?.user ?? null;
  }

  const payload = verifyAccessToken(accessToken);

  if (!payload) {
    return (await getSessionByRefreshToken())?.user ?? null;
  }

  const session = await prisma.webSession.findFirst({
    where: {
      id: payload.sid,
      userId: payload.uid,
      revokedAt: null,
      accessTokenExpiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  return session?.user ?? (await getSessionByRefreshToken())?.user ?? null;
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;

  if (!accessToken) {
    return getSessionByRefreshToken();
  }

  const payload = verifyAccessToken(accessToken);

  if (!payload) {
    return getSessionByRefreshToken();
  }

  const session = await prisma.webSession.findFirst({
    where: {
      id: payload.sid,
      userId: payload.uid,
      revokedAt: null,
      accessTokenExpiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  return session ?? getSessionByRefreshToken();
}

export async function refreshCurrentAccessCookie() {
  const session = await getCurrentSession();

  if (!session) {
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

  return session;
}

export async function createWebSessionOnResponse(response: NextResponse, userId: string) {
  const env = getEnv();
  const requestHeaders = await headers();
  const currentSession = await getCurrentSession();
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

  return session;
}

export async function clearWebSession() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;
  const refreshToken = cookieStore.get(sessionCookieNames.refresh)?.value;
  const payload = accessToken ? verifyAccessToken(accessToken) : null;

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
}
