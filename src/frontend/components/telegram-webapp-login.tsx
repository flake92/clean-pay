"use client";

import { useEffect, useState } from "react";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { readBffError } from "@/frontend/lib/client-api";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  initData?: string;
};

function getTelegramWebApp() {
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

function loadTelegramWebAppScript() {
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

function redirectToTelegramLogin() {
  const url = new URL("/auth/telegram/start", window.location.origin);
  url.searchParams.set("redirect_to", "/cabinet");
  window.location.replace(url.toString());
}

async function readError(response: Response) {
  return (await readBffError(response, "Не удалось войти через Telegram.")).message;
}

export function TelegramWebAppLogin() {
  const [error, setError] = useState<string | null>(null);
  const [fallbackStarted, setFallbackStarted] = useState(false);

  useEffect(() => {
    let alive = true;

    async function login() {
      try {
        await loadTelegramWebAppScript();

        const webApp = getTelegramWebApp();
        webApp?.ready?.();
        webApp?.expand?.();

        const initData = webApp?.initData?.trim();

        if (!initData) {
          setFallbackStarted(true);
          redirectToTelegramLogin();
          return;
        }

        const response = await fetch("/api/bff/auth/telegram/webapp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const body = await response.json().catch(() => null) as { redirectTo?: string } | null;
        window.location.replace(body?.redirectTo ?? "/cabinet");
      } catch (nextError) {
        if (alive) {
          setError(nextError instanceof Error ? nextError.message : "Не удалось войти через Telegram.");
        }
      }
    }

    void login();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-column align-items-center gap-4 text-center">
      {error ? (
        <>
          <Message severity="error" text={error} />
          <div className="flex flex-wrap justify-content-center gap-2">
            <LinkButton href="/auth/telegram/start?redirect_to=/cabinet" label="Повторить вход через Telegram" />
            <LinkButton href="/login" label="Открыть обычный вход" outlined />
          </div>
        </>
      ) : (
        <>
          <ProgressSpinner aria-label="Вход через Telegram" style={{ width: "48px", height: "48px" }} />
          <Message
            severity="info"
            text={fallbackStarted ? "Открываем вход Telegram..." : "Входим через Telegram..."}
          />
        </>
      )}
    </div>
  );
}
