"use client";

import { useEffect, useState } from "react";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { readBffError } from "@/frontend/lib/client-api";
import { ProgressSpinner } from "primereact/progressspinner";
import { Message } from "primereact/message";

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

async function readError(response: Response) {
  return (await readBffError(response, "Не удалось войти через Telegram.")).message;
}

export function TelegramWebAppLogin() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function login() {
      try {
        await loadTelegramWebAppScript();

        const webApp = getTelegramWebApp();
        webApp?.ready?.();
        webApp?.expand?.();

        const initData = webApp?.initData;

        if (!initData) {
          throw new Error(
            "Telegram не передал данные входа. Откройте кабинет через кнопку Mini App/Web App в боте, а не через обычную ссылку.",
          );
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
            <LinkButton href="/login" label="Открыть обычный вход" outlined />
            <LinkButton href="/cabinet" label="Перейти в кабинет" />
          </div>
        </>
      ) : (
        <>
          <ProgressSpinner aria-label="Вход через Telegram" style={{ width: "48px", height: "48px" }} />
          <Message severity="info" text="Входим через Telegram..." />
        </>
      )}
    </div>
  );
}
