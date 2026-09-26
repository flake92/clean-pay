import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateTelegramWebApp: vi.fn(),
  clearReferralAttributionCookie: vi.fn(),
}));

vi.mock("@/application/auth/authenticate-telegram-webapp", () => ({
  authenticateTelegramWebApp: mocks.authenticateTelegramWebApp,
}));
vi.mock("@/app/_composition/session-gateways", () => ({
  productionTelegramWebAppGateway: { adapter: "telegram-webapp" },
}));
vi.mock("@/backend/integrations/referral/referral-attribution", () => ({
  clearReferralAttributionCookie: mocks.clearReferralAttributionCookie,
}));

import { authenticateTelegramWebAppAction } from "@/app/actions/telegram";

describe("referral attribution after Telegram WebApp login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearReferralAttributionCookie.mockResolvedValue(undefined);
  });

  it("clears attribution only after a terminal successful session", async () => {
    mocks.authenticateTelegramWebApp.mockResolvedValue({ ok: true });

    await expect(authenticateTelegramWebAppAction("signed-data"))
      .resolves.toEqual({ ok: true });
    expect(mocks.authenticateTelegramWebApp).toHaveBeenCalledWith(
      { adapter: "telegram-webapp" },
      "signed-data",
    );
    expect(mocks.clearReferralAttributionCookie).toHaveBeenCalledOnce();
  });

  it("preserves attribution after a transient WebApp failure", async () => {
    const failure = {
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Не удалось войти через Telegram.",
    };
    mocks.authenticateTelegramWebApp.mockResolvedValue(failure);

    await expect(authenticateTelegramWebAppAction("signed-data"))
      .resolves.toEqual(failure);
    expect(mocks.clearReferralAttributionCookie).not.toHaveBeenCalled();
  });
});
