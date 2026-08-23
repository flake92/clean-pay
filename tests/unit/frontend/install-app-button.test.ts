/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/frontend/components/ios-install-guide", () => ({
  IosInstallGuide: () =>
    createElement("div", { role: "dialog" }, "Инструкция iOS"),
}));
vi.mock("@/frontend/lib/telegram-webapp", () => ({
  loadTelegramWebAppScript: vi.fn(),
  openTelegramExternalLink: vi.fn(() => false),
  wasOpenedInTelegramWebApp: vi.fn(() => false),
}));

import { InstallAppButton } from "@/frontend/components/install-app-button";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("InstallAppButton", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let originalUserAgent: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalUserAgent = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "userAgent",
    );
    Object.defineProperty(Navigator.prototype, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container.remove();
    vi.unstubAllGlobals();
    if (originalUserAgent) {
      Object.defineProperty(
        Navigator.prototype,
        "userAgent",
        originalUserAgent,
      );
    }
  });

  it("keeps the iOS guide closed until the optional install button is clicked", async () => {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(InstallAppButton, {
          alwaysVisible: true,
          autoOpenIosGuide: false,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Установить приложение",
    );
    expect(button).toBeDefined();

    await act(async () => {
      button!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Инструкция iOS",
    );
  });

  it("hydrates the server button before detecting standalone display mode", async () => {
    vi.mocked(matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const browserWindow = window;
    vi.stubGlobal("window", undefined);
    const markup = renderToString(createElement(InstallAppButton, {
      alwaysVisible: true,
      autoOpenIosGuide: false,
    }));
    vi.stubGlobal("window", browserWindow);
    container.innerHTML = markup;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root = hydrateRoot(container, createElement(InstallAppButton, {
        alwaysVisible: true,
        autoOpenIosGuide: false,
      }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Clean Pay уже установлен");
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((part) => String(part).toLowerCase().includes("hydration")),
      ),
    ).toBe(false);
  });

  it("does not leave a stale cancellation message after dismissing the browser prompt", async () => {
    Object.defineProperty(Navigator.prototype, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0",
    });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installPrompt = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    });
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(InstallAppButton, {
          alwaysVisible: true,
          autoOpenIosGuide: false,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      window.dispatchEvent(installPrompt);
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Установка отменена");
  });

  it("reports a rejected browser install prompt and restores the install button", async () => {
    Object.defineProperty(Navigator.prototype, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0",
    });
    const prompt = vi.fn().mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"));
    const installPrompt = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    });
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(InstallAppButton, {
          alwaysVisible: false,
          autoOpenIosGuide: false,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      window.dispatchEvent(installPrompt);
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(button!.disabled).toBe(false);
    expect(container.textContent).toContain("Не удалось открыть системное окно установки");
  });
});
