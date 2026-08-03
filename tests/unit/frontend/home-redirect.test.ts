import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import Home from "@/app/page";

describe("home page", () => {
  it("continues an authenticated root navigation in the cabinet", () => {
    Home();

    expect(mocks.redirect).toHaveBeenCalledWith("/cabinet");
  });
});
