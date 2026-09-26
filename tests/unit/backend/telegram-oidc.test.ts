import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  deleted: [] as string[],
}));

const mocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  customFetch: Symbol("customFetch"),
  jwtVerify: vi.fn(),
  logTechnicalError: vi.fn(),
  logTechnicalWarning: vi.fn(),
  authDebugLog: vi.fn(),
  getCurrentSession: vi.fn(),
  redisCommand: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  recordUpstreamRequest: vi.fn(),
  remnashopAuth: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    telegramAuthState: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: mocks.createRemoteJWKSet,
  customFetch: mocks.customFetch,
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
vi.mock("@/backend/observability/metrics", () => ({
  recordUpstreamRequest: mocks.recordUpstreamRequest,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({ remnashopAuth: mocks.remnashopAuth }));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/backend/cache/redis", () => ({ redisCommand: mocks.redisCommand }));

import {
  createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse,
  clearTelegramAuthCookies,
  clearTelegramAuthCookiesOnResponse,
  readTelegramCallbackCookieProof,
  resetTelegramOidcJwksForTests,
  resumeTelegramOidcCodeExchange,
  resumeTelegramProviderAuthentication,
  TelegramAuthStateAlreadyConsumedError,
  verifyTelegramCallback,
  verifyTelegramPopupToken,
  verifyTelegramWidgetCallbackPayload,
} from "@/backend/integrations/telegram/oidc";
import { resetEnvForTests } from "@/backend/config/env";
import { sha256 } from "@/backend/security/crypto";

const durableOwnership = {
  authStateId: "auth-state-1",
  stateHash: sha256("state"),
  codeHash: sha256("code"),
  claimToken: "durable-claim-token",
};

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
    vi.unstubAllEnvs();
    resetEnvForTests();
    vi.clearAllMocks();
    resetTelegramOidcJwksForTests();
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
    mocks.prisma.$queryRaw.mockResolvedValue([{
      id: "auth-state-1",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    }]);
    mocks.prisma.$transaction.mockImplementation(
      async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma),
    );
    mocks.getCurrentSession.mockResolvedValue({ id: "session-1", userId: "target-user" });
    mocks.redisCommand.mockResolvedValue("OK");
    mocks.remnashopAuth.mockResolvedValue({
      data: { expires_at: "2099-01-01", refresh_expires_at: "2099-02-01" },
      cookies: { accessToken: "access", refreshToken: "refresh" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id_token: "id-token" }), { status: 200 }),
    );
  });

  it("creates authorization state and temporary browser cookies", async () => {
    vi.useFakeTimers();
    const issuedAt = new Date("2026-08-26T10:00:00.000Z");
    vi.setSystemTime(issuedAt);
    try {
      const response = await createTelegramAuthorizationResponse(
        "/cabinet",
        "user-1",
      );
      expect(response.headers.get("location")).toContain("response_type=code");
      expect(mocks.prisma.telegramAuthState.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          redirectTo: "/cabinet",
          userId: "user-1",
          expiresAt: new Date("2026-08-26T10:10:00.000Z"),
        }),
      });
      expect(response.cookies.get("clean_pay_tg_state")?.value).toBeTruthy();
      expect(response.cookies.get("clean_pay_tg_nonce")?.value).toBeTruthy();
      expect(response.cookies.get("clean_pay_tg_code_verifier")?.value).toBeTruthy();
      expect(response.headers.get("set-cookie")).toContain("Max-Age=1830");
      expect(response.headers.get("set-cookie")).toContain(
        "Expires=Wed, 26 Aug 2026 10:30:30 GMT",
      );
      expect(response.headers.get("set-cookie")).toContain(
        "clean_pay_tg_callback_receipt=",
      );
      expect(response.headers.get("set-cookie")).toContain(
        "Path=/auth/telegram/callback",
      );
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps callback proof cookies usable when the global policy is strict", async () => {
    vi.stubEnv("COOKIE_SAMESITE", "strict");
    try {
      const response = await createTelegramAuthorizationResponse();

      expect(response.cookies.get("clean_pay_tg_state")?.sameSite).toBe("lax");
      expect(response.cookies.get("clean_pay_tg_nonce")?.sameSite).toBe("lax");
      expect(response.cookies.get("clean_pay_tg_code_verifier")?.sameSite).toBe("lax");
    } finally {
      vi.unstubAllEnvs();
      resetEnvForTests();
    }
  });

  it("creates popup metadata from the same one-time state", async () => {
    const response = await createTelegramPopupStartResponse("/cabinet", "user-1");
    await expect(response.json()).resolves.toMatchObject({
      clientId: expect.any(String),
      nonce: expect.any(String),
      redirectUri: "http://localhost:8080/auth/telegram/callback",
    });
    expect(mocks.prisma.telegramAuthState.create).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain(
      "clean_pay_tg_callback_receipt=",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "Path=/auth/telegram/callback",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("verifies OIDC state, claims it once and returns identity without local-user decisions", async () => {
    setCallbackCookies();
    await expect(verifyTelegramCallback("code", "state")).resolves.toMatchObject({
      authState: expect.objectContaining({ id: "auth-state-1", redirectTo: "/cabinet" }),
      identity: expect.objectContaining({
        telegramId: "123456",
        telegramUsername: "clean_user",
        fullName: "Clean User",
        remnashopAuthResult: expect.objectContaining({ cookies: { accessToken: "access", refreshToken: "refresh" } }),
      }),
      durable: expect.objectContaining({
        authStateId: "auth-state-1",
        claimToken: expect.any(String),
        codeHash: expect.any(String),
        stateHash: expect.any(String),
      }),
    });
    expect(mocks.prisma.telegramAuthState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "auth-state-1",
        consumedAt: null,
        callbackStatus: "READY",
        nonceHash: expect.any(String),
        codeVerifierHash: expect.any(String),
      }),
      data: expect.objectContaining({
        consumedAt: expect.any(Date),
        callbackStatus: "PROVIDER_READY",
        callbackCodeHash: expect.any(String),
        callbackLeaseExpiresAt: expect.any(Date),
      }),
    }));
    const providerDispatchCall = mocks.prisma.telegramAuthState.updateMany.mock
      .calls.findIndex((call) =>
        call[0]?.data?.callbackStatus === "PROVIDER_DISPATCHING"
      );
    expect(providerDispatchCall).toBeGreaterThanOrEqual(0);
    expect(
      mocks.prisma.telegramAuthState.updateMany.mock.invocationCallOrder[
        providerDispatchCall
      ],
    ).toBeLessThan(vi.mocked(globalThis.fetch).mock.invocationCallOrder[0]!);
    expect(mocks.prisma.telegramAuthState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callbackStatus: "IDENTITY_VERIFIED",
        }),
        data: expect.objectContaining({
          callbackStatus: "REMNASHOP_DISPATCHING",
        }),
      }),
    );
    expect(mocks.prisma.telegramAuthState).not.toHaveProperty("update");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1])
      .toMatchObject({ redirect: "error" });
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "telegram_oidc",
      operation: "/token",
      outcome: "success",
      durationMs: expect.any(Number),
    });
  });

  it("fails closed once for malformed and oversized token responses", async () => {
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id_token: 123,
        access_token: "must-not-project",
      }), { status: 200 }),
    );
    await expect(verifyTelegramCallback("code", "state"))
      .rejects.toThrow("invalid response");
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledTimes(1);
    expect(mocks.recordUpstreamRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "unavailable" }),
    );

    vi.clearAllMocks();
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(128 * 1024) },
      }),
    );
    await expect(verifyTelegramCallback("code", "state"))
      .rejects.toThrow("invalid response");
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledTimes(1);
    expect(mocks.recordUpstreamRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "unavailable" }),
    );
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

  it("terminally fences an ambiguous Remnashop auth dispatch for login", async () => {
    setCallbackCookies();
    mocks.remnashopAuth.mockRejectedValueOnce(new Error("upstream timeout"));

    await expect(verifyTelegramCallback("code", "state")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });

    expect(mocks.prisma.telegramAuthState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callbackStatus: "REMNASHOP_DISPATCHING",
        }),
        data: expect.objectContaining({
          callbackStatus: "FAILED",
          callbackFailureCode: "REMNASHOP_AUTH_AMBIGUOUS",
        }),
      }),
    );
    expect(mocks.prisma.telegramAuthState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          callbackStatus: "PROVIDER_AUTHENTICATED",
        }),
      }),
    );
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

  it("reuses the remote JWKS verifier across token validations", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");

    await verifyTelegramPopupToken("first-token");
    await verifyTelegramPopupToken("second-token");

    expect(mocks.createRemoteJWKSet).toHaveBeenCalledOnce();
    expect(mocks.jwtVerify).toHaveBeenCalledTimes(2);
  });

  it("forces redirect rejection for the JOSE JWKS transport", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    await verifyTelegramPopupToken("id-token");
    const createJwksCall = mocks.createRemoteJWKSet.mock.calls[0] as unknown as
      | [URL, Record<PropertyKey, unknown>]
      | undefined;
    const options = createJwksCall?.[1];
    const fetchJwks = options?.[mocks.customFetch] as
      | ((url: string, init: never) => Promise<Response>)
      | undefined;
    expect(fetchJwks).toBeTypeOf("function");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://redirect.example/jwks" },
      }),
    );
    await expect(fetchJwks!("https://oauth.telegram.org/.well-known/jwks.json", {
      method: "GET",
      headers: new Headers({ accept: "application/json" }),
      redirect: "follow",
      signal: AbortSignal.timeout(1_000),
    } as never)).resolves.toMatchObject({ status: 302 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("verifies Telegram Login Widget HMAC and returns a provider identity", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    const body = { id: 123456, auth_date: Math.floor(Date.now() / 1000), username: "clean_user", first_name: "Clean" };
    await expect(verifyTelegramWidgetCallbackPayload({ ...body, hash: signWidgetPayload(body) }))
      .resolves.toMatchObject({
        identity: { telegramId: "123456", telegramUsername: "clean_user", fullName: "Clean", source: "widget" },
      });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.redisCommand).toHaveBeenCalledWith([
      "SET",
      expect.stringMatching(/^clean-pay:telegram-widget:v1:/),
      "1",
      "NX",
      "EX",
      expect.any(Number),
    ]);
  });

  it("rejects replayed Telegram Login Widget credentials", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    mocks.redisCommand.mockResolvedValueOnce(null);
    const body = { id: 123456, auth_date: Math.floor(Date.now() / 1000), first_name: "Clean" };

    await expect(
      verifyTelegramWidgetCallbackPayload({ ...body, hash: signWidgetPayload(body) }),
    ).rejects.toThrow("already used");
    expect(mocks.prisma.telegramAuthState.updateMany).not.toHaveBeenCalled();
  });

  it("rejects invalid token claims and failed token exchange", async () => {
    setCallbackCookies();
    mocks.jwtVerify.mockResolvedValueOnce({ payload: { nonce: "wrong", id: "123" } });
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("Telegram id_token nonce mismatch");

    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("bad", { status: 500 }));
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("Telegram token exchange failed");
  });

  it("handles an unreadable token error body and normalizes a prefixed client secret", async () => {
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_SECRET", "123456:normalized-secret");
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      clone: () => ({ text: () => Promise.reject(new Error("body unavailable")) }),
    } as Response);

    await expect(verifyTelegramCallback("code", "state"))
      .rejects.toThrow("Telegram token exchange failed");
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("123456:normalized-secret").toString("base64")}`,
    });
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
    [{ id: 1, hash: "bad", auth_date: Math.floor(Date.now() / 1000) }, "hash is invalid"],
  ])("rejects invalid widget payload %#", async (payload, message) => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    await expect(verifyTelegramWidgetCallbackPayload(payload as never)).rejects.toThrow(message);
  });

  it.each([-301, 31])("rejects a validly signed widget payload outside the allowed clock window (%#)", async (offsetSeconds) => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    const body = {
      id: 1,
      first_name: "Telegram",
      auth_date: Math.floor(Date.now() / 1000) + offsetSeconds,
    };

    await expect(verifyTelegramWidgetCallbackPayload({
      ...body,
      hash: signWidgetPayload(body),
    })).rejects.toThrow("expired");
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
    resetEnvForTests();
  });

  it("requires a bot token for widget verification and tolerates OIDC provider auth failure", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    await expect(verifyTelegramWidgetCallbackPayload({}))
      .rejects.toThrow("TELEGRAM_BOT_TOKEN is required");
    vi.unstubAllEnvs();
    resetEnvForTests();

    state.cookies.set("clean_pay_tg_nonce", "nonce");
    mocks.remnashopAuth.mockRejectedValueOnce(new Error("provider offline"));
    await expect(verifyTelegramPopupToken("token")).resolves.toMatchObject({
      identity: { remnashopAuthResult: null },
    });
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "telegram_remnashop_auth_failed",
      expect.any(Error),
      expect.objectContaining({ telegramId: "123456" }),
    );
  });

  it("rejects token endpoint error payloads and missing id_token", async () => {
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), { status: 200 }));
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("invalid_grant");
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await expect(verifyTelegramCallback("code", "state")).rejects.toThrow("does not contain id_token");
  });

  it("reads the callback proof and clears it on a redirect response", async () => {
    setCallbackCookies();
    await expect(readTelegramCallbackCookieProof("state")).resolves.toEqual({
      stateHash: sha256("state"),
      nonceHash: sha256("nonce"),
      codeVerifierHash: sha256("verifier"),
    });

    const response = NextResponse.redirect("http://localhost/cabinet");
    clearTelegramAuthCookiesOnResponse(response);
    for (const name of [
      "clean_pay_tg_state",
      "clean_pay_tg_nonce",
      "clean_pay_tg_code_verifier",
    ]) {
      expect(response.cookies.get(name)).toMatchObject({
        name,
        value: "",
        maxAge: 0,
        expires: new Date(0),
      });
    }
  });

  it("resumes an already claimed code exchange for the exact linking session", async () => {
    setCallbackCookies();
    await expect(resumeTelegramOidcCodeExchange(
      "code",
      "state",
      {
        id: "auth-state-1",
        targetUserId: "target-user",
        redirectTo: "/cabinet",
      },
      durableOwnership,
    )).resolves.toMatchObject({
      authState: {
        id: "auth-state-1",
        targetUserId: "target-user",
        redirectTo: "/cabinet",
      },
      identity: {
        telegramId: "123456",
        providerSession: expect.objectContaining({
          context: expect.objectContaining({
            cookies: { accessToken: "access", refreshToken: "refresh" },
          }),
        }),
      },
      durable: durableOwnership,
    });
    expect(mocks.getCurrentSession).toHaveBeenCalled();
  });

  it("records a secondary checkpoint failure when the token request is unavailable", async () => {
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce("network offline");
    mocks.prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(resumeTelegramOidcCodeExchange(
      "code",
      "state",
      {
        id: "auth-state-1",
        targetUserId: null,
        redirectTo: "/cabinet",
      },
      durableOwnership,
    )).rejects.toThrow("token exchange unavailable");

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "telegram_token_request_failed",
      expect.objectContaining({ errorName: "UnknownError" }),
      expect.anything(),
    );
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "telegram_oidc_dispatch_failure_checkpoint_failed",
      expect.any(Error),
      { authStateId: "auth-state-1" },
    );
  });

  it("preserves the identity error when its fallback failure checkpoint also fails", async () => {
    setCallbackCookies();
    mocks.jwtVerify.mockResolvedValueOnce({
      payload: { nonce: "wrong-nonce", id: "123456" },
    });
    mocks.prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(resumeTelegramOidcCodeExchange(
      "code",
      "state",
      {
        id: "auth-state-1",
        targetUserId: null,
        redirectTo: "/cabinet",
      },
      durableOwnership,
    )).rejects.toThrow("nonce mismatch");
  });

  it("rejects malformed token JSON and preserves a non-conflict claim error", async () => {
    setCallbackCookies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{not-json", { status: 200 }),
    );
    await expect(resumeTelegramOidcCodeExchange(
      "code",
      "state",
      {
        id: "auth-state-1",
        targetUserId: null,
        redirectTo: null,
      },
      durableOwnership,
    )).rejects.toThrow("invalid response");

    setCallbackCookies();
    const databaseError = new Error("claim database unavailable");
    mocks.prisma.telegramAuthState.updateMany.mockRejectedValueOnce(databaseError);
    await expect(verifyTelegramCallback("code", "state"))
      .rejects.toBe(databaseError);
  });

  it("fails closed when durable provider authentication has no usable result", async () => {
    const verified = {
      authState: {
        id: "auth-state-1",
        targetUserId: null,
        redirectTo: "/cabinet",
      },
      identity: {
        telegramId: "123456",
        telegramUsername: "clean_user",
        fullName: "Clean User",
        photoUrl: null,
        providerSession: null,
      },
    };

    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    try {
      await expect(resumeTelegramProviderAuthentication(
        verified,
        durableOwnership,
      )).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        status: 503,
      });
    } finally {
      vi.unstubAllEnvs();
      resetEnvForTests();
    }

    mocks.remnashopAuth.mockRejectedValueOnce(new Error("provider timeout"));
    mocks.prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(resumeTelegramProviderAuthentication(
      verified,
      durableOwnership,
    )).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
  });

  it("reports a consumed popup state when the atomic claim loses", async () => {
    state.cookies.set("clean_pay_tg_nonce", "nonce");
    mocks.prisma.telegramAuthState.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(verifyTelegramPopupToken("id-token"))
      .rejects.toBeInstanceOf(TelegramAuthStateAlreadyConsumedError);
    expect(mocks.logTechnicalWarning).toHaveBeenCalledWith(
      "telegram_oidc_state_already_consumed",
      { authStateId: "auth-state-1" },
    );
  });
});
