import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({
    webJwtSecret: "test-web-jwt-secret-with-enough-entropy",
    cookieSecure: true,
    cookieSameSite: "lax",
  }),
}));

import {
  completedTelegramCallbackDestination,
  setTelegramCallbackReceipt,
  telegramCallbackReceiptCookieName,
  telegramCallbackReceiptMaxAgeSeconds,
} from "@/backend/integrations/telegram/callback-receipt";

const state = "telegram-state-with-sufficient-entropy";
const code = "telegram-authorization-code";
const issuedAt = Date.parse("2030-01-01T00:00:00.000Z");

function receiptCookie(redirectTo = "/cabinet") {
  const response = NextResponse.redirect("https://pay.example.com/cabinet");
  setTelegramCallbackReceipt(response, state, code, redirectTo, issuedAt);
  const value = response.cookies.get(telegramCallbackReceiptCookieName)?.value;
  expect(value).toBeTruthy();
  return value!;
}

function request(
  value: string,
  callbackState = state,
  callbackCode = code,
) {
  return new Request(
    `https://pay.example.com/auth/telegram/callback?code=${callbackCode}&state=${callbackState}`,
    { headers: { cookie: `${telegramCallbackReceiptCookieName}=${value}` } },
  );
}

describe("Telegram callback completion receipt", () => {
  it("uses a short-lived HttpOnly host cookie scoped to the callback route", () => {
    const response = NextResponse.redirect("https://pay.example.com/cabinet");
    setTelegramCallbackReceipt(response, state, code, "/cabinet", issuedAt);
    const serialized = response.headers.get("set-cookie") ?? "";

    expect(serialized).toContain(`${telegramCallbackReceiptCookieName}=`);
    expect(serialized).toContain(`Max-Age=${telegramCallbackReceiptMaxAgeSeconds}`);
    expect(serialized).toContain("Path=/auth/telegram/callback");
    expect(serialized).toContain("HttpOnly");
    expect(serialized).toContain("SameSite=lax");
    expect(serialized).toContain("Secure");
    expect(serialized).not.toContain("Domain=");
  });

  it("accepts the exact completed state and safe destination during the replay window", () => {
    const value = receiptCookie("/link-account?auth=telegram_processing");

    expect(completedTelegramCallbackDestination(
      request(value),
      state,
      code,
      issuedAt + 11_000,
    )).toBe("/link-account?auth=telegram_processing");
    expect(completedTelegramCallbackDestination(
      request(value),
      state,
      code,
      issuedAt + telegramCallbackReceiptMaxAgeSeconds * 1_000 - 1,
    )).toBe("/link-account?auth=telegram_processing");
    expect(completedTelegramCallbackDestination(
      request(value),
      state,
      code,
      issuedAt + telegramCallbackReceiptMaxAgeSeconds * 1_000,
    )).toBeUndefined();
  });

  it("rejects a different state, a forged signature and an expired receipt", () => {
    const value = receiptCookie();
    const forged = `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;

    expect(completedTelegramCallbackDestination(
      request(value, "different-telegram-state-value"),
      "different-telegram-state-value",
      code,
      issuedAt + 11_000,
    )).toBeUndefined();
    expect(completedTelegramCallbackDestination(
      request(value, state, "different-authorization-code"),
      state,
      "different-authorization-code",
      issuedAt + 11_000,
    )).toBeUndefined();
    expect(completedTelegramCallbackDestination(
      request(forged),
      state,
      code,
      issuedAt + 11_000,
    )).toBeUndefined();
    expect(completedTelegramCallbackDestination(
      request(value),
      state,
      code,
      issuedAt + (telegramCallbackReceiptMaxAgeSeconds + 1) * 1_000,
    )).toBeUndefined();
  });

  it("does not issue a receipt for malformed state and canonicalizes an unsafe destination", () => {
    const malformed = NextResponse.redirect("https://pay.example.com/cabinet");
    setTelegramCallbackReceipt(malformed, "short", code, "/cabinet", issuedAt);
    expect(malformed.cookies.get(telegramCallbackReceiptCookieName)).toBeUndefined();

    const value = receiptCookie("/missing");
    expect(completedTelegramCallbackDestination(
      request(value),
      state,
      code,
      issuedAt + 1_000,
    )).toBe("/cabinet");

    const oversized = receiptCookie(`/cabinet?note=${"a".repeat(600)}`);
    expect(completedTelegramCallbackDestination(
      request(oversized),
      state,
      code,
      issuedAt + 1_000,
    )).toBe("/cabinet");
  });
});
