import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeTelegramCallback: vi.fn(),
  clearReferralAttributionCookieOnResponse: vi.fn(),
  createWebSessionOnResponse: vi.fn(),
  getCurrentSession: vi.fn(),
  recoverRemnashopTelegramSession: vi.fn(),
  revokeWebSessionById: vi.fn(),
  readTelegramPopupRequest: vi.fn(),
  logTechnicalError: vi.fn(),
  logTechnicalInfo: vi.fn(),
  logTechnicalWarning: vi.fn(),
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
    webJwtSecret: "test-web-jwt-secret-with-enough-entropy",
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
  logTechnicalError: mocks.logTechnicalError,
  logTechnicalInfo: mocks.logTechnicalInfo,
  logTechnicalWarning: mocks.logTechnicalWarning,
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
const oidcState = "telegram-state-with-sufficient-entropy";

function oidcRequest() {
  return new Request(
    `https://pay.example.com/auth/telegram/callback?code=code&state=${oidcState}`,
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

  it("treats a sequential replay of a completed OIDC callback as the same success", async () => {
    mocks.completeTelegramCallback.mockResolvedValueOnce(sessionOutcome);
    const first = await GET(oidcRequest());
    const receipt = first.cookies.get("clean_pay_tg_callback_receipt")?.value;
    expect(receipt).toBeTruthy();

    const replay = await GET(new Request(
      `https://pay.example.com/auth/telegram/callback?code=code&state=${oidcState}`,
      { headers: { cookie: `clean_pay_tg_callback_receipt=${receipt}` } },
    ));

    expect(replay.headers.get("location")).toBe("https://pay.example.com/cabinet");
    expect(mocks.logTechnicalInfo).toHaveBeenCalledWith(
      "telegram_callback_duplicate_completed",
      { redirectTo: "/cabinet" },
    );
    expect(mocks.logTechnicalError).not.toHaveBeenCalledWith(
      "telegram_callback_failed",
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.completeTelegramCallback).toHaveBeenCalledTimes(1);
    expect(mocks.createWebSessionOnResponse).toHaveBeenCalledTimes(1);
  });

  it("does not accept a completion receipt for a different callback state", async () => {
    mocks.completeTelegramCallback.mockResolvedValueOnce(sessionOutcome);
    const first = await GET(oidcRequest());
    const receipt = first.cookies.get("clean_pay_tg_callback_receipt")?.value;

    mocks.completeTelegramCallback.mockRejectedValueOnce(
      new Error("Telegram OIDC state is invalid"),
    );
    const forgedReplay = await GET(new Request(
      "https://pay.example.com/auth/telegram/callback?code=code&state=different-state-value",
      { headers: { cookie: `clean_pay_tg_callback_receipt=${receipt}` } },
    ));

    expect(forgedReplay.headers.get("location")).toBe(
      "https://pay.example.com/login?auth=telegram_failed",
    );
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "telegram_callback_failed",
      expect.any(Error),
      expect.any(Object),
    );
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "javascript:alert(1)",
    "/missing",
  ])("revalidates a corrupted callback destination at both final sinks: %s", async (redirectTo) => {
    mocks.completeTelegramCallback.mockResolvedValue({
      ...sessionOutcome,
      redirectTo,
    });

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.headers.get("location")).toBe("https://pay.example.com/cabinet");
    await expect(popup.json()).resolves.toEqual({ redirectTo: "/cabinet" });
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

  it("does not issue a completion receipt before post-session recovery succeeds", async () => {
    mocks.completeTelegramCallback.mockResolvedValueOnce({
      ...sessionOutcome,
      session: { userId: "user-1", requiresTelegramRecovery: true },
    });
    mocks.recoverRemnashopTelegramSession.mockRejectedValueOnce(
      new Error("recovery unavailable"),
    );

    const response = await GET(oidcRequest());

    expect(response.cookies.get("clean_pay_tg_callback_receipt")).toBeUndefined();
    expect(mocks.revokeWebSessionById).toHaveBeenCalledWith("session-1", "user-1");
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
