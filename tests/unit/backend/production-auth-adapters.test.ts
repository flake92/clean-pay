import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasCredential: vi.fn(),
  remnashopIdentifyEmail: vi.fn(),
  remnashopAuth: vi.fn(),
  remnashopRequestPasswordReset: vi.fn(),
  createSessionFromRemnashopAuth: vi.fn(),
  requestRemnashopEmailVerification: vi.fn(),
  withAuthConcurrency: vi.fn(),
  auditLog: vi.fn(),
  assertRateLimit: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  requestEmailVerification: vi.fn(),
  confirmEmailVerification: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  getCurrentAuthProfile: vi.fn(),
  beginPasskeyLogin: vi.fn(),
  beginPasskeyRegistration: vi.fn(),
  finishPasskeyLogin: vi.fn(),
  finishPasskeyRegistration: vi.fn(),
  deletePasskey: vi.fn(),
  listPasskeys: vi.fn(),
  linkRemnashopAccount: vi.fn(),
  cancelTelegramAccountMerge: vi.fn(),
  confirmTelegramAccountMerge: vi.fn(),
  getTelegramAccountMergeConfirmation: vi.fn(),
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock("@/backend/integrations/auth/prisma-passkey-account-reader", () => ({
  prismaPasskeyAccountReader: { hasCredential: mocks.hasCredential },
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopIdentifyEmail: mocks.remnashopIdentifyEmail,
  remnashopAuth: mocks.remnashopAuth,
  remnashopRequestPasswordReset: mocks.remnashopRequestPasswordReset,
}));
vi.mock("@/backend/integrations/remnashop/session", () => ({
  createSessionFromRemnashopAuth: mocks.createSessionFromRemnashopAuth,
}));
vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
  withAuthConcurrency: mocks.withAuthConcurrency,
}));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/backend/security/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/backend/integrations/auth/email-verification-service", () => ({
  requestRemnashopEmailVerification: mocks.requestRemnashopEmailVerification,
  requestEmailVerification: mocks.requestEmailVerification,
  confirmEmailVerification: mocks.confirmEmailVerification,
  changeEmail: mocks.changeEmail,
}));
vi.mock("@/backend/auth/password", () => ({ changePassword: mocks.changePassword }));
vi.mock("@/backend/auth/profile", () => ({ getCurrentAuthProfile: mocks.getCurrentAuthProfile }));
vi.mock("@/backend/integrations/auth/passkey-service", () => ({
  beginPasskeyLogin: mocks.beginPasskeyLogin,
  beginPasskeyRegistration: mocks.beginPasskeyRegistration,
  finishPasskeyLogin: mocks.finishPasskeyLogin,
  finishPasskeyRegistration: mocks.finishPasskeyRegistration,
  deletePasskey: mocks.deletePasskey,
  listPasskeys: mocks.listPasskeys,
}));
vi.mock("@/backend/integrations/auth/remnashop-link-service", () => ({ linkRemnashopAccount: mocks.linkRemnashopAccount }));
vi.mock("@/backend/integrations/auth/telegram-account-merge-service", () => ({
  cancelTelegramAccountMerge: mocks.cancelTelegramAccountMerge,
  confirmTelegramAccountMerge: mocks.confirmTelegramAccountMerge,
  getTelegramAccountMergeConfirmation: mocks.getTelegramAccountMergeConfirmation,
  telegramAccountMergeCookieName: "merge-token",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, delete: mocks.cookieDelete }),
}));

import { ServiceError } from "@/backend/errors/service-error";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";
import { productionAuthCommands } from "@/backend/integrations/auth/auth-commands";
import { productionEmailVerificationCommands } from "@/backend/integrations/auth/email-verification";
import { productionLinkAccountCommands, productionLinkAccountReader } from "@/backend/integrations/auth/link-account";
import { productionPasskeyCommands } from "@/backend/integrations/auth/passkey-commands";
import { productionProfileCommands, productionProfileReader } from "@/backend/integrations/profile/profile-adapter";

