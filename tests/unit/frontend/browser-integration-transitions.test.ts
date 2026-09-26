/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import * as installButtonFacade from "@/frontend/components/install-app-button";
import * as telegramLoginFacade from "@/frontend/components/telegram-webapp-login";
import * as turnstileFacade from "@/frontend/components/turnstile-widget";
import {
  androidInstallBrowserName,
  isAndroidPlatform,
  isAppleMobilePlatform,
  isEmbeddedMobileUserAgent,
  isStandaloneInstallMode,
} from "@/frontend/lib/install-app-transitions";
import * as telegramWebAppFacade from "@/frontend/lib/telegram-webapp";
import {
  normalizeTelegramWebAppInitData,
  telegramWebAppFallbackUrl,
  telegramWebAppLoginErrorMessage,
  telegramWebAppLoginProgressMessage,
} from "@/frontend/lib/telegram-webapp-login-transitions";
import { hasTurnstileSiteKey } from "@/frontend/lib/turnstile-transitions";

describe("browser integration transitions", () => {
  it("preserves the PWA platform and embedded-browser decisions", () => {
    expect(isAppleMobilePlatform("Mozilla iPhone", 0)).toBe(true);
    expect(isAppleMobilePlatform("Mozilla Mac", 2)).toBe(true);
    expect(isAppleMobilePlatform("Mozilla Mac", 1)).toBe(false);
    expect(isAndroidPlatform("Mozilla Android 15")).toBe(true);
    expect(isEmbeddedMobileUserAgent("Telegram WebView")).toBe(true);
    expect(isEmbeddedMobileUserAgent("Mozilla Chrome")).toBe(false);
    expect(androidInstallBrowserName("SamsungBrowser")).toBe(
      "Samsung Internet",
    );
    expect(androidInstallBrowserName("YaBrowser")).toBe("Яндекс Браузер");

    const readNavigatorStandalone = vi.fn(() => false);
    expect(isStandaloneInstallMode(true, readNavigatorStandalone)).toBe(true);
    expect(readNavigatorStandalone).not.toHaveBeenCalled();
    expect(isStandaloneInstallMode(false, readNavigatorStandalone)).toBe(
      false,
    );
    expect(readNavigatorStandalone).toHaveBeenCalledOnce();
  });

  it("preserves Turnstile key truthiness and Telegram login presentation", () => {
    expect(hasTurnstileSiteKey(undefined)).toBe(false);
    expect(hasTurnstileSiteKey("")).toBe(false);
    expect(hasTurnstileSiteKey(" ")).toBe(true);

    expect(normalizeTelegramWebAppInitData("  signed-data  ")).toBe(
      "signed-data",
    );
    expect(normalizeTelegramWebAppInitData("   ")).toBeNull();
    expect(telegramWebAppLoginErrorMessage("failure")).toBe(
      "Не удалось войти через Telegram.",
    );
    expect(telegramWebAppLoginProgressMessage(false)).toBe(
      "Входим через Telegram...",
    );
    expect(telegramWebAppLoginProgressMessage(true)).toBe(
      "Открываем вход Telegram...",
    );
    expect(
      telegramWebAppFallbackUrl(
        "https://pay.example.com",
        "/payment?plan=pro&duration=30",
      ),
    ).toBe(
      "https://pay.example.com/auth/telegram/start?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30",
    );
  });

  it("keeps every existing browser-integration facade export", () => {
    expect(telegramWebAppFacade.telegramWebAppSessionKey).toBe(
      "clean_pay_telegram_webapp",
    );
    expect(Object.keys(installButtonFacade).sort()).toEqual([
      "InstallAppButton",
    ]);
    expect(Object.keys(turnstileFacade).sort()).toEqual([
      "TurnstileWidget",
      "hasTurnstileSiteKey",
    ]);
    expect(Object.keys(telegramWebAppFacade).sort()).toEqual([
      "getTelegramWebApp",
      "loadTelegramWebAppScript",
      "markTelegramWebAppSession",
      "openTelegramExternalLink",
      "telegramWebAppSessionKey",
      "wasOpenedInTelegramWebApp",
    ]);
    expect(Object.keys(telegramLoginFacade).sort()).toEqual([
      "TelegramWebAppLogin",
    ]);
  });
});
