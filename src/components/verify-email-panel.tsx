"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import { TurnstileWidget, type TurnstileHandle, hasPublicTurnstileKey } from "@/components/turnstile-widget";
import { BffClientError, readBffError } from "@/lib/client-api";

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

export function VerifyEmailPanel({ turnstileEnabled = false }: { turnstileEnabled?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading("request");

    if (turnstileEnabled && !turnstileToken) {
      setLoading(null);
      setError(missingTurnstileTokenMessage());
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const response = await fetch("/api/bff/auth/email/request-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email ? String(email) : undefined,
        ...turnstilePayload(turnstileToken),
      }),
    });

    setLoading(null);

    if (!response.ok) {
      turnstile?.reset();
      setTurnstileToken(null);
      setTargetEmail(null);
      const error = await readBffError(response, "Не удалось отправить код.");
      if (error instanceof BffClientError && error.code === "EMAIL_REQUIRED") {
        setError(null);
      } else {
        setError(error.message);
      }
      return;
    }

    const body = await response.json();
    setTargetEmail(body.data.target_email);
    setMessage(`Код отправлен на ${body.data.target_email}.`);
    turnstile?.reset();
    setTurnstileToken(null);
  }

  async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading("confirm");

    if (!targetEmail) {
      setLoading(null);
      setError("Сначала запросите код подтверждения.");
      return;
    }

    if (turnstileEnabled && !turnstileToken) {
      setLoading(null);
      setError(missingTurnstileTokenMessage());
      return;
    }

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/auth/email/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: targetEmail,
        code: formData.get("code"),
        ...turnstilePayload(turnstileToken),
      }),
    });

    setLoading(null);

    if (!response.ok) {
      turnstile?.reset();
      setTurnstileToken(null);
      const error = await readBffError(response, "Не удалось подтвердить e-mail.");
      if (error instanceof BffClientError && error.code === "EMAIL_REQUIRED") {
        setError(null);
      } else {
        setError(error.message);
      }
      return;
    }

    setMessage("E-mail подтвержден.");
    turnstile?.reset();
    setTurnstileToken(null);
  }

  return (
    <div className="flex flex-column gap-4">
      {turnstileEnabled ? <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} /> : null}
      <Card title="Получить код">
        <p className="mt-0 line-height-3 text-600">
          Код можно запросить не чаще одного раза в минуту.
        </p>
        <form className="flex flex-column gap-3" onSubmit={requestCode}>
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">E-mail</span>
            <InputText name="email" placeholder="user@example.com" type="email" />
          </label>
          <Button
            disabled={loading === "request"}
            label={targetEmail ? "Отправить код повторно" : "Отправить код"}
            loading={loading === "request"}
            severity="info"
            type="submit"
          />
        </form>
      </Card>
      {targetEmail ? (
        <Card title="Подтвердить код">
          <p className="mt-0 line-height-3 text-600">Введите 6 цифр из письма.</p>
          <form className="flex flex-column gap-3" onSubmit={confirmCode}>
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Код</span>
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
            <Button
              disabled={loading === "confirm"}
              label="Подтвердить"
              loading={loading === "confirm"}
              type="submit"
            />
          </form>
        </Card>
      ) : null}
      {error ? <Message severity="error" text={error} /> : null}
      {message ? <Message severity="success" text={message} /> : null}
    </div>
  );
}
