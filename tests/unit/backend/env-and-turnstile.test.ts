import { afterEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/backend/config/env";
import { verifyTurnstileToken } from "@/backend/security/turnstile";

function stubValidProductionEnv() {
  const postgresPassword = "pg-runtime-9QvL2xR8mT4pK7sN6cWd";
  const values = {
    NODE_ENV: "production",
    CLEAN_PAY_BUILD_PHASE: "",
    CLEAN_PAY_BAKED_PUBLIC_APP_URL: "",
    CLEAN_PAY_DEPLOY_SOURCE: "build",
    CLEAN_PAY_IMAGE: "clean-pay-runtime:test",
    CLEAN_PAY_MIGRATION_IMAGE: "clean-pay-migration-runtime:test",
    CLEAN_PAY_RELEASE: "local",
    CLEAN_PAY_REVISION: "local",
    POSTGRES_DB: "clean_pay",
    POSTGRES_USER: "clean_pay",
    POSTGRES_PASSWORD: postgresPassword,
    DATABASE_URL: `postgresql://clean_pay:${postgresPassword}@postgres:5432/clean_pay?schema=public`,
    REDIS_URL: "redis://redis:6379/0",
    APP_URL: "https://pay.runtime-clean.dev",
    NEXT_PUBLIC_APP_URL: "https://pay.runtime-clean.dev",
    REMNASHOP_API_BASE_URL: "http://remnashop:5000/api/v1/public",
    REMNASHOP_ADMIN_API_BASE_URL: "http://remnashop:5000/api/v1/admin",
    REMNASHOP_API_KEY: "shop-runtime-8Wp4Jz7Lc2Nq9Vr5Ks3M",
    REMNASHOP_AUTH_SERVICE_KEY: "auth-service-runtime-7Vr3Nm8Wp2Kq5Xs9Lc4D",
    REMNAWAVE_API_BASE_URL: "https://panel.runtime-clean.dev",
    REMNAWAVE_TOKEN: "wave-runtime-7Nq3Kp9Xs4Vm2Lc8Wr6J",
    REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://subscription.runtime-clean.dev",
    WEB_JWT_SECRET: "jwt-runtime-6Vr2Kp8Wm4Xq9Lc3Ns7D5Hz1",
    WEB_REFRESH_SECRET: "refresh-runtime-5Kq8Vr2Nm7Wp4Lc9Xs3D6Hz1",
    AUDIT_IP_HASH_SECRET: "audit-runtime-4Wp7Kq2Vr9Nm5Xs8Lc3D6Hz1",
    RATE_LIMIT_IDENTITY_SECRET: "rate-limit-runtime-4Lc8Kq2Vr9Nm5Xs7Wp3D6Hz1",
    AUTH_RATE_LIMIT_CAPACITY: "1000",
    READINESS_INTERNAL_SECRET: "readiness-runtime-9Wp2Kq7Vr4Nm5Xs8Lc3D6Hz1",
    COOKIE_SECURE: "true",
    COOKIE_SAMESITE: "lax",
    TELEGRAM_OIDC_CLIENT_ID: "7654321098",
    TELEGRAM_OIDC_CLIENT_SECRET: "oidc-runtime-3Nm8Wp5Kq2Vr7Xs9Lc4D6Hz1",
    TELEGRAM_BOT_TOKEN: "7654321098:RuntimeBotToken_9QvL2xR8mT4pK",
    PAYMENT_RECONCILIATION_ENABLED: "false",
    PAYMENT_RECONCILIATION_SECRET: "",
    PAYMENT_RECONCILIATION_INTERNAL_URL: "http://app:4000/api/internal/payments/reconcile",
    PAYMENT_REDIRECT_ORIGINS: "https://yoomoney.ru,https://pay.platega.io",
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SITE_KEY: "0x4AAAAARuntimeSiteKey8Wp4Jz7Lc2",
    TURNSTILE_SECRET_KEY: "turnstile-runtime-8Xs3Lc7Nm4Wp9Kq5Vr2D6Hz1",
    TURNSTILE_VERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    SUPPORT_ENABLED: "false",
    SUPPORT_EMAIL: "",
    SUPPORT_TELEGRAM_USERNAME: "",
    SUPPORT_FAQ_URL: "",
    CHATWOOT_BASE_URL: "",
    CHATWOOT_WEBSITE_TOKEN: "",
    CHATWOOT_HMAC_TOKEN: "",
    CLEAN_PAY_READINESS_MAILPIT_URL: "",
    CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://panel.runtime-clean.dev",
  } as const;

  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value);
  }
}

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
    expect(env.paymentRedirectOrigins).toEqual([
      "https://pay.example.test",
      "https://pay.example",
      "https://pay.test",
      "https://provider.test",
    ]);
  });

  it("normalizes and validates payment redirect origins", () => {
    vi.stubEnv(
      "PAYMENT_REDIRECT_ORIGINS",
      "https://yoomoney.ru, https://pay.platega.io:443",
    );
    expect(getEnv().paymentRedirectOrigins).toEqual([
      "https://yoomoney.ru",
      "https://pay.platega.io",
    ]);

    for (const invalid of [
      "http://yoomoney.ru",
      "https://user:password@yoomoney.ru",
      "https://yoomoney.ru/checkout",
      "https://yoomoney.ru?next=checkout",
      "https://yoomoney.ru#checkout",
    ]) {
      vi.stubEnv("PAYMENT_REDIRECT_ORIGINS", invalid);
      expect(() => getEnv()).toThrow("PAYMENT_REDIRECT_ORIGINS");
    }

    vi.stubEnv(
      "PAYMENT_REDIRECT_ORIGINS",
      "https://yoomoney.ru,https://yoomoney.ru:443",
    );
    expect(() => getEnv()).toThrow(
      "PAYMENT_REDIRECT_ORIGINS must not contain duplicate origins",
    );
  });

  it("uses the closed production payment-origin default when the override is absent", () => {
    vi.stubEnv("PAYMENT_REDIRECT_ORIGINS", "");

    expect(getEnv().paymentRedirectOrigins).toEqual([
      "https://yoomoney.ru",
      "https://pay.platega.io",
    ]);
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

  it("enforces the production preflight at runtime and confines its escape hatch to builds", () => {
    stubValidProductionEnv();
    expect(getEnv().appUrl).toBe("https://pay.runtime-clean.dev");

    vi.stubEnv("CLEAN_PAY_BAKED_PUBLIC_APP_URL", "https://old.runtime-clean.dev");
    expect(() => getEnv()).toThrow("rebuild the image");

    stubValidProductionEnv();
    vi.stubEnv("APP_URL", "http://pay.runtime-clean.dev");
    expect(() => getEnv()).toThrow("APP_URL must be a valid https: URL");

    stubValidProductionEnv();
    vi.stubEnv("COOKIE_SECURE", "false");
    expect(() => getEnv()).toThrow('COOKIE_SECURE must be "true" in production');

    stubValidProductionEnv();
    vi.stubEnv("WEB_JWT_SECRET", "change-me-runtime-web-jwt-secret-value");
    expect(() => getEnv()).toThrow("WEB_JWT_SECRET must not use a placeholder");

    stubValidProductionEnv();
    vi.stubEnv("CLEAN_PAY_BUILD_PHASE", "true");
    vi.stubEnv("APP_URL", "http://localhost:4000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:4000");
    vi.stubEnv("COOKIE_SECURE", "false");
    expect(getEnv().appUrl).toBe("http://localhost:4000");
  });

  it("keeps the public Turnstile widget enabled during builds without exposing its runtime secret", () => {
    stubValidProductionEnv();
    vi.stubEnv("CLEAN_PAY_BUILD_PHASE", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    expect(getEnv().turnstile).toMatchObject({
      enabled: true,
      siteKey: "0x4AAAAARuntimeSiteKey8Wp4Jz7Lc2",
      secretKey: null,
    });

    vi.stubEnv("CLEAN_PAY_BUILD_PHASE", "");
    expect(() => getEnv()).toThrow(
      "TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true",
    );
  });

  it("fails fast for invalid URLs and inconsistent Telegram settings", () => {
    vi.stubEnv("APP_URL", "ftp://clean-pay.local");
    expect(() => getEnv()).toThrow("APP_URL must be a valid http(s) URL");

    vi.stubEnv("APP_URL", "http://localhost:8080");
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_ID", "111111");
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_SECRET", "111111:legacy-oidc-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "222222:test-token");
    expect(() => getEnv()).toThrow("TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN");
  });

  it("allows only HTTPS subscription origins plus explicit development loopback HTTP", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "REMNAWAVE_SUBSCRIPTION_ORIGINS",
      "https://subscriptions.example.com,http://127.0.0.1:8081",
    );
    expect(getEnv().remnawave.subscriptionOrigins).toEqual([
      "https://subscriptions.example.com",
      "http://127.0.0.1:8081",
    ]);

    vi.stubEnv("REMNAWAVE_SUBSCRIPTION_ORIGINS", "http://subscriptions.example.com");
    expect(() => getEnv()).toThrow(
      "REMNAWAVE_SUBSCRIPTION_ORIGINS must use HTTPS",
    );

    vi.stubEnv("REMNAWAVE_SUBSCRIPTION_ORIGINS", "http://127.evil");
    expect(() => getEnv()).toThrow(
      "REMNAWAVE_SUBSCRIPTION_ORIGINS must use HTTPS",
    );

    vi.stubEnv("REMNAWAVE_SUBSCRIPTION_ORIGINS", "https://user:password@subscriptions.example.com");
    expect(() => getEnv()).toThrow(
      "REMNAWAVE_SUBSCRIPTION_ORIGINS must contain only URL origins without credentials",
    );
  });

  it("validates the optional Chatwoot origin and all-or-nothing tokens", () => {
    vi.stubEnv("CHATWOOT_BASE_URL", "https://chat.clean-pay.local/");
    vi.stubEnv("CHATWOOT_WEBSITE_TOKEN", "website_token_123456789");
    vi.stubEnv("CHATWOOT_HMAC_TOKEN", "hmac_token_12345678901234567890");

    expect(getEnv().chatwoot).toEqual({
      baseUrl: "https://chat.clean-pay.local",
      websiteToken: "website_token_123456789",
      hmacToken: "hmac_token_12345678901234567890",
    });

    vi.stubEnv("CHATWOOT_HMAC_TOKEN", "");
    expect(() => getEnv()).toThrow(
      "CHATWOOT_BASE_URL, CHATWOOT_WEBSITE_TOKEN and CHATWOOT_HMAC_TOKEN must be configured together",
    );

    vi.stubEnv("CHATWOOT_HMAC_TOKEN", "hmac_token_12345678901234567890");
    vi.stubEnv("CHATWOOT_BASE_URL", "https://chat.clean-pay.local/app");
    expect(() => getEnv()).toThrow("CHATWOOT_BASE_URL must contain only an http(s) origin");

    vi.stubEnv("CHATWOOT_BASE_URL", "https://chat.clean-pay.local");
    vi.stubEnv("CHATWOOT_WEBSITE_TOKEN", "short");
    expect(() => getEnv()).toThrow("CHATWOOT_WEBSITE_TOKEN must be a complete Chatwoot token");
  });

  it("derives the Remnashop admin URL and requires strong bounded reconciliation configuration", () => {
    vi.stubEnv("PAYMENT_RECONCILIATION_ENABLED", "false");
    vi.stubEnv("REMNASHOP_ADMIN_API_BASE_URL", "");
    expect(getEnv().remnashopAdminApiBaseUrl).toBe(
      "http://remnashop:5000/api/v1/admin",
    );

    vi.stubEnv("PAYMENT_RECONCILIATION_ENABLED", "true");
    vi.stubEnv("PAYMENT_RECONCILIATION_SECRET", "x".repeat(48));
    expect(getEnv().remnashopAdminApiBaseUrl).toBe(
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

  it("skips verification when disabled", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(verifyTurnstileToken(null, "auth_login")).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates token through Cloudflare when enabled", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("TURNSTILE_VERIFY_URL", "https://turnstile.test/siteverify");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, hostname: "localhost", action: "auth_login" }), { status: 200 }),
    );

    await verifyTurnstileToken("token", "auth_login");

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("token");
    expect(body.has("remoteip")).toBe(false);
  });

  it("returns service errors for invalid Turnstile states", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await expect(verifyTurnstileToken("token", "auth_login")).rejects.toThrow(
      "TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true",
    );

    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    await expect(verifyTurnstileToken(null, "auth_login")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(verifyTurnstileToken("bad", "auth_login")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a successful Turnstile response issued for another hostname", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, hostname: "attacker.example", action: "auth_login" }), { status: 200 }),
    );

    await expect(verifyTurnstileToken("token", "auth_login")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("rejects a successful token issued for another action", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, hostname: "localhost", action: "auth_register" }), { status: 200 }),
    );

    await expect(verifyTurnstileToken("token", "auth_login")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("rejects replay after Cloudflare consumes a single-use token", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, hostname: "localhost", action: "auth_login" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, hostname: "localhost", action: "auth_login", "error-codes": ["timeout-or-duplicate"] }), { status: 200 }),
      );

    await expect(verifyTurnstileToken("single-use", "auth_login")).resolves.toBeUndefined();
    await expect(verifyTurnstileToken("single-use", "auth_login")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("returns 503 for an unavailable or malformed Turnstile response", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(verifyTurnstileToken("token", "auth_login")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });

    vi.mocked(fetch).mockRejectedValueOnce(new Error("network unavailable"));
    await expect(verifyTurnstileToken("token", "auth_login")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
  });
});
