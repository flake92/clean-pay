import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRateLimit: vi.fn(),
  createTelegramAuthorizationResponse: vi.fn(),
  createTelegramPopupStartResponse: vi.fn(),
  getCurrentUser: vi.fn(),
  logTechnicalError: vi.fn(),
  verifyTurnstileToken: vi.fn(),
}));

vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({ publicAppUrl: "https://pay.example.com" }),
}));
vi.mock("@/backend/integrations/telegram/oidc", () => ({
  createTelegramAuthorizationResponse: mocks.createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse: mocks.createTelegramPopupStartResponse,
}));
vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
}));
vi.mock("@/backend/sessions/web-session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/backend/security/turnstile", () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}));
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
}));

import { GET } from "@/app/auth/telegram/start/route";

const paymentPath = "/payment?plan=pro&duration=30&gateway=card";

describe("Telegram start failure redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.verifyTurnstileToken.mockResolvedValue(undefined);
    mocks.assertRateLimit.mockResolvedValue(undefined);
    mocks.createTelegramAuthorizationResponse.mockRejectedValue(
      new Error("OIDC unavailable"),
    );
  });

  it("shows an anonymous failure on login without losing the continuation", async () => {
    const response = await GET(new Request(
      `https://pay.example.com/auth/telegram/start?redirect_to=${encodeURIComponent(paymentPath)}`,
    ));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://pay.example.com");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("auth")).toBe("telegram_failed");
    expect(location.searchParams.get("redirect_to")).toBe(paymentPath);
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith(null, "auth_login");
  });

  it("returns an authenticated link failure to the same guided setup URL", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      telegramId: null,
    });
    const setupPath =
      `/link-account?reason=email-required&redirect_to=${encodeURIComponent(paymentPath)}`;
    const response = await GET(new Request(
      `https://pay.example.com/auth/telegram/start?redirect_to=${encodeURIComponent(setupPath)}&turnstile_token=link-token`,
    ));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/link-account");
    expect(location.searchParams.get("reason")).toBe("email-required");
    expect(location.searchParams.get("redirect_to")).toBe(paymentPath);
    expect(location.searchParams.get("auth")).toBe("telegram_failed");
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith(
      "link-token",
      "telegram_auth_start",
    );
  });

  it("never reflects an unsafe external destination into the failure URL", async () => {
    const response = await GET(new Request(
      "https://pay.example.com/auth/telegram/start?redirect_to=%2F%2Fevil.example%2Fsteal",
    ));
    const location = new URL(response.headers.get("location")!);

    expect(location.origin).toBe("https://pay.example.com");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.has("redirect_to")).toBe(false);
  });
});
