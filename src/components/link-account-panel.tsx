"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

import { TurnstileWidget, type TurnstileHandle, hasPublicTurnstileKey } from "@/components/turnstile-widget";
import { readBffError } from "@/lib/client-api";

async function readError(response: Response) {
  return (await readBffError(response, "Не удалось выполнить действие.")).message;
}

function missingTurnstileTokenMessage() {
  return hasPublicTurnstileKey()
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Cloudflare Turnstile site key is not configured.";
}

export function LinkAccountPanel({ turnstileEnabled = false }: { turnstileEnabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);

  function linkTelegram() {
    setMessage(null);
    setError(null);

    if (turnstileEnabled && !turnstileToken) {
      setError(missingTurnstileTokenMessage());
      return;
    }

    setTelegramLoading(true);
    const url = new URL("/auth/telegram/start", window.location.origin);
    url.searchParams.set("redirect_to", "/link-account");
    if (turnstileToken) {
      url.searchParams.set("turnstile_token", turnstileToken);
      url.searchParams.set("cf-turnstile-response", turnstileToken);
    }
    window.location.assign(url.toString());
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/link/remnashop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });

    setLoading(false);

    if (!response.ok) {
      turnstile?.reset();
      setError(await readError(response));
      return;
    }

    setMessage("E-mail сохранён, код подтверждения отправлен.");
  }

  return (
    <div className="flex flex-column gap-4">
      {turnstileEnabled ? <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} /> : null}
      <Card title="Привязать Telegram">
        <p className="line-height-3 text-600">
          Если вы вошли по e-mail, можно привязать Telegram ID через OIDC.
        </p>
        <Button
          icon="pi pi-send"
          label="Привязать Telegram"
          loading={telegramLoading}
          onClick={linkTelegram}
          severity="info"
          type="button"
        />
      </Card>
      <Card title="Привязать e-mail">
        <p className="line-height-3 text-600">
          Если вы вошли через Telegram, укажите e-mail и подтвердите его кодом из письма.
        </p>
        <form className="flex flex-column gap-3" onSubmit={onSubmit}>
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">E-mail</span>
            <InputText name="email" placeholder="user@example.com" required type="email" />
          </label>
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">Пароль</span>
            <Password
              className="w-full"
              feedback={false}
              inputClassName="w-full"
              minLength={8}
              name="password"
              placeholder="Придумайте пароль"
              required
              toggleMask
            />
          </label>
          {error ? <Message severity="error" text={error} /> : null}
          {message ? <Message severity="success" text={message} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={loading} label="Отправить код" loading={loading} type="submit" />
            <Button
              label="Ввести код"
              onClick={() => window.location.assign("/verify-email")}
              outlined
              type="button"
            />
          </div>
        </form>
      </Card>
    </div>
  );
}
