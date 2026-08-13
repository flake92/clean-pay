import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeTelegramPopupToken: vi.fn(),
  consumeTelegramLoginWidgetPayload: vi.fn(),
  consumeTelegramCallback: vi.fn(),
  withPaymentOwnerChangeFence: vi.fn(),
  markPaymentOwnerChangeUpstreamMutationStarted: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getJwtExpiresAt: vi.fn(),
  getRemnashopMe: vi.fn(),
  remnashopLinkTelegram: vi.fn(),
  remnashopMergeUsers: vi.fn(),
  recoverRemnashopTelegramSession: vi.fn(),
  linkCurrentUserToRemnashopAuth: vi.fn(),
  reconcileUserFromRemnashopAuth: vi.fn(),
  createWebSessionOnResponse: vi.fn(),
  revokeWebSessionById: vi.fn(),
  getCurrentSession: vi.fn(),
  logTechnicalError: vi.fn(),
  logTechnicalInfo: vi.fn(),
  logTechnicalWarning: vi.fn(),
  auditLog: vi.fn(),
  assertRateLimit: vi.fn(),
  stageTelegramAccountMerge: vi.fn(),
  synchronizeProviderAccountIdentity: vi.fn(),
  prisma: {
    webUser: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    telegramAuthState: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
  logTechnicalInfo: mocks.logTechnicalInfo,
  logTechnicalWarning: mocks.logTechnicalWarning,
  auditLog: mocks.auditLog,
}));

vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));

vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({
    publicAppUrl: "https://clean-pay.example.com",
    cookieSecure: true,
    cookieSameSite: "lax",
  }),
}));

vi.mock("@/backend/integrations/remnashop/session", () => ({
  linkCurrentUserToRemnashopAuth: mocks.linkCurrentUserToRemnashopAuth,
  reconcileUserFromRemnashopAuth: mocks.reconcileUserFromRemnashopAuth,
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  getJwtExpiresAt: mocks.getJwtExpiresAt,
  getRemnashopMe: mocks.getRemnashopMe,
  recoverRemnashopTelegramSession: mocks.recoverRemnashopTelegramSession,
  remnashopLinkTelegram: mocks.remnashopLinkTelegram,
  remnashopMergeUsers: mocks.remnashopMergeUsers,
}));
vi.mock("@/backend/integrations/auth/provider-account-identity-sync", () => ({
  synchronizeProviderAccountIdentity: mocks.synchronizeProviderAccountIdentity,
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  createWebSessionOnResponse: mocks.createWebSessionOnResponse,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/backend/integrations/sessions/web-session-revocation", () => ({
  revokeWebSessionById: mocks.revokeWebSessionById,
}));

vi.mock("@/backend/integrations/telegram/oidc", () => {
  class TelegramAuthStateAlreadyConsumedError extends Error {}

  return {
    consumeTelegramCallback: mocks.consumeTelegramCallback,
    consumeTelegramLoginWidgetPayload: mocks.consumeTelegramLoginWidgetPayload,
    consumeTelegramPopupToken: mocks.consumeTelegramPopupToken,
    verifyTelegramCallback: mocks.consumeTelegramCallback,
    verifyTelegramWidgetCallbackPayload: mocks.consumeTelegramLoginWidgetPayload,
    verifyTelegramPopupToken: mocks.consumeTelegramPopupToken,
    clearTelegramAuthCookies: vi.fn(),
    TelegramAuthStateAlreadyConsumedError,
  };
});

vi.mock("@/backend/integrations/auth/telegram-account-merge-service", () => ({
  telegramAccountMergeCookieMaxAgeSeconds: 300,
  telegramAccountMergeCookieName: "telegram-account-merge",
  stageTelegramAccountMerge: mocks.stageTelegramAccountMerge,
}));

vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({
  withPaymentOwnerChangeFence: mocks.withPaymentOwnerChangeFence,
  markPaymentOwnerChangeUpstreamMutationStarted: mocks.markPaymentOwnerChangeUpstreamMutationStarted,
}));

import { GET, POST } from "@/app/auth/telegram/callback/route";

