import { afterEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/backend/config/env";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { getRequestIp, getTurnstileToken, verifyTurnstileToken } from "@/backend/security/turnstile";

describe("backend env", () => {
  const restoreEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...restoreEnv };
    vi.unstubAllEnvs();
  });

  it("normalizes URLs, booleans and optional values", () => {
    vi.stubEnv("APP_URL", "http://localhost:8080/");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:8080/");
    vi.stubEnv("REMNASHOP_API_BASE_URL", "http://remnashop:5000/api/v1/public/");
    vi.stubEnv("COOKIE_SECURE", "true");
    vi.stubEnv("COOKIE_SAMESITE", "strict");
    vi.stubEnv("SUPPORT_ENABLED", "true");

    const env = getEnv();

    expect(env.appUrl).toBe("http://localhost:8080");
    expect(env.remnashopApiBaseUrl).toBe("http://remnashop:5000/api/v1/public");
    expect(env.cookieSecure).toBe(true);
    expect(env.cookieSameSite).toBe("strict");
    expect(env.telegramOidc.redirectUri).toBe("http://localhost:8080/auth/telegram/callback");
    expect(env.paymentReturnUrls.success).toBe("http://localhost:8080/payment/success");
  });

  it("throws on missing required values and invalid booleans", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getEnv()).toThrow("DATABASE_URL is required");

    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("COOKIE_SECURE", "maybe");
    expect(() => getEnv()).toThrow('COOKIE_SECURE must be "true" or "false"');
  });
});

describe("Turnstile helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("extracts token and request ip from supported fields", () => {
    expect(getTurnstileToken({ turnstileToken: "a", "cf-turnstile-response": "b" })).toBe("a");
    expect(getTurnstileToken({ "cf-turnstile-response": "b" })).toBe("b");

    const request = new Request("http://clean-pay.local", {
      headers: {
        "x-forwarded-for": "10.0.0.1, 10.0.0.2",
      },
    });

    expect(getRequestIp(request)).toBe("10.0.0.1");
    expect(getRequestIp(new Request("http://clean-pay.local", { headers: { "cf-connecting-ip": "1.1.1.1" } }))).toBe(
      "1.1.1.1",
    );
  });

  it("skips verification when disabled", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(verifyTurnstileToken(null)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates token through Cloudflare when enabled", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("TURNSTILE_VERIFY_URL", "https://turnstile.test/siteverify");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await verifyTurnstileToken("token", "127.0.0.1");

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("token");
    expect(body.get("remoteip")).toBe("127.0.0.1");
  });

  it("returns BFF errors for invalid Turnstile states", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await expect(verifyTurnstileToken("token")).rejects.toMatchObject<BffError>({ code: "UPSTREAM_UNAVAILABLE" });

    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    await expect(verifyTurnstileToken(null)).rejects.toMatchObject<BffError>({ code: "VALIDATION_ERROR" });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(verifyTurnstileToken("bad")).rejects.toMatchObject<BffError>({ code: "FORBIDDEN" });
  });
});
