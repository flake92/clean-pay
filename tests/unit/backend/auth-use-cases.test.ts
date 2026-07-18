import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopAuth: vi.fn(),
  remnashopRequest: vi.fn(),
  remnashopLinkTelegram: vi.fn(),
  remnashopMergeUsers: vi.fn(),
  remnashopAuthTelegramIdentity: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopMe: vi.fn(),
  remnashopChangePassword: vi.fn(),
  remnashopRefreshTokens: vi.fn(),
  protectRemnashopToken: vi.fn((token: string) => `protected:${token}`),
  getJwtExpiresAt: vi.fn(() => new Date("2026-06-26T00:00:00.000Z")),
  getRemnashopUserIdFromAccessToken: vi.fn((token: string) => token.includes("merged") ? "1" : "18367"),
  createSessionFromRemnashopAuth: vi.fn(),
  linkCurrentUserToRemnashopAuth: vi.fn(),
  assertRateLimit: vi.fn(),
  assertCooldown: vi.fn(),
  auditLog: vi.fn(),
  authDebugLog: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  getCurrentSession: vi.fn(),
  refreshCurrentAccessCookie: vi.fn(),
  replaceWebSessionAfterPasswordChange: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    webUser: { findUnique: vi.fn(), update: vi.fn() },
    webSession: { update: vi.fn() },
  },
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopAuth: mocks.remnashopAuth,
  remnashopRequest: mocks.remnashopRequest,
  remnashopLinkTelegram: mocks.remnashopLinkTelegram,
  remnashopMergeUsers: mocks.remnashopMergeUsers,
  remnashopAuthTelegramIdentity: mocks.remnashopAuthTelegramIdentity,
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopMe: mocks.getRemnashopMe,
  remnashopChangePassword: mocks.remnashopChangePassword,
  remnashopRefreshTokens: mocks.remnashopRefreshTokens,
  protectRemnashopToken: mocks.protectRemnashopToken,
  getJwtExpiresAt: mocks.getJwtExpiresAt,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
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
  replaceWebSessionAfterPasswordChange:
    mocks.replaceWebSessionAfterPasswordChange,
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
  remnashopUserId: "1",
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
    mocks.remnashopAuthTelegramIdentity.mockResolvedValue({
      data: authData,
      cookies: {
        accessToken: "merged-access-token",
        refreshToken: "merged-refresh-token",
      },
    });
    mocks.remnashopRequest.mockResolvedValue({ target_email: "user@example.com", expires_at: "2026-06-25T10:15:00.000Z" });
    mocks.remnashopLinkTelegram.mockResolvedValue({ ...profile, telegram_id: 123456 });
    mocks.createSessionFromRemnashopAuth.mockResolvedValue({ user, profile });
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValue({ user, profile });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token", refreshToken: "refresh-token", session });
    mocks.getCurrentSession.mockResolvedValue({ ...session, remnashopAccessTokenEncrypted: null, remnashopRefreshTokenEncrypted: null });
    mocks.getRemnashopMe.mockResolvedValue(profile);
    mocks.prisma.webUser.findUnique.mockResolvedValue(null);
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma));
    mocks.remnashopChangePassword.mockResolvedValue({
      data: { success: true },
      cookies: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    mocks.remnashopRefreshTokens.mockResolvedValue({
      data: {
        expires_at: "2026-06-25T10:00:00.000Z",
        refresh_expires_at: "2026-07-25T10:00:00.000Z",
      },
      cookies: { accessToken: "refreshed-access", refreshToken: "refreshed-refresh" },
    });
    mocks.replaceWebSessionAfterPasswordChange.mockResolvedValue({
      session: { id: "session-2" },
      revokedSessionCount: 2,
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

    expect(result.emailVerification?.target_email).toBe("user@example.com");
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

  it("does not request email verification when resumed registration is already verified", async () => {
    mocks.remnashopAuth
      .mockRejectedValueOnce(new BffError("CONFLICT", 409, "email already exists"))
      .mockResolvedValueOnce(authResult);
    mocks.createSessionFromRemnashopAuth.mockResolvedValueOnce({
      user: { ...user, emailVerified: true },
      profile: { ...profile, is_email_verified: true },
    });

    await expect(registerWithEmail({ email: "user@example.com", password: "secret" }, {})).resolves.toMatchObject({
      user: expect.objectContaining({ is_email_verified: true }),
    });

    expect(mocks.remnashopRequest).not.toHaveBeenCalledWith("/auth/email/request-verification", expect.any(Object));
  });

  it("requests and confirms email verification for the current session", async () => {
    await requestEmailVerification({ email: "user@example.com" }, {});

    expect(mocks.getAuthorizedRemnashopTokens).toHaveBeenCalledWith({ allowUnverifiedEmail: true });
    expect(mocks.assertCooldown).toHaveBeenCalledWith(
      expect.objectContaining({ key: "email-verification:user-1", action: "email_verification_request" }),
    );

    mocks.remnashopRequest.mockResolvedValueOnce({ email: "verified@example.com" });
    mocks.getRemnashopMe.mockResolvedValueOnce({ ...profile, pending_email: "verified@example.com" });

    await confirmEmailVerification(
      { code: "123456", registrationFlow: true, turnstileToken: "ts-confirm" },
      { remoteIp: "127.0.0.1" },
    );

    expect(mocks.remnashopLinkTelegram).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledOnce();
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("ts-confirm", "127.0.0.1");
    expect(mocks.remnashopRequest).toHaveBeenLastCalledWith("/auth/email/confirm", {
      method: "POST",
      accessToken: "access-token",
      body: { code: "123456", email: "verified@example.com" },
    });
    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "verified@example.com", emailVerified: true, authPending: false },
    });
    expect(mocks.refreshCurrentAccessCookie).toHaveBeenCalledOnce();
  });

  it("does not let the legacy registrationFlow flag bypass Turnstile", async () => {
    mocks.verifyTurnstileToken.mockRejectedValueOnce(
      new BffError("VALIDATION_ERROR", 400, "Turnstile token is required"),
    );

    await expect(
      confirmEmailVerification({ code: "123456", registrationFlow: true }, {}),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith(undefined, undefined);
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).not.toHaveBeenCalled();
  });

  it("merges Remnashop users after email code confirmation when Telegram belongs to another Remnashop account", async () => {
    mocks.getAuthorizedRemnashopTokens.mockResolvedValueOnce({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      session: {
        ...session,
        user: { ...user, telegramId: "123456", telegramUsername: "clean_user" },
      },
    });
    mocks.remnashopRequest.mockResolvedValueOnce({ email: "verified@example.com" });
    mocks.getRemnashopMe.mockResolvedValueOnce({ ...profile, pending_email: "verified@example.com" });
    mocks.remnashopLinkTelegram.mockRejectedValueOnce(new BffError("CONFLICT", 409, "telegram already linked"));

    await expect(confirmEmailVerification({ code: "123456", registrationFlow: true }, {})).resolves.toMatchObject({
      email: "verified@example.com",
    });

    expect(mocks.remnashopMergeUsers).toHaveBeenCalledWith({
      sourceUserId: "18367",
      targetUserId: "1",
      reason: "Clean Pay account link: verified e-mail code and Telegram ownership",
    });
    expect(mocks.remnashopAuthTelegramIdentity).toHaveBeenCalledWith({
      telegramId: "123456",
      telegramUsername: "clean_user",
    });
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledWith({
      accessToken: "merged-access-token",
      refreshToken: "merged-refresh-token",
      auth: authData,
    });
  });

  it("changes email and marks local user as unverified", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce({ pending_email: "next@example.com" }).mockResolvedValueOnce({
      target_email: "next@example.com",
      expires_at: "2026-06-25T10:15:00.000Z",
    });

    await expect(changeEmail({ email: "next@example.com", turnstileToken: "ts-change" }, { remoteIp: "127.0.0.1" })).resolves.toMatchObject({
      pending_email: "next@example.com",
      emailVerification: { target_email: "next@example.com" },
    });

    expect(mocks.verifyTurnstileToken).not.toHaveBeenCalled();
    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerified: false },
    });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "email_change_requested" }));
  });

  it("replaces the local session and rotates both token families after password change", async () => {
    await expect(changePassword({ current_password: "old", new_password: "new" })).resolves.toEqual({ success: true });

    expect(mocks.remnashopChangePassword).toHaveBeenCalledWith("access-token", {
      current_password: "old",
      new_password: "new",
    });
    expect(mocks.replaceWebSessionAfterPasswordChange).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      remnashopAccessTokenEncrypted: "protected:new-access",
      remnashopRefreshTokenEncrypted: "protected:new-refresh",
      remnashopAccessExpiresAt: new Date("2026-06-26T00:00:00.000Z"),
      remnashopRefreshExpiresAt: expect.any(Date),
    });
    expect(mocks.prisma.webSession.update).not.toHaveBeenCalled();
  });

  it("refreshes stale Remnashop tokens and retries password change once", async () => {
    mocks.remnashopChangePassword
      .mockRejectedValueOnce(new BffError("CURRENT_PASSWORD_INVALID", 401, "Current password is invalid"))
      .mockResolvedValueOnce({
        data: { success: true },
        cookies: { accessToken: "retry-access", refreshToken: "retry-refresh" },
      });

    await expect(changePassword({ current_password: "old", new_password: "new" })).resolves.toEqual({ success: true });

    expect(mocks.remnashopRefreshTokens).toHaveBeenCalledWith("refresh-token");
    expect(mocks.remnashopChangePassword).toHaveBeenNthCalledWith(1, "access-token", {
      current_password: "old",
      new_password: "new",
    });
    expect(mocks.remnashopChangePassword).toHaveBeenNthCalledWith(2, "refreshed-access", {
      current_password: "old",
      new_password: "new",
    });
    expect(mocks.prisma.webSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: "protected:refreshed-access",
        remnashopRefreshTokenEncrypted: "protected:refreshed-refresh",
      }),
    });
    expect(mocks.replaceWebSessionAfterPasswordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        remnashopAccessTokenEncrypted: "protected:retry-access",
        remnashopRefreshTokenEncrypted: "protected:retry-refresh",
      }),
    );
  });

  it("returns local profile when the current session is not linked to Remnashop", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
      user: { ...user, remnashopUserId: null },
    });

    await expect(getCurrentAuthProfile()).resolves.toMatchObject({
      user: {
        email: "user@example.com",
        auth_type: "email",
      },
    });
    expect(mocks.getRemnashopMe).not.toHaveBeenCalled();
  });

  it("claims a Remnashop bundle for a linked user even when this session has no copy", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
    });

    await expect(getCurrentAuthProfile()).resolves.toMatchObject({
      user: {
        email: "user@example.com",
        auth_type: "email",
      },
    });

    expect(mocks.getAuthorizedRemnashopTokens).toHaveBeenCalledWith({ allowUnverifiedEmail: true });
  });

  it("presents the session identity committed by Telegram recovery", async () => {
    const initialSession = {
      ...session,
      authMethod: "TELEGRAM",
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
      user: {
        ...user,
        email: null,
        emailVerified: false,
        telegramId: "123456",
      },
    };
    const recoveredSession = {
      ...initialSession,
      user: {
        ...initialSession.user,
        email: "owner@example.com",
        emailVerified: true,
        remnashopUserId: "2",
      },
    };
    mocks.getCurrentSession.mockResolvedValueOnce(initialSession);
    mocks.getAuthorizedRemnashopTokens.mockResolvedValueOnce({
      accessToken: "recovered-access",
      refreshToken: "recovered-refresh",
      session: recoveredSession,
    });
    mocks.getRemnashopMe.mockResolvedValueOnce({
      ...profile,
      email: "owner@example.com",
      is_email_verified: true,
      telegram_id: 123456,
      auth_type: "telegram",
    });

    await expect(getCurrentAuthProfile()).resolves.toMatchObject({
      user: {
        email: "owner@example.com",
        emailVerified: true,
        telegramId: "123456",
        auth_type: "telegram",
      },
    });
  });

  it("stages Remnashop account and falls back to registration after auth failure", async () => {
    mocks.remnashopAuth
      .mockRejectedValueOnce(new BffError("AUTH_FAILED", 401, "bad credentials"))
      .mockResolvedValueOnce(authResult);

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: false,
      pendingVerification: true,
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
    expect(mocks.linkCurrentUserToRemnashopAuth).not.toHaveBeenCalled();
    expect(mocks.remnashopLinkTelegram).not.toHaveBeenCalled();
    expect(mocks.prisma.webSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "session-1" },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: "protected:access-token",
        remnashopRefreshTokenEncrypted: "protected:refresh-token",
      }),
    }));
  });

  it("does not link current Telegram identity in Remnashop before email code confirmation", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...user, telegramId: "123456", telegramUsername: "clean_user" },
    });

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: false,
      pendingVerification: true,
    });

    expect(mocks.remnashopLinkTelegram).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUserToRemnashopAuth).not.toHaveBeenCalled();
  });

  it("continues email linking when Telegram already exists in Remnashop", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...user, telegramId: "123456", telegramUsername: "clean_user" },
    });
    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: false,
      pendingVerification: true,
      emailVerification: { target_email: "user@example.com" },
    });

    expect(mocks.remnashopLinkTelegram).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/auth/email/request-verification", {
      method: "POST",
      accessToken: "access-token",
      body: { email: "user@example.com" },
    });
    expect(mocks.linkCurrentUserToRemnashopAuth).not.toHaveBeenCalled();
  });

  it("links an existing verified Remnashop email account after password proof", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...user, email: null, telegramId: "123456", telegramUsername: "clean_user" },
    });
    mocks.getRemnashopMe.mockResolvedValueOnce({ ...profile, is_email_verified: true });

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: true,
      pendingVerification: false,
      alreadyVerified: true,
    });

    expect(mocks.remnashopRequest).not.toHaveBeenCalledWith("/auth/email/request-verification", expect.any(Object));
    expect(mocks.remnashopLinkTelegram).toHaveBeenCalledWith({
      accessToken: "access-token",
      telegramId: "123456",
      telegramUsername: "clean_user",
    });
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledOnce();
    expect(mocks.refreshCurrentAccessCookie).toHaveBeenCalledOnce();
  });

  it("merges Remnashop users for an existing e-mail when Telegram belongs to another Remnashop account", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...user, email: null, telegramId: "123456", telegramUsername: "clean_user" },
    });
    mocks.getRemnashopMe.mockResolvedValueOnce({ ...profile, is_email_verified: true });
    mocks.remnashopLinkTelegram.mockRejectedValueOnce(new BffError("CONFLICT", 409, "telegram already linked"));

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: true,
      pendingVerification: false,
    });

    expect(mocks.remnashopMergeUsers).toHaveBeenCalledWith({
      sourceUserId: "18367",
      targetUserId: "1",
      reason: "Clean Pay account link: verified e-mail password and Telegram ownership",
    });
    expect(mocks.remnashopAuthTelegramIdentity).toHaveBeenCalledWith({
      telegramId: "123456",
      telegramUsername: "clean_user",
    });
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledWith({
      accessToken: "merged-access-token",
      refreshToken: "merged-refresh-token",
      auth: authData,
    });
  });

  it("requires code confirmation when a new e-mail registration cannot be linked as already verified", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...user, email: null, telegramId: "123456", telegramUsername: "clean_user" },
    });
    mocks.remnashopAuth
      .mockRejectedValueOnce(new BffError("AUTH_FAILED", 401, "bad credentials"))
      .mockResolvedValueOnce(authResult);
    mocks.getRemnashopMe.mockResolvedValueOnce({ ...profile, is_email_verified: true });
    mocks.remnashopRequest.mockRejectedValueOnce(new BffError("CONFLICT", 409, "email is already verified"));

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).rejects.toMatchObject({
      code: "EMAIL_LINK_REQUIRES_VERIFICATION",
      status: 409,
    });

    expect(mocks.remnashopLinkTelegram).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUserToRemnashopAuth).not.toHaveBeenCalled();
  });

  it("returns auth failure when the target email exists but the password is wrong", async () => {
    mocks.remnashopAuth
      .mockRejectedValueOnce(new BffError("AUTH_FAILED", 401, "bad credentials"))
      .mockRejectedValueOnce(new BffError("CONFLICT", 409, "email already exists"));

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "wrong" })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      status: 401,
    });

    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(1, "/auth/login", {
      email: "user@example.com",
      password: "wrong",
    });
    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(2, "/auth/register", {
      email: "user@example.com",
      password: "wrong",
    });
  });

  it("does not merge an existing unverified email account before sending the verification code", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...user, email: null, telegramId: "123456", telegramUsername: "clean_user" },
    });
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValueOnce({
      user: { ...user, email: "user@example.com", telegramId: "123456" },
      profile: { ...profile, is_email_verified: false, telegram_id: 123456 },
    });

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: false,
      pendingVerification: true,
      emailVerification: { target_email: "user@example.com" },
    });

    expect(mocks.linkCurrentUserToRemnashopAuth).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/auth/email/request-verification", {
      method: "POST",
      accessToken: "access-token",
      body: { email: "user@example.com" },
    });
  });

  it("does not merge an existing local email owner before code confirmation", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...user, email: null, telegramId: "123456", telegramUsername: "clean_user" },
    });
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValueOnce({
      user: { ...user, emailVerified: true, telegramId: "123456" },
      profile: { ...profile, is_email_verified: true, telegram_id: 123456 },
    });

    await expect(linkRemnashopAccount({ email: "user@example.com", password: "secret" })).resolves.toMatchObject({
      linked: false,
      pendingVerification: true,
      emailVerification: { target_email: "user@example.com" },
    });

    expect(mocks.linkCurrentUserToRemnashopAuth).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/auth/email/request-verification", {
      method: "POST",
      accessToken: "access-token",
      body: { email: "user@example.com" },
    });
  });
});
