import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTelegramCallback: vi.fn(), verifyTelegramPopupToken: vi.fn(), verifyTelegramWidgetCallbackPayload: vi.fn(),
  clearTelegramAuthCookies: vi.fn(), assertRateLimit: vi.fn(), auditLog: vi.fn(), logTechnicalWarning: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(), getJwtExpiresAt: vi.fn(), getRemnashopMe: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(), remnashopLinkTelegram: vi.fn(), remnashopMergeUsers: vi.fn(),
  linkCurrentUserToRemnashopAuth: vi.fn(), reconcileUserFromRemnashopAuth: vi.fn(),
  withPaymentOwnerChangeFence: vi.fn(), mergeLocalUsersIntoTarget: vi.fn(), assertUserMergeFinalOwner: vi.fn(),
  markPaymentOwnerChangeUpstreamMutationStarted: vi.fn(),
  synchronizeProviderAccountIdentity: vi.fn(), randomToken: vi.fn(() => "merge-token"), sha256: vi.fn((v: string) => `hash:${v}`),
  prisma: {
    webUser: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    telegramAuthState: { update: vi.fn() },
    accountMergeConfirmation: { updateMany: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(), $transaction: vi.fn(),
  },
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog, logTechnicalWarning: mocks.logTechnicalWarning }));
vi.mock("@/backend/integrations/telegram/oidc", () => ({
  verifyTelegramCallback: mocks.verifyTelegramCallback,
  verifyTelegramPopupToken: mocks.verifyTelegramPopupToken,
  verifyTelegramWidgetCallbackPayload: mocks.verifyTelegramWidgetCallbackPayload,
  clearTelegramAuthCookies: mocks.clearTelegramAuthCookies,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getJwtExpiresAt: mocks.getJwtExpiresAt,
  getRemnashopMe: mocks.getRemnashopMe,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  remnashopLinkTelegram: mocks.remnashopLinkTelegram,
  remnashopMergeUsers: mocks.remnashopMergeUsers,
}));
vi.mock("@/backend/integrations/remnashop/session", () => ({
  linkCurrentUserToRemnashopAuth: mocks.linkCurrentUserToRemnashopAuth,
  reconcileUserFromRemnashopAuth: mocks.reconcileUserFromRemnashopAuth,
}));
vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({
  withPaymentOwnerChangeFence: mocks.withPaymentOwnerChangeFence,
  markPaymentOwnerChangeUpstreamMutationStarted: mocks.markPaymentOwnerChangeUpstreamMutationStarted,
}));
vi.mock("@/backend/integrations/auth/local-user-merge-service", () => ({
  mergeLocalUsersIntoTarget: mocks.mergeLocalUsersIntoTarget,
  assertUserMergeFinalOwner: mocks.assertUserMergeFinalOwner,
}));
vi.mock("@/backend/integrations/auth/provider-account-identity-sync", () => ({
  synchronizeProviderAccountIdentity: mocks.synchronizeProviderAccountIdentity,
}));
vi.mock("@/backend/security/crypto", () => ({ randomToken: mocks.randomToken, sha256: mocks.sha256 }));

import { ServiceError } from "@/backend/errors/service-error";
import { productionTelegramCallbackGateway as gateway } from "@/backend/integrations/auth/telegram-callback-gateway";

const provider = {
  context: {
    cookies: { accessToken: "provider-access", refreshToken: "provider-refresh" },
    data: { expires_at: "2030-01-01T00:00:00Z", refresh_expires_at: "2030-02-01T00:00:00Z" },
  },
};
const verified = {
  authState: { id: "state-1", userId: "user-1", redirectTo: "/cabinet" },
  identity: { telegramId: "777", telegramUsername: "clean", fullName: "Clean User", photoUrl: null, remnashopAuthResult: provider.context },
};
const local = { id: "user-1", remnashopUserId: "account-1", email: "user@example.com", emailVerified: true, telegramId: "777" };

