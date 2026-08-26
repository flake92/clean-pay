import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearReferralAttributionCookie: vi.fn(),
  endCabinetSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/application/cabinet/execute-command", () => ({
  clearCabinetSession: vi.fn(),
  endCabinetSession: mocks.endCabinetSession,
}));
vi.mock("@/app/_composition/session-gateways", () => ({
  productionCabinetCommands: { adapter: "cabinet" },
}));
vi.mock("@/backend/integrations/referral/referral-attribution", () => ({
  clearReferralAttributionCookie: mocks.clearReferralAttributionCookie,
}));

import { logoutAction } from "@/app/actions/session";

describe("referral attribution on logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.endCabinetSession.mockResolvedValue(undefined);
    mocks.clearReferralAttributionCookie.mockResolvedValue(undefined);
  });

  it("clears stale attribution after ending the current session", async () => {
    await logoutAction();

    expect(mocks.endCabinetSession).toHaveBeenCalledWith({ adapter: "cabinet" });
    expect(mocks.clearReferralAttributionCookie).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.endCabinetSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearReferralAttributionCookie.mock.invocationCallOrder[0],
    );
  });
});
