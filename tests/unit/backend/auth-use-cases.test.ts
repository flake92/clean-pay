import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopAuth: vi.fn(),
  remnashopRequest: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopMe: vi.fn(),
  remnashopChangePassword: vi.fn(),
  protectRemnashopToken: vi.fn((token: string) => `protected:${token}`),
  getJwtExpiresAt: vi.fn(() => new Date("2026-06-26T00:00:00.000Z")),
  createSessionFromRemnashopAuth: vi.fn(),
  linkCurrentUserToRemnashopAuth: vi.fn(),
  assertRateLimit: vi.fn(),
  assertCooldown: vi.fn(),
  auditLog: vi.fn(),
  authDebugLog: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  getCurrentSession: vi.fn(),
  refreshCurrentAccessCookie: vi.fn(),
  prisma: {
    webUser: { update: vi.fn() },
    webSession: { update: vi.fn() },
  },
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopAuth: mocks.remnashopAuth,
  remnashopRequest: mocks.remnashopRequest,
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopMe: mocks.getRemnashopMe,
  remnashopChangePassword: mocks.remnashopChangePassword,
  protectRemnashopToken: mocks.protectRemnashopToken,
  getJwtExpiresAt: mocks.getJwtExpiresAt,
}));

vi.mock("@/backend/integrations/remnashop/session", () => ({
  createSessionFromRemnashopAuth: mocks.createSessionFromRemnashopAuth,
  linkCurrentUserToRemnashopAuth: mocks.linkCurrentUserToRemnashopAuth,
}));

vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertCooldown: mocks.assertCooldown,
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

vi.mock("@/backend/security/turnstile", () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/sessions/web-session", () => ({
  getCurrentSession: mocks.getCurrentSession,
  refreshCurrentAccessCookie: mocks.refreshCurrentAccessCookie,
}));

import { loginWithEmail } from "@/backend/auth/email-login";
import { registerWithEmail } from "@/backend/auth/email-register";
import { changeEmail, confirmEmailVerification, requestEmailVerification } from "@/backend/auth/email-verification";
import { changePassword } from "@/backend/auth/password";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import { linkRemnashopAccount } from "@/backend/auth/remnashop-link";
import { BffError } from "@/backend/integrations/remnashop/errors";

const authData = {
  expires_at: "2026-06-25T10:00:00.000Z",
  refresh_expires_at: "2026-07-25T10:00:00.000Z",
};

const authResult = {
  data: authData,
  cookies: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
  },
};

const profile = {
  telegram_id: null,
  auth_type: "email",
  email: "user@example.com",
  is_email_verified: false,
  pending_email: null,
  name: "User",
  username: null,
  language: "ru",
};

const user = {
  id: "user-1",
  email: "user@example.com",
  emailVerified: false,
  telegramId: null,
};

const session = {
  id: "session-1",
  userId: "user-1",
  authMethod: "EMAIL",
  assuranceLevel: "FULL",
  user,
};

