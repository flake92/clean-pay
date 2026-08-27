/** @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/frontend/components/ios-install-guide", () => ({
  IosInstallGuide: () => createElement("div", null, "Инструкция iOS"),
}));
vi.mock("@/frontend/lib/telegram-webapp", () => ({
  loadTelegramWebAppScript: vi.fn(),
  openTelegramExternalLink: vi.fn(() => false),
  wasOpenedInTelegramWebApp: vi.fn(() => false),
}));

import { InstallAppButton } from "@/frontend/components/install-app-button";

describe("InstallAppButton early prompt characterization", () => {
  beforeEach(() => {
    Object.defineProperty(Navigator.prototype, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0",
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "serviceWorker");
    vi.unstubAllGlobals();
  });

  it("continues to miss beforeinstallprompt events fired before the effect subscribes", async () => {
    const prompt = vi.fn();
    const earlyPrompt = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" as const }),
      },
    );

    window.dispatchEvent(earlyPrompt);
    expect(earlyPrompt.defaultPrevented).toBe(false);

    const view = render(createElement(InstallAppButton, {
      alwaysVisible: false,
      autoOpenIosGuide: false,
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(view.queryByRole("button")).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("keeps the exact service-worker URL, scope and update policy", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const register = vi.fn().mockResolvedValue({ update });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(createElement(InstallAppButton, {
      alwaysVisible: true,
      autoOpenIosGuide: false,
    }));

    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
  });
});
