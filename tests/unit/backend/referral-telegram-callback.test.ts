import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeTelegramCallback: vi.fn(),
  clearReferralAttributionCookieOnResponse: vi.fn(),
  createWebSessionOnResponse: vi.fn(),
  getCurrentSession: vi.fn(),
  recoverRemnashopTelegramSession: vi.fn(),
  revokeWebSessionById: vi.fn(),
  readTelegramPopupRequest: vi.fn(),
}));

vi.mock("@/application/auth/complete-telegram-callback", () => ({
  completeTelegramCallback: mocks.completeTelegramCallback,
}));
vi.mock("@/application/auth/ports/telegram-callback", () => {
  class TelegramCallbackError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { TelegramCallbackError };
});
vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({
    publicAppUrl: "https://pay.example.com",
    cookieSecure: true,
    cookieSameSite: "lax",
  }),
}));
vi.mock("@/backend/integrations/auth/telegram-callback-gateway", () => ({
  productionTelegramCallbackGateway: { adapter: "telegram-callback" },
}));
vi.mock("@/backend/integrations/referral/referral-attribution", () => ({
  clearReferralAttributionCookieOnResponse: mocks.clearReferralAttributionCookieOnResponse,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  recoverRemnashopTelegramSession: mocks.recoverRemnashopTelegramSession,
}));
vi.mock("@/backend/integrations/auth/telegram-account-merge-store", () => ({
  telegramAccountMergeCookieMaxAgeSeconds: 300,
  telegramAccountMergeCookieName: "clean_pay_account_merge",
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  createWebSessionOnResponse: mocks.createWebSessionOnResponse,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/backend/integrations/sessions/web-session-revocation", () => ({
  revokeWebSessionById: mocks.revokeWebSessionById,
}));
vi.mock("@/backend/integrations/telegram/popup-request", () => ({
  readTelegramPopupRequest: mocks.readTelegramPopupRequest,
}));
vi.mock("@/backend/integrations/telegram/oidc", () => {
  class TelegramAuthStateAlreadyConsumedError extends Error {}
  return { TelegramAuthStateAlreadyConsumedError };
});
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: vi.fn(),
  logTechnicalInfo: vi.fn(),
  logTechnicalWarning: vi.fn(),
}));

import { GET, POST } from "@/app/auth/telegram/callback/route";

const sessionOutcome = {
  redirectTo: "/cabinet",
  session: { userId: "user-1", requiresTelegramRecovery: false },
  audit: { userId: "user-1", remnashopLinked: true },
};
const mergeOutcome = {
  redirectTo: "/link-account",
  session: null,
  mergeConfirmation: { token: "merge-token" },
  audit: { userId: "user-1", remnashopLinked: false },
};

function oidcRequest() {
  return new Request(
    "https://pay.example.com/auth/telegram/callback?code=code&state=state",
  );
}

function popupRequest() {
  return new Request("https://pay.example.com/auth/telegram/callback", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://pay.example.com" },
    body: JSON.stringify({ idToken: "id-token" }),
  });
}

describe("referral attribution after Telegram callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createWebSessionOnResponse.mockResolvedValue({ id: "session-1" });
    mocks.recoverRemnashopTelegramSession.mockResolvedValue(undefined);
    mocks.revokeWebSessionById.mockResolvedValue(undefined);
    mocks.getCurrentSession.mockResolvedValue(null);
    mocks.readTelegramPopupRequest.mockResolvedValue({ method: "oidc", idToken: "id-token" });
  });

  it("clears attribution after successful OIDC GET and popup POST sessions", async () => {
    mocks.completeTelegramCallback.mockResolvedValue(sessionOutcome);

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.status).toBe(307);
    expect(popup.status).toBe(200);
    expect(mocks.createWebSessionOnResponse).toHaveBeenCalledTimes(2);
    expect(mocks.clearReferralAttributionCookieOnResponse).toHaveBeenCalledTimes(2);
  });

  it("preserves attribution while an account merge awaits confirmation", async () => {
    mocks.completeTelegramCallback.mockResolvedValue(mergeOutcome);

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.status).toBe(307);
    expect(popup.status).toBe(200);
    expect(mocks.createWebSessionOnResponse).not.toHaveBeenCalled();
    expect(mocks.clearReferralAttributionCookieOnResponse).not.toHaveBeenCalled();
  });

  it("preserves attribution after transient GET and popup callback failures", async () => {
    mocks.completeTelegramCallback.mockRejectedValue(new Error("provider unavailable"));

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.status).toBe(307);
    expect(popup.status).toBe(400);
    expect(mocks.clearReferralAttributionCookieOnResponse).not.toHaveBeenCalled();
  });

  it("does not clear attribution when post-session recovery rolls back", async () => {
    mocks.completeTelegramCallback.mockResolvedValue({
      ...sessionOutcome,
      session: { userId: "user-1", requiresTelegramRecovery: true },
    });
    mocks.recoverRemnashopTelegramSession.mockRejectedValue(
      new Error("recovery unavailable"),
    );

    const response = await POST(popupRequest());

    expect(response.status).toBe(400);
    expect(mocks.revokeWebSessionById).toHaveBeenCalledWith("session-1", "user-1");
    expect(mocks.clearReferralAttributionCookieOnResponse).not.toHaveBeenCalled();
  });
});
