"use client";

import { useState } from "react";

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
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Привязать Telegram</h2>
        <p className="text-sm text-zinc-600">
          Если вы вошли по e-mail, можно привязать Telegram ID через OIDC.
        </p>
        <a
          className="inline-flex h-11 items-center justify-center bg-cyan-700 px-4 text-white"
          href="/auth/telegram/start?redirect_to=/link-account"
        >
          Привязать Telegram
        </a>
      </section>
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Привязать e-mail</h2>
        <p className="text-sm text-zinc-600">
          Если вы вошли через Telegram, подтвердите e-mail аккаунт Remnashop.
        </p>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <input
            className="h-11 border border-zinc-300 bg-white px-3"
            name="email"
            placeholder="E-mail"
            type="email"
            required
          />
          <input
            className="h-11 border border-zinc-300 bg-white px-3"
            name="password"
            placeholder="Пароль"
            type="password"
            required
          />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {message ? <p className="text-sm text-green-700">{message}</p> : null}
          <button
            className="h-11 bg-zinc-950 px-4 text-white disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            Привязать e-mail
          </button>
        </form>
      </section>
    </div>
  );
}
