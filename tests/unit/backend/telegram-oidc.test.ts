import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  deleted: [] as string[],
}));

const mocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: vi.fn(),
  logTechnicalError: vi.fn(),
  logTechnicalWarning: vi.fn(),
  authDebugLog: vi.fn(),
  getCurrentSession: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  remnashopAuth: vi.fn(),
  prisma: {
    telegramAuthState: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
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
  logTechnicalError: mocks.logTechnicalError,
  logTechnicalWarning: mocks.logTechnicalWarning,
}));
vi.mock("@/backend/observability/auth-debug-log", () => ({ authDebugLog: mocks.authDebugLog }));
vi.mock("@/backend/observability/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/integrations/remnashop/client", () => ({ remnashopAuth: mocks.remnashopAuth }));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({ getCurrentSession: mocks.getCurrentSession }));

import {
  createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse,
  clearTelegramAuthCookies,
  TelegramAuthStateAlreadyConsumedError,
  verifyTelegramCallback,
  verifyTelegramPopupToken,
  verifyTelegramWidgetCallbackPayload,
} from "@/backend/integrations/telegram/oidc";

function setCallbackCookies() {
  state.cookies.set("clean_pay_tg_state", "state");
  state.cookies.set("clean_pay_tg_nonce", "nonce");
  state.cookies.set("clean_pay_tg_code_verifier", "verifier");
}

function signWidgetPayload(body: Record<string, string | number | undefined>) {
  const dataCheckString = Object.entries(body)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN ?? "123456:test-token").digest();
  return createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

