import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRateLimit: vi.fn(),
  findUser: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  remnashopAuth: vi.fn(),
  getRemnashopMe: vi.fn(),
  reconcileUser: vi.fn(),
  createWebSession: vi.fn(),
  logTechnicalInfo: vi.fn(),
  logTechnicalWarning: vi.fn(),
  logTechnicalError: vi.fn(),
}));

vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    webUser: { findUnique: mocks.findUser },
  },
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopAuth: mocks.remnashopAuth,
  getRemnashopMe: mocks.getRemnashopMe,
}));

vi.mock("@/backend/integrations/remnashop/session", () => ({
  reconcileUserFromRemnashopAuth: mocks.reconcileUser,
}));

vi.mock("@/backend/sessions/web-session", () => ({
  createWebSessionOnResponse: mocks.createWebSession,
}));

vi.mock("@/backend/observability/audit", () => ({
  logTechnicalInfo: mocks.logTechnicalInfo,
  logTechnicalWarning: mocks.logTechnicalWarning,
  logTechnicalError: mocks.logTechnicalError,
}));

import { POST as identify } from "@/app/api/bff/auth/identify/route";
import { POST as telegramWebApp } from "@/app/api/bff/auth/telegram/webapp/route";
import { BffError } from "@/backend/integrations/remnashop/errors";

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public auth anti-abuse routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue(null);
    mocks.createWebSession.mockResolvedValue(undefined);
  });

  it("preserves RATE_LIMITED from auth identify", async () => {
    mocks.assertRateLimit.mockRejectedValueOnce(new BffError("RATE_LIMITED", 429, "Slow down"));

    const response = await identify(post("http://localhost/api/bff/auth/identify", {
      email: "user@example.com",
    }));

    expect(response.status).toBe(429);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("continues identify when the limiter itself is unavailable", async () => {
    mocks.assertRateLimit.mockRejectedValueOnce(new Error("redis unavailable"));

    const response = await identify(post("http://localhost/api/bff/auth/identify", {
      email: "user@example.com",
    }));

    expect(response.status).toBe(200);
    expect(mocks.findUser).toHaveBeenCalledOnce();
    expect(mocks.logger.warn).toHaveBeenCalledOnce();
  });

  it("rate-limits Telegram WebApp only by the verified upstream identity", async () => {
    mocks.remnashopAuth.mockResolvedValue({
      data: { expires_at: "2026-08-01T00:00:00.000Z", refresh_expires_at: "2026-09-01T00:00:00.000Z" },
      cookies: { accessToken: "access", refreshToken: "refresh" },
    });
    const verifiedProfile = {
      telegram_id: 777,
      auth_type: "telegram",
      email: null,
      is_email_verified: false,
      pending_email: null,
      name: "Telegram User",
      username: null,
      language: "ru",
    };
    mocks.getRemnashopMe.mockResolvedValue(verifiedProfile);
    mocks.reconcileUser.mockResolvedValue({
      user: { id: "user-1" },
      remnashopSession: {},
    });

    const response = await telegramWebApp(post("http://localhost/api/bff/auth/telegram/webapp", {
      initData: `user=${encodeURIComponent(JSON.stringify({ id: 123 }))}&hash=signed`,
    }));

    expect(response.status).toBe(200);
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "telegram_webapp_login",
      tgId: 777,
    }));
    expect(mocks.reconcileUser).toHaveBeenCalledWith(expect.objectContaining({ verifiedProfile }));
    expect(await response.json()).toEqual({ redirectTo: "/cabinet" });
  });

  it("rejects Telegram WebApp auth without a verified Telegram identity", async () => {
    mocks.remnashopAuth.mockResolvedValue({
      data: { expires_at: "2026-08-01T00:00:00.000Z", refresh_expires_at: "2026-09-01T00:00:00.000Z" },
      cookies: { accessToken: "access", refreshToken: "refresh" },
    });
    mocks.getRemnashopMe.mockResolvedValue({ telegram_id: null });

    const response = await telegramWebApp(post("http://localhost/api/bff/auth/telegram/webapp", {
      initData: "signed",
    }));

    expect(response.status).toBe(401);
    expect(mocks.assertRateLimit).not.toHaveBeenCalled();
    expect(mocks.reconcileUser).not.toHaveBeenCalled();
  });
});
