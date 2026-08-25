import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  clearWebSession: vi.fn(),
}));

vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({ publicAppUrl: "https://pay.example.com" }),
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.authorize,
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  clearWebSession: mocks.clearWebSession,
}));

import { GET } from "@/app/auth/session/recover/route";
import { ServiceError } from "@/backend/errors/service-error";

function request(returnTo = "/cabinet") {
  return new Request(
    `https://pay.example.com/auth/session/recover?return_to=${encodeURIComponent(returnTo)}`,
  );
}

function location(response: Response) {
  const value = response.headers.get("location");
  expect(value).not.toBeNull();
  return new URL(value!);
}

describe("provider session recovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
      session: { id: "session-1" },
    });
    mocks.clearWebSession.mockResolvedValue(undefined);
  });

  it("recovers the mutable provider session and resumes a safe target", async () => {
    const response = await GET(request("/cabinet?tab=payments"));

    expect(mocks.authorize).toHaveBeenCalledWith({
      allowUnverifiedEmail: true,
      forceRefresh: true,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/cabinet?tab=payments",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.clearWebSession).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/auth/session/recover?return_to=%2Fprofile",
    "/login",
  ])("rejects unsafe or recursive return target %s", async (returnTo) => {
    const response = await GET(request(returnTo));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/cabinet",
    );
  });

  it.each(["UNAUTHORIZED", "AUTH_FAILED"] as const)(
    "clears both credential candidates and redirects %s to login",
    async (code) => {
      mocks.authorize.mockRejectedValueOnce(new ServiceError(code, 401));

      const response = await GET(request("/payment?plan=pro"));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://pay.example.com/login?redirect_to=%2Fpayment%3Fplan%3Dpro",
      );
      expect(mocks.clearWebSession).toHaveBeenCalledOnce();
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("clean_pay_access=");
      expect(setCookie).toContain("clean_pay_refresh=");
    },
  );

  it("still removes browser credentials when terminal revocation fails", async () => {
    mocks.authorize.mockRejectedValueOnce(
      new ServiceError("UNAUTHORIZED", 401),
    );
    mocks.clearWebSession.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await GET(request("/profile"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/login?redirect_to=%2Fprofile",
    );
    expect(response.headers.get("set-cookie")).toContain("clean_pay_access=");
    expect(response.headers.get("set-cookie")).toContain("clean_pay_refresh=");
  });

  it.each([
    "UPSTREAM_UNAVAILABLE",
    "UPSTREAM_ERROR",
    "INTERNAL_ERROR",
    "CONFLICT",
  ] as const)("preserves credentials on transient %s", async (code) => {
    mocks.authorize.mockRejectedValueOnce(
      new ServiceError(code, code === "CONFLICT" ? 409 : 503, undefined, {
        retryAfterSeconds: 2.2,
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3");
    expect(mocks.clearWebSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code,
        message: "Provider session recovery is temporarily unavailable.",
      },
    });
  });

  it("returns 429 for rate limiting without clearing the session", async () => {
    mocks.authorize.mockRejectedValueOnce(
      new ServiceError("RATE_LIMITED", 429, undefined, {
        retryAfterSeconds: 17,
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.clearWebSession).not.toHaveBeenCalled();
  });

  it.each([
    ["PASSKEY_REQUIRED", "/passkey/setup", null, null],
    ["EMAIL_REQUIRED", "/link-account", "reason", "email-required"],
    ["EMAIL_NOT_VERIFIED", "/verify-email", "flow", "telegram-email"],
  ] as const)("routes %s into its guided recovery flow", async (
    code,
    pathname,
    marker,
    markerValue,
  ) => {
    mocks.authorize.mockRejectedValueOnce(new ServiceError(code, 403));

    const response = await GET(request("/payment?plan=pro"));
    const target = location(response);

    expect(response.status).toBe(303);
    expect(target.pathname).toBe(pathname);
    expect(target.searchParams.get("redirect_to")).toBe("/payment?plan=pro");
    if (marker) expect(target.searchParams.get(marker)).toBe(markerValue);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.clearWebSession).not.toHaveBeenCalled();
  });

  it.each([
    ["ACCOUNT_MERGE_REQUIRED", "telegram_merge_required"],
    [
      "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
      "telegram_merge_subscriptions",
    ],
  ] as const)("routes %s to linked-account conflict handling", async (
    code,
    authStatus,
  ) => {
    mocks.authorize.mockRejectedValueOnce(new ServiceError(code, 409));

    const response = await GET(request("/cabinet"));
    const target = location(response);

    expect(response.status).toBe(303);
    expect(target.pathname).toBe("/link-account");
    expect(target.searchParams.get("reason")).toBe("email-required");
    expect(target.searchParams.get("redirect_to")).toBe("/cabinet");
    expect(target.searchParams.get("auth")).toBe(authStatus);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.clearWebSession).not.toHaveBeenCalled();
  });

  it("treats an unknown exception as transient evidence", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("retry-after")).toBe("1");
    expect(mocks.clearWebSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