describe("Telegram identity verification adapter", () => {
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
    mocks.prisma.telegramAuthState.updateMany.mockResolvedValue({ count: 1 });
    mocks.getCurrentSession.mockResolvedValue({ id: "session-1", userId: "target-user" });
    mocks.remnashopAuth.mockResolvedValue({
      data: { expires_at: "2099-01-01", refresh_expires_at: "2099-02-01" },
      cookies: { accessToken: "access", refreshToken: "refresh" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 }),
    );
  });

  it("creates authorization state and temporary browser cookies", async () => {
    const response = await createTelegramAuthorizationResponse("/cabinet", "user-1");
    expect(response.headers.get("location")).toContain("response_type=code");
    expect(mocks.prisma.telegramAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ redirectTo: "/cabinet", userId: "user-1", expiresAt: expect.any(Date) }),
    });
    expect(response.cookies.get("clean_pay_tg_state")?.value).toBeTruthy();
    expect(response.cookies.get("clean_pay_tg_nonce")?.value).toBeTruthy();
    expect(response.cookies.get("clean_pay_tg_code_verifier")?.value).toBeTruthy();
  });

  it("creates popup metadata from the same one-time state", async () => {
    const response = await createTelegramPopupStartResponse("/cabinet", "user-1");
    await expect(response.json()).resolves.toMatchObject({
      clientId: expect.any(String),
      nonce: expect.any(String),
      redirectUri: "http://localhost:8080/auth/telegram/callback",
    });
    expect(mocks.prisma.telegramAuthState.create).toHaveBeenCalledOnce();
  });

  it("verifies OIDC state, claims it once and returns identity without local-user decisions", async () => {
    setCallbackCookies();
    await expect(verifyTelegramCallback("code", "state")).resolves.toEqual({
      authState: expect.objectContaining({ id: "auth-state-1", redirectTo: "/cabinet" }),
      identity: expect.objectContaining({
        telegramId: "123456",
        telegramUsername: "clean_user",
        fullName: "Clean User",
        source: "oidc",
        remnashopAuthResult: expect.objectContaining({ cookies: { accessToken: "access", refreshToken: "refresh" } }),
      }),
    });
    expect(mocks.prisma.telegramAuthState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "auth-state-1", consumedAt: null }),
    }));
    expect(mocks.prisma.telegramAuthState).not.toHaveProperty("update");
  });

  it("requires the original linking session before consuming linked state", async () => {
    setCallbackCookies();
    mocks.prisma.telegramAuthState.findFirst.mockResolvedValueOnce({
      id: "auth-state-1", userId: "target-user", redirectTo: "/cabinet", expiresAt: new Date("2099-01-01"),
    });
    mocks.getCurrentSession.mockResolvedValueOnce({ id: "other-session", userId: "other-user" });

    await expect(verifyTelegramCallback("code", "state")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.prisma.telegramAuthState.updateMany).toHaveBeenCalledOnce();
    expect(state.deleted).toEqual(expect.arrayContaining([
      "clean_pay_tg_state", "clean_pay_tg_nonce", "clean_pay_tg_code_verifier",
    ]));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects mismatched state and duplicate claims", async () => {
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("Telegram OIDC state is invalid");
    setCallbackCookies();
    mocks.prisma.telegramAuthState.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(verifyTelegramCallback("code", "state"))
      .rejects.toBeInstanceOf(TelegramAuthStateAlreadyConsumedError);
  });

  it("verifies popup tokens without exchanging an authorization code", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    await expect(verifyTelegramPopupToken("id-token")).resolves.toMatchObject({
      identity: { telegramId: "123456", source: "oidc" },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("verifies Telegram Login Widget HMAC and returns a provider identity", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    const body = { id: 123456, auth_date: Math.floor(Date.now() / 1000), username: "clean_user", first_name: "Clean" };
    await expect(verifyTelegramWidgetCallbackPayload({ ...body, hash: signWidgetPayload(body) }))
      .resolves.toMatchObject({
        identity: { telegramId: "123456", telegramUsername: "clean_user", fullName: "Clean", source: "widget" },
      });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid token claims and failed token exchange", async () => {
    setCallbackCookies();
    mocks.jwtVerify.mockResolvedValueOnce({ payload: { nonce: "wrong", id: "123" } });
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("Telegram id_token nonce mismatch");

    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("bad", { status: 500 }));
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("Telegram token exchange failed");
  });

  it("clears all temporary Telegram cookies explicitly", async () => {
    setCallbackCookies();
    await clearTelegramAuthCookies();
    expect(state.cookies.size).toBe(0);
    expect(state.deleted).toEqual([
      "clean_pay_tg_state", "clean_pay_tg_nonce", "clean_pay_tg_code_verifier",
    ]);
  });

  it("rejects absent popup/widget nonce and missing persisted state", async () => {
    await expect(verifyTelegramPopupToken("token")).rejects.toThrow("popup nonce");
    await expect(verifyTelegramWidgetCallbackPayload({})).rejects.toThrow("widget nonce");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    mocks.prisma.telegramAuthState.findFirst.mockResolvedValueOnce(null);
    await expect(verifyTelegramPopupToken("token")).rejects.toThrow("popup state");
    mocks.prisma.telegramAuthState.findFirst.mockResolvedValueOnce(null);
    await expect(verifyTelegramWidgetCallbackPayload({})).rejects.toThrow("widget state");
  });

  it("rejects a missing persisted OIDC state before token exchange", async () => {
    setCallbackCookies();
    mocks.prisma.telegramAuthState.findFirst.mockResolvedValueOnce(null);
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("not found or has expired");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: 1, auth_date: Math.floor(Date.now() / 1000) }, "hash"],
    [{ hash: "bad", auth_date: Math.floor(Date.now() / 1000) }, "incomplete"],
    [{ id: 1, hash: "bad", auth_date: "invalid" }, "invalid auth_date"],
    [{ id: 1, hash: "bad", auth_date: Math.floor(Date.now() / 1000) - 86_401 }, "expired"],
    [{ id: 1, hash: "bad", auth_date: Math.floor(Date.now() / 1000) }, "hash is invalid"],
  ])("rejects invalid widget payload %#", async (payload, message) => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    await expect(verifyTelegramWidgetCallbackPayload(payload as never)).rejects.toThrow(message);
  });

  it("accepts widget optional identity fields and tolerates provider authentication failure", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    const body = { id: 123456, auth_date: Math.floor(Date.now() / 1000), first_name: "Clean", last_name: "User", photo_url: "https://img.test/a.png" };
    mocks.remnashopAuth.mockRejectedValueOnce(new Error("provider offline"));
    await expect(verifyTelegramWidgetCallbackPayload({ ...body, hash: signWidgetPayload(body) })).resolves.toMatchObject({
      identity: { telegramUsername: null, fullName: "Clean User", photoUrl: "https://img.test/a.png", remnashopAuthResult: null },
    });
    expect(mocks.logTechnicalError).toHaveBeenCalled();
  });

  it("validates Telegram identity claims and derives fallback names", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    mocks.jwtVerify.mockResolvedValueOnce({ payload: {
      nonce: "nonce", telegram_id: 123456, given_name: "Clean", family_name: "User",
    } });
    await expect(verifyTelegramPopupToken("token")).resolves.toMatchObject({
      identity: { telegramId: "123456", telegramUsername: null, fullName: "Clean User", photoUrl: null },
    });

    for (const invalid of [undefined, 0, -1]) {
      state.cookies.set("clean_pay_tg_nonce", "nonce");
      mocks.jwtVerify.mockResolvedValueOnce({ payload: { nonce: "nonce", id: invalid } });
      await expect(verifyTelegramPopupToken("token")).rejects.toThrow(/Telegram user id|invalid telegram_id/);
    }
  });

  it("returns null provider auth when Telegram bot integration is unavailable", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    await expect(verifyTelegramPopupToken("token")).resolves.toMatchObject({
      identity: { remnashopAuthResult: null },
    });
    expect(mocks.logTechnicalWarning).toHaveBeenCalledWith("telegram_remnashop_auth_skipped", expect.anything());
    vi.unstubAllEnvs();
  });

  it("rejects token endpoint error payloads and missing id_token", async () => {
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), { status: 200 }));
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("invalid_grant");
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("does not contain id_token");
  });
});
