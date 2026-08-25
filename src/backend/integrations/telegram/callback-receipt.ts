import type { NextResponse } from "next/server";

import { getEnv } from "@/backend/config/env";
import {
  hmacSha256,
  jsonBase64Url,
  parseJsonBase64Url,
  safeEqual,
  sha256,
} from "@/backend/security/crypto";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export const telegramCallbackReceiptCookieName = "clean_pay_tg_callback_receipt";
export const telegramCallbackReceiptMaxAgeSeconds = 120;

type TelegramCallbackReceipt = {
  version: 1;
  stateHash: string;
  codeHash: string;
  redirectTo: string;
  expiresAt: number;
};

function signature(payload: string) {
  return hmacSha256(
    `clean-pay:telegram-callback-receipt:v1:${payload}`,
    getEnv().webJwtSecret,
  );
}

function requestCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1 || entry.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function bounded(value: string, minimum: number, maximum: number) {
  return value.length >= minimum && value.length <= maximum;
}

function receiptDestination(value: string | undefined) {
  const destination = safeRedirectPath(value);
  return destination && Buffer.byteLength(destination, "utf8") <= 512
    ? destination
    : "/cabinet";
}

function receiptCookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/auth/telegram/callback",
  } as const;
}

export function clearTelegramCallbackReceipt(response: NextResponse) {
  response.cookies.set(telegramCallbackReceiptCookieName, "", {
    ...receiptCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
}

export function setTelegramCallbackReceipt(
  response: NextResponse,
  state: string,
  code: string,
  redirectTo: string,
  now = Date.now(),
) {
  if (!bounded(state, 16, 512) || !bounded(code, 1, 4_096)) return;

  const destination = receiptDestination(redirectTo);
  const payload = jsonBase64Url({
    version: 1,
    stateHash: sha256(state),
    codeHash: sha256(code),
    redirectTo: destination,
    expiresAt: now + telegramCallbackReceiptMaxAgeSeconds * 1_000,
  } satisfies TelegramCallbackReceipt);
  const value = `${payload}.${signature(payload)}`;
  if (value.length > 2_048) return;

  response.cookies.set(telegramCallbackReceiptCookieName, value, {
    ...receiptCookieOptions(),
    maxAge: telegramCallbackReceiptMaxAgeSeconds,
  });
}

export function completedTelegramCallbackDestination(
  request: Request,
  state: string,
  code: string,
  now = Date.now(),
) {
  if (!bounded(state, 16, 512) || !bounded(code, 1, 4_096)) return undefined;

  const value = requestCookie(request, telegramCallbackReceiptCookieName);
  if (!value || value.length > 2_048) return undefined;

  const separator = value.indexOf(".");
  if (separator < 1 || value.indexOf(".", separator + 1) !== -1) {
    return undefined;
  }

  const payload = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (!safeEqual(suppliedSignature, signature(payload))) return undefined;

  try {
    const receipt = parseJsonBase64Url<Partial<TelegramCallbackReceipt>>(payload);
    const destination = receiptDestination(receipt.redirectTo);

    if (
      receipt.version !== 1
      || typeof receipt.stateHash !== "string"
      || !safeEqual(receipt.stateHash, sha256(state))
      || typeof receipt.codeHash !== "string"
      || !safeEqual(receipt.codeHash, sha256(code))
      || typeof receipt.expiresAt !== "number"
      || !Number.isSafeInteger(receipt.expiresAt)
      || receipt.expiresAt <= now
      || receipt.expiresAt > now + telegramCallbackReceiptMaxAgeSeconds * 1_000
      || !receipt.redirectTo
      || destination !== receipt.redirectTo
    ) {
      return undefined;
    }

    return destination;
  } catch {
    return undefined;
  }
}
