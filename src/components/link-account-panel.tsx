"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import { LinkButton } from "@/components/prime/link-button";

async function readError(response: Response) {
  const body = await response.json().catch(() => null);

  return body?.error?.message ?? "Не удалось выполнить действие.";
}

export function LinkAccountPanel() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    if (!response.ok) {
      setLoading(false);
      setError(await readError(response));
      return;
    }

    setLoading(false);
    setMessage("E-mail аккаунт привязан.");
  }

  return (
    <div className="flex flex-column gap-4">
      <Card title="Привязать Telegram">
        <p className="line-height-3 text-600">
          Если вы вошли по e-mail, можно привязать Telegram ID через OIDC.
        </p>
        <LinkButton
          href="/auth/telegram/start?redirect_to=/link-account"
          icon="pi pi-send"
          label="Привязать Telegram"
          severity="info"
        />
      </Card>
      <Card title="Привязать e-mail">
        <p className="line-height-3 text-600">
          Если вы вошли через Telegram, подтвердите e-mail аккаунт Remnashop.
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
              name="password"
              placeholder="Пароль"
              required
              toggleMask
            />
          </label>
          {error ? <Message severity="error" text={error} /> : null}
          {message ? <Message severity="success" text={message} /> : null}
          <Button disabled={loading} label="Привязать e-mail" loading={loading} type="submit" />
        </form>
      </Card>
    </div>
  );
}
