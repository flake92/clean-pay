import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("proxy session refresh navigation", () => {
  const previousSecret = process.env.WEB_JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEB_JWT_SECRET = "test-secret";
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.WEB_JWT_SECRET;
    else process.env.WEB_JWT_SECRET = previousSecret;
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

  it("sends a protected navigation through the cookie-capable refresh route", async () => {
    const response = await proxy(request("/cabinet?tab=payments"));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/auth/session/refresh");
    expect(location.searchParams.get("return_to")).toBe("/cabinet?tab=payments");
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
});
