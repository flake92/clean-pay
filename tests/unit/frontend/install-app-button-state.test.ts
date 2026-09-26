import { describe, expect, it } from "vitest";

import {
  embeddedInstallPageUrl,
  failedInstallPromptMessage,
  missingInstallPromptMessage,
  selectEmbeddedInstallBrowser,
  selectInstallMobilePlatform,
  shouldAutoOpenIosInstallGuide,
} from "@/frontend/components/install-app-button-state";

describe("install app pure presentation state", () => {
  it("preserves iOS, Android and other platform precedence", () => {
    expect(selectInstallMobilePlatform(true, true)).toBe("ios");
    expect(selectInstallMobilePlatform(false, true)).toBe("android");
    expect(selectInstallMobilePlatform(false, false)).toBe("other");
  });

  it("preserves Telegram and embedded user-agent detection", () => {
    expect(selectEmbeddedInstallBrowser(true, "Mozilla Chrome")).toBe(true);
    expect(selectEmbeddedInstallBrowser(false, "Telegram WebView")).toBe(true);
    expect(selectEmbeddedInstallBrowser(false, "Mozilla Chrome")).toBe(false);
  });

  it("opens the automatic iOS guide only for the established branches", () => {
    const base = {
      autoOpenIosGuide: true,
      embeddedBrowser: false,
      iosDevice: false,
      requestedPlatform: "ios",
      standalone: false,
    };
    expect(shouldAutoOpenIosInstallGuide(base)).toBe(true);
    expect(shouldAutoOpenIosInstallGuide({ ...base, iosDevice: true, requestedPlatform: null }))
      .toBe(true);
    expect(shouldAutoOpenIosInstallGuide({ ...base, autoOpenIosGuide: false }))
      .toBe(false);
    expect(shouldAutoOpenIosInstallGuide({ ...base, embeddedBrowser: true }))
      .toBe(false);
    expect(shouldAutoOpenIosInstallGuide({ ...base, standalone: true }))
      .toBe(false);
    expect(shouldAutoOpenIosInstallGuide({ ...base, requestedPlatform: "android" }))
      .toBe(false);
  });

  it("preserves the external-install query order and exact fallback copy", () => {
    expect(embeddedInstallPageUrl("https://pay.example", "android")).toBe(
      "https://pay.example/install?source=telegram&platform=android",
    );
    expect(missingInstallPromptMessage()).toBe(
      "Если системное окно установки не появилось, откройте меню браузера и выберите «Установить приложение».",
    );
    expect(failedInstallPromptMessage()).toBe(
      "Не удалось открыть системное окно установки. Попробуйте ещё раз через меню браузера.",
    );
  });
});
