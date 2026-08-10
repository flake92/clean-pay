/** @vitest-environment jsdom */

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutState } from "@/frontend/types";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  onMenuToggle: vi.fn(),
  showProfileSidebar: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const imageProps = { ...props };
    delete imageProps.unoptimized;
    return createElement("img", imageProps);
  },
}));
vi.mock("next/link", () => ({
  default: (props: { children?: ReactNode; prefetch?: boolean }) => {
    const linkProps = { ...props };
    const children = linkProps.children;
    delete linkProps.children;
    delete linkProps.prefetch;
    return createElement("a", linkProps, children);
  },
}));
vi.mock("@/frontend/layout/useCleanPayMenu", () => ({
  useCleanPayMenu: () => ({
    flatItems: [
      { label: "Кабинет", icon: "pi pi-home", to: "/cabinet" },
      { label: "Выйти", icon: "pi pi-sign-out", command: mocks.command },
    ],
  }),
}));

import AppTopbar from "@/frontend/layout/AppTopbar";
import { LayoutContext } from "@/frontend/layout/context/layoutcontext";

const navigation = {
  authenticated: true,
  canRenewSubscription: true,
  emailVerificationRequired: false,
  hasSubscription: true,
};

const collapsedState: LayoutState = {
  staticMenuDesktopInactive: true,
  overlayMenuActive: false,
  profileSidebarVisible: false,
  staticMenuMobileActive: false,
  menuHoverActive: false,
};

function renderTopbar(layoutState: LayoutState) {
  return render(createElement(
    LayoutContext.Provider,
    {
      value: {
        layoutState,
        setLayoutState: vi.fn(),
        onMenuToggle: mocks.onMenuToggle,
        showProfileSidebar: mocks.showProfileSidebar,
      },
    },
    createElement(AppTopbar, { navigation }),
  ));
}

describe("AppTopbar accessibility", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("names icon-only controls and exposes their controlled expanded state", () => {
    const view = renderTopbar(collapsedState);
    const menuButton = screen.getByRole("button", { name: "Главное меню" });
    const profileButton = screen.getByRole("button", { name: "Меню профиля" });

    expect(menuButton.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    expect(profileButton.getAttribute("aria-controls")).toBe("app-topbar-menu");
    expect(profileButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("#app-topbar-menu")).not.toBeNull();

    fireEvent.click(menuButton);
    fireEvent.click(profileButton);
    expect(mocks.onMenuToggle).toHaveBeenCalledOnce();
    expect(mocks.showProfileSidebar).toHaveBeenCalledOnce();

    view.rerender(createElement(
      LayoutContext.Provider,
      {
        value: {
          layoutState: {
            ...collapsedState,
            profileSidebarVisible: true,
            staticMenuMobileActive: true,
          },
          setLayoutState: vi.fn(),
          onMenuToggle: mocks.onMenuToggle,
          showProfileSidebar: mocks.showProfileSidebar,
        },
      },
      createElement(AppTopbar, { navigation }),
    ));

    expect(screen.getByRole("button", { name: "Главное меню" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Меню профиля" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps labelled navigation and command items keyboard-accessible", () => {
    renderTopbar(collapsedState);

    expect(screen.getByRole("link", { name: "Кабинет" }).getAttribute("href")).toBe("/cabinet");
    fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
    expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({ label: "Выйти" }),
      originalEvent: expect.any(Object),
    }));
  });
});
