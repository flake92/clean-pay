import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";

import {
  clearReferralAttributionCookieOnResponse,
  createReferralAttributionValue,
  referralAttributionCookieName,
  referralAttributionTtlSeconds,
  verifyReferralAttributionValue,
} from "@/backend/integrations/referral/referral-attribution";
import {
  canonicalReferralPath,
  normalizeReferralCode,
} from "@/shared/domain/referrals";

describe("referral attribution", () => {
  const now = new Date("2026-08-20T10:00:00.000Z");

  it("accepts only bounded alphanumeric referral codes", () => {
    expect(normalizeReferralCode("AbC123")).toBe("AbC123");
    expect(normalizeReferralCode(" AbC123 ")).toBeNull();
    expect(normalizeReferralCode("ab")).toBeNull();
    expect(normalizeReferralCode("a".repeat(65))).toBeNull();
    expect(normalizeReferralCode("../friend")).toBeNull();
    expect(normalizeReferralCode("friend_code")).toBeNull();
    expect(canonicalReferralPath("AbC123")).toBe("/invite/AbC123");
  });

  it("round-trips a signed, time-bounded HttpOnly-cookie value", () => {
    const value = createReferralAttributionValue("AbC123", now);

    expect(verifyReferralAttributionValue(value, now)).toBe("AbC123");
    expect(verifyReferralAttributionValue(
      value,
      new Date(now.getTime() + referralAttributionTtlSeconds * 1_000),
    )).toBe("AbC123");
  });

  it("rejects tampering, expiration and implausible issue times", () => {
    const value = createReferralAttributionValue("AbC123", now);
    const parts = value.split(".");

    expect(verifyReferralAttributionValue(
      [parts[0], "Other42", parts[2], parts[3]].join("."),
      now,
    )).toBeNull();
    expect(verifyReferralAttributionValue(
      value,
      new Date(now.getTime() + (referralAttributionTtlSeconds + 1) * 1_000),
    )).toBeNull();
    expect(verifyReferralAttributionValue(
      createReferralAttributionValue("AbC123", new Date(now.getTime() + 301_000)),
      now,
    )).toBeNull();
    expect(verifyReferralAttributionValue("x".repeat(161), now)).toBeNull();
  });

  it("expires attribution directly on a terminal route response", () => {
    const response = NextResponse.json({ ok: true });

    clearReferralAttributionCookieOnResponse(response);

    expect(response.cookies.get(referralAttributionCookieName)).toMatchObject({
      name: referralAttributionCookieName,
      value: "",
    });
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});
