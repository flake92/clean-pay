/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTelegramWebAppScript: vi.fn(),
  openTelegramExternalLink: vi.fn(() => false),
  wasOpenedInTelegramWebApp: vi.fn(() => false),
}));

vi.mock("@/frontend/lib/telegram-webapp", () => ({
  loadTelegramWebAppScript: mocks.loadTelegramWebAppScript,
  openTelegramExternalLink: mocks.openTelegramExternalLink,
  wasOpenedInTelegramWebApp: mocks.wasOpenedInTelegramWebApp,
}));

import { useInstallAppController } from "@/frontend/hooks/use-install-app-controller";

type InstallOutcome = "accepted" | "dismissed";

const originalUserAgent = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "userAgent",
);
const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "maxTouchPoints",
);
const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

function setNavigatorPlatform(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(Navigator.prototype, "userAgent", {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints,
  });
}

function installPromptEvent({
  prompt,
  userChoice,
}: {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
}) {
  return Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    { prompt, userChoice },
  );
}

function restoreDescriptor(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

describe("install app controller characterization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setNavigatorPlatform(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0",
    );
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    Reflect.deleteProperty(navigator, "serviceWorker");
    window.history.replaceState(null, "", "/");
    mocks.loadTelegramWebAppScript.mockResolvedValue(undefined);
    mocks.openTelegramExternalLink.mockReturnValue(false);
    mocks.wasOpenedInTelegramWebApp.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    restoreDescriptor(Navigator.prototype, "userAgent", originalUserAgent);
    restoreDescriptor(
      Navigator.prototype,
      "maxTouchPoints",
      originalMaxTouchPoints,
    );
    restoreDescriptor(navigator, "serviceWorker", originalServiceWorker);
    window.history.replaceState(null, "", "/");
  });

  it("continues to lose a prompt dispatched before the mount effect subscribes", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const earlyPrompt = installPromptEvent({
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });

    window.dispatchEvent(earlyPrompt);
    expect(earlyPrompt.defaultPrevented).toBe(false);

    const view = renderHook(() => useInstallAppController({
      autoOpenIosGuide: false,
    }));
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(view.result.current.installEvent).toBeNull();

    await act(async () => view.result.current.install());
    expect(prompt).not.toHaveBeenCalled();
    expect(view.result.current.message).toBe(
      "Если системное окно установки не появилось, откройте меню браузера и выберите «Установить приложение».",
    );
  });

  it("preserves the platform query and embedded Android branches", async () => {
    window.history.replaceState(null, "", "/install?platform=ios");
    const queryView = renderHook(() => useInstallAppController({
      autoOpenIosGuide: true,
    }));
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(queryView.result.current.mobilePlatform).toBe("other");
    expect(queryView.result.current.showIosGuide).toBe(true);
    queryView.unmount();

    window.history.replaceState(null, "", "/");
    setNavigatorPlatform(
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0",
    );
    mocks.wasOpenedInTelegramWebApp.mockReturnValue(true);
    const embeddedView = renderHook(() => useInstallAppController({
      autoOpenIosGuide: false,
    }));
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(embeddedView.result.current.mobilePlatform).toBe("android");
    expect(embeddedView.result.current.embeddedBrowser).toBe(true);
    expect(mocks.loadTelegramWebAppScript).toHaveBeenCalledOnce();

    await act(async () => embeddedView.result.current.install());
    expect(mocks.openTelegramExternalLink).toHaveBeenCalledWith(
      `${window.location.origin}/install?source=telegram&platform=android`,
    );
    expect(embeddedView.result.current.showEmbeddedGuide).toBe(true);
  });

  it.each<InstallOutcome>(["accepted", "dismissed"])(
    "keeps prompt then userChoice ordering for a %s outcome",
    async (outcome) => {
      const order: string[] = [];
      let resolveChoice!: (choice: { outcome: InstallOutcome }) => void;
      const userChoice = new Promise<{ outcome: InstallOutcome }>((resolve) => {
        resolveChoice = resolve;
      }).then((choice) => {
        order.push("choice");
        return choice;
      });
      const prompt = vi.fn(async () => {
        order.push("prompt");
      });
      const promptEvent = installPromptEvent({ prompt, userChoice });
      const view = renderHook(() => useInstallAppController({
        autoOpenIosGuide: false,
      }));

      act(() => window.dispatchEvent(promptEvent));
      expect(promptEvent.defaultPrevented).toBe(true);
      let completion!: Promise<void>;
      act(() => {
        completion = view.result.current.install();
      });
      await Promise.resolve();
      expect(order).toEqual(["prompt"]);
      expect(view.result.current.installPending).toBe(true);

      await act(async () => {
        resolveChoice({ outcome });
        await completion;
      });
      expect(order).toEqual(["prompt", "choice"]);
      expect(prompt).toHaveBeenCalledOnce();
      expect(view.result.current.installEvent).toBeNull();
      expect(view.result.current.installPending).toBe(false);
      expect(view.result.current.message).toBeNull();
    },
  );

  it("preserves prompt failure copy and restores the pending fence", async () => {
    const prompt = vi.fn().mockRejectedValue(
      new DOMException("Not allowed", "NotAllowedError"),
    );
    const promptEvent = installPromptEvent({
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    const view = renderHook(() => useInstallAppController({
      autoOpenIosGuide: false,
    }));
    act(() => window.dispatchEvent(promptEvent));

    await act(async () => view.result.current.install());

    expect(prompt).toHaveBeenCalledOnce();
    expect(view.result.current.installEvent).toBeNull();
    expect(view.result.current.installPending).toBe(false);
    expect(view.result.current.message).toBe(
      "Не удалось открыть системное окно установки. Попробуйте ещё раз через меню браузера.",
    );
  });

  it("appinstalled clears a captured prompt and switches to installed", () => {
    const promptEvent = installPromptEvent({
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    const view = renderHook(() => useInstallAppController({
      autoOpenIosGuide: false,
    }));

    act(() => window.dispatchEvent(promptEvent));
    expect(view.result.current.installEvent).toBe(promptEvent);
    act(() => window.dispatchEvent(new Event("appinstalled")));

    expect(view.result.current.installEvent).toBeNull();
    expect(view.result.current.installed).toBe(true);
    expect(view.result.current.message).toBeNull();
  });

  it("registers and updates the service worker after listeners, then cleans up", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const update = vi.fn().mockResolvedValue(undefined);
    const register = vi.fn().mockResolvedValue({ update });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    const view = renderHook(() => useInstallAppController({
      autoOpenIosGuide: false,
    }));

    await act(async () => Promise.resolve());
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    expect(update).toHaveBeenCalledOnce();
    const beforePromptIndex = addEventListener.mock.calls.findIndex(
      ([eventName]) => eventName === "beforeinstallprompt",
    );
    const installedIndex = addEventListener.mock.calls.findIndex(
      ([eventName]) => eventName === "appinstalled",
    );
    expect(addEventListener.mock.invocationCallOrder[beforePromptIndex])
      .toBeLessThan(addEventListener.mock.invocationCallOrder[installedIndex]!);
    expect(addEventListener.mock.invocationCallOrder[installedIndex])
      .toBeLessThan(register.mock.invocationCallOrder[0]!);
    expect(register.mock.invocationCallOrder[0])
      .toBeLessThan(update.mock.invocationCallOrder[0]!);

    view.unmount();
    const beforePromptRemoval = removeEventListener.mock.calls.findIndex(
      ([eventName]) => eventName === "beforeinstallprompt",
    );
    const installedRemoval = removeEventListener.mock.calls.findIndex(
      ([eventName]) => eventName === "appinstalled",
    );
    expect(clearTimeout.mock.invocationCallOrder[0])
      .toBeLessThan(removeEventListener.mock.invocationCallOrder[beforePromptRemoval]!);
    expect(removeEventListener.mock.invocationCallOrder[beforePromptRemoval])
      .toBeLessThan(removeEventListener.mock.invocationCallOrder[installedRemoval]!);

    const latePrompt = installPromptEvent({
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(latePrompt);
    expect(latePrompt.defaultPrevented).toBe(false);
  });
});
