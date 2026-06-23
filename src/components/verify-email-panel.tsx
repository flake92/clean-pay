"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { readBffError } from "@/lib/client-api";
import { TurnstileWidget, type TurnstileHandle, hasPublicTurnstileKey } from "@/components/turnstile-widget";

async function readError(response: Response) {
  return (await readBffError(response, 'Не удалось выполнить действие.')).message;
}

function missingTurnstileTokenMessage() {
  return hasPublicTurnstileKey()
    ? "РџСЂРѕР№РґРёС‚Рµ РїСЂРѕРІРµСЂРєСѓ Cloudflare Turnstile."
    : "Cloudflare Turnstile site key is not configured.";
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
      setError(await readError(response));
      return;
    }

    const body = await response.json();
    setTargetEmail(body.data.target_email);
    setMessage(`Код отправлен на ${body.data.target_email}.`);
  }

  async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading("confirm");

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
        email: targetEmail ?? undefined,
        code: formData.get("code"),
        ...turnstilePayload(turnstileToken),
      }),
    });

    setLoading(null);

    if (!response.ok) {
      turnstile?.reset();
      setError(await readError(response));
      return;
    }

    setMessage("E-mail подтверждён.");
  }

  return (
    <div className="flex flex-column gap-4">
      {turnstileEnabled ? <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} /> : null}
      <Card title="Получить код">
        <p className="mt-0 line-height-3 text-600">
          Код можно запросить не чаще одного раза в минуту. You can request the code once per minute.
        </p>
        <form className="flex flex-column gap-3" onSubmit={requestCode}>
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">E-mail</span>
            <InputText name="email" placeholder="user@example.com" type="email" />
          </label>
          <Button
            disabled={loading === "request"}
            label="Отправить код"
            loading={loading === "request"}
            severity="info"
            type="submit"
          />
        </form>
      </Card>
      <Card title="Подтвердить код">
        <p className="mt-0 line-height-3 text-600">
          Введите 6 цифр из письма. Enter the 6 digits from the e-mail.
        </p>
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
      {error ? <Message severity="error" text={error} /> : null}
      {message ? <Message severity="success" text={message} /> : null}
    </div>
  );
}