describe("Telegram callback payment-owner fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withPaymentOwnerChangeFence.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => work(),
    );
    mocks.consumeTelegramPopupToken.mockResolvedValue({
      authState: { id: "state-1", userId: "local-user", redirectTo: "/cabinet" },
      identity: {
        telegramId: "777",
        telegramUsername: "clean_pay_user",
        fullName: "Clean Pay User",
        photoUrl: null,
        remnashopAuthResult: {
        cookies: {
          accessToken: "incoming-access",
          refreshToken: "incoming-refresh",
        },
        data: {
          expires_at: "2030-01-01T00:00:00.000Z",
          refresh_expires_at: "2030-02-01T00:00:00.000Z",
        },
      },
      },
    });
    const targetUser = {
      id: "local-user", remnashopUserId: "source-owner", email: "user@example.com", emailVerified: true,
      telegramId: null, telegramUsername: null, fullName: null, photoUrl: null,
    };
    mocks.prisma.webUser.findUnique.mockImplementation(async ({ where }: { where: { id?: string; telegramId?: string } }) => where.id ? targetUser : null);
    mocks.prisma.webUser.findUniqueOrThrow.mockResolvedValue(targetUser);
    mocks.prisma.webUser.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...targetUser, ...data }));
    mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
    mocks.stageTelegramAccountMerge.mockResolvedValue({ required: false });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("target-owner");
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValueOnce("source-owner");
    mocks.getRemnashopMe.mockResolvedValue({
      email: "user@example.com", is_email_verified: true, pending_email: null, telegram_id: 777,
    });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "current-access",
      refreshToken: "current-refresh",
      session: {
        remnashopAccessExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
        remnashopRefreshExpiresAt: new Date("2030-02-01T00:00:00.000Z"),
      },
    });
    mocks.getJwtExpiresAt.mockReturnValue(null);
    mocks.remnashopLinkTelegram.mockRejectedValue(new Error("attach failed"));
    mocks.remnashopMergeUsers.mockResolvedValue({});
    mocks.linkCurrentUserToRemnashopAuth.mockResolvedValue({
      user: { id: "local-user" },
    });
    mocks.createWebSessionOnResponse.mockResolvedValue({ id: "new-session" });
  });

  it("holds the owner fence before Telegram attach, upstream merge and local relink", async () => {
    const response = await POST(new Request("https://clean-pay.example.com/auth/telegram/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "telegram-id-token" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.withPaymentOwnerChangeFence).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ["local-user"],
      upstreamAccountIds: ["source-owner", "target-owner"],
      telegramIds: ["777"],
      work: expect.any(Function),
    }));
    expect(mocks.withPaymentOwnerChangeFence.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remnashopLinkTelegram.mock.invocationCallOrder[0]!,
    );
    expect(mocks.remnashopLinkTelegram.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remnashopMergeUsers.mock.invocationCallOrder[0]!,
    );
    expect(mocks.linkCurrentUserToRemnashopAuth).toHaveBeenCalledWith({
      accessToken: "incoming-access",
      refreshToken: "incoming-refresh",
      auth: {
        expires_at: "2030-01-01T00:00:00.000Z",
        refresh_expires_at: "2030-02-01T00:00:00.000Z",
      },
      invalidateSiblingRemnashopTokens: true,
      paymentOwnerFenceHeld: true,
    });
  });

  it("returns generic failures without exposing a mismatched link-state owner", async () => {
    mocks.consumeTelegramCallback.mockRejectedValueOnce(
      new Error("link state belongs to target-user"),
    );
    mocks.consumeTelegramPopupToken.mockRejectedValueOnce(
      new Error("link state belongs to target-user"),
    );
    mocks.getCurrentSession.mockResolvedValue(null);

    const redirectResponse = await GET(new Request(
      "https://clean-pay.example.com/auth/telegram/callback?code=code&state=state",
    ));
    const popupResponse = await POST(new Request(
      "https://clean-pay.example.com/auth/telegram/callback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: "telegram-id-token" }),
      },
    ));

    expect(redirectResponse.status).toBe(307);
    expect(redirectResponse.headers.get("location")).toBe(
      "https://clean-pay.example.com/login?auth=telegram_failed",
    );
    expect(popupResponse.status).toBe(400);
    await expect(popupResponse.json()).resolves.toEqual({
      error: "telegram_failed",
    });
    expect(mocks.createWebSessionOnResponse).not.toHaveBeenCalled();
  });

  it("revokes the newly created popup session before propagating a recovery failure", async () => {
    mocks.consumeTelegramPopupToken.mockResolvedValueOnce({
      authState: { id: "state-2", userId: null, redirectTo: "/cabinet" },
      identity: {
        telegramId: "888",
        telegramUsername: "new_user",
        fullName: "New User",
        photoUrl: null,
        remnashopAuthResult: {
          cookies: { accessToken: "incoming-access", refreshToken: "incoming-refresh" },
          data: {
            expires_at: "2030-01-01T00:00:00.000Z",
            refresh_expires_at: "2030-02-01T00:00:00.000Z",
          },
        },
      },
    });
    mocks.prisma.webUser.upsert.mockResolvedValueOnce({
      id: "new-user",
      remnashopUserId: null,
      email: null,
      emailVerified: false,
      telegramId: "888",
    });
    mocks.reconcileUserFromRemnashopAuth.mockResolvedValueOnce({
      user: { id: "new-user" },
      requiresTelegramRecovery: true,
    });
    mocks.recoverRemnashopTelegramSession.mockRejectedValueOnce(new Error("recovery unavailable"));

    const response = await POST(new Request(
      "https://clean-pay.example.com/auth/telegram/callback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: "telegram-id-token" }),
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.revokeWebSessionById).toHaveBeenCalledWith("new-session", "new-user");
    expect(mocks.revokeWebSessionById.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.logTechnicalError.mock.invocationCallOrder.at(-1)!,
    );
  });
});
