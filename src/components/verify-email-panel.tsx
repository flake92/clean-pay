"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

async function readError(response: Response) {
  const body = await response.json().catch(() => null);

  return body?.error?.message ?? "Не удалось выполнить действие.";
}

export function VerifyEmailPanel() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading("request");

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const response = await fetch("/api/bff/auth/email/request-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email ? String(email) : undefined,
      }),
    });

    setLoading(null);

    if (!response.ok) {
      setError(await readError(response));
      return;
    }

    const body = await response.json();
    setMessage(`Код отправлен на ${body.data.target_email}.`);
  }

  async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading("confirm");

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/auth/email/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: formData.get("code"),
      }),
    });

    setLoading(null);

    if (!response.ok) {
      setError(await readError(response));
      return;
    }

    setMessage("E-mail подтверждён.");
  }

  return (
    <div className="grid gap-8">
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
