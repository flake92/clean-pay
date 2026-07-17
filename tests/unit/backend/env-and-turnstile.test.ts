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
    vi.stubEnv("REMNASHOP_ADMIN_API_BASE_URL", "http://remnashop:5000/api/v1/admin/");
    vi.stubEnv("COOKIE_SECURE", "true");
    vi.stubEnv("COOKIE_SAMESITE", "strict");
    vi.stubEnv("SUPPORT_ENABLED", "true");

    const env = getEnv();

    expect(env.appUrl).toBe("http://localhost:8080");
    expect(env.remnashopApiBaseUrl).toBe("http://remnashop:5000/api/v1/public");
    expect(env.remnashopAdminApiBaseUrl).toBe("http://remnashop:5000/api/v1/admin");
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

  it("fails fast for invalid production configuration combinations", () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    expect(() => getEnv()).toThrow("TURNSTILE_SITE_KEY is required when TURNSTILE_ENABLED=true");

    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(() => getEnv()).toThrow("TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true");

    vi.stubEnv("TURNSTILE_ENABLED", "false");
    vi.stubEnv("COOKIE_SAMESITE", "none");
    vi.stubEnv("COOKIE_SECURE", "false");
    expect(() => getEnv()).toThrow('COOKIE_SECURE must be "true" when COOKIE_SAMESITE="none"');

    vi.stubEnv("COOKIE_SAMESITE", "lax");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "");
    vi.stubEnv("REMNAWAVE_TOKEN", "");
    expect(() => getEnv()).toThrow("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN are required in production");

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "https://panel.example.com");
    vi.stubEnv("REMNAWAVE_TOKEN", "");
    expect(() => getEnv()).toThrow("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN must be configured together");

    vi.stubEnv("REMNAWAVE_API_BASE_URL", "");
    vi.stubEnv("REMNAWAVE_TOKEN", "token");
    expect(() => getEnv()).toThrow("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN must be configured together");

    vi.stubEnv("REMNAWAVE_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_BRAND_NAME", "x".repeat(81));
    expect(() => getEnv()).toThrow("NEXT_PUBLIC_BRAND_NAME must be 80 characters or less");

    vi.stubEnv("NEXT_PUBLIC_BRAND_NAME", "Partner Cabinet");
    vi.stubEnv("NEXT_PUBLIC_BRAND_LOGO_URL", "https://cdn.example.com/logo.png");
    expect(() => getEnv()).toThrow("NEXT_PUBLIC_BRAND_LOGO_URL must be a root-relative public path");
  });

  it("fails fast for invalid URLs and inconsistent Telegram settings", () => {
    vi.stubEnv("APP_URL", "ftp://clean-pay.local");
    expect(() => getEnv()).toThrow("APP_URL must be a valid http(s) URL");

    vi.stubEnv("APP_URL", "http://localhost:8080");
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_ID", "111111");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "222222:test-token");
    expect(() => getEnv()).toThrow("TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN");
  });

  it("requires strong bounded reconciliation configuration when enabled", () => {
    vi.stubEnv("PAYMENT_RECONCILIATION_ENABLED", "false");
    vi.stubEnv("REMNASHOP_ADMIN_API_BASE_URL", "");
    expect(getEnv().remnashopAdminApiBaseUrl).toBeNull();

    vi.stubEnv("PAYMENT_RECONCILIATION_ENABLED", "true");
    vi.stubEnv("PAYMENT_RECONCILIATION_SECRET", "x".repeat(48));
    expect(() => getEnv()).toThrow(
      "REMNASHOP_ADMIN_API_BASE_URL is required when PAYMENT_RECONCILIATION_ENABLED=true",
    );

    vi.stubEnv(
      "REMNASHOP_ADMIN_API_BASE_URL",
      "http://remnashop:5000/api/v1/admin",
    );
    vi.stubEnv("PAYMENT_RECONCILIATION_SECRET", "short");
    expect(() => getEnv()).toThrow(
      "PAYMENT_RECONCILIATION_SECRET must be at least 32 characters",
    );

    vi.stubEnv("PAYMENT_RECONCILIATION_SECRET", "x".repeat(48));
    vi.stubEnv("PAYMENT_RECONCILIATION_BATCH_SIZE", "101");
    expect(() => getEnv()).toThrow(
      "PAYMENT_RECONCILIATION_BATCH_SIZE must be an integer between 1 and 100",
    );
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
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
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
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await expect(verifyTurnstileToken("token")).rejects.toThrow(
      "TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true",
    );

    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    await expect(verifyTurnstileToken(null)).rejects.toMatchObject<BffError>({ code: "VALIDATION_ERROR" });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(verifyTurnstileToken("bad")).rejects.toMatchObject<BffError>({ code: "FORBIDDEN" });
  });
});
