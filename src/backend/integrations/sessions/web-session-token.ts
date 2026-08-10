import { cookies } from "next/headers";
import { WebSessionAssuranceLevel } from "@prisma/client";

import { getEnv } from "@/backend/config/env";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import {
  hmacSha256,
  jsonBase64Url,
  parseJsonBase64Url,
  safeEqual,
} from "@/backend/security/crypto";
import { sessionCookieNames } from "@/backend/integrations/sessions/web-session-revocation";

export type AccessPayload = {
  sid: string;
  uid: string;
  exp: number;
  al?: WebSessionAssuranceLevel;
  ev?: boolean;
  tg?: boolean;
};

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function signAccessToken(payload: AccessPayload) {
  const env = getEnv();
  const encodedPayload = jsonBase64Url(payload);
  const signature = hmacSha256(encodedPayload, env.webJwtSecret);
  return `${encodedPayload}.${signature}`;
}

export async function setAccessCookie({
  sessionId,
  userId,
  expiresAt,
  assuranceLevel,
  emailVerified,
  telegramId,
}: {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  assuranceLevel: WebSessionAssuranceLevel;
  emailVerified?: boolean | null;
  telegramId?: number | string | null;
}) {
  const env = getEnv();
  const cookieStore = await cookies();
  const accessToken = signAccessToken({
    sid: sessionId,
    uid: userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    al: assuranceLevel,
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
    assuranceLevel,
    emailVerified: Boolean(emailVerified),
    hasTelegramId: Boolean(telegramId),
  });
}

export function verifyAccessToken(token: string) {
  const env = getEnv();
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = hmacSha256(encodedPayload, env.webJwtSecret);
  if (!safeEqual(signature, expectedSignature)) return null;

  const payload = parseJsonBase64Url<AccessPayload>(encodedPayload);
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}
