import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/app/_composition/request-scoped-readers", () => ({
  requestAuthProfileGateway: { loadCurrentSession: vi.fn() },
}));

import { requestSessionRequiresPasskey } from "@/app/_composition/require-request-session";

describe("Passkey setup session requirement", () => {
  it("requires setup only for a bootstrap session", () => {
    expect(requestSessionRequiresPasskey({
      context: { assuranceLevel: "BOOTSTRAP" },
    })).toBe(true);
    expect(requestSessionRequiresPasskey({
      context: { assuranceLevel: "FULL" },
    })).toBe(false);
    expect(requestSessionRequiresPasskey({ context: null })).toBe(false);
  });
});
