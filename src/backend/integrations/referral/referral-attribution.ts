import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { getEnv } from "@/backend/config/env";
import { hmacSha256, safeEqual } from "@/backend/security/crypto";
import {
  REFERRAL_ATTRIBUTION_COOKIE_NAME,
  normalizeReferralCode,
} from "@/shared/domain/referrals";

export const referralAttributionCookieName = REFERRAL_ATTRIBUTION_COOKIE_NAME;
export const referralAttributionTtlSeconds = 30 * 24 * 60 * 60;

const VERSION = "v1";
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_COOKIE_LENGTH = 160;

function signaturePayload(code: string, issuedAtSeconds: number) {
  return `clean-pay:referral-attribution:${VERSION}:${code}:${issuedAtSeconds}`;
}

function sign(code: string, issuedAtSeconds: number) {
  return hmacSha256(
    signaturePayload(code, issuedAtSeconds),
    getEnv().rateLimitIdentitySecret,
  );
}

export function createReferralAttributionValue(
  code: string,
  now = new Date(),
) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) throw new Error("Invalid referral code");

  const issuedAtSeconds = Math.floor(now.getTime() / 1_000);
  return [VERSION, normalized, issuedAtSeconds, sign(normalized, issuedAtSeconds)].join(".");
}

export function verifyReferralAttributionValue(
  value: unknown,
  now = new Date(),
) {
  if (typeof value !== "string" || value.length > MAX_COOKIE_LENGTH) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, rawCode, rawIssuedAt, suppliedSignature] = parts;
  if (version !== VERSION || !rawCode || !rawIssuedAt || !suppliedSignature) return null;

  const code = normalizeReferralCode(rawCode);
  if (!code || code !== rawCode || !/^\d{10}$/.test(rawIssuedAt)) return null;

  const issuedAtSeconds = Number(rawIssuedAt);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (
    !Number.isSafeInteger(issuedAtSeconds)
    || issuedAtSeconds > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    || nowSeconds - issuedAtSeconds > referralAttributionTtlSeconds
  ) {
    return null;
  }

  const expectedSignature = sign(code, issuedAtSeconds);
  return safeEqual(suppliedSignature, expectedSignature) ? code : null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: referralAttributionTtlSeconds,
    path: "/",
    sameSite: "lax" as const,
    secure: getEnv().cookieSecure,
  };
}

export function setReferralAttributionCookie(
  response: NextResponse,
  code: string,
  now = new Date(),
) {
  response.cookies.set(
    referralAttributionCookieName,
    createReferralAttributionValue(code, now),
    cookieOptions(),
  );
}

export async function readReferralAttributionCookie() {
  const value = (await cookies()).get(referralAttributionCookieName)?.value;
  return verifyReferralAttributionValue(value);
}

export async function clearReferralAttributionCookie() {
  (await cookies()).set(referralAttributionCookieName, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}

export function clearReferralAttributionCookieOnResponse(response: NextResponse) {
  response.cookies.set(referralAttributionCookieName, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}
