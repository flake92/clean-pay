import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/backend/observability/logger", () => ({ logger }));

import { proxy } from "@/proxy";

function request(path: string) {
  return new NextRequest(`https://pay.example.com${path}`, {
    headers: {
      cookie: "clean_pay_access=invalid; clean_pay_refresh=refresh-candidate",
    },
  });
}

function anonymousRequest(path: string) {
  return new NextRequest(`https://pay.example.com${path}`);
}

function signedAccessToken(
  overrides: Record<string, unknown> = {},
) {
  const payload = Buffer.from(JSON.stringify({
    sid: "session-that-must-be-checked-by-the-server",
    uid: "user-1",
    exp: Math.floor(Date.now() / 1_000) + 60,
    ev: true,
    al: "FULL",
    ...overrides,
  })).toString("base64url");
  const signature = createHmac("sha256", "test-secret")
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

describe("proxy session refresh navigation", () => {
  const previousSecret = process.env.WEB_JWT_SECRET;
  const previousPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEB_JWT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://pay.example.com";
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.WEB_JWT_SECRET;
    else process.env.WEB_JWT_SECRET = previousSecret;
    if (previousPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousPublicAppUrl;
  });

  it.each(["/support", "/tariffs"])(
    "keeps the public page %s reachable with a bad refresh candidate",
    async (path) => {
      const response = await proxy(request(path));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("keeps the provider session recovery page public", async () => {
    const response = await proxy(anonymousRequest(
      "/auth/session/recovery?return_to=%2Fcabinet&kind=provider",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not make similarly prefixed recovery paths public", async () => {
    const response = await proxy(anonymousRequest("/auth/session/recovery-fake"));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect_to")).toBe(
      "/auth/session/recovery-fake",
    );
  });

  it.each([
    "/",
    "/cabinet",
    "/profile",
    "/link-account?reason=email-required&redirect_to=%2Fpayment%3Fplan%3Dpro",
    "/referral",
    "/extend?duration=30&gateway=CARD",
    "/payment?plan=pro&duration=30&gateway=CARD",
    "/payment/success?operation_id=operation-1",
    "/payment/pending?operation_id=operation-1",
    "/payment/fail?operation_id=operation-1",
    "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro",
    "/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro",
    "/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro",
  ])(
    "redirects anonymous protected navigation %s to login with the exact return target",
    async (path) => {
      const response = await proxy(anonymousRequest(path));
      const location = new URL(response.headers.get("location")!);

      expect(response.status).toBe(307);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("redirect_to")).toBe(path);
    },
  );

  it("leaves database validation of a signed access session to the server boundary", async () => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/cabinet?tab=devices",
      {
        headers: {
          cookie: `clean_pay_access=${signedAccessToken()}`,
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("repairs the observed Cyrillic-c cabinet path without discarding the authenticated session", async () => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/%D1%81abinet?tab=devices",
      {
        headers: {
          cookie: `clean_pay_access=${signedAccessToken()}`,
        },
      },
    ));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/cabinet");
    expect(location.search).toBe("?tab=devices");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("repairs the confusable cabinet path before a refresh candidate can preserve it", async () => {
    const response = await proxy(request("/%D1%81abinet?tab=payments"));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/cabinet");
    expect(location.search).toBe("?tab=payments");
  });

  it("canonicalizes an anonymous confusable link before applying the normal login boundary", async () => {
    const canonicalResponse = await proxy(anonymousRequest("/%D1%81abinet"));
    const canonicalLocation = new URL(canonicalResponse.headers.get("location")!);

    expect(canonicalResponse.status).toBe(307);
    expect(canonicalLocation.pathname).toBe("/cabinet");

    const loginResponse = await proxy(new NextRequest(canonicalLocation));
    const loginLocation = new URL(loginResponse.headers.get("location")!);
    expect(loginResponse.status).toBe(307);
    expect(loginLocation.pathname).toBe("/login");
    expect(loginLocation.searchParams.get("redirect_to")).toBe("/cabinet");
  });

  it("does not redirect a mutation from the confusable path", async () => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/%D1%81abinet",
      {
        method: "POST",
        headers: { cookie: `clean_pay_access=${signedAccessToken()}` },
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends a protected navigation through the cookie-capable refresh route", async () => {
    const response = await proxy(request("/cabinet?tab=payments"));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/auth/session/refresh");
    expect(location.searchParams.get("return_to")).toBe("/cabinet?tab=payments");
  });

  it("refreshes a session candidate before accepting a new invite attribution", async () => {
    const response = await proxy(request("/invite/Friend42"));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/auth/session/refresh");
    expect(location.searchParams.get("return_to")).toBe("/invite/Friend42");
  });

  it("sends an authenticated invite visitor to tariffs and deletes stale attribution", async () => {
    const authenticatedRequest = new NextRequest("https://pay.example.com/invite/Friend42", {
      headers: {
        cookie: `clean_pay_access=${signedAccessToken()}; clean_pay_referral=stale-signed-value`,
      },
    });

    const response = await proxy(authenticatedRequest);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/tariffs");
    expect(response.headers.get("set-cookie")).toMatch(/clean_pay_referral=;/);
    expect(response.headers.get("set-cookie")).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it.each(["login", "register"])(
    "preserves a safe redirect_to while validating %s session candidates",
    async (entry) => {
      const destination = "/payment?plan=pro&duration=30";
      const response = await proxy(request(
        `/${entry}?redirect_to=${encodeURIComponent(destination)}`,
      ));
      const location = new URL(response.headers.get("location")!);

      expect(location.pathname).toBe("/auth/session/refresh");
      expect(location.searchParams.get("return_to")).toBe(destination);
      expect(location.searchParams.get("fallback_to")).toBe(
        `/${entry}?redirect_to=${encodeURIComponent(destination)}`,
      );
    },
  );

  it("replaces an unsafe login redirect target with the cabinet", async () => {
    const response = await proxy(request("/login?redirect_to=%2F%2Fevil.example"));
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("return_to")).toBe("/cabinet");
    expect(location.searchParams.get("fallback_to")).toBe(
      "/login?redirect_to=%2Fcabinet",
    );
  });

  it("blocks cross-origin Telegram popup callbacks at the proxy boundary", async () => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/auth/telegram/callback",
      { method: "POST", headers: { origin: "https://evil.example" } },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it.each([
    [{}, "missing source"],
    [{ origin: "https://evil.example" }, "mismatched source"],
    [{
      origin: "https://evil.example",
      host: "pay.example.com",
      "x-forwarded-host": "pay.example.com",
    }, "forged forwarding metadata"],
  ])("blocks Server Actions with $1 metadata before dispatch", async (...[headers]) => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/login",
      {
        method: "POST",
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          "next-action": "synthetic-action-id",
          ...headers,
        },
        body: "[null]",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("accepts the trusted Referer when Origin is absent without trusting forwarded host", async () => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/login",
      {
        method: "POST",
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          "next-action": "synthetic-action-id",
          referer: "https://pay.example.com/login?redirect_to=%2Fcabinet",
          host: "attacker.example",
          "x-forwarded-host": "attacker.example",
        },
        body: "[null]",
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["text/plain;charset=UTF-8", true],
    ["application/x-www-form-urlencoded", false],
    ["multipart/form-data; boundary=synthetic", false],
  ])("accepts an exact-limit %s Server Action body", async (contentType, nextAction) => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/login",
      {
        method: "POST",
        headers: {
          "content-type": contentType,
          origin: "https://pay.example.com",
          ...(nextAction ? { "next-action": "synthetic-action-id" } : {}),
        },
        body: "x".repeat(64 * 1024),
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["text/plain;charset=UTF-8", true],
    ["application/x-www-form-urlencoded", false],
    ["multipart/form-data; boundary=synthetic", false],
  ])("returns a bounded 413 for an over-limit %s Server Action body", async (contentType, nextAction) => {
    const response = await proxy(new NextRequest(
      "https://pay.example.com/login",
      {
        method: "POST",
        headers: {
          "content-type": contentType,
          origin: "https://pay.example.com",
          ...(nextAction ? { "next-action": "synthetic-action-id" } : {}),
        },
        body: "x".repeat(64 * 1024 + 1),
      },
    ));

    expect(response.status).toBe(413);
    const payload = await response.json();
    expect(JSON.stringify(payload).length).toBeLessThan(256);
    expect(payload).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Размер запроса превышает допустимый предел.",
      },
    });
  });
});
