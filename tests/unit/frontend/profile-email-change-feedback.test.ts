/** @vitest-environment jsdom */

import { act, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changeEmail: vi.fn(),
  navigateTo: vi.fn(),
  scrollIntoView: vi.fn(),
}));

vi.mock("@/app/actions/profile", () => ({
  changeProfileEmailAction: mocks.changeEmail,
  changeProfilePasswordAction: vi.fn(),
  requestProfileEmailVerificationAction: vi.fn(),
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({ navigateTo: mocks.navigateTo }));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: () => true,
  TurnstileWidget: () => null,
}));
vi.mock("@/frontend/components/prime/link-button", () => ({ LinkButton: () => null }));
vi.mock("primereact/card", () => ({
  Card: ({ children, title }: { children?: ReactNode; title?: string }) =>
    createElement("section", { "data-title": title }, children),
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ severity, text }: { severity?: string; text?: string }) =>
    createElement("div", { role: "alert", "data-severity": severity }, text),
}));
vi.mock("primereact/button", () => ({
  Button: (props: { label?: string; type?: "button" | "submit" }) =>
    createElement("button", { type: props.type ?? "button" }, props.label),
}));
vi.mock("primereact/password", () => ({ Password: () => createElement("input") }));
vi.mock("primereact/tag", () => ({ Tag: () => null }));

import { ProfilePanel } from "@/frontend/components/profile-panel";

describe("profile e-mail change feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.changeEmail.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Не удалось изменить e-mail.",
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: mocks.scrollIntoView,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a failed change next to the e-mail form and brings it into view", async () => {
    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user: {
            authType: "email",
            email: "old@example.com",
            emailVerified: true,
            pendingEmail: null,
            telegramId: "777",
          },
        },
      }));
    });

    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(emailInput, "new@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(mocks.changeEmail).toHaveBeenCalledWith({ email: "new@example.com" });
    expect(alert?.closest("form")).toBe(container.querySelector("form"));
    expect(alert?.getAttribute("data-severity")).toBe("error");
    expect(alert?.textContent).toBe("Не удалось изменить e-mail.");
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });
});
