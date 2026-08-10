import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(), getCurrentSession: vi.fn(), refreshCurrentAccessCookie: vi.fn(),
  assertRateLimit: vi.fn(), auditLog: vi.fn(), withPaymentOwnerChangeFence: vi.fn(),
  remnashopAuthTelegramIdentity: vi.fn(), getRemnashopMe: vi.fn(), getRemnashopUserIdFromAccessToken: vi.fn(),
  remnashopMergeUsers: vi.fn(), remnashopRequest: vi.fn(), linkCurrentUserToRemnashopAuth: vi.fn(),
  synchronizeProviderAccountIdentity: vi.fn(),
  prisma: {
    $transaction: vi.fn(), accountMergeConfirmation: { findFirst: vi.fn(), updateMany: vi.fn() },
    webUser: { findUnique: vi.fn() }, $queryRaw: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession, refreshCurrentAccessCookie: mocks.refreshCurrentAccessCookie,
}));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({ withPaymentOwnerChangeFence: mocks.withPaymentOwnerChangeFence }));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopAuthTelegramIdentity: mocks.remnashopAuthTelegramIdentity,
  getRemnashopMe: mocks.getRemnashopMe,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  remnashopMergeUsers: mocks.remnashopMergeUsers,
  remnashopRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnashop/session", () => ({ linkCurrentUserToRemnashopAuth: mocks.linkCurrentUserToRemnashopAuth }));
vi.mock("@/backend/integrations/auth/provider-account-identity-sync", () => ({ synchronizeProviderAccountIdentity: mocks.synchronizeProviderAccountIdentity }));

import { productionTelegramAccountMergeGateway as gateway } from "@/backend/integrations/auth/telegram-account-merge-gateway";

describe("production Telegram account merge gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "merge-token" });
    mocks.getCurrentSession.mockResolvedValue({ userId: "user-1", assuranceLevel: "FULL" });
    mocks.prisma.accountMergeConfirmation.findFirst.mockResolvedValue({
      id: "merge-1", userId: "user-1", status: "PENDING", expiresAt: new Date("2099-01-01"),
      sourceRemnashopUserId: "source", targetRemnashopUserId: "target", sourceEmail: "source@example.com",
      targetEmail: "target@example.com", targetTelegramId: null, telegramId: "777", telegramUsername: "clean",
    });
    mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
    mocks.prisma.accountMergeConfirmation.updateMany.mockResolvedValue({ count: 1 });
    mocks.withPaymentOwnerChangeFence.mockImplementation(async ({ work }: { work: () => Promise<unknown> }) => work());
    mocks.prisma.webUser.findUnique.mockResolvedValue({ email: "target@example.com", emailVerified: true, remnashopUserId: "target", telegramId: null });
    mocks.remnashopAuthTelegramIdentity.mockResolvedValue({
      data: { expires_at: "2099-01-01", refresh_expires_at: "2099-02-01" },
      cookies: { accessToken: "provider-access", refreshToken: "provider-refresh" },
    });
    mocks.getRemnashopMe.mockResolvedValue({ telegram_id: 777, email: "target@example.com", is_email_verified: true, pending_email: null });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("target");
    mocks.remnashopMergeUsers.mockResolvedValue({
      conflicts: [], dry_run: true, source_user_id: "source", target_user_id: "target",
      target: { id: "target", email: "target@example.com", is_email_verified: true, telegram_id: 777, current_subscription_id: "sub-1" },
      requires_relogin: true,
    });
    mocks.remnashopRequest.mockResolvedValue({ status: "ACTIVE", user_remna_id: "remna-1" });
    mocks.synchronizeProviderAccountIdentity.mockResolvedValue(true);
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("implements every persistence and provider primitive", async () => {
    await expect(gateway.loadActor()).resolves.toEqual({ userId: "user-1", fullAssurance: true });
    const confirmation = await gateway.loadConfirmation("user-1");
    await gateway.assertRateLimit(confirmation.telegramId);
    await gateway.audit({ action: "merge", userId: "user-1" });
    await expect(gateway.claim(confirmation, new Date("2026-01-01"))).resolves.toBe(true);
    await gateway.withOwnerChangeFence(confirmation, async () => undefined);
    await expect(gateway.loadCurrentOwner("user-1")).resolves.toMatchObject({ upstreamAccountId: "target" });
    const identity = await gateway.authenticateTelegram(confirmation);
    await expect(gateway.preflight(confirmation)).resolves.toMatchObject({ sourceAccountId: "source", targetAccountId: "target" });
    await expect(gateway.mergeProviderAccounts(confirmation)).resolves.toEqual({ targetHasSubscription: true });
    await expect(gateway.synchronizeSubscriptionIdentity(identity)).resolves.toBe(true);
    await expect(gateway.linkCurrentAccount(identity)).resolves.toEqual({ userId: "user-1" });
    await expect(gateway.complete(confirmation)).resolves.toBe(true);
    await expect(gateway.cancel(confirmation)).resolves.toBe(true);
    await gateway.release(confirmation, { terminal: false, errorCode: "UPSTREAM_UNAVAILABLE" });
    await gateway.refreshLocalSession();

    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "telegram_account_merge_confirm" }));
    expect(mocks.withPaymentOwnerChangeFence).toHaveBeenCalled();
    expect(mocks.synchronizeProviderAccountIdentity).toHaveBeenCalledWith("provider-access");
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledWith(expect.objectContaining({ paymentOwnerFenceHeld: true }));
  });

  it("fails closed for missing sessions, bootstrap sessions and absent confirmations", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(gateway.loadActor()).resolves.toBeNull();
    mocks.getCurrentSession.mockResolvedValueOnce({ userId: "user-1", assuranceLevel: "BOOTSTRAP" });
    await expect(gateway.loadActor()).resolves.toEqual({ userId: "user-1", fullAssurance: false });
    mocks.cookieGet.mockReturnValueOnce(undefined);
    await expect(gateway.loadConfirmation("user-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(null);
    await expect(gateway.loadCurrentOwner("missing")).resolves.toBeNull();
  });
});
