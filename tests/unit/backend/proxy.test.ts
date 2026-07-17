import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
}));

import { proxy } from "@/proxy";

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function accessToken(payload: Record<string, unknown>, secret = process.env.WEB_JWT_SECRET ?? "test-web-jwt-secret") {
  const encoded = base64UrlJson(payload);
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");

  return `${encoded}.${signature}`;
}

function request(pathname: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (cookie) {
    headers.set("cookie", cookie);
  }

  return new NextRequest(new Request(`https://pay.example.com${pathname}`, {
    ...init,
    headers,
  }));
}

describe("proxy auth redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pay.example.com");
  });

  it.each(["/cabinet", "/profile", "/tariffs", "/link-account"])(
    "redirects protected page %s to login without cookies",
    async (pathname) => {
      const response = await proxy(request(pathname));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://pay.example.com/login?redirect_to=${encodeURIComponent(pathname)}`);
    },
  );

  it.each(["/install", "/offline"])("allows public PWA page %s without cookies", async (pathname) => {
    const response = await proxy(request(pathname));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    ["refresh only", "clean_pay_refresh=refresh-token"],
    [
      "expired access with refresh",
      `clean_pay_access=${accessToken({ sid: "session-1", uid: "user-1", exp: 1, al: "FULL", ev: true })}; clean_pay_refresh=refresh-token`,
    ],
    [
      "invalid access with refresh",
      `clean_pay_access=${accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }, "wrong-secret")}; clean_pay_refresh=refresh-token`,
    ],
  ])("redirects protected pages to login for %s", async (_label, cookie) => {
    const response = await proxy(request("/cabinet", cookie));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://pay.example.com/login?redirect_to=%2Fcabinet");
    expect(response.cookies.get("clean_pay_access")?.value).toBe("");
    expect(response.cookies.get("clean_pay_refresh")?.value).toBe("");
  });

  it("does not redirect login to cabinet when only refresh cookie remains", async () => {
    const response = await proxy(request("/login", "clean_pay_refresh=refresh-token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows API requests with refresh cookie to reach handlers for session refresh", async () => {
    const response = await proxy(request("/api/bff/auth/me", "clean_pay_refresh=refresh-token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows a same-origin cookie-auth JSON mutation", async () => {
    const response = await proxy(request(
      "/api/bff/auth/email/change",
      "clean_pay_refresh=refresh-token",
      {
        method: "POST",
        headers: {
          origin: "https://pay.example.com",
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ email: "next@example.com" }),
      },
    ));

    expect(response.status).toBe(200);
  });

  it("allows Referer as a fallback when Origin is absent", async () => {
    const response = await proxy(request(
      "/api/bff/auth/email/confirm",
      "clean_pay_refresh=refresh-token",
      {
        method: "POST",
        headers: {
          referer: "https://pay.example.com/register/verify-email",
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: "123456" }),
      },
    ));

    expect(response.status).toBe(200);
  });

  it.each([
    ["a cross-origin request", { origin: "https://evil.example" }],
    ["a same-site sibling origin", { origin: "https://other.pay.example.com" }],
    ["an opaque origin", { origin: "null" }],
    [
      "an untrusted Origin even with a trusted Referer",
      { origin: "https://evil.example", referer: "https://pay.example.com/profile" },
    ],
    ["a request without source headers", {}],
  ])("rejects %s for a cookie-auth mutation", async (_label, sourceHeaders) => {
    const response = await proxy(request(
      "/api/bff/auth/email/change",
      "clean_pay_refresh=refresh-token",
      {
        method: "POST",
        headers: {
          ...sourceHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "next@example.com" }),
      },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it.each([
    ["email confirmation", "/api/bff/auth/email/confirm", "clean_pay_refresh=refresh-token"],
    ["Telegram popup callback", "/auth/telegram/callback", undefined],
  ])("rejects non-JSON %s even from the trusted origin", async (_label, pathname, cookie) => {
    const response = await proxy(request(
      pathname,
      cookie,
      {
        method: "POST",
        headers: {
          origin: "https://pay.example.com",
          "content-type": "text/plain",
        },
        body: JSON.stringify({ code: "123456" }),
      },
    ));

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("allows a same-origin no-body cookie-auth mutation without Content-Type", async () => {
    const response = await proxy(request(
      "/api/bff/auth/logout",
      "clean_pay_refresh=refresh-token",
      {
        method: "POST",
        headers: { origin: "https://pay.example.com" },
      },
    ));

    expect(response.status).toBe(200);
  });

  it("requires JSON by default for future unsafe BFF routes", async () => {
    const response = await proxy(request(
      "/api/bff/future/mutation",
      undefined,
      {
        method: "POST",
        headers: { origin: "https://pay.example.com" },
      },
    ));

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it.each([
    ["a future POST on an existing DELETE path", "POST", "/api/bff/subscription/devices"],
    ["a nested future DELETE route", "DELETE", "/api/bff/subscription/devices/device/metadata"],
  ])("does not overmatch bodyless exceptions for %s", async (_label, method, pathname) => {
    const response = await proxy(request(pathname, undefined, {
      method,
      headers: { origin: "https://pay.example.com" },
    }));

    expect(response.status).toBe(415);
  });

  it("allows the known single-segment bodyless DELETE route", async () => {
    const response = await proxy(request(
      "/api/bff/subscription/devices/device-1",
      "clean_pay_refresh=refresh-token",
      {
        method: "DELETE",
        headers: { origin: "https://pay.example.com" },
      },
    ));

    expect(response.status).toBe(200);
  });

  it.each([
    ["public login", "/api/bff/auth/login", { email: "user@example.com", password: "secret" }],
    ["Telegram WebApp login", "/api/bff/auth/telegram/webapp", { initData: "signed-telegram-payload" }],
    ["Telegram popup callback", "/auth/telegram/callback", { idToken: "signed-telegram-token" }],
  ])("allows same-origin %s without existing cookies", async (_label, pathname, body) => {
    const response = await proxy(request(pathname, undefined, {
      method: "POST",
      headers: {
        origin: "https://pay.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(200);
  });

  it.each([
    ["public login", "/api/bff/auth/login", { email: "user@example.com", password: "secret" }],
    ["Telegram WebApp login", "/api/bff/auth/telegram/webapp", { initData: "signed-telegram-payload" }],
    ["Telegram popup callback", "/auth/telegram/callback", { idToken: "signed-telegram-token" }],
  ])("rejects cross-origin %s without existing cookies", async (_label, pathname, body) => {
    const response = await proxy(request(pathname, undefined, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("allows the external Telegram OIDC GET callback without source headers", async () => {
    const response = await proxy(request("/auth/telegram/callback?code=code&state=state"));

    expect(response.status).toBe(200);
  });

  it("allows an authenticated Telegram link start from the trusted page", async () => {
    const response = await proxy(request(
      "/auth/telegram/start?redirect_to=/link-account",
      "clean_pay_refresh=refresh-token",
      { headers: { referer: "https://pay.example.com/link-account" } },
    ));

    expect(response.status).toBe(200);
  });

  it.each([
    ["an untrusted page", { referer: "https://evil.example/attack" }],
    ["a request without source headers", {}],
  ])("rejects authenticated Telegram link start from %s", async (_label, headers) => {
    const response = await proxy(request(
      "/auth/telegram/start?redirect_to=/link-account",
      "clean_pay_refresh=refresh-token",
      { headers },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("keeps anonymous Telegram login start available without source headers", async () => {
    const response = await proxy(request("/auth/telegram/start?redirect_to=/cabinet"));

    expect(response.status).toBe(200);
  });

  it("blocks API requests without cookies and clears stale session cookies on the response", async () => {
    const response = await proxy(request("/api/bff/auth/me"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect(response.cookies.get("clean_pay_access")?.value).toBe("");
    expect(response.cookies.get("clean_pay_refresh")?.value).toBe("");
  });
});
