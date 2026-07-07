import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";

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

const tx = vi.hoisted(() => ({
  webUser: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  webSession: { updateMany: vi.fn() },
  auditLog: { updateMany: vi.fn() },
  paymentRecord: { updateMany: vi.fn() },
  emailVerificationCode: { updateMany: vi.fn() },
  telegramAuthState: { updateMany: vi.fn() },
}));

function signTelegramAuthPayload(body: Record<string, string | number | undefined>) {
  const dataCheckString = Object.entries(body)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN ?? "123456:test-token").digest();

  return createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

function hasLogKey(metadata: unknown, key: string) {
  return Boolean(metadata && typeof metadata === "object" && key in metadata);
}

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
  consumeTelegramLoginWidgetPayload,
  consumeTelegramPopupToken,
  createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse,
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
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.webUser.findUniqueOrThrow.mockResolvedValue({
      id: "target-user",
      remnashopUserId: "remna-email",
      email: "email@example.com",
      emailVerified: true,
      telegramId: null,
      telegramUsername: null,
      fullName: null,
      photoUrl: null,
      displayName: null,
    });
    tx.webUser.update.mockResolvedValue({
      id: "target-user",
      remnashopUserId: "remna-email",
      email: "email@example.com",
      emailVerified: true,
      telegramId: "123456",
    });
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

  it("creates Telegram popup start response with client id, redirect uri and nonce", async () => {
    const response = await createTelegramPopupStartResponse("/cabinet", "user-1");
    const body = await response.json() as { clientId?: string; nonce?: string; redirectUri?: string };

    expect(body.clientId).toBeTruthy();
    expect(body.nonce).toBeTruthy();
    expect(body.redirectUri).toBe("http://localhost:8080/auth/telegram/callback");
    expect(mocks.prisma.telegramAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        redirectTo: "/cabinet",
        userId: "user-1",
      }),
    });
    expect(response.cookies.get("clean_pay_tg_state")?.value).toBeTruthy();
    expect(response.cookies.get("clean_pay_tg_nonce")?.value).toBeTruthy();
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

    const logMetadata = mocks.logger.info.mock.calls.map(([, metadata]) => metadata);

    expect(logMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", hasBody: true }),
        expect.objectContaining({ method: "POST", status: 200, ok: true }),
      ]),
    );
    expect(JSON.stringify(logMetadata)).not.toContain("verifier");
    expect(JSON.stringify(logMetadata)).not.toContain("code");
    expect(JSON.stringify(logMetadata)).not.toContain("id-token");
    expect(logMetadata.some((metadata) => hasLogKey(metadata, "headers"))).toBe(false);
    expect(logMetadata.some((metadata) => hasLogKey(metadata, "body"))).toBe(false);
    expect(logMetadata.some((metadata) => hasLogKey(metadata, "url"))).toBe(false);
  });

  it("links Telegram to the current user without logging in through Remnashop Telegram auth", async () => {
    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");
    mocks.prisma.telegramAuthState.findFirst.mockResolvedValueOnce({
      id: "auth-state-1",
      userId: "target-user",
      redirectTo: "/link-account",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    await expect(consumeTelegramCallback("code", "state")).resolves.toMatchObject({
      user: { id: "target-user", telegramId: "123456" },
      redirectTo: "/link-account",
      linked: true,
      telegramId: "123456",
      remnashopAuth: null,
    });

    expect(mocks.remnashopAuth).not.toHaveBeenCalled();
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "telegram_link_confirm", tgId: "123456" }),
    );
    expect(tx.webUser.update).toHaveBeenCalledWith({
      where: { id: "target-user" },
      data: expect.objectContaining({
        remnashopUserId: "remna-email",
        email: "email@example.com",
        emailVerified: true,
        telegramId: "123456",
        telegramUsername: "clean_user",
        authPending: false,
      }),
    });
  });

  it("rejects linking a Telegram account that already belongs to another verified e-mail", async () => {
    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");
    mocks.prisma.telegramAuthState.findFirst.mockResolvedValueOnce({
      id: "auth-state-1",
      userId: "target-user",
      redirectTo: "/link-account",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({
      id: "source-user",
      remnashopUserId: "remna-telegram",
      email: "telegram@example.com",
      emailVerified: true,
      telegramId: "123456",
      telegramUsername: "clean_user",
      fullName: "Clean User",
      photoUrl: null,
      displayName: "Clean User",
    });

    await expect(consumeTelegramCallback("code", "state")).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(tx.webSession.updateMany).not.toHaveBeenCalled();
    expect(tx.webUser.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.telegramAuthState.update).not.toHaveBeenCalled();
  });

  it("consumes popup id token without exchanging authorization code", async () => {
    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");

    await expect(consumeTelegramPopupToken("id-token")).resolves.toMatchObject({
      user: { id: "user-1" },
      redirectTo: "/cabinet",
      remnashopAuth: { cookies: { accessToken: "access" } },
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.jwtVerify).toHaveBeenCalledWith("id-token", "jwks", {
      issuer: "https://oauth.telegram.org",
      audience: process.env.TELEGRAM_OIDC_CLIENT_ID ?? "test-telegram-client-id",
    });
    expect(state.deleted).toEqual([
      "clean_pay_tg_state",
      "clean_pay_tg_nonce",
      "clean_pay_tg_code_verifier",
    ]);
  });

  it("consumes Telegram Login widget payload and verifies hash without token exchange", async () => {
    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");
    const authData = {
      id: 123456,
      first_name: "Clean",
      username: "clean_user",
      auth_date: Math.floor(Date.now() / 1000),
    };

    await expect(consumeTelegramLoginWidgetPayload({
      ...authData,
      hash: signTelegramAuthPayload(authData),
    })).resolves.toMatchObject({
      user: { id: "user-1" },
      redirectTo: "/cabinet",
      remnashopAuth: { cookies: { accessToken: "access" } },
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
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

  it("uses the bot token secret part when full bot token is configured as OIDC client secret", async () => {
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_ID", "123456");
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_SECRET", "123456:secret-part");
    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");

    await consumeTelegramCallback("code", "state");

    const [, options] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const authorization = (options as RequestInit | undefined)?.headers
      ? ((options as RequestInit).headers as Record<string, string>).authorization
      : "";

    expect(Buffer.from(authorization.replace(/^Basic /, ""), "base64").toString("utf8")).toBe("123456:secret-part");
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

    state.cookies.set("clean_pay_tg_state", "state");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    state.cookies.set("clean_pay_tg_code_verifier", "verifier");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_client" }), { status: 200 }));

    await expect(consumeTelegramCallback("code", "state")).rejects.toThrow("Telegram token exchange failed: invalid_client");
    expect(mocks.logTechnicalWarning).toHaveBeenCalledWith("telegram_token_exchange_error_response", expect.any(Object));
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
