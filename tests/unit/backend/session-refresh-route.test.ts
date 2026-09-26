import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
}));

vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({ publicAppUrl: "https://pay.example.com" }),
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { GET } from "@/app/auth/session/refresh/route";

describe("session refresh route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes a safe navigation after the refresh cookie was rotated", async () => {
    mocks.getCurrentSession.mockResolvedValue({ id: "session-1" });

    const response = await GET(new Request(
      "https://pay.example.com/auth/session/refresh?return_to=%2Fcabinet%3Ftab%3Dpayments",
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/cabinet?tab=payments",
    );
  });

  it("falls back to the cabinet instead of resuming a nonexistent page", async () => {
    mocks.getCurrentSession.mockResolvedValue({ id: "session-1" });

    const response = await GET(new Request(
      "https://pay.example.com/auth/session/refresh?return_to=%2Fmissing",
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/cabinet",
    );
  });

  it("preserves cookie candidates and opens the recovery UI on browser infrastructure failure", async () => {
    mocks.getCurrentSession.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(new Request(
      "https://pay.example.com/auth/session/refresh?return_to=https%3A%2F%2Fevil.example",
    ));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/auth/session/recovery");
    expect(location.searchParams.get("return_to")).toBe("/cabinet");
    expect(location.searchParams.get("retry_after")).toBe("1");
    expect(location.searchParams.get("attempt")).toBe("0");
    expect(location.searchParams.get("kind")).toBe("session");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("preserves a validated registration fallback across a transient recovery step", async () => {
    mocks.getCurrentSession.mockRejectedValueOnce(new Error("database unavailable"));
    const fallback = "/register?redirect_to=%2Fpayment%3Fplan%3Dpro";
    const firstResponse = await GET(new Request(
      `https://pay.example.com/auth/session/refresh?return_to=%2Fpayment%3Fplan%3Dpro&fallback_to=${encodeURIComponent(fallback)}`,
    ));
    const recoveryLocation = new URL(firstResponse.headers.get("location")!);

    expect(recoveryLocation.pathname).toBe("/auth/session/recovery");
    expect(recoveryLocation.searchParams.get("fallback_to")).toBe(fallback);

    mocks.getCurrentSession.mockResolvedValueOnce(null);
    const retryParams = new URLSearchParams({
      return_to: recoveryLocation.searchParams.get("return_to")!,
      fallback_to: recoveryLocation.searchParams.get("fallback_to")!,
      attempt: "1",
    });
    const retryResponse = await GET(new Request(
      `https://pay.example.com/auth/session/refresh?${retryParams.toString()}`,
    ));

    expect(retryResponse.headers.get("location")).toBe(
      "https://pay.example.com/register?redirect_to=%2Fpayment%3Fplan%3Dpro",
    );
  });

  it("keeps structured refresh errors only for explicit JSON clients", async () => {
    mocks.getCurrentSession.mockRejectedValue(new Error("database unavailable"));
    const request = new Request(
      "https://pay.example.com/auth/session/refresh?return_to=%2Fprofile",
      { headers: { accept: "application/json" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SESSION_REFRESH_UNAVAILABLE",
        message: "Session refresh is temporarily unavailable.",
      },
    });
  });

  it.each(["login", "register"])(
    "returns to %s with a safe redirect_to when the refresh candidate is rejected",
    async (entry) => {
      mocks.getCurrentSession.mockResolvedValue(null);
      const fallback = `/${entry}?redirect_to=${encodeURIComponent("/payment?plan=pro")}`;
      const response = await GET(new Request(
        `https://pay.example.com/auth/session/refresh?return_to=${encodeURIComponent("/payment?plan=pro")}&fallback_to=${encodeURIComponent(fallback)}`,
      ));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        `https://pay.example.com/${entry}?redirect_to=%2Fpayment%3Fplan%3Dpro`,
      );
      expect(response.headers.get("set-cookie")).toContain("clean_pay_access=");
      expect(response.headers.get("set-cookie")).toContain("clean_pay_refresh=");
    },
  );

  it("rejects a forged auth fallback", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);

    const response = await GET(new Request(
      "https://pay.example.com/auth/session/refresh?return_to=%2Fprofile&fallback_to=%2F%2Fevil.example%2Flogin",
    ));

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/login?redirect_to=%2Fprofile",
    );
  });
});
