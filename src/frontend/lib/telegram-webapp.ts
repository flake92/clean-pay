export const telegramWebAppSessionKey = "clean_pay_telegram_webapp";

export type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  initData?: string;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
};

export function getTelegramWebApp() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function loadTelegramWebAppScript() {
  if (getTelegramWebApp()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-clean-pay-telegram-webapp]");

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Telegram WebApp script failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.cleanPayTelegramWebapp = "true";
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Telegram WebApp script failed to load"));
    document.head.appendChild(script);
  });
}

export function markTelegramWebAppSession() {
  try {
    window.sessionStorage.setItem(telegramWebAppSessionKey, "1");
  } catch {
    // Some embedded browsers can disable session storage. User-agent detection remains as a fallback.
  }
}

export function wasOpenedInTelegramWebApp() {
  try {
    return window.sessionStorage.getItem(telegramWebAppSessionKey) === "1";
  } catch {
    return false;
  }
}

export function openTelegramExternalLink(url: string) {
  const webApp = getTelegramWebApp();

  if (!webApp?.openLink) {
    return false;
  }

  webApp.openLink(url, { try_instant_view: false });
  return true;
}
