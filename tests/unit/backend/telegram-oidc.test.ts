import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  deleted: [] as string[],
}));

const mocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: vi.fn(),
  auditLog: vi.fn(),
  logTechnicalError: vi.fn(),
  logTechnicalWarning: vi.fn(),
  authDebugLog: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  assertRateLimit: vi.fn(),
  remnashopAuth: vi.fn(),
  prisma: {
    telegramAuthState: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    webUser: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: mocks.createRemoteJWKSet,
  jwtVerify: mocks.jwtVerify,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = state.cookies.get(name);
      return value ? { name, value } : undefined;
    },
    delete: (name: string) => {
      state.cookies.delete(name);
      state.deleted.push(name);
    },
  })),
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
  logTechnicalError: mocks.logTechnicalError,
  logTechnicalWarning: mocks.logTechnicalWarning,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopAuth: mocks.remnashopAuth,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  consumeTelegramCallback,
  createTelegramAuthorizationResponse,
} from "@/backend/integrations/telegram/oidc";

describe("Telegram OIDC integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cookies.clear();
    state.deleted = [];
    mocks.jwtVerify.mockResolvedValue({
      payload: {
        nonce: "nonce",
        id: "123456",
        preferred_username: "clean_user",
        name: "Clean User",
        picture: "https://img.test/avatar.png",
      },
    });
    mocks.prisma.telegramAuthState.findFirst.mockResolvedValue({
      id: "auth-state-1",
      userId: null,
      redirectTo: "/cabinet",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    mocks.prisma.webUser.findUnique.mockResolvedValue(null);
    mocks.prisma.webUser.upsert.mockResolvedValue({ id: "user-1", telegramId: "123456" });
    mocks.prisma.telegramAuthState.update.mockResolvedValue({});
    mocks.remnashopAuth.mockResolvedValue({
      data: {},
      cookies: { accessToken: "access", refreshToken: "refresh" },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 }),
    );
  });

  it("creates Telegram authorization redirect, state record and temporary cookies", async () => {
    const response = await createTelegramAuthorizationResponse("/cabinet", "user-1");
    const location = response.headers.get("location");

    expect(location).toContain("https://oauth.telegram.org/auth");
    expect(location).toContain("response_type=code");
    expect(location).toContain("client_id=");
    expect(location).not.toContain("bot_id=");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Ftelegram%2Fcallback");
    expect(mocks.prisma.telegramAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        redirectTo: "/cabinet",
        userId: "user-1",
        expiresAt: expect.any(Date),
      }),
    });
    expect(response.cookies.get("clean_pay_tg_state")?.value).toBeTruthy();
    expect(response.cookies.get("clean_pay_tg_nonce")?.value).toBeTruthy();
    expect(response.cookies.get("clean_pay_tg_code_verifier")?.value).toBeTruthy();
  });

  it("keeps client_id for non-Telegram OAuth-compatible mocks", async () => {
    vi.stubEnv("TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT", "http://localhost:8090/auth");
    const response = await createTelegramAuthorizationResponse("/cabinet");
    const location = response.headers.get("location");

    expect(location).toContain("http://localhost:8090/auth");
    expect(location).toContain("client_id=");
    expect(location).not.toContain("bot_id=");
  });

  it("consumes callback, creates/updates local user and authenticates in Remnashop", async () => {
    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");

    await expect(consumeTelegramCallback("code", "state")).resolves.toMatchObject({
      user: { id: "user-1" },
      redirectTo: "/cabinet",
      remnashopAuth: { cookies: { accessToken: "access" } },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://oauth.telegram.org/token",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
    expect(mocks.jwtVerify).toHaveBeenCalledWith("id-token", "jwks", {
      issuer: "https://oauth.telegram.org",
      audience: process.env.TELEGRAM_OIDC_CLIENT_ID ?? "test-telegram-client-id",
    });
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "telegram_login_confirm", tgId: "123456" }),
    );
    expect(mocks.prisma.webUser.upsert).toHaveBeenCalledWith({
      where: { telegramId: "123456" },
      create: expect.objectContaining({ telegramId: "123456", telegramUsername: "clean_user" }),
      update: expect.objectContaining({ telegramUsername: "clean_user" }),
    });
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/telegram", expect.objectContaining({
      id: 123456,
      first_name: "Clean",
      username: "clean_user",
      hash: expect.any(String),
    }));
    expect(state.deleted).toEqual([
      "clean_pay_tg_state",
      "clean_pay_tg_nonce",
      "clean_pay_tg_code_verifier",
    ]);
  });

  it("rejects invalid state cookies and failed token exchange", async () => {
    await expect(consumeTelegramCallback("code", "state")).rejects.toThrow("Telegram OIDC state is invalid");
    expect(mocks.logTechnicalWarning).toHaveBeenCalledWith("telegram_oidc_state_cookie_invalid", expect.any(Object));

    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("bad", { status: 500, statusText: "Nope" }));

    await expect(consumeTelegramCallback("code", "state")).rejects.toThrow("Telegram token exchange failed");
    expect(mocks.logTechnicalWarning).toHaveBeenCalledWith("telegram_token_exchange_failed", expect.any(Object));
  });

  it("rejects invalid id token payloads", async () => {
    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");
    mocks.jwtVerify.mockResolvedValueOnce({ payload: { nonce: "wrong", id: "123" } });

    await expect(consumeTelegramCallback("code", "state")).rejects.toThrow("Telegram id_token nonce mismatch");

    mocks.jwtVerify.mockResolvedValueOnce({ payload: { nonce: "nonce" } });
    await expect(consumeTelegramCallback("code", "state")).rejects.toThrow("Telegram id_token does not contain Telegram user id");
  });
});
