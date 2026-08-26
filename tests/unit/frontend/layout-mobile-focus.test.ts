/** @vitest-environment jsdom */

import {
  createElement,
  forwardRef,
  useImperativeHandle,
  useRef,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppTopbarRef, LayoutState } from "@/frontend/types";

const mocks = vi.hoisted(() => ({
  setLayoutState: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/cabinet" }));
vi.mock("primereact/hooks", () => ({
  useEventListener: () => [vi.fn(), vi.fn()],
}));
vi.mock("primereact/utils", () => ({
  classNames: (base: string) => base,
}));
vi.mock("@/frontend/layout/AppTopbar", () => ({
  default: forwardRef<AppTopbarRef>(function MockAppTopbar(_props, ref) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    useImperativeHandle(ref, () => ({ menubutton: buttonRef.current }));
    return createElement(
      "header",
      null,
      createElement("button", { ref: buttonRef, type: "button" }, "Главное меню"),
    );
  }),
}));
vi.mock("@/frontend/layout/AppMenu", () => ({
  default: () => createElement(
    "ul",
    null,
    createElement("li", null, createElement("a", { href: "/cabinet" }, "Кабинет")),
    createElement("li", null, createElement("button", { type: "button" }, "Выйти")),
  ),
}));
vi.mock("@/frontend/layout/AppFooter", () => ({
  default: () => createElement("footer", null, "footer"),
}));

import Layout from "@/frontend/layout/layout";
import { LayoutContext } from "@/frontend/layout/context/layoutcontext";

const LayoutElement = Layout as ComponentType<
  Omit<ComponentProps<typeof Layout>, "children"> & { children?: ReactNode }
>;

const mobileOpenState: LayoutState = {
  profileSidebarVisible: false,
  staticMenuDesktopInactive: false,
  staticMenuMobileActive: true,
};

describe("mobile layout focus management", () => {
  afterEach(() => {
    cleanup();
    document.body.classList.remove("blocked-scroll");
    vi.clearAllMocks();
  });

  it("traps Tab in the drawer and restores the trigger on Escape", () => {
    render(createElement(
      LayoutContext.Provider,
      {
        value: {
          layoutState: mobileOpenState,
          onMenuToggle: vi.fn(),
          setLayoutState: mocks.setLayoutState,
          showProfileSidebar: vi.fn(),
        },
      },
      createElement(
        LayoutElement,
        { navigation: { authenticated: true, emailVerificationRequired: false } },
        createElement("h1", null, "Кабинет"),
      ),
    ));

    const trigger = screen.getByRole("button", { name: "Главное меню" });
    const firstLink = screen.getByRole("link", { name: "Кабинет" });
    const lastButton = screen.getByRole("button", { name: "Выйти" });
    expect(screen.getByRole("navigation", { name: "Основная навигация" }))
      .toBeTruthy();

    trigger.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(firstLink);

    lastButton.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(trigger);

    mocks.setLayoutState.mockClear();
    lastButton.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    const update = mocks.setLayoutState.mock.calls[0]?.[0] as
      | ((state: LayoutState) => LayoutState)
      | undefined;
    expect(update?.(mobileOpenState).staticMenuMobileActive).toBe(false);
  });

  it("releases the mobile focus trap after resizing to desktop", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 480,
    });

    render(createElement(
      LayoutContext.Provider,
      {
        value: {
          layoutState: mobileOpenState,
          onMenuToggle: vi.fn(),
          setLayoutState: mocks.setLayoutState,
          showProfileSidebar: vi.fn(),
        },
      },
      createElement(
        LayoutElement,
        { navigation: { authenticated: true, emailVerificationRequired: false } },
        createElement("h1", null, "Кабинет"),
      ),
    ));

    mocks.setLayoutState.mockClear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1_200,
    });
    fireEvent(window, new Event("resize"));

    const update = mocks.setLayoutState.mock.calls[0]?.[0] as
      | ((state: LayoutState) => LayoutState)
      | undefined;
    expect(update?.(mobileOpenState).staticMenuMobileActive).toBe(false);

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
  });
});
