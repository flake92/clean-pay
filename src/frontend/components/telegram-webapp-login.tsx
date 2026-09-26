"use client";

import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  useTelegramWebAppLoginController,
} from "@/frontend/hooks/use-telegram-webapp-login-controller";
import { telegramWebAppLoginProgressMessage } from "@/frontend/lib/telegram-webapp-login-transitions";
import { Message } from "@/frontend/components/sakai/form-foundation";
import { ProgressSpinner } from "primereact/progressspinner";

export function TelegramWebAppLogin({ redirectTo = "/cabinet" }: { redirectTo?: string }) {
  const { error, fallbackStarted } = useTelegramWebAppLoginController({
    redirectTo,
  });

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
            text={telegramWebAppLoginProgressMessage(fallbackStarted)}
          />
        </>
      )}
    </div>
  );
}
