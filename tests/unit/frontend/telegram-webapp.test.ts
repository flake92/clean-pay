/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  markTelegramWebAppSession,
  openTelegramExternalLink,
  telegramWebAppSessionKey,
  wasOpenedInTelegramWebApp,
  type TelegramWebApp,
} from "@/frontend/lib/telegram-webapp";

function setTelegramWebApp(webApp?: TelegramWebApp) {
  const target = window as Window & { Telegram?: { WebApp?: TelegramWebApp } };

  if (webApp) {
    target.Telegram = { WebApp: webApp };
  } else {
    delete target.Telegram;
  }
}

describe("Telegram WebApp browser handoff", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setTelegramWebApp();
  });

  it("marks the current tab as opened from Telegram", () => {
    expect(wasOpenedInTelegramWebApp()).toBe(false);

    markTelegramWebAppSession();

    expect(window.sessionStorage.getItem(telegramWebAppSessionKey)).toBe("1");
    expect(wasOpenedInTelegramWebApp()).toBe(true);
  });

  it("opens the install page through Telegram in the external browser", () => {
    const openLink = vi.fn();
    setTelegramWebApp({ openLink });

    expect(openTelegramExternalLink("https://pay.example.com/install")).toBe(true);
    expect(openLink).toHaveBeenCalledWith("https://pay.example.com/install", { try_instant_view: false });
  });

  it("reports when the Telegram external-link API is unavailable", () => {
    expect(openTelegramExternalLink("https://pay.example.com/install")).toBe(false);
  });
});
