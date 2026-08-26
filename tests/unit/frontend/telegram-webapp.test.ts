/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadTelegramWebAppScript,
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

  afterEach(() => {
    document
      .querySelector<HTMLScriptElement>("script[data-clean-pay-telegram-webapp]")
      ?.remove();
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

  it("removes a failed SDK script and retries with a fresh element", async () => {
    const firstAttempt = loadTelegramWebAppScript();
    const firstScript = document.querySelector<HTMLScriptElement>(
      "script[data-clean-pay-telegram-webapp]",
    );
    expect(firstScript).not.toBeNull();

    firstScript?.dispatchEvent(new Event("error"));
    await expect(firstAttempt).rejects.toThrow("failed to load");
    expect(firstScript?.isConnected).toBe(false);

    const retry = loadTelegramWebAppScript();
    const retryScript = document.querySelector<HTMLScriptElement>(
      "script[data-clean-pay-telegram-webapp]",
    );
    expect(retryScript).not.toBeNull();
    expect(retryScript).not.toBe(firstScript);

    setTelegramWebApp({});
    retryScript?.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBeUndefined();

    setTelegramWebApp();
    const staleRetry = loadTelegramWebAppScript();
    const staleRetryScript = document.querySelector<HTMLScriptElement>(
      "script[data-clean-pay-telegram-webapp]",
    );
    expect(staleRetryScript).not.toBe(retryScript);

    setTelegramWebApp({});
    staleRetryScript?.dispatchEvent(new Event("load"));
    await expect(staleRetry).resolves.toBeUndefined();

    setTelegramWebApp();
    if (!staleRetryScript) throw new Error("Expected stale retry script");
    staleRetryScript.dataset.cleanPayTelegramWebappState = "loading";
    const hmrRetry = loadTelegramWebAppScript();
    expect(document.querySelector("script[data-clean-pay-telegram-webapp]"))
      .toBe(staleRetryScript);
    setTelegramWebApp({});
    await expect(hmrRetry).resolves.toBeUndefined();
  });
});
