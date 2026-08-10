"use client";

import { useEffect, useState } from "react";

import { authenticateTelegramWebAppAction } from "@/app/actions/telegram";
import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  getTelegramWebApp,
  loadTelegramWebAppScript,
  markTelegramWebAppSession,
} from "@/frontend/lib/telegram-webapp";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";

function redirectToTelegramLogin(redirectTo: string) {
  const url = new URL("/auth/telegram/start", window.location.origin);
  url.searchParams.set("redirect_to", redirectTo);
  window.location.replace(url.toString());
}

export function TelegramWebAppLogin({ redirectTo = "/cabinet" }: { redirectTo?: string }) {
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
          redirectToTelegramLogin(redirectTo);
          return;
        }

        markTelegramWebAppSession();

        const result = await authenticateTelegramWebAppAction(initData);
        if (!result.ok) throw new Error(result.message);
        window.location.replace(redirectTo);
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
  }, [redirectTo]);

  return (
    <div className="flex flex-column align-items-center gap-4 text-center">
      {error ? (
        <>
          <Message severity="error" text={error} />
          <div className="flex flex-wrap justify-content-center gap-2">
            <LinkButton href={`/auth/telegram/start?redirect_to=${encodeURIComponent(redirectTo)}`} label="Повторить вход через Telegram" />
            <LinkButton href={`/login?redirect_to=${encodeURIComponent(redirectTo)}`} label="Открыть обычный вход" outlined />
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
