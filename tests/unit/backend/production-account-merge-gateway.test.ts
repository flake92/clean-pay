import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(), getCurrentSession: vi.fn(), refreshCurrentAccessCookie: vi.fn(),
  assertRateLimit: vi.fn(), auditLog: vi.fn(), withPaymentOwnerChangeFence: vi.fn(),
  markPaymentOwnerChangeUpstreamMutationStarted: vi.fn(),
  reconcileCompletedPaymentOwnerChange: vi.fn(),
  remnashopAuthTelegramIdentity: vi.fn(), getRemnashopMe: vi.fn(), getRemnashopUserIdFromAccessToken: vi.fn(),
  remnashopMergeUsers: vi.fn(), remnashopRequest: vi.fn(), linkCurrentUserToRemnashopAuth: vi.fn(),
  synchronizeProviderAccountIdentity: vi.fn(),
  prisma: {
    $transaction: vi.fn(), accountMergeConfirmation: { findFirst: vi.fn(), updateMany: vi.fn() },
    webUser: { findUnique: vi.fn(), findFirst: vi.fn() }, $queryRaw: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession, refreshCurrentAccessCookie: mocks.refreshCurrentAccessCookie,
}));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({
  withPaymentOwnerChangeFence: mocks.withPaymentOwnerChangeFence,
  markPaymentOwnerChangeUpstreamMutationStarted: mocks.markPaymentOwnerChangeUpstreamMutationStarted,
  reconcileCompletedPaymentOwnerChange: mocks.reconcileCompletedPaymentOwnerChange,
}));
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

  it("does not steal an expired confirmation lease while its owner fence is active", async () => {
    const confirmation = await gateway.loadConfirmation("user-1");
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({
      paymentOwnerChangeTokenHash: "active-owner-change",
      paymentOwnerChangeLeaseExpiresAt: new Date("2026-01-01T00:01:00.000Z"),
    });

    await expect(
      gateway.claim(confirmation, new Date("2026-01-01T00:00:00.000Z")),
    ).resolves.toBe(false);
    expect(mocks.prisma.accountMergeConfirmation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects stale confirmation work before any provider mutation", async () => {
    const confirmation = await gateway.loadConfirmation("user-1");
    await expect(
      gateway.claim(confirmation, new Date("2098-01-01T00:00:00.000Z")),
    ).resolves.toBe(true);
    mocks.prisma.accountMergeConfirmation.findFirst.mockResolvedValueOnce(null);
    mocks.withPaymentOwnerChangeFence.mockImplementationOnce(async (input: {
      claimGuard: (tx: typeof mocks.prisma) => Promise<void>;
      work: () => Promise<unknown>;
    }) => {
      await input.claimGuard(mocks.prisma);
      return input.work();
    });
    const work = vi.fn();

    await expect(
      gateway.withOwnerChangeFence(confirmation, work),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(work).not.toHaveBeenCalled();
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

  it("translates service and unexpected adapter failures into the application error contract", async () => {
    const { ServiceError } = await import("@/backend/errors/service-error");
    mocks.getCurrentSession.mockRejectedValueOnce(new ServiceError("UNAUTHORIZED", 401));
    await expect(gateway.loadActor()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.getCurrentSession.mockRejectedValueOnce(new TypeError("broken adapter"));
    await expect(gateway.loadActor()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    mocks.prisma.accountMergeConfirmation.findFirst.mockResolvedValueOnce(null);
    await expect(gateway.loadConfirmation("user-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps nullable provider identities and subscription outcomes", async () => {
    const confirmation = await gateway.loadConfirmation("user-1");
    mocks.getRemnashopMe.mockResolvedValueOnce({ telegram_id: null, email: null, is_email_verified: false, pending_email: "pending@example.com" });
    await expect(gateway.authenticateTelegram(confirmation)).resolves.toMatchObject({ telegramId: null, email: null });
    mocks.remnashopMergeUsers.mockResolvedValueOnce({
      conflicts: [], dry_run: true, source_user_id: "source", target_user_id: "target", requires_relogin: true,
      target: { id: "target", email: "target@example.com", is_email_verified: true, telegram_id: 888, current_subscription_id: null },
    });
    await expect(gateway.preflight(confirmation)).resolves.toMatchObject({ target: { telegramId: "888" } });
    mocks.remnashopMergeUsers.mockResolvedValueOnce({
      target: { current_subscription_id: null },
    });
    await expect(gateway.mergeProviderAccounts(confirmation)).resolves.toEqual({ targetHasSubscription: false });
  });

  it("reports lost completion and cancellation races and releases terminal claims", async () => {
    const confirmation = await gateway.loadConfirmation("user-1");
    (confirmation.context as { claimLeaseExpiresAt?: Date }).claimLeaseExpiresAt =
      new Date("2026-01-01T00:02:00.000Z");
    mocks.prisma.accountMergeConfirmation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(gateway.complete(confirmation)).resolves.toBe(false);
    mocks.prisma.accountMergeConfirmation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(gateway.cancel(confirmation)).resolves.toBe(false);
    await gateway.release(confirmation, { terminal: true, errorCode: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.prisma.accountMergeConfirmation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", lastErrorCode: "ACCOUNT_MERGE_REQUIRED" }),
    }));
  });
});