describe("production Telegram callback gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyTelegramCallback.mockResolvedValue(verified);
    mocks.verifyTelegramPopupToken.mockResolvedValue(verified);
    mocks.verifyTelegramWidgetCallbackPayload.mockResolvedValue(verified);
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("account-1");
    mocks.getRemnashopMe.mockResolvedValue({ email: "user@example.com", is_email_verified: true, pending_email: null, telegram_id: 777 });
    mocks.withPaymentOwnerChangeFence.mockImplementation(async ({ work }: { work: () => Promise<unknown> }) => work());
    mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    mocks.prisma.accountMergeConfirmation.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.accountMergeConfirmation.create.mockResolvedValue({ id: "confirmation-1" });
    mocks.prisma.accountMergeConfirmation.findMany.mockResolvedValue([]);
    mocks.prisma.accountMergeConfirmation.update.mockResolvedValue({ id: "confirmation-1" });
    mocks.synchronizeProviderAccountIdentity.mockResolvedValue({
      hasSubscription: true,
      profile: { email: "owner@example.com", is_email_verified: true, pending_email: null, telegram_id: 777 },
    });
  });

  it("consumes every Telegram transport and maps provider sessions", async () => {
    await expect(gateway.consume({ kind: "oidc", code: "code", state: "state" })).resolves.toMatchObject({
      authState: { id: "state-1", targetUserId: "user-1", redirectTo: "/cabinet" },
      identity: { telegramId: "777", providerSession: provider },
    });
    await gateway.consume({ kind: "popup-oidc", idToken: "token" });
    await gateway.consume({ kind: "login-widget", authData: { id: 777 } });
    expect(mocks.verifyTelegramCallback).toHaveBeenCalledWith("code", "state");
    expect(mocks.verifyTelegramPopupToken).toHaveBeenCalledWith("token");
    expect(mocks.verifyTelegramWidgetCallbackPayload).toHaveBeenCalledWith({ id: 777 });

    mocks.verifyTelegramPopupToken.mockResolvedValueOnce({ ...verified, identity: { ...verified.identity, remnashopAuthResult: null } });
    await expect(gateway.consume({ kind: "popup-oidc", idToken: "without-provider" })).resolves.toMatchObject({
      identity: { providerSession: null },
    });
  });

  it("applies rate limits, reads local users and maps provider identity", async () => {
    await gateway.assertIdentityRateLimit({ linked: true, telegramId: "777" });
    await gateway.assertIdentityRateLimit({ linked: false, telegramId: "888" });
    expect(mocks.assertRateLimit).toHaveBeenNthCalledWith(1, { action: "telegram_link_confirm", tgId: "777", limit: 10, windowSeconds: 900 });
    expect(mocks.assertRateLimit).toHaveBeenNthCalledWith(2, { action: "telegram_login_confirm", tgId: "888", limit: 10, windowSeconds: 900 });

    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(local).mockResolvedValueOnce(null).mockResolvedValueOnce(local);
    await expect(gateway.findUserByTelegramId("777")).resolves.toEqual({ id: "user-1", upstreamAccountId: "account-1", email: "user@example.com", emailVerified: true, telegramId: "777" });
    await expect(gateway.findUserById("missing")).resolves.toBeNull();
    await expect(gateway.findUserById("user-1")).resolves.toMatchObject({ id: "user-1" });
    await expect(gateway.loadProviderMergeIdentity(provider)).resolves.toEqual({
      accountId: "account-1", email: "user@example.com", emailVerified: true, pendingEmail: null, telegramId: "777",
    });
    mocks.getRemnashopMe.mockResolvedValueOnce({ email: null, is_email_verified: false, pending_email: "new@example.com", telegram_id: null });
    await expect(gateway.loadProviderMergeIdentity(provider)).resolves.toMatchObject({ telegramId: null });
  });

  it("runs provider merge preflight with deterministic conflict resolutions", async () => {
    mocks.remnashopMergeUsers.mockResolvedValue({
      conflicts: [], dry_run: true, source_user_id: 10, target_user_id: 20,
      target: { id: 20, email: "target@example.com", is_email_verified: true, telegram_id: null }, requires_relogin: true,
    });
    await expect(gateway.preflightAccountMerge({ sourceAccountId: "10", targetAccountId: "20" })).resolves.toEqual({
      conflicts: [], dryRun: true, sourceAccountId: "10", targetAccountId: "20",
      target: { accountId: "20", email: "target@example.com", emailVerified: true, telegramId: null }, requiresRelogin: true,
    });
    expect(mocks.remnashopMergeUsers).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true, emailResolution: "KEEP_TARGET", telegramResolution: "KEEP_SOURCE", paymentResolution: "REKEY_SOURCE",
    }));
  });

  it("persists one active, hashed and expiring merge confirmation", async () => {
    await expect(gateway.persistAccountMergeConfirmation({
      userId: "user-1", telegramId: "777", telegramUsername: "clean", sourceEmail: "source@example.com",
      targetEmail: "target@example.com", targetTelegramId: null, sourceAccountId: "source", targetAccountId: "target",
    })).resolves.toEqual({ token: "merge-token" });
    expect(mocks.prisma.accountMergeConfirmation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "FAILED", lastErrorCode: "SUPERSEDED" },
    }));
    expect(mocks.prisma.accountMergeConfirmation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "user-1", tokenHash: "hash:merge-token", expiresAt: expect.any(Date),
    }) });

    mocks.prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "active" }]);
    await expect(gateway.persistAccountMergeConfirmation({
      userId: "user-1", telegramId: "777", telegramUsername: null, sourceEmail: null,
      targetEmail: "target@example.com", targetTelegramId: null, sourceAccountId: "source", targetAccountId: "target",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps the exact confirmation retryable while it owns a payment transition", async () => {
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({
      paymentOwnerChangeTokenHash: "incomplete-owner-change",
    });

    await expect(gateway.persistAccountMergeConfirmation({
      userId: "user-1", telegramId: "777", telegramUsername: "clean",
      sourceEmail: "source@example.com", targetEmail: "target@example.com",
      targetTelegramId: null, sourceAccountId: "source", targetAccountId: "target",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.prisma.accountMergeConfirmation.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.accountMergeConfirmation.create).not.toHaveBeenCalled();
  });

  it("rotates the bearer token for the exact durable post-mutation retry", async () => {
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({
      paymentOwnerChangeTokenHash: "incomplete-owner-change",
      paymentOwnerChangeLeaseExpiresAt: new Date(0),
      paymentOwnerChangeOperationHash: "hash:telegram-account-merge:v1:confirmation-1",
      paymentOwnerChangeMutationStartedAt: new Date(),
    });
    mocks.prisma.accountMergeConfirmation.findMany.mockResolvedValueOnce([{
      id: "confirmation-1",
      userId: "user-1",
      status: "PENDING",
      leaseExpiresAt: null,
      createdAt: new Date(),
      telegramId: "777",
      sourceRemnashopUserId: "source",
      targetRemnashopUserId: "target",
      targetEmail: "target@example.com",
    }]);

    await expect(gateway.persistAccountMergeConfirmation({
      userId: "user-1", telegramId: "777", telegramUsername: "clean",
      sourceEmail: "source@example.com", targetEmail: "target@example.com",
      targetTelegramId: null, sourceAccountId: "source", targetAccountId: "target",
    })).resolves.toEqual({ token: "merge-token" });
    expect(mocks.prisma.accountMergeConfirmation.update).toHaveBeenCalledWith({
      where: { id: "confirmation-1" },
      data: expect.objectContaining({ tokenHash: "hash:merge-token", expiresAt: expect.any(Date) }),
    });
    expect(mocks.prisma.accountMergeConfirmation.create).not.toHaveBeenCalled();
  });

  it("updates a target user, merging a distinct Telegram owner when necessary", async () => {
    const source = { ...local, id: "source-user", email: "source@example.com", emailVerified: false };
    const target = { ...local, id: "target-user", remnashopUserId: null, email: null, emailVerified: false, telegramId: null };
    mocks.prisma.webUser.findUnique.mockResolvedValue(source);
    mocks.prisma.webUser.findUniqueOrThrow.mockResolvedValue(target);
    mocks.prisma.webUser.update.mockImplementation(async ({ data }: { data: object }) => ({ ...target, ...data }));

    await expect(gateway.applyTelegramIdentity({
      targetUserId: "target-user", existingTelegramUserId: "source-user", telegramId: "777",
      expectedExistingUpstreamAccountId: "account-1", provenProviderAccountId: "account-1",
      telegramUsername: "clean", fullName: "Clean User", photoUrl: "photo",
    })).resolves.toMatchObject({ id: "target-user", upstreamAccountId: "account-1", email: "source@example.com", telegramId: "777" });
    expect(mocks.mergeLocalUsersIntoTarget).toHaveBeenCalledWith(mocks.prisma, expect.objectContaining({ sourceUserIds: ["source-user"] }));
    expect(mocks.assertUserMergeFinalOwner).toHaveBeenCalled();

    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(target);
    mocks.prisma.webUser.findUniqueOrThrow.mockResolvedValueOnce(target);
    await gateway.applyTelegramIdentity({
      targetUserId: "target-user", existingTelegramUserId: "target-user", telegramId: "777",
      expectedExistingUpstreamAccountId: null, provenProviderAccountId: "account-1",
      telegramUsername: null, fullName: null, photoUrl: null,
    });
    expect(mocks.mergeLocalUsersIntoTarget).toHaveBeenCalledTimes(1);
  });

  it("upserts a Telegram-only user and performs state and audit side effects", async () => {
    mocks.prisma.webUser.upsert.mockResolvedValue({ ...local, remnashopUserId: null, email: null, emailVerified: false });
    await expect(gateway.applyTelegramIdentity({
      targetUserId: null, existingTelegramUserId: null, telegramId: "777",
      expectedExistingUpstreamAccountId: null, provenProviderAccountId: null,
      telegramUsername: "clean", fullName: null, photoUrl: null,
    })).resolves.toMatchObject({ id: "user-1", telegramId: "777" });
    expect(mocks.prisma.webUser.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { telegramId: "777" }, create: expect.objectContaining({ displayName: "clean" }),
    }));
    await gateway.markAuthStateUser("state-1", "user-1");
    await gateway.auditIdentityResolved({ linked: true, userId: "user-1" });
    await gateway.auditIdentityResolved({ linked: false, userId: "user-1" });
    await gateway.clearTemporaryAuth();
    expect(mocks.auditLog).toHaveBeenNthCalledWith(1, { action: "telegram_link_success", userId: "user-1" });
    expect(mocks.auditLog).toHaveBeenNthCalledWith(2, { action: "telegram_login", userId: "user-1" });
    expect(gateway.providerAccountId(provider)).toBe("account-1");
  });

  it("revalidates the local Telegram source owner inside the merge transaction", async () => {
    const target = { ...local, id: "target-user", remnashopUserId: "account-1", telegramId: null };
    const changedSource = { ...local, id: "source-user", remnashopUserId: "other-account" };
    mocks.prisma.webUser.findUniqueOrThrow.mockResolvedValueOnce(target);
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(changedSource);

    await expect(gateway.applyTelegramIdentity({
      targetUserId: "target-user",
      existingTelegramUserId: "source-user",
      expectedExistingUpstreamAccountId: "account-1",
      provenProviderAccountId: "account-1",
      telegramId: "777",
      telegramUsername: null,
      fullName: null,
      photoUrl: null,
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.mergeLocalUsersIntoTarget).not.toHaveBeenCalled();
  });

  it("attaches Telegram using token expirations with safe fallbacks", async () => {
    const accessExpiry = new Date("2030-03-01T00:00:00Z");
    const refreshExpiry = new Date("2030-04-01T00:00:00Z");
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "current-access", refreshToken: "current-refresh",
      session: { remnashopAccessExpiresAt: accessExpiry, remnashopRefreshExpiresAt: refreshExpiry },
    });
    mocks.getJwtExpiresAt.mockReturnValue(null);
    await gateway.attachTelegramToCurrentAccount({ telegramId: "777", telegramUsername: "clean", ownerFenceHeld: true });
    expect(mocks.remnashopLinkTelegram).toHaveBeenCalledWith({ accessToken: "current-access", telegramId: "777", telegramUsername: "clean" });
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledWith(expect.objectContaining({
      auth: { expires_at: accessExpiry.toISOString(), refresh_expires_at: refreshExpiry.toISOString() }, paymentOwnerFenceHeld: true,
    }));

    mocks.getAuthorizedRemnashopTokens.mockResolvedValueOnce({ accessToken: "a", refreshToken: "r", session: {} });
    await gateway.attachTelegramToCurrentAccount({ telegramId: "777", telegramUsername: null, ownerFenceHeld: false });
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenLastCalledWith(expect.objectContaining({ auth: {
      expires_at: expect.any(String), refresh_expires_at: expect.any(String),
    } }));
  });

  it("merges provider owners, maps subscription conflicts and preserves other failures", async () => {
    await expect(gateway.mergeProviderAccounts({ sourceAccountId: "same", targetAccountId: "same" })).resolves.toBe(false);
    mocks.remnashopMergeUsers.mockResolvedValueOnce({});
    await expect(gateway.mergeProviderAccounts({ sourceAccountId: "source", targetAccountId: "target" })).resolves.toBe(true);
    const conflict = new ServiceError("CONFLICT", 409, "conflict", { message: "Both users have current subscriptions" });
    mocks.remnashopMergeUsers.mockRejectedValueOnce(conflict);
    await expect(gateway.mergeProviderAccounts({ sourceAccountId: "source", targetAccountId: "target" })).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
    });
    const unrelated = new ServiceError("CONFLICT", 409, "another conflict");
    mocks.remnashopMergeUsers.mockRejectedValueOnce(unrelated);
    await expect(gateway.mergeProviderAccounts({ sourceAccountId: "source", targetAccountId: "target" })).rejects.toBe(unrelated);
  });

  it("links and reconciles provider sessions and logs sanitized attach failures", async () => {
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValue({ user: { id: "user-1" } });
    const expectedIdentity = { accountId: "account-1", email: "owner@example.com", emailVerified: true, pendingEmail: null, telegramId: "777" };
    await expect(gateway.linkProviderSession({ session: provider, ownerFenceHeld: true, invalidateSiblingTokens: true, expectedIdentity })).resolves.toEqual({
      userId: "user-1", requiresTelegramRecovery: false,
    });
    expect(mocks.synchronizeProviderAccountIdentity).toHaveBeenCalledWith("provider-access", expectedIdentity);
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledWith(expect.objectContaining({ invalidateSiblingRemnashopTokens: true }));
    mocks.reconcileUserFromRemnashopAuth.mockResolvedValue({
      user: { id: "user-2" }, requiresTelegramRecovery: true,
      remnashopSession: { accessTokenEncrypted: "a", refreshTokenEncrypted: "r", accessExpiresAt: new Date(), refreshExpiresAt: new Date() },
    });
    await expect(gateway.reconcileProviderSession(provider)).resolves.toMatchObject({ userId: "user-2", requiresTelegramRecovery: true });
    await gateway.withOwnerChangeFence({ userIds: [], upstreamAccountIds: [], telegramIds: [], operationKey: "telegram-callback:test", targetUpstreamAccountId: "account-1", work: async () => "done" });
    gateway.logAttachFailure(new TypeError("secret"), "777");
    gateway.logAttachFailure("secret", "888");
    expect(mocks.logTechnicalWarning).toHaveBeenNthCalledWith(1, "telegram_link_remnashop_attach_failed", { errorName: "TypeError", telegramId: "777" });
    expect(mocks.logTechnicalWarning).toHaveBeenNthCalledWith(2, "telegram_link_remnashop_attach_failed", { errorName: "UnknownError", telegramId: "888" });
  });
});
