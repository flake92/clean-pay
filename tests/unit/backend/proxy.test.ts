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

function request(pathname: string, cookie?: string) {
  return new NextRequest(new Request(`https://pay.example.com${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  }));
}

describe("proxy auth redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["/cabinet", "/profile", "/tariffs", "/link-account"])(
    "redirects protected page %s to login without cookies",
    async (pathname) => {
      const response = await proxy(request(pathname));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://pay.example.com/login?redirect_to=${encodeURIComponent(pathname)}`);
    },
  );

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

  it("blocks API requests without cookies and clears stale session cookies on the response", async () => {
    const response = await proxy(request("/api/bff/auth/me"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect(response.cookies.get("clean_pay_access")?.value).toBe("");
    expect(response.cookies.get("clean_pay_refresh")?.value).toBe("");
  });
});