describe("production auth and profile adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "signed-merge-token" });
    mocks.withAuthConcurrency.mockImplementation(async (_key: string, work: () => Promise<unknown>) => work());
  });

  it("implements granular auth operations without owning the workflow", async () => {
    mocks.remnashopIdentifyEmail.mockResolvedValue({ exists: true });
    mocks.hasCredential.mockResolvedValue(true);
    const providerAuth = { data: {}, cookies: { accessToken: "access", refreshToken: "refresh" } };
    mocks.remnashopAuth.mockResolvedValue(providerAuth);
    mocks.createSessionFromRemnashopAuth.mockResolvedValue({
      user: { id: "user-1" },
      profile: { is_email_verified: true },
    });

    await productionAuthCommands.verifyHuman("token", "auth_login");
    await productionAuthCommands.rateLimit({
      action: "auth_identify",
      email: "u@example.com",
      limit: 20,
      windowSeconds: 900,
    });
    await expect(productionAuthCommands.identifyEmail("u@example.com")).resolves.toEqual({ exists: true });
    await expect(productionAuthCommands.hasPasskey("u@example.com")).resolves.toBe(true);
    const providerSession = await productionAuthCommands.authenticate({
      operation: "login",
      email: "u@example.com",
      password: "secret",
    });
    await expect(productionAuthCommands.establishSession(providerSession))
      .resolves.toEqual({ userId: "user-1", emailVerified: true });
    await productionAuthCommands.requestPasswordReset("u@example.com");

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("token", "auth_login");
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth_identify" }));
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/login", {
      email: "u@example.com",
      password: "secret",
    });
    expect(mocks.remnashopRequestPasswordReset).toHaveBeenCalledWith({ email: "u@example.com" });
  });

  it("translates provider registration conflicts into an application error", async () => {
    mocks.remnashopAuth.mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "email already exists"));

    await expect(productionAuthCommands.authenticate({
      operation: "register",
      email: "u@example.com",
      password: "secret123",
    })).rejects.toBeInstanceOf(AuthGatewayError);
  });

  it("adapts registration, reset confirmation, verification and audit operations", async () => {
    const providerAuth = { data: { expires_at: "later" }, cookies: { accessToken: "access", refreshToken: "refresh" } };
    mocks.remnashopAuth.mockResolvedValue(providerAuth);
    mocks.createSessionFromRemnashopAuth.mockResolvedValue({
      user: { id: "user-1" },
      profile: { is_email_verified: false },
    });

    const registration = await productionAuthCommands.authenticate({
      operation: "register",
      email: "u@example.com",
      password: "secret123",
    });
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/register", {
      email: "u@example.com",
      password: "secret123",
    });
    await productionAuthCommands.requestEmailVerification(registration, "u@example.com");
    expect(mocks.requestRemnashopEmailVerification).toHaveBeenCalledWith({
      accessToken: "access",
      body: { email: "u@example.com" },
      source: "register",
    });

    const reset = await productionAuthCommands.authenticate({
      operation: "confirm-password-reset",
      email: "u@example.com",
      code: "123456",
      password: "new-password",
    });
    await expect(productionAuthCommands.establishSession(reset, {
      replaceExistingSessions: true,
      replacementIdentityEmail: "u@example.com",
    })).resolves.toEqual({ userId: "user-1", emailVerified: false });
    expect(mocks.remnashopAuth).toHaveBeenLastCalledWith("/auth/password/confirm-reset", {
      email: "u@example.com",
      code: "123456",
      new_password: "new-password",
    });

    await productionAuthCommands.audit({ action: "auth_success", userId: "user-1" });
    expect(mocks.auditLog).toHaveBeenCalledWith({ action: "auth_success", userId: "user-1" });
  });

  it("translates unrelated provider failures without leaking backend errors", async () => {
    const failure = new ServiceError("UPSTREAM_UNAVAILABLE", 503);
    mocks.remnashopAuth.mockRejectedValueOnce(failure);

    await expect(productionAuthCommands.authenticate({
      operation: "login",
      email: "u@example.com",
      password: "secret123",
    })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("translates security, persistence and unknown failures at the gateway boundary", async () => {
    mocks.verifyTurnstileToken.mockRejectedValueOnce(new ServiceError("RATE_LIMITED", 429));
    await expect(productionAuthCommands.verifyHuman("token", "auth_login"))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });

    mocks.hasCredential.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(productionAuthCommands.hasPasskey("u@example.com"))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    mocks.remnashopAuth.mockRejectedValueOnce(new Error("invalid provider response"));
    await expect(productionAuthCommands.authenticate({
      operation: "login",
      email: "u@example.com",
      password: "secret123",
    })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("maps email verification and readiness without leaking provider DTOs", async () => {
    mocks.requestEmailVerification.mockResolvedValue({ target_email: "u@example.com" });
    mocks.confirmEmailVerification.mockResolvedValue({ account_sync_pending: true });
    mocks.getCurrentAuthProfile.mockResolvedValue({ user: { email: "u@example.com", emailVerified: true } });

    await expect(productionEmailVerificationCommands.requestCode({ email: "u@example.com" }))
      .resolves.toEqual({ targetEmail: "u@example.com" });
    await expect(productionEmailVerificationCommands.confirmCode({ code: "123456" }))
      .resolves.toEqual({ accountSyncPending: true });
    await expect(productionEmailVerificationCommands.checkReadiness())
      .resolves.toEqual({ status: "ready" });

    mocks.getCurrentAuthProfile.mockRejectedValueOnce(new ServiceError("ACCOUNT_MERGE_REQUIRED", 409));
    await expect(productionEmailVerificationCommands.checkReadiness())
      .resolves.toEqual({ status: "merge-conflict" });
    mocks.getCurrentAuthProfile.mockRejectedValueOnce(new ServiceError("UNAUTHORIZED", 401));
    await expect(productionEmailVerificationCommands.checkReadiness())
      .resolves.toEqual({ status: "unauthorized" });
    mocks.getCurrentAuthProfile.mockRejectedValueOnce(new Error("offline"));
    await expect(productionEmailVerificationCommands.checkReadiness())
      .resolves.toEqual({ status: "unavailable" });
  });

  it("translates e-mail verification adapter failures", async () => {
    mocks.requestEmailVerification.mockRejectedValueOnce(new ServiceError("RATE_LIMITED", 429));
    await expect(productionEmailVerificationCommands.requestCode({ email: "u@example.com" }))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });

    mocks.confirmEmailVerification.mockRejectedValueOnce(new Error("invalid response"));
    await expect(productionEmailVerificationCommands.confirmCode({ code: "123456" }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("keeps WebAuthn provider types inside the adapter", async () => {
    const options = { challenge: "challenge" };
    mocks.beginPasskeyLogin.mockResolvedValue(options);
    mocks.beginPasskeyRegistration.mockResolvedValue(options);

    await productionPasskeyCommands.verifyHuman("token");
    await expect(productionPasskeyCommands.beginLogin("u@example.com"))
      .resolves.toBe(options);
    await productionPasskeyCommands.finishLogin({ id: "credential" } as never);
    await expect(productionPasskeyCommands.beginRegistration()).resolves.toBe(options);
    await productionPasskeyCommands.finishRegistration({ id: "credential", name: "Laptop" } as never);

    expect(mocks.finishPasskeyLogin).toHaveBeenCalledWith({ id: "credential" });
    expect(mocks.finishPasskeyRegistration).toHaveBeenCalledWith({ id: "credential", name: "Laptop" });
  });

  it("maps profile queries and mutations to application DTOs", async () => {
    mocks.getCurrentAuthProfile.mockResolvedValue({
      user: {
        auth_type: "EMAIL",
        email: "u@example.com",
        is_email_verified: true,
        pending_email: "new@example.com",
        telegram_id: 123n,
      },
    });
    mocks.requestEmailVerification.mockResolvedValue({ target_email: "u@example.com" });
    mocks.changeEmail.mockResolvedValue({ emailVerification: { target_email: "new@example.com" } });

    await expect(productionProfileReader.loadCurrent()).resolves.toEqual({
      authType: "EMAIL",
      email: "u@example.com",
      emailVerified: true,
      pendingEmail: "new@example.com",
      telegramId: "123",
    });
    await expect(productionProfileCommands.requestEmailVerification({ email: "u@example.com" }))
      .resolves.toEqual({ targetEmail: "u@example.com" });
    await expect(productionProfileCommands.changeEmail({ email: "new@example.com" }))
      .resolves.toEqual({ targetEmail: "new@example.com" });
    await productionProfileCommands.changePassword({ currentPassword: "old", newPassword: "new" });
    expect(mocks.changePassword).toHaveBeenCalledWith({ current_password: "old", new_password: "new" });
  });

  it("maps linked-account state and consumes merge cookies", async () => {
    mocks.getCurrentAuthProfile.mockResolvedValue({
      user: { email: "u@example.com", emailVerified: true, telegramId: "123" },
    });
    mocks.listPasskeys.mockResolvedValue({
      credentials: [{ id: "passkey-1", name: "Laptop", createdAt: new Date("2026-01-01"), lastUsedAt: null }],
    });
    mocks.getTelegramAccountMergeConfirmation.mockResolvedValue({ emailWillBeReplaced: true });
    mocks.linkRemnashopAccount.mockResolvedValue({ linked: true });

    await expect(productionLinkAccountReader.loadProfile()).resolves.toMatchObject({ telegramId: "123" });
    await expect(productionLinkAccountReader.loadPasskeys()).resolves.toEqual([expect.objectContaining({
      id: "passkey-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    })]);
    await expect(productionLinkAccountReader.loadTelegramMergeConfirmation())
      .resolves.toMatchObject({ emailWillBeReplaced: true });
    await expect(productionLinkAccountCommands.linkEmail({ email: "u@example.com", password: "secret" } as never))
      .resolves.toEqual({ linked: true });
    await productionLinkAccountCommands.confirmTelegramMerge();
    await productionLinkAccountCommands.cancelTelegramMerge();
    await productionLinkAccountCommands.deletePasskey("passkey-1");

    expect(mocks.confirmTelegramAccountMerge).toHaveBeenCalledWith("signed-merge-token");
    expect(mocks.cancelTelegramAccountMerge).toHaveBeenCalledWith("signed-merge-token");
    expect(mocks.cookieDelete).toHaveBeenCalledTimes(2);
    expect(mocks.deletePasskey).toHaveBeenCalledWith("passkey-1");
  });

  it("fails closed when merge confirmation cookie is absent", async () => {
    mocks.cookieGet.mockReturnValueOnce(undefined);
    await expect(productionLinkAccountCommands.confirmTelegramMerge())
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(mocks.confirmTelegramAccountMerge).not.toHaveBeenCalled();
  });
});
