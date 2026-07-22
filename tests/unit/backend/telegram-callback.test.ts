import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeTelegramPopupToken: vi.fn(),
  consumeTelegramLoginWidgetPayload: vi.fn(),
  consumeTelegramCallback: vi.fn(),
  withPaymentOwnerChangeFence: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getJwtExpiresAt: vi.fn(),
  remnashopLinkTelegram: vi.fn(),
  remnashopMergeUsers: vi.fn(),
  recoverRemnashopTelegramSession: vi.fn(),
  linkCurrentUserToRemnashopAuth: vi.fn(),
  reconcileUserFromRemnashopAuth: vi.fn(),
  createWebSessionOnResponse: vi.fn(),
  getCurrentSession: vi.fn(),
  logTechnicalError: vi.fn(),
  logTechnicalInfo: vi.fn(),
  logTechnicalWarning: vi.fn(),
}));

vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
  logTechnicalInfo: mocks.logTechnicalInfo,
  logTechnicalWarning: mocks.logTechnicalWarning,
}));

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
  recoverRemnashopTelegramSession: mocks.recoverRemnashopTelegramSession,
  remnashopLinkTelegram: mocks.remnashopLinkTelegram,
  remnashopMergeUsers: mocks.remnashopMergeUsers,
}));

vi.mock("@/backend/sessions/web-session", () => ({
  createWebSessionOnResponse: mocks.createWebSessionOnResponse,
  getCurrentSession: mocks.getCurrentSession,
}));

vi.mock("@/backend/integrations/telegram/oidc", () => {
  class TelegramAuthStateAlreadyConsumedError extends Error {}

  return {
    consumeTelegramCallback: mocks.consumeTelegramCallback,
    consumeTelegramLoginWidgetPayload: mocks.consumeTelegramLoginWidgetPayload,
    consumeTelegramPopupToken: mocks.consumeTelegramPopupToken,
    TelegramAuthStateAlreadyConsumedError,
  };
});

vi.mock("@/backend/auth/telegram-account-merge", () => ({
  telegramAccountMergeCookieMaxAgeSeconds: 300,
  telegramAccountMergeCookieName: "telegram-account-merge",
}));

vi.mock("@/backend/payments/user-merge", () => ({
  withPaymentOwnerChangeFence: mocks.withPaymentOwnerChangeFence,
}));

import { POST } from "@/app/auth/telegram/callback/route";

describe("Telegram callback payment-owner fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withPaymentOwnerChangeFence.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => work(),
    );
    mocks.consumeTelegramPopupToken.mockResolvedValue({
      user: { id: "local-user", remnashopUserId: "source-owner" },
      redirectTo: "/cabinet",
      remnashopAuth: {
        cookies: {
          accessToken: "incoming-access",
          refreshToken: "incoming-refresh",
        },
        data: {
          expires_at: "2030-01-01T00:00:00.000Z",
          refresh_expires_at: "2030-02-01T00:00:00.000Z",
        },
      },
      linked: true,
      telegramId: "777",
      telegramUsername: "clean_pay_user",
      mergeConfirmation: undefined,
    });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("target-owner");
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
});
