"use client";

import { useState } from "react";

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
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Получить код</h2>
        <p className="text-sm leading-6 text-zinc-600">
          Код можно запросить не чаще одного раза в минуту. You can request the
          code once per minute.
        </p>
        <form className="grid gap-4" onSubmit={requestCode}>
          <input
            className="h-11 border border-zinc-300 bg-white px-3"
            name="email"
            placeholder="E-mail"
            type="email"
          />
          <button
            className="h-11 bg-cyan-700 px-4 text-white disabled:opacity-60"
            disabled={loading === "request"}
            type="submit"
          >
            Отправить код
          </button>
        </form>
      </section>
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Подтвердить код</h2>
        <p className="text-sm leading-6 text-zinc-600">
          Введите 6 цифр из письма. Enter the 6 digits from the e-mail.
        </p>
        <form className="grid gap-4" onSubmit={confirmCode}>
          <input
            className="h-11 border border-zinc-300 bg-white px-3"
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            name="code"
            pattern="[0-9]{6}"
            placeholder="000000"
            required
          />
          <button
            className="h-11 bg-zinc-950 px-4 text-white disabled:opacity-60"
            disabled={loading === "confirm"}
            type="submit"
          >
            Подтвердить
          </button>
        </form>
      </section>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
    </div>
  );
}
