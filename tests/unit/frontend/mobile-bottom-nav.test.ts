/** @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/tariffs" }));
vi.mock("@/app/actions/session", () => ({ logoutAction: vi.fn() }));
vi.mock("@/frontend/lib/chatwoot", () => ({ resetChatwootSession: vi.fn() }));

import MobileBottomNav from "@/frontend/layout/MobileBottomNav";

describe("mobile bottom navigation", () => {
  afterEach(() => cleanup());

  it("is absent for guests", () => {
    const { container } = render(createElement(MobileBottomNav, {
      navigation: { authenticated: false, emailVerificationRequired: false },
    }));
    expect(container.innerHTML).toBe("");
  });

  it("offers only menu destinations and marks the current page", () => {
    render(createElement(MobileBottomNav, {
      navigation: { authenticated: true, emailVerificationRequired: false },
    }));

    const nav = screen.getByRole("navigation", { name: "Быстрая навигация" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href")))
      .toEqual(["/cabinet", "/referral", "/tariffs", "/extend", "/profile"]);
    expect(screen.getByRole("link", { name: "Тарифы" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Кабинет" }).hasAttribute("aria-current")).toBe(false);
  });
});
