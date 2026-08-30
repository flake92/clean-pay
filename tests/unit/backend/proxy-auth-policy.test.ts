import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  authenticatedEntryRedirectPolicy,
  authenticatedInviteRedirectPolicy,
  emailVerificationRedirectPolicy,
  getAccessState,
  passkeySetupRedirectPolicy,
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
  it("projects valid FULL and BOOTSTRAP access claims without promoting a refresh candidate", async () => {
    const baseClaims = { exp: 2_000, ev: true };
    await expect(getAccessState({
      token: signedAccessToken({ ...baseClaims, al: "FULL" }),
      hasRefreshToken: true,
      jwtSecret: () => "test-secret",
      nowEpochSeconds: () => 1_000,
    })).resolves.toEqual({
      authenticated: true,
      fullAuthenticated: true,
      bootstrapAuthenticated: false,
      emailVerificationRequired: false,
      hasRefreshToken: true,
    });
    await expect(getAccessState({
      token: signedAccessToken({ ...baseClaims, al: "BOOTSTRAP", ev: false }),
      hasRefreshToken: false,
      jwtSecret: () => "test-secret",
      nowEpochSeconds: () => 1_000,
    })).resolves.toEqual({
      authenticated: true,
      fullAuthenticated: false,
      bootstrapAuthenticated: true,
      emailVerificationRequired: true,
      hasRefreshToken: false,
    });
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
      token: signedAccessToken({ exp: 999, ev: true }),
      hasRefreshToken: true,
      jwtSecret: secret,
      nowEpochSeconds: () => 1_000,
    });
    expect(expired).toEqual({
      authenticated: false,
      fullAuthenticated: false,
      bootstrapAuthenticated: false,
      emailVerificationRequired: false,
      hasRefreshToken: true,
    });
    expect(secret).not.toHaveBeenCalled();

    for (const token of [
      "malformed",
      signedAccessToken({ exp: 2_000, ev: true }, "wrong-secret"),
    ]) {
      await expect(getAccessState({
        token,
        hasRefreshToken: false,
        jwtSecret: () => "test-secret",
        nowEpochSeconds: () => 1_000,
      })).resolves.toMatchObject({ authenticated: false });
    }
    await expect(getAccessState({
      token: signedAccessToken({ exp: 2_000, ev: true }),
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

  it("derives the same invite, verification, and passkey destinations", () => {
    expect(authenticatedEntryRedirectPolicy({
      requestedRedirect: "/payment?plan=pro#resume",
      bootstrapAuthenticated: true,
      emailVerificationRequired: false,
    })).toBe("/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro%23resume");
    expect(authenticatedEntryRedirectPolicy({
      requestedRedirect: "/payment?plan=pro",
      bootstrapAuthenticated: false,
      emailVerificationRequired: true,
    })).toBe("/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro");
    expect(authenticatedInviteRedirectPolicy({
      bootstrapAuthenticated: false,
      emailVerificationRequired: false,
    })).toBe("/tariffs");
    expect(emailVerificationRedirectPolicy("/profile", "?tab=email"))
      .toBe("/register/verify-email?redirect_to=%2Fprofile%3Ftab%3Demail");
    expect(passkeySetupRedirectPolicy("/payment", "?plan=pro"))
      .toBe("/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro");
  });
});
