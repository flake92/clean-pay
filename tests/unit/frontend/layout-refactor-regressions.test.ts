/** @vitest-environment jsdom */

import { createElement, useContext } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LayoutContext, LayoutProvider } from "@/frontend/layout/context/layoutcontext";

function LayoutStateProbe() {
  const {
    layoutState,
    onMenuToggle,
    showProfileSidebar,
  } = useContext(LayoutContext);

  return createElement(
    "div",
    null,
    createElement("output", {
      "data-desktop-collapsed": layoutState.staticMenuDesktopInactive,
      "data-mobile-open": layoutState.staticMenuMobileActive,
      "data-profile-open": layoutState.profileSidebarVisible,
    }),
    createElement("button", { onClick: onMenuToggle, type: "button" }, "toggle menu"),
    createElement(
      "button",
      { onClick: showProfileSidebar, type: "button" },
      "toggle profile",
    ),
  );
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("layout refactor regressions", () => {
  beforeEach(() => setViewportWidth(1_280));
  afterEach(() => cleanup());

  it("keeps desktop, mobile and profile controls in independent state slots", () => {
    render(createElement(LayoutProvider, null, createElement(LayoutStateProbe)));
    const state = screen.getByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "toggle menu" }));
    expect(state.getAttribute("data-desktop-collapsed")).toBe("true");
    expect(state.getAttribute("data-mobile-open")).toBe("false");

    setViewportWidth(640);
    fireEvent.click(screen.getByRole("button", { name: "toggle menu" }));
    expect(state.getAttribute("data-desktop-collapsed")).toBe("true");
    expect(state.getAttribute("data-mobile-open")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "toggle profile" }));
    expect(state.getAttribute("data-profile-open")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "toggle menu" }));
    expect(state.getAttribute("data-mobile-open")).toBe("false");
    expect(state.getAttribute("data-desktop-collapsed")).toBe("true");
    expect(state.getAttribute("data-profile-open")).toBe("true");
  });
});