describe("auth use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remnashopAuth.mockResolvedValue(authResult);
    mocks.remnashopRequest.mockResolvedValue({ target_email: "user@example.com", expires_at: "2026-06-25T10:15:00.000Z" });
    mocks.createSessionFromRemnashopAuth.mockResolvedValue({ user, profile });
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValue({ user, profile });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token", refreshToken: "refresh-token", session });
    mocks.getCurrentSession.mockResolvedValue({ ...session, remnashopAccessTokenEncrypted: null, remnashopRefreshTokenEncrypted: null });
    mocks.getRemnashopMe.mockResolvedValue(profile);
    mocks.remnashopChangePassword.mockResolvedValue({
      data: { success: true },
      cookies: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
  });

  it("logs in with email through Turnstile, rate-limit and Remnashop session creation", async () => {
    await expect(
      loginWithEmail({ email: "user@example.com", password: "secret", turnstileToken: "ts" }, { remoteIp: "127.0.0.1" }),
    ).resolves.toEqual({
      user: profile,
      expiresAt: authData.expires_at,
      refreshExpiresAt: authData.refresh_expires_at,
    });

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("ts", "127.0.0.1");
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth_login", email: "user@example.com", limit: 5 }),
    );
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/login", { email: "user@example.com", password: "secret" });
    expect(mocks.createSessionFromRemnashopAuth).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      auth: authData,
    });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "auth_login_success", userId: "user-1" }));
  });

  it("registers new email users and requests verification", async () => {
    const result = await registerWithEmail(
      { email: "user@example.com", password: "secret", name: "User" },
      { token: "ctx-token", remoteIp: null },
    );

    expect(result.emailVerification.target_email).toBe("user@example.com");
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/register", {
      email: "user@example.com",
      password: "secret",
      name: "User",
    });
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/auth/email/request-verification", {
      method: "POST",
      accessToken: "access-token",
      body: { email: "user@example.com" },
    });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "auth_register_success" }));
  });

  it("resumes registration by logging in when Remnashop reports existing email", async () => {
    mocks.remnashopAuth
      .mockRejectedValueOnce(new BffError("CONFLICT", 409, "email already exists"))
      .mockResolvedValueOnce(authResult);

    await registerWithEmail({ email: "user@example.com", password: "secret", name: "User" }, {});

    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(1, "/auth/register", expect.any(Object));
    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(2, "/auth/login", {
      email: "user@example.com",
      password: "secret",
    });
  });

  it("requests and confirms email verification for the current session", async () => {
    await requestEmailVerification({ email: "user@example.com" }, {});

    expect(mocks.getAuthorizedRemnashopTokens).toHaveBeenCalledWith({ allowUnverifiedEmail: true });
    expect(mocks.assertCooldown).toHaveBeenCalledWith(
      expect.objectContaining({ key: "email-verification:user-1", action: "email_verification_request" }),
    );

    mocks.remnashopRequest.mockResolvedValueOnce({ email: "verified@example.com" });
    mocks.getRemnashopMe.mockResolvedValueOnce({ ...profile, pending_email: "verified@example.com" });

    await confirmEmailVerification({ code: "123456", registrationFlow: true }, {});

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledTimes(1);
    expect(mocks.remnashopRequest).toHaveBeenLastCalledWith("/auth/email/confirm", {
      method: "POST",
      accessToken: "access-token",
      body: { code: "123456", email: "verified@example.com" },
    });
    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "verified@example.com", emailVerified: true },
    });
    expect(mocks.refreshCurrentAccessCookie).toHaveBeenCalledOnce();
  });

  it("changes email and marks local user as unverified", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce({ pending_email: "next@example.com" }).mockResolvedValueOnce({
      target_email: "next@example.com",
      expires_at: "2026-06-25T10:15:00.000Z",
    });

    await expect(changeEmail({ email: "next@example.com" })).resolves.toMatchObject({
      pending_email: "next@example.com",
      emailVerification: { target_email: "next@example.com" },
    });

    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerified: false },
    });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "email_change_requested" }));
  });

  it("rotates local Remnashop session tokens after password change", async () => {
    await expect(changePassword({ current_password: "old", new_password: "new" })).resolves.toEqual({ success: true });

    expect(mocks.remnashopChangePassword).toHaveBeenCalledWith("access-token", {
      current_password: "old",
      new_password: "new",
    });
    expect(mocks.prisma.webSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: "protected:new-access",
        remnashopRefreshTokenEncrypted: "protected:new-refresh",
      }),
    });
  });

  it("returns local profile when the current session is not linked to Remnashop", async () => {
    await expect(getCurrentAuthProfile()).resolves.toMatchObject({
      user: {
        email: "user@example.com",
        auth_type: "email",
      },
    });
    expect(mocks.getRemnashopMe).not.toHaveBeenCalled();
  });

  it("returns Remnashop profile when current session has Remnashop tokens", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      remnashopAccessTokenEncrypted: "protected-access",
      remnashopRefreshTokenEncrypted: "protected-refresh",
    });

    await expect(getCurrentAuthProfile()).resolves.toMatchObject({
      user: {
        email: "user@example.com",
        auth_type: "email",
      },
    });

    expect(mocks.getAuthorizedRemnashopTokens).toHaveBeenCalledWith({ allowUnverifiedEmail: true });
  });

  it("links Remnashop account and falls back to registration after auth failure", async () => {
    mocks.remnashopAuth
      .mockRejectedValueOnce(new BffError("AUTH_FAILED", 401, "bad credentials"))
      .mockResolvedValueOnce(authResult);

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: true,
      emailVerification: { target_email: "user@example.com" },
    });

    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(1, "/auth/login", {
      email: "user@example.com",
      password: "secret",
    });
    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(2, "/auth/register", {
      email: "user@example.com",
      password: "secret",
    });
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledOnce();
  });
});
