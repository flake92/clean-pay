import { cookies, headers } from "next/headers";

import { sha256, hmacSha256, jsonBase64Url, parseJsonBase64Url, randomToken, safeEqual } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { securityPolicy } from "@/lib/security-policy";

export const sessionCookieNames = {
  access: "clean_pay_access",
  refresh: "clean_pay_refresh",
} as const;

type AccessPayload = {
  sid: string;
  uid: string;
  exp: number;
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
      accessTokenExpiresAt,
      refreshExpiresAt,
    },
  });

  const accessToken = signAccessToken({
    sid: session.id,
    uid: userId,
    exp: Math.floor(accessTokenExpiresAt.getTime() / 1000),
  });

  cookieStore.set(sessionCookieNames.access, accessToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: accessTokenExpiresAt,
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
      userAgent: requestHeaders.get("user-agent"),
      accessTokenExpiresAt,
      refreshExpiresAt,
    },
  });

  const accessToken = signAccessToken({
    sid: session.id,
    uid: userId,
    exp: Math.floor(accessTokenExpiresAt.getTime() / 1000),
  });

  cookieStore.set(sessionCookieNames.access, accessToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: accessTokenExpiresAt,
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
    return null;
  }

  const payload = verifyAccessToken(accessToken);

  if (!payload) {
    return null;
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

  return session?.user ?? null;
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(sessionCookieNames.access)?.value;

  if (!accessToken) {
    return null;
  }

  const payload = verifyAccessToken(accessToken);

  if (!payload) {
    return null;
  }

  return prisma.webSession.findFirst({
    where: {
      id: payload.sid,
      userId: payload.uid,
      revokedAt: null,
      accessTokenExpiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
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
