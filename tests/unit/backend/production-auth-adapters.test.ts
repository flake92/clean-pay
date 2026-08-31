import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasCredential: vi.fn(),
  remnashopIdentifyEmail: vi.fn(),
  remnashopAuth: vi.fn(),
  remnashopRequestPasswordReset: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getRemnashopMe: vi.fn(),
  remnashopRequest: vi.fn(),
  createSessionFromRemnashopAuth: vi.fn(),
  requestRemnashopEmailVerification: vi.fn(),
  withAuthConcurrency: vi.fn(),
  auditLog: vi.fn(),
  assertRateLimit: vi.fn(),
  assertRateLimitCapacity: vi.fn(),
  assertTargetRateLimit: vi.fn(),
  assertCooldown: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  requestEmailVerification: vi.fn(),
  confirmEmailVerification: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  remnashopChangePassword: vi.fn(), remnashopRefreshTokens: vi.fn(), protectRemnashopToken: vi.fn((value: string) => `protected:${value}`),
  getJwtExpiresAt: vi.fn(), replaceWebSessionAfterPasswordChange: vi.fn(),
  remnashopAuthTelegramIdentity: vi.fn(), remnashopLinkTelegram: vi.fn(), remnashopMergeUsers: vi.fn(),
  linkCurrentUserToRemnashopAuth: vi.fn(), refreshCurrentAccessCookie: vi.fn(), withPaymentOwnerChangeFence: vi.fn(),
  markPaymentOwnerChangeUpstreamMutationStarted: vi.fn(), assertPaymentOwnerChangeFenceHeld: vi.fn(),
  acquireRemnashopTokensForSession: vi.fn(),
  getCurrentSession: vi.fn(), loggerWarn: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    webUser: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    webSession: { update: vi.fn() },
    accountMergeConfirmation: { findMany: vi.fn() },
  },
  linkRemnashopAccount: vi.fn(),
  cancelTelegramAccountMerge: vi.fn(),
  confirmTelegramAccountMerge: vi.fn(),
  getTelegramAccountMergeConfirmation: vi.fn(),
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
  synchronizeProviderAccountIdentity: vi.fn(),
}));

vi.mock("@/backend/integrations/auth/prisma-passkey-account-reader", () => ({
  prismaPasskeyAccountReader: { hasCredential: mocks.hasCredential },
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopIdentifyEmail: mocks.remnashopIdentifyEmail,
  remnashopAuth: mocks.remnashopAuth,
  remnashopRequestPasswordReset: mocks.remnashopRequestPasswordReset,
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  getRemnashopMe: mocks.getRemnashopMe,
  remnashopRequest: mocks.remnashopRequest,
  remnashopValidatedRequest: mocks.remnashopRequest,
  remnashopChangePassword: mocks.remnashopChangePassword,
  remnashopRefreshTokens: mocks.remnashopRefreshTokens,
  protectRemnashopToken: mocks.protectRemnashopToken,
  getJwtExpiresAt: mocks.getJwtExpiresAt,
  remnashopAuthTelegramIdentity: mocks.remnashopAuthTelegramIdentity,
  remnashopLinkTelegram: mocks.remnashopLinkTelegram,
  remnashopMergeUsers: mocks.remnashopMergeUsers,
}));
vi.mock("@/backend/integrations/remnashop/api-client-runtime", () => ({
  remnashopValidatedRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnashop/session", () => ({
  createSessionFromRemnashopAuth: mocks.createSessionFromRemnashopAuth,
  linkCurrentUserToRemnashopAuth: mocks.linkCurrentUserToRemnashopAuth,
}));
vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertRateLimitCapacity: mocks.assertRateLimitCapacity,
  assertTargetRateLimit: mocks.assertTargetRateLimit,
  assertCooldown: mocks.assertCooldown,
  withAuthConcurrency: mocks.withAuthConcurrency,
}));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/backend/security/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/backend/integrations/auth/email-verification-delivery", () => ({
  requestRemnashopEmailVerification: mocks.requestRemnashopEmailVerification,
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  replaceWebSessionAfterPasswordChange: mocks.replaceWebSessionAfterPasswordChange,
  refreshCurrentAccessCookie: mocks.refreshCurrentAccessCookie,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({
  withPaymentOwnerChangeFence: mocks.withPaymentOwnerChangeFence,
  markPaymentOwnerChangeUpstreamMutationStarted: mocks.markPaymentOwnerChangeUpstreamMutationStarted,
  assertPaymentOwnerChangeFenceHeld: mocks.assertPaymentOwnerChangeFenceHeld,
}));
vi.mock("@/backend/integrations/remnashop/session-token-lifecycle", () => ({
  acquireRemnashopTokensForSession: mocks.acquireRemnashopTokensForSession,
}));
vi.mock("@/backend/observability/logger", () => ({ logger: { warn: mocks.loggerWarn } }));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/auth/passkey-service", () => ({
  recordPasskeyUse: vi.fn(),
}));
vi.mock("@/backend/integrations/auth/telegram-account-merge-store", () => ({
  getTelegramAccountMergeConfirmation: mocks.getTelegramAccountMergeConfirmation,
  telegramAccountMergeCookieName: "merge-token",
}));
vi.mock("@/backend/integrations/auth/provider-account-identity-sync", () => ({
  synchronizeProviderAccountIdentity: mocks.synchronizeProviderAccountIdentity,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, delete: mocks.cookieDelete }),
}));

