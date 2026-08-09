import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loginWithEmail: vi.fn(),
  registerWithEmail: vi.fn(),
  confirmPasswordReset: vi.fn(),
  requestPasswordReset: vi.fn(),
  hasCredential: vi.fn(),
  remnashopIdentifyEmail: vi.fn(),
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

vi.mock("@/backend/auth/email-login", () => ({ loginWithEmail: mocks.loginWithEmail }));
vi.mock("@/backend/auth/email-register", () => ({ registerWithEmail: mocks.registerWithEmail }));
vi.mock("@/backend/auth/password-reset", () => ({
  confirmPasswordReset: mocks.confirmPasswordReset,
  requestPasswordReset: mocks.requestPasswordReset,
}));
vi.mock("@/backend/integrations/auth/prisma-passkey-account-reader", () => ({
  prismaPasskeyAccountReader: { hasCredential: mocks.hasCredential },
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({ remnashopIdentifyEmail: mocks.remnashopIdentifyEmail }));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/security/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/backend/integrations/auth/email-verification-service", () => ({
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
import { productionAuthCommands } from "@/backend/integrations/auth/auth-commands";
import { productionEmailVerificationCommands } from "@/backend/integrations/auth/email-verification";
import { productionLinkAccountCommands, productionLinkAccountReader } from "@/backend/integrations/auth/link-account";
import { productionPasskeyCommands } from "@/backend/integrations/auth/passkey-commands";
import { productionProfileCommands, productionProfileReader } from "@/backend/integrations/profile/profile-adapter";

describe("production auth and profile adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "signed-merge-token" });
  });

  it("wires identify, login, registration and password-reset commands", async () => {
    mocks.remnashopIdentifyEmail.mockResolvedValue({ exists: true });
    mocks.hasCredential.mockResolvedValue(true);
    mocks.registerWithEmail.mockResolvedValue({ user: { is_email_verified: false }, emailVerification: {} });

    await expect(productionAuthCommands.identify({ email: "u@example.com", turnstileToken: "token" }))
      .resolves.toEqual({ exists: true, hasPasskey: true });
    await productionAuthCommands.login({ email: "u@example.com", password: "secret", turnstileToken: "token" });
    await expect(productionAuthCommands.register({ email: "u@example.com", password: "secret", turnstileToken: "token" }))
      .resolves.toEqual({ emailVerified: false, verificationRequired: true });
    await productionAuthCommands.requestPasswordReset({ email: "u@example.com", turnstileToken: "token" });
    await productionAuthCommands.confirmPasswordReset({
      email: "u@example.com",
      code: "123456",
      newPassword: "new-password",
      turnstileToken: "token",
    });

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("token", "auth_login");
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth_identify" }));
    expect(mocks.confirmPasswordReset).toHaveBeenCalledWith(
      { email: "u@example.com", code: "123456", new_password: "new-password" },
      "token",
    );
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

  it("keeps WebAuthn provider types inside the adapter", async () => {
    const options = { challenge: "challenge" };
    mocks.beginPasskeyLogin.mockResolvedValue(options);
    mocks.beginPasskeyRegistration.mockResolvedValue(options);

    await expect(productionPasskeyCommands.beginLogin({ email: "u@example.com", turnstileToken: "token" }))
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
