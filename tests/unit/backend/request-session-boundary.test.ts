import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCurrentSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/app/_composition/request-scoped-readers", () => ({
  requestAuthProfileGateway: {
    loadCurrentSession: mocks.loadCurrentSession,
  },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requireRequestSession } from "@/app/_composition/require-request-session";

describe("database-backed protected setup boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a current database session on the protected setup page", async () => {
    const session = { id: "session-1" };
    mocks.loadCurrentSession.mockResolvedValueOnce(session);

    await expect(requireRequestSession("/passkey/setup?redirect_to=%2Fpayment"))
      .resolves.toBe(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends a stale signed access cookie through the cookie-capable refresh boundary", async () => {
    mocks.loadCurrentSession.mockResolvedValueOnce(null);
    mocks.redirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireRequestSession(
      "/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro",
    )).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth/session/refresh?return_to=%2Fregister%2Fverify-email%3Fredirect_to%3D%252Fpayment%253Fplan%253Dpro",
    );
  });

  it("does not turn a database outage into a false logout", async () => {
    mocks.loadCurrentSession.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(requireRequestSession("/passkey/setup"))
      .rejects.toThrow("database unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
