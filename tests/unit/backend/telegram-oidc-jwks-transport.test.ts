import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type JwksFetch = (
  url: string,
  options: { headers: Headers; method: "GET"; signal: AbortSignal },
) => Promise<Response>;

const state = vi.hoisted(() => ({
  customFetch: Symbol("customFetch"),
  fetcher: null as JwksFetch | null,
}));

const mocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  recordUpstreamRequest: vi.fn(),
}));

vi.mock("jose", () => ({
  customFetch: state.customFetch,
  createRemoteJWKSet: mocks.createRemoteJWKSet,
  jwtVerify: mocks.jwtVerify,
}));
vi.mock("@/backend/observability/metrics", () => ({
  recordUpstreamRequest: mocks.recordUpstreamRequest,
}));
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: vi.fn(),
  logTechnicalWarning: vi.fn(),
}));
vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: vi.fn(),
}));
vi.mock("@/backend/observability/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopAuth: vi.fn(),
}));

import {
  resetTelegramOidcJwksForTests,
  verifyTelegramIdToken,
} from "@/backend/integrations/telegram/oidc-transport";

describe("Telegram OIDC JWKS transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.fetcher = null;
    resetTelegramOidcJwksForTests();
    mocks.createRemoteJWKSet.mockImplementation((_url, options) => {
      state.fetcher = (options as Record<symbol, JwksFetch>)[state.customFetch];
      return { kind: "synthetic-jwks" };
    });
    mocks.jwtVerify.mockResolvedValue({ payload: { nonce: "nonce-1" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("projects valid keys and emits exactly one outcome after decode", async () => {
    await expect(verifyTelegramIdToken("id-token", "nonce-1"))
      .resolves.toEqual({ nonce: "nonce-1" });
    const fetcher = state.fetcher;
    expect(fetcher).toBeTypeOf("function");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        keys: [{
          kty: "RSA",
          kid: "telegram-key-1",
          alg: "RS256",
          use: "sig",
          key_ops: ["verify"],
          n: "public-modulus",
          e: "AQAB",
          d: "must-not-project",
          provider_extra: true,
        }],
        provider_extra: true,
      })),
    );
    const response = await fetcher!(
      "https://oauth.telegram.org/.well-known/jwks.json",
      { headers: new Headers(), method: "GET", signal: new AbortController().signal },
    );

    await expect(response.json()).resolves.toEqual({
      keys: [{
        kty: "RSA",
        kid: "telegram-key-1",
        use: "sig",
        alg: "RS256",
        key_ops: ["verify"],
        n: "public-modulus",
        e: "AQAB",
      }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "telegram_oidc",
      operation: "/.well-known/jwks.json",
      outcome: "success",
      durationMs: expect.any(Number),
    });

    mocks.recordUpstreamRequest.mockClear();
    await verifyTelegramIdToken("second-id-token", "nonce-1");
    expect(mocks.createRemoteJWKSet).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).not.toHaveBeenCalled();
  });

  it("records redirect rejection and malformed bytes once without replay", async () => {
    await verifyTelegramIdToken("id-token", "nonce-1");
    const fetcher = state.fetcher!;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(fetcher(
      "https://oauth.telegram.org/.well-known/jwks.json",
      { headers: new Headers(), method: "GET", signal: new AbortController().signal },
    )).resolves.toMatchObject({ status: 302 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "rejected" }),
    );

    fetchMock.mockClear();
    mocks.recordUpstreamRequest.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([
      0x7b, 0x22, 0x6b, 0x65, 0x79, 0x73, 0x22, 0x3a, 0xc3, 0x28, 0x7d,
    ])));
    await expect(fetcher(
      "https://oauth.telegram.org/.well-known/jwks.json",
      { headers: new Headers(), method: "GET", signal: new AbortController().signal },
    )).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "unavailable" }),
    );
  });
});
