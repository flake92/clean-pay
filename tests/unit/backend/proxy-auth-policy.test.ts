import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  authenticatedEntryRedirectPolicy,
  authenticatedInviteRedirectPolicy,
  emailVerificationRedirectPolicy,
  getAccessState,
  refreshSessionRedirectPolicy,
  safeRedirectTarget,
} from "@/shared/edge/proxy-auth-policy";

function signedAccessToken(
  claims: Record<string, unknown>,
  secret = "test-secret",
) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

describe("proxy auth and redirect policy", () => {
  it("accepts only FULL access claims without promoting a refresh candidate", async () => {
    const baseClaims = { exp: 2_000, ev: true };
    await expect(getAccessState({
      token: signedAccessToken({ ...baseClaims, al: "FULL" }),
      hasRefreshToken: true,
      jwtSecret: () => "test-secret",
      nowEpochSeconds: () => 1_000,
    })).resolves.toEqual({
      authenticated: true,
      emailVerificationRequired: false,
      hasRefreshToken: true,
    });
    for (const al of ["BOOTSTRAP", undefined, "full"]) {
      await expect(getAccessState({
        token: signedAccessToken({ ...baseClaims, al, ev: false }),
        hasRefreshToken: false,
        jwtSecret: () => "test-secret",
        nowEpochSeconds: () => 1_000,
      })).resolves.toEqual({
        authenticated: false,
        emailVerificationRequired: false,
        hasRefreshToken: false,
      });
    }
  });

  it("requires verification for a direct e-mail cabinet session without restricting Telegram-only access", async () => {
    const common = {
      hasRefreshToken: false,
      jwtSecret: () => "test-secret",
      nowEpochSeconds: () => 1_000,
    };

    await expect(getAccessState({
      ...common,
      token: signedAccessToken({ exp: 2_000, al: "FULL", ev: false, tg: false }),
    })).resolves.toMatchObject({
      authenticated: true,
      emailVerificationRequired: true,
    });
    await expect(getAccessState({
      ...common,
      token: signedAccessToken({ exp: 2_000, al: "FULL", ev: false, tg: true }),
    })).resolves.toMatchObject({
      authenticated: true,
      emailVerificationRequired: false,
    });
  });

  it("fails closed for expired, malformed, missing-secret, and invalid-signature tokens", async () => {
    const secret = vi.fn(() => "test-secret");
    const expired = await getAccessState({
      token: signedAccessToken({ exp: 999, al: "FULL", ev: true }),
      hasRefreshToken: true,
      jwtSecret: secret,
      nowEpochSeconds: () => 1_000,
    });
    expect(expired).toEqual({
      authenticated: false,
      emailVerificationRequired: false,
      hasRefreshToken: true,
    });
    expect(secret).not.toHaveBeenCalled();

    for (const token of [
      "malformed",
      signedAccessToken({ exp: 2_000, al: "FULL", ev: true }, "wrong-secret"),
    ]) {
      await expect(getAccessState({
        token,
        hasRefreshToken: false,
        jwtSecret: () => "test-secret",
        nowEpochSeconds: () => 1_000,
      })).resolves.toMatchObject({ authenticated: false });
    }
    await expect(getAccessState({
      token: signedAccessToken({ exp: 2_000, al: "FULL", ev: true }),
      hasRefreshToken: false,
      jwtSecret: () => undefined,
      nowEpochSeconds: () => 1_000,
    })).resolves.toMatchObject({ authenticated: false });
  });

  it("preserves protected return paths and constrains auth-entry refresh targets", () => {
    expect(safeRedirectTarget("/cabinet", "?tab=payments")).toBe(
      "/cabinet?tab=payments",
    );
    expect(safeRedirectTarget("/login", "?redirect_to=%2Fpayment")).toBe("/cabinet");
    expect(refreshSessionRedirectPolicy({
      pathname: "/cabinet",
      search: "?tab=payments",
      origin: "https://pay.example.com",
      requestedRedirect: null,
    })).toEqual({ returnTo: "/cabinet?tab=payments", fallbackTo: undefined });
    expect(refreshSessionRedirectPolicy({
      pathname: "/login",
      search: "?redirect_to=%2Fpayment",
      origin: "https://pay.example.com",
      requestedRedirect: "/payment?plan=pro#resume",
    })).toEqual({
      returnTo: "/payment?plan=pro#resume",
      fallbackTo: "/login?redirect_to=%2Fpayment%3Fplan%3Dpro%23resume",
    });
    expect(refreshSessionRedirectPolicy({
      pathname: "/register",
      search: "?redirect_to=%2F%2Fevil.example",
      origin: "https://pay.example.com",
      requestedRedirect: "//evil.example",
    })).toEqual({
      returnTo: "/cabinet",
      fallbackTo: "/register?redirect_to=%2Fcabinet",
    });
  });

  it("derives the same invite and verification destinations", () => {
    expect(authenticatedEntryRedirectPolicy({
      requestedRedirect: "/payment?plan=pro#resume",
      emailVerificationRequired: false,
    })).toBe("/payment?plan=pro#resume");
    expect(authenticatedEntryRedirectPolicy({
      requestedRedirect: "/payment?plan=pro",
      emailVerificationRequired: true,
    })).toBe("/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro");
    expect(authenticatedInviteRedirectPolicy({
      emailVerificationRequired: false,
    })).toBe("/tariffs");
    expect(authenticatedInviteRedirectPolicy({
      emailVerificationRequired: true,
    })).toBe("/register/verify-email?redirect_to=%2Ftariffs");
    expect(emailVerificationRedirectPolicy("/profile", "?tab=email"))
      .toBe("/register/verify-email?redirect_to=%2Fprofile%3Ftab%3Demail");
  });
});