import { ServiceError } from "@/backend/errors/service-error";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";
import { createProductionAuthCommands } from "@/backend/integrations/auth/auth-commands";
import { productionEmailVerificationCommands } from "@/backend/integrations/auth/email-verification";
import { productionLinkAccountCommands, productionLinkAccountReader } from "@/backend/integrations/auth/link-account";
import { productionProfileCommands } from "@/backend/integrations/profile/profile-adapter";
import { linkAccountEmail } from "@/application/auth/manage-linked-account";

const productionAuthCommands = createProductionAuthCommands();

describe("production auth and profile adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "signed-merge-token" });
    mocks.withAuthConcurrency.mockImplementation(async (_key: string, work: () => Promise<unknown>) => work());
    mocks.withPaymentOwnerChangeFence.mockImplementation(async ({ work }: { work: () => Promise<unknown> }) => work());
    mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
    mocks.synchronizeProviderAccountIdentity.mockResolvedValue({
      hasSubscription: false,
      profile: { email: "u@example.com", is_email_verified: true, pending_email: null, telegram_id: 777 },
    });
    mocks.prisma.accountMergeConfirmation.findMany.mockResolvedValue([]);
    mocks.prisma.webUser.updateMany.mockResolvedValue({ count: 1 });
    mocks.acquireRemnashopTokensForSession.mockResolvedValue({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      session: { id: "session-1", userId: "user-1" },
      source: "refresh",
    });
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
    expect(mocks.assertTargetRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth_identify" }));
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/login", {
      email: "u@example.com",
      password: "secret",
    });
    expect(mocks.remnashopRequestPasswordReset).toHaveBeenCalledWith({ email: "u@example.com" });
  });

  it("delegates capacity and concurrency guards through the auth error boundary", async () => {
    await productionAuthCommands.preflightCapacity("auth_login");
    expect(mocks.assertRateLimitCapacity).toHaveBeenCalledWith("auth_login");

    const work = vi.fn().mockResolvedValue("guarded-result");
    await expect(productionAuthCommands.withUpstreamConcurrency("auth_login", work))
      .resolves.toBe("guarded-result");
    expect(mocks.withAuthConcurrency).toHaveBeenCalledWith("auth_login", work);
    expect(work).toHaveBeenCalledOnce();

    const gatewayError = new AuthGatewayError("RATE_LIMITED");
    mocks.assertRateLimitCapacity.mockRejectedValueOnce(gatewayError);
    await expect(productionAuthCommands.preflightCapacity("auth_register"))
      .rejects.toBe(gatewayError);
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
      referralCode: "Friend42",
    });
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/register", {
      email: "u@example.com",
      password: "secret123",
      referral_code: "Friend42",
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

  it("maps email verification without leaking provider DTOs", async () => {
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "access-token",
      session: {
        userId: "user-1",
        user: {
          email: "u@example.com", emailVerified: false, telegramId: null,
          pendingRemnashopUserId: null, pendingRemnashopEmail: null,
        },
      },
    });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-1");
    mocks.requestRemnashopEmailVerification.mockResolvedValue({ target_email: "u@example.com" });
    mocks.getRemnashopMe.mockResolvedValue({ email: "u@example.com", pending_email: null, is_email_verified: false });
    mocks.remnashopRequest.mockResolvedValue({ email: "u@example.com" });

    const actor = await productionEmailVerificationCommands.loadActor();
    await productionEmailVerificationCommands.verifyHuman("token", "email_change");
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("token", "email_change");
    await productionEmailVerificationCommands.assertRequestLimits({
      userId: actor.userId, email: actor.email, telegramId: actor.telegramId,
    });
    await expect(productionEmailVerificationCommands.requestProviderCode(actor, "u@example.com"))
      .resolves.toEqual({ targetEmail: "u@example.com" });
    await productionEmailVerificationCommands.auditCodeRequested({ userId: actor.userId, targetEmail: "u@example.com" });
    await expect(productionEmailVerificationCommands.loadProviderProfile(actor))
      .resolves.toEqual({ email: "u@example.com", pendingEmail: null, emailVerified: false });
    await expect(productionEmailVerificationCommands.confirmProviderCode(actor, {
      code: "123456", email: "u@example.com", alreadyVerified: false,
    })).resolves.toMatchObject({ email: "u@example.com" });
  });

  it("translates e-mail verification adapter failures", async () => {
    mocks.verifyTurnstileToken.mockRejectedValueOnce(new ServiceError("RATE_LIMITED", 429));
    await expect(productionEmailVerificationCommands.verifyHuman("token", "email_verification"))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });

    mocks.getAuthorizedRemnashopTokens.mockResolvedValueOnce({
      accessToken: "access", refreshToken: "refresh",
      session: { userId: "u", user: { email: null, emailVerified: false, telegramId: null, telegramUsername: null, pendingRemnashopUserId: null, pendingRemnashopEmail: null } },
    });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValueOnce("upstream");
    const actor = await productionEmailVerificationCommands.loadActor();
    mocks.remnashopRequest.mockRejectedValueOnce(new Error("invalid response"));
    await expect(productionEmailVerificationCommands.confirmProviderCode(actor, { code: "123456", alreadyVerified: false }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    mocks.assertCooldown.mockRejectedValueOnce(new ServiceError("RATE_LIMITED", 429, undefined, { retryAfterSeconds: 42 }));
    await expect(productionEmailVerificationCommands.assertChangeCooldown("user-1"))
      .rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 42 });
  });

  it("implements the complete granular e-mail persistence and provider gateway", async () => {
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "email-access", refreshToken: "email-refresh",
      session: {
        id: "session-1", userId: "user-1", remnashopAccessExpiresAt: new Date("2099-01-01"), remnashopRefreshExpiresAt: new Date("2099-02-01"),
        user: { email: "u@example.com", emailVerified: false, telegramId: "777", telegramUsername: "clean", pendingRemnashopUserId: "upstream-1", pendingRemnashopEmail: "u@example.com" },
      },
    });
    mocks.getRemnashopUserIdFromAccessToken.mockImplementation((token: string) => token.includes("telegram") ? "telegram-account" : "upstream-1");
    mocks.prisma.webUser.findUnique.mockResolvedValue(null);
    mocks.prisma.webUser.update.mockResolvedValue({});
    mocks.remnashopAuthTelegramIdentity.mockResolvedValue({
      data: { expires_at: "2099-01-01", refresh_expires_at: "2099-02-01" },
      cookies: { accessToken: "telegram-access", refreshToken: "telegram-refresh" },
    });
    mocks.remnashopRequest.mockResolvedValue({ pending_email: "new@example.com" });
    mocks.requestRemnashopEmailVerification.mockResolvedValue({ target_email: "new@example.com" });
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValue({ user: { id: "user-1" } });

    const actor = await productionEmailVerificationCommands.loadActor({ allowUnverifiedEmail: true });
    await expect(productionEmailVerificationCommands.persistConfirmedEmail(actor, "u@example.com"))
      .resolves.toMatchObject({ upstreamAccountId: "upstream-1", localVerificationChanged: true });
    const current = productionEmailVerificationCommands.currentProviderSession(actor);
    expect(productionEmailVerificationCommands.providerAccountId(current)).toBe("upstream-1");
    const telegram = await productionEmailVerificationCommands.telegramProviderSession({ telegramId: "777", telegramUsername: "clean" });
    await productionEmailVerificationCommands.attachTelegram(current, { telegramId: "777", telegramUsername: "clean" });
    await productionEmailVerificationCommands.mergeProviderAccounts({ sourceAccountId: "upstream-1", targetAccountId: "telegram-account", reason: "proof" });
    await productionEmailVerificationCommands.refreshProviderSession({ telegramId: "777", telegramUsername: "clean" });
    await productionEmailVerificationCommands.linkCurrentAccount(telegram, {
      upstreamMerged: true,
      ownerFenceHeld: true,
      expectedIdentity: { accountId: "telegram-account", email: "u@example.com", emailVerified: true, pendingEmail: null, telegramId: "777" },
    });
    await productionEmailVerificationCommands.withOwnerChangeFence({ userIds: ["user-1"], upstreamAccountIds: ["upstream-1"], emails: ["u@example.com"], telegramIds: ["777"], operationKey: "email-verify:test", targetUpstreamAccountId: "upstream-1", work: async () => "done" });
    await productionEmailVerificationCommands.refreshLocalSession();
    await productionEmailVerificationCommands.auditEmailVerified({ userId: "user-1", email: "u@example.com" });
    await productionEmailVerificationCommands.markAccountSyncPending("user-1", new Error("offline"));
    await productionEmailVerificationCommands.assertChangeLimits({ userId: "user-1" });
    await expect(productionEmailVerificationCommands.emailOwnerId("new@example.com")).resolves.toBeNull();
    await productionEmailVerificationCommands.assertChangeCooldown("user-1");
    await expect(productionEmailVerificationCommands.changeProviderEmail(actor, "new@example.com"))
      .resolves.toEqual({ pendingEmail: "new@example.com" });
    await productionEmailVerificationCommands.persistPendingEmail(actor, "new@example.com");
    await productionEmailVerificationCommands.auditEmailChangeRequested({ userId: "user-1", pendingEmail: "new@example.com", verificationTargetEmail: "new@example.com" });

    expect(mocks.remnashopLinkTelegram).toHaveBeenCalled();
    expect(mocks.remnashopMergeUsers).toHaveBeenCalled();
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledWith(expect.objectContaining({ paymentOwnerFenceHeld: true }));
    expect(mocks.refreshCurrentAccessCookie).toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalled();
    expect(mocks.assertRateLimit).toHaveBeenCalledWith({
      action: "email_change_attempt",
      sessionId: "user-1",
      limit: 5,
      windowSeconds: 15 * 60,
    });
    expect(mocks.assertCooldown).toHaveBeenCalledWith({
      key: "email-change:user-1",
      action: "email_change_cooldown",
      windowSeconds: 60,
    });
  });

  it("covers e-mail adapter ownership and conflict translations", async () => {
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "access", refreshToken: "refresh",
      session: { userId: "user-1", user: { email: "u@example.com", emailVerified: true, telegramId: null, telegramUsername: null, pendingRemnashopUserId: null, pendingRemnashopEmail: null } },
    });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-1");
    const actor = await productionEmailVerificationCommands.loadActor();
    await productionEmailVerificationCommands.assertConfirmationLimit({ email: "u@example.com", telegramId: null });
    await expect(productionEmailVerificationCommands.confirmProviderCode(actor, { email: "u@example.com", code: "123456", alreadyVerified: true }))
      .resolves.toEqual({ email: "u@example.com" });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({ id: "other-user" });
    await expect(productionEmailVerificationCommands.persistConfirmedEmail(actor, "u@example.com"))
      .resolves.toMatchObject({ existingOwnerId: "other-user", localVerificationChanged: true });

    mocks.remnashopMergeUsers.mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "Both users have current subscriptions"));
    await expect(productionEmailVerificationCommands.mergeProviderAccounts({ sourceAccountId: "one", targetAccountId: "two", reason: "proof" }))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT" });
    mocks.remnashopMergeUsers.mockRejectedValueOnce(new ServiceError("UPSTREAM_UNAVAILABLE", 503));
    await expect(productionEmailVerificationCommands.mergeProviderAccounts({ sourceAccountId: "one", targetAccountId: "two", reason: "proof" }))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("implements every password adapter operation with opaque provider contexts", async () => {
    const authorized = {
      accessToken: "old-access", refreshToken: "old-refresh",
      session: { id: "session-1", userId: "user-1" },
    };
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue(authorized);
    mocks.remnashopChangePassword.mockResolvedValue({
      data: {}, cookies: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    mocks.remnashopRefreshTokens.mockResolvedValue({
      data: { expires_at: "2099-01-01T00:00:00.000Z", refresh_expires_at: "2099-02-01T00:00:00.000Z" },
      cookies: { accessToken: "fresh-access", refreshToken: "fresh-refresh" },
    });
    mocks.getJwtExpiresAt.mockReturnValue(new Date("2099-01-01T00:00:00.000Z"));

    const session = await productionProfileCommands.loadPasswordSession();
    await productionProfileCommands.assertPasswordChangeRateLimit(session);
    const refreshed = await productionProfileCommands.refreshProviderSession(session);
    await productionProfileCommands.persistRefreshedProviderSession(session, refreshed);
    const changed = await productionProfileCommands.changeProviderPassword(session, { currentPassword: "old", newPassword: "new-password" });
    await productionProfileCommands.replaceLocalPasswordSession(session, changed);
    await productionProfileCommands.auditPasswordChanged("user-1");

    expect(mocks.acquireRemnashopTokensForSession).toHaveBeenCalledWith({
      session: authorized.session,
      refresh: mocks.remnashopRefreshTokens,
      forceRefresh: true,
    });
    expect(mocks.assertRateLimit).toHaveBeenCalledWith({
      action: "password_change",
      sessionId: "session-1",
      limit: 5,
      windowSeconds: 15 * 60,
    });
    expect(mocks.replaceWebSessionAfterPasswordChange).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1", userId: "user-1" }));
    expect(mocks.auditLog).toHaveBeenCalledWith({ action: "password_changed", userId: "user-1" });

    mocks.remnashopChangePassword.mockRejectedValueOnce(new ServiceError("CURRENT_PASSWORD_INVALID", 401));
    await expect(productionProfileCommands.changeProviderPassword(session, { currentPassword: "bad", newPassword: "new-password" }))
      .rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID" });
    mocks.remnashopChangePassword.mockRejectedValueOnce(new ServiceError("PASSWORD_UNCHANGED", 409));
    await expect(productionProfileCommands.changeProviderPassword(session, { currentPassword: "same-password", newPassword: "same-password" }))
      .rejects.toMatchObject({ code: "PASSWORD_UNCHANGED" });
    mocks.remnashopChangePassword.mockRejectedValueOnce(new Error("invalid provider response"));
    await expect(productionProfileCommands.changeProviderPassword(session, { currentPassword: "bad", newPassword: "new-password" }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    mocks.getJwtExpiresAt.mockReturnValueOnce(null);
    await productionProfileCommands.replaceLocalPasswordSession(session, changed);
    expect(mocks.replaceWebSessionAfterPasswordChange).toHaveBeenLastCalledWith(expect.objectContaining({
      remnashopAccessExpiresAt: expect.any(Date),
    }));
  });

  it("loads linked-account merge confirmation from its store", async () => {
    mocks.getTelegramAccountMergeConfirmation.mockResolvedValue({ emailWillBeReplaced: true });
    mocks.getCurrentSession.mockResolvedValueOnce({ userId: "user-1", assuranceLevel: "FULL" });
    await expect(productionLinkAccountReader.loadMergeActor()).resolves.toEqual({ userId: "user-1", fullAssurance: true });
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(productionLinkAccountReader.loadMergeActor()).resolves.toBeNull();

    await expect(productionLinkAccountReader.loadTelegramMergeConfirmation("user-1"))
      .resolves.toMatchObject({ emailWillBeReplaced: true });
    expect(mocks.getTelegramAccountMergeConfirmation).toHaveBeenCalledWith("signed-merge-token", "user-1");
  });

  it("implements every linked-account gateway operation without scenario branching", async () => {
    const session = {
      id: "session-1", userId: "user-1", assuranceLevel: "FULL",
      user: { email: "u@example.com", emailVerified: true, telegramId: "777", telegramUsername: "clean", remnashopUserId: "telegram-account" },
    };
    const provider = {
      data: { expires_at: "2099-01-01", refresh_expires_at: "2099-02-01" },
      cookies: { accessToken: "email-access", refreshToken: "email-refresh" },
    };
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.remnashopAuth.mockResolvedValue(provider);
    mocks.getRemnashopMe.mockResolvedValue({ email: "u@example.com", is_email_verified: true });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("email-account");
    mocks.remnashopAuthTelegramIdentity.mockResolvedValue(provider);
    mocks.remnashopMergeUsers.mockResolvedValue({});
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.webUser.findUnique.mockResolvedValue({ id: "owner-1" });
    mocks.requestRemnashopEmailVerification.mockResolvedValue({ target_email: "u@example.com" });

    const actor = await productionLinkAccountCommands.loadLinkActor();
    if (!actor) throw new Error("expected actor");
    await productionLinkAccountCommands.assertLinkRateLimit("u@example.com");
    const emailSession = await productionLinkAccountCommands.authenticateEmail({ operation: "login", email: "u@example.com", password: "secret123" });
    await expect(productionLinkAccountCommands.linkActorIsCurrent(actor)).resolves.toBe(true);
    await expect(productionLinkAccountCommands.loadProviderProfile(emailSession)).resolves.toMatchObject({ email: "u@example.com", emailVerified: true });
    expect(productionLinkAccountCommands.providerAccountId(emailSession)).toBe("email-account");
    await productionLinkAccountCommands.telegramProviderSession({ telegramId: "777", telegramUsername: "clean" });
    await productionLinkAccountCommands.attachTelegram(emailSession, { telegramId: "777", telegramUsername: "clean" });
    await productionLinkAccountCommands.mergeProviderAccounts({ sourceAccountId: "email-account", targetAccountId: "telegram-account", reason: "proof" });
    await productionLinkAccountCommands.refreshTelegramProviderSession({ telegramId: "777", telegramUsername: "clean" });
    await expect(productionLinkAccountCommands.linkCurrentAccount(emailSession, {
      upstreamMerged: true,
      ownerFenceHeld: true,
      expectedIdentity: { accountId: "email-account", email: "u@example.com", emailVerified: true, pendingEmail: null, telegramId: "777" },
    })).resolves.toEqual({ userId: "user-1" });
    await productionLinkAccountCommands.withOwnerChangeFence({ userIds: ["user-1"], upstreamAccountIds: ["email-account"], emails: ["u@example.com"], telegramIds: ["777"], operationKey: "link-email:test", targetUpstreamAccountId: "email-account", work: async () => undefined });
    await expect(productionLinkAccountCommands.emailOwnerId("u@example.com")).resolves.toBe("owner-1");
    await productionLinkAccountCommands.stagePendingEmail({ actor, providerSession: emailSession, email: "u@example.com", providerEmail: null, stagedLocally: true });
    await expect(productionLinkAccountCommands.requestProviderVerification(emailSession, "u@example.com")).resolves.toEqual({ targetEmail: "u@example.com" });
    await productionLinkAccountCommands.auditLinkEvent({ action: "linked", userId: "user-1" });

    expect(mocks.prisma.webSession.update).toHaveBeenCalled();
    expect(mocks.prisma.webUser.updateMany).toHaveBeenCalled();
    expect(mocks.remnashopMergeUsers).toHaveBeenCalled();
  });

  it("covers linked-account authorization fences and provider error translations", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(productionLinkAccountCommands.loadLinkActor()).resolves.toBeNull();
    mocks.getCurrentSession.mockResolvedValueOnce({ assuranceLevel: "BOOTSTRAP", userId: "user-1", user: {} });
    await expect(productionLinkAccountCommands.loadLinkActor()).resolves.toMatchObject({ fullAssurance: false });
    mocks.assertRateLimit.mockRejectedValueOnce(new ServiceError("RATE_LIMITED", 429));
    await expect(productionLinkAccountCommands.assertLinkRateLimit("u@example.com"))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });

    for (const [message, code] of [
      ["email already exists", "EMAIL_ALREADY_EXISTS"],
      ["email is already verified", "EMAIL_ALREADY_VERIFIED"],
      ["both users have current subscriptions", "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"],
    ] as const) {
      mocks.remnashopAuth.mockRejectedValueOnce(new ServiceError("CONFLICT", 409, message));
      await expect(productionLinkAccountCommands.authenticateEmail({ operation: "register", email: "u@example.com", password: "secret123" }))
        .rejects.toMatchObject({ code });
    }
    mocks.remnashopAuth.mockRejectedValueOnce(new Error("bad response"));
    await expect(productionLinkAccountCommands.authenticateEmail({ operation: "login", email: "u@example.com", password: "secret123" }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    const expected = { context: { id: "session-1", userId: "user-1", user: { remnashopUserId: null, email: null, emailVerified: false, telegramId: null, telegramUsername: null } } };
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(productionLinkAccountCommands.linkActorIsCurrent(expected)).resolves.toBe(false);
  });

  it("classifies only an opaque register conflict by the provider endpoint contract", async () => {
    mocks.remnashopAuth
      .mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "Request failed"))
      .mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "Request failed"));

    await expect(productionLinkAccountCommands.authenticateEmail({
      operation: "register",
      email: "existing@example.com",
      password: "wrong-password",
    })).rejects.toMatchObject({ code: "EMAIL_ALREADY_EXISTS" });

    await expect(productionLinkAccountCommands.authenticateEmail({
      operation: "login",
      email: "existing@example.com",
      password: "wrong-password",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("preserves the wrong-password reason through the linked-account production boundary", async () => {
    mocks.getCurrentSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      assuranceLevel: "FULL",
      user: {
        email: null,
        emailVerified: false,
        telegramId: "777",
        telegramUsername: null,
        remnashopUserId: "telegram-account",
      },
    });
    mocks.remnashopAuth
      .mockRejectedValueOnce(new ServiceError("AUTH_FAILED", 401, "bad credentials"))
      .mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "email already exists"));

    await expect(linkAccountEmail(productionLinkAccountCommands, {
      email: "existing@example.com",
      password: "wrong-password",
    })).resolves.toEqual({
      ok: false,
      code: "AUTH_FAILED",
      message: "Неверный e-mail или пароль.",
    });
    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(1, "/auth/login", {
      email: "existing@example.com",
      password: "wrong-password",
    });
    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(2, "/auth/register", {
      email: "existing@example.com",
      password: "wrong-password",
    });
  });

  it("preserves the login failure when register conflict prose is unavailable", async () => {
    mocks.getCurrentSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      assuranceLevel: "FULL",
      user: {
        email: null,
        emailVerified: false,
        telegramId: "777",
        telegramUsername: null,
        remnashopUserId: "telegram-account",
      },
    });
    mocks.remnashopAuth
      .mockRejectedValueOnce(new ServiceError("AUTH_FAILED", 401, "bad credentials"))
      .mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "Request failed"));

    await expect(linkAccountEmail(productionLinkAccountCommands, {
      email: " Existing@Example.com ",
      password: "wrong-password",
    })).resolves.toEqual({
      ok: false,
      code: "AUTH_FAILED",
      message: "Неверный e-mail или пароль.",
    });

    expect(mocks.assertRateLimit).toHaveBeenCalledOnce();
    expect(mocks.assertRateLimit).toHaveBeenCalledWith({
      action: "remnashop_link",
      email: "existing@example.com",
      limit: 10,
      windowSeconds: 15 * 60,
    });
    expect(mocks.remnashopAuth).toHaveBeenCalledTimes(2);
    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(1, "/auth/login", {
      email: "existing@example.com",
      password: "wrong-password",
    });
    expect(mocks.remnashopAuth).toHaveBeenNthCalledWith(2, "/auth/register", {
      email: "existing@example.com",
      password: "wrong-password",
    });
    expect(mocks.getRemnashopMe).not.toHaveBeenCalled();
    expect(mocks.requestRemnashopEmailVerification).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUserToRemnashopAuth).not.toHaveBeenCalled();
    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
  });

  it("preserves actionable link feedback for a rate limit", async () => {
    mocks.getCurrentSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      assuranceLevel: "FULL",
      user: {
        email: null,
        emailVerified: false,
        telegramId: "777",
        telegramUsername: null,
        remnashopUserId: "telegram-account",
      },
    });
    mocks.assertRateLimit.mockRejectedValue(
      new ServiceError("RATE_LIMITED", 429, "too many attempts"),
    );

    await expect(productionLinkAccountCommands.assertLinkRateLimit(
      "existing@example.com",
    )).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    await expect(linkAccountEmail(productionLinkAccountCommands, {
      email: "existing@example.com",
      password: "wrong-password",
    })).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "Слишком много попыток. Попробуйте позже.",
    });
    expect(mocks.remnashopAuth).not.toHaveBeenCalled();
  });

  it("stages a verified owner transition only under its fence and exact actor snapshot", async () => {
    const session = {
      id: "session-1",
      userId: "user-1",
      assuranceLevel: "FULL",
      user: {
        remnashopUserId: "source-account",
        email: null,
        emailVerified: false,
        telegramId: "777",
        telegramUsername: "clean",
        authPending: false,
        pendingRemnashopUserId: null,
        pendingRemnashopEmail: null,
      },
    };
    const provider = {
      data: { expires_at: "2099-01-01", refresh_expires_at: "2099-02-01" },
      cookies: { accessToken: "target-access", refreshToken: "target-refresh" },
    };
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.remnashopAuth.mockResolvedValue(provider);
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("target-account");
    const actor = await productionLinkAccountCommands.loadLinkActor();
    if (!actor) throw new Error("expected actor");
    const providerSession = await productionLinkAccountCommands.authenticateEmail({
      operation: "login",
      email: "owner@example.com",
      password: "secret123",
    });

    await productionLinkAccountCommands.stagePendingEmail({
      actor,
      providerSession,
      email: "owner@example.com",
      providerEmail: "owner@example.com",
      stagedLocally: false,
      ownerTransitionStarted: true,
    });
    expect(mocks.assertPaymentOwnerChangeFenceHeld).toHaveBeenCalledWith(
      mocks.prisma,
      ["user-1"],
    );
    expect(mocks.prisma.webUser.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "user-1",
        remnashopUserId: "source-account",
        authPending: false,
        pendingRemnashopUserId: null,
      }),
      data: expect.objectContaining({
        authPending: true,
        pendingRemnashopUserId: "target-account",
      }),
    }));

    mocks.prisma.webUser.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(productionLinkAccountCommands.stagePendingEmail({
      actor,
      providerSession,
      email: "owner@example.com",
      providerEmail: "owner@example.com",
      stagedLocally: false,
      ownerTransitionStarted: true,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("covers optional linked-account projections and non-local staging", async () => {
    const session = { id: "session-1", userId: "user-1", assuranceLevel: "FULL", user: { email: null, emailVerified: false, telegramId: "777", telegramUsername: null, remnashopUserId: null } };
    const provider = { data: { expires_at: "2099-01-01", refresh_expires_at: "2099-02-01" }, cookies: { accessToken: "access", refreshToken: "refresh" } };
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.remnashopAuth.mockResolvedValue(provider);
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(null);
    const actor = await productionLinkAccountCommands.loadLinkActor();
    if (!actor) throw new Error("expected actor");
    const providerSession = await productionLinkAccountCommands.authenticateEmail({ operation: "register", email: "u@example.com", password: "secret123" });
    await expect(productionLinkAccountCommands.emailOwnerId("none@example.com")).resolves.toBeNull();
    await productionLinkAccountCommands.stagePendingEmail({ actor, providerSession, email: "u@example.com", providerEmail: "provider@example.com", stagedLocally: false });
    expect(mocks.refreshCurrentAccessCookie).not.toHaveBeenCalled();
  });

  it("fails closed when merge confirmation cookie is absent", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(productionLinkAccountReader.loadTelegramMergeConfirmation("user-1"))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(mocks.confirmTelegramAccountMerge).not.toHaveBeenCalled();
  });
});
