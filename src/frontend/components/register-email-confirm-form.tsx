"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import { TurnstileWidget, type TurnstileHandle, hasPublicTurnstileKey } from "@/frontend/components/turnstile-widget";
import { readBffError } from "@/frontend/lib/client-api";

async function readError(response: Response, fallback: string) {
  return (await readBffError(response, fallback)).message;
}

function missingTurnstileTokenMessage() {
  return hasPublicTurnstileKey()
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Ключ сайта Cloudflare Turnstile не настроен.";
}

function turnstilePayload(token: string | null) {
  return token
    ? {
        turnstileToken: token,
        "cf-turnstile-response": token,
      }
    : {};
}

export function RegisterEmailConfirmForm({ turnstileEnabled = false }: { turnstileEnabled?: boolean }) {
  const [loading, setLoading] = useState<"confirm" | "resend" | "back" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);

  function ensureTurnstileToken() {
    if (!turnstileEnabled || turnstileToken) {
      return true;
    }

    setError(missingTurnstileTokenMessage());
    return false;
  }

  async function goBackToRegister() {
    setLoading("back");
    await fetch("/api/bff/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/register");
  }

  async function resendCode() {
    setError(null);
    setMessage(null);

    if (!ensureTurnstileToken()) {
      return;
    }

    setLoading("resend");

    const response = await fetch("/api/bff/auth/email/request-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(turnstilePayload(turnstileToken)),
    });

    setLoading(null);

    if (!response.ok) {
      turnstile?.reset();
      setTurnstileToken(null);
      setError(await readError(response, "Не удалось повторно отправить код."));
      return;
    }

    const body = await response.json().catch(() => null);
    const targetEmail = body?.data?.target_email;
    setMessage(targetEmail ? `Код повторно отправлен на ${targetEmail}.` : "Код повторно отправлен.");
    turnstile?.reset();
    setTurnstileToken(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!ensureTurnstileToken()) {
      return;
    }

    setLoading("confirm");

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/auth/email/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: formData.get("code"),
        registrationFlow: true,
        ...turnstilePayload(turnstileToken),
      }),
    });

    setLoading(null);

    if (!response.ok) {
      turnstile?.reset();
      setTurnstileToken(null);
      setError(await readError(response, "Не удалось подтвердить e-mail."));
      return;
    }

    window.location.assign("/passkey/setup");
  }

  return (
    <div className="flex flex-column gap-3">
      {turnstileEnabled ? <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} /> : null}
      <form className="flex flex-column gap-3" onSubmit={onSubmit}>
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">Код подтверждения</span>
          <InputText
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            name="code"
            pattern="[0-9]{6}"
            placeholder="000000"
            required
          />
        </label>
        {error ? <Message severity="error" text={error} /> : null}
        {message ? <Message severity="success" text={message} /> : null}
        <div className="flex flex-column gap-2 sm:flex-row">
          <Button
            className="flex-1"
            disabled={loading !== null}
            label="Подтвердить e-mail"
            loading={loading === "confirm"}
            type="submit"
          />
          <Button
            className="flex-1"
            disabled={loading !== null}
            label="Отправить код повторно"
            loading={loading === "resend"}
            onClick={resendCode}
            outlined
            type="button"
          />
          <Button
            className="flex-1"
            disabled={loading !== null}
            label="Назад"
            loading={loading === "back"}
            onClick={goBackToRegister}
            outlined
            severity="secondary"
            type="button"
          />
        </div>
      </form>
    </div>
  );
}
