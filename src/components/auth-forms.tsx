"use client";

import { useState } from "react";

type ApiState = {
  loading: boolean;
  error: string | null;
};

async function readError(response: Response) {
  const body = await response.json().catch(() => null);

  return body?.error?.message ?? "Не удалось выполнить действие.";
}

export function LoginForm() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ loading: true, error: null });

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });

    if (!response.ok) {
      setState({ loading: false, error: await readError(response) });
      return;
    }

    window.location.href = "/cabinet";
  }

  return (
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
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button
        className="h-11 bg-zinc-950 px-4 text-white disabled:opacity-60"
        disabled={state.loading}
        type="submit"
      >
        Войти
      </button>
    </form>
  );
}

export function RegisterForm() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ loading: true, error: null });

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
        name: formData.get("name") || undefined,
      }),
    });

    if (!response.ok) {
      setState({ loading: false, error: await readError(response) });
      return;
    }

    window.location.href = "/cabinet";
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <input
        className="h-11 border border-zinc-300 bg-white px-3"
        name="name"
        placeholder="Имя"
        type="text"
      />
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
        minLength={8}
        required
      />
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button
        className="h-11 bg-zinc-950 px-4 text-white disabled:opacity-60"
        disabled={state.loading}
        type="submit"
      >
        Зарегистрироваться
      </button>
    </form>
  );
}
