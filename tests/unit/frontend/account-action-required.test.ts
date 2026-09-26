/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replaceWith: vi.fn(),
}));

vi.mock("@/frontend/lib/browser-navigation", () => ({
  replaceWith: mocks.replaceWith,
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) =>
    createElement("div", { role: "alert" }, text),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({
    href,
    label,
  }: {
    href: string;
    label: string;
  }) => createElement("a", { href }, label),
}));

import { AccountActionRequired } from "@/frontend/components/account-action-required";

describe("account action continuation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("automatically opens guided e-mail setup with the payment selection", async () => {
    await act(async () => {
      root.render(
        createElement(AccountActionRequired, {
          action: "linkEmail",
          redirectTo: "/payment?plan=pro&duration=30&gateway=card",
        }),
      );
    });

    const expected =
      "/link-account?reason=email-required&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard";
    expect(mocks.replaceWith).toHaveBeenCalledWith(expected);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(expected);
    expect(container.textContent).toContain("e-mail и пароль");
  });

  it("validates an anonymous session candidate before login and preserves the destination", async () => {
    await act(async () => {
      root.render(
        createElement(AccountActionRequired, {
          action: "login",
          redirectTo: "/payment?plan=pro",
        }),
      );
    });

    expect(mocks.replaceWith).not.toHaveBeenCalled();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/auth/session/refresh?return_to=%2Fpayment%3Fplan%3Dpro",
    );
  });

  it("automatically opens cookie-capable provider recovery", async () => {
    await act(async () => {
      root.render(
        createElement(AccountActionRequired, {
          action: "recover-session",
          redirectTo: "/payment?plan=pro",
        }),
      );
    });

    const expected = "/auth/session/recover?return_to=%2Fpayment%3Fplan%3Dpro";
    expect(mocks.replaceWith).toHaveBeenCalledWith(expected);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(expected);
  });
});
