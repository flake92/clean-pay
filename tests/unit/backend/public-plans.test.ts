import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopRequest: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopRequest: mocks.remnashopRequest,
}));

import { getPublicPlans } from "@/backend/plans/public-plans";

describe("public plans protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates concurrent requests into one upstream request", async () => {
    mocks.remnashopRequest.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ plans: [] }), 5)),
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, () => getPublicPlans()),
    );

    expect(results).toEqual(Array.from({ length: 20 }, () => ({ plans: [] })));
    expect(mocks.remnashopRequest).toHaveBeenCalledOnce();
  });

  it("fetches fresh plans after the concurrent request settles", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ id: "first" }] })
      .mockResolvedValueOnce({ plans: [{ id: "fresh" }] });

    await expect(getPublicPlans()).resolves.toEqual({ plans: [{ id: "first" }] });
    await expect(getPublicPlans()).resolves.toEqual({ plans: [{ id: "fresh" }] });
    expect(mocks.remnashopRequest).toHaveBeenCalledTimes(2);
  });

  it("clears a rejected request so the next call can retry", async () => {
    mocks.remnashopRequest
      .mockRejectedValueOnce(new Error("upstream unavailable"))
      .mockResolvedValueOnce({ plans: [{ id: "live" }] });

    await expect(getPublicPlans()).rejects.toThrow("upstream unavailable");
    await expect(getPublicPlans()).resolves.toEqual({ plans: [{ id: "live" }] });
    expect(mocks.remnashopRequest).toHaveBeenCalledTimes(2);
  });
});
