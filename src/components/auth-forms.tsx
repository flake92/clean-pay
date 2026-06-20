"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

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
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText name="email" placeholder="user@example.com" required type="email" />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Пароль</span>
        <Password
          feedback={false}
          inputClassName="w-full"
          name="password"
          placeholder="Введите пароль"
          required
          toggleMask
        />
      </label>
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button disabled={state.loading} label="Войти" loading={state.loading} type="submit" />
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
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Имя</span>
        <InputText name="name" placeholder="Как к вам обращаться" type="text" />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText name="email" placeholder="user@example.com" required type="email" />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Пароль</span>
        <Password
          inputClassName="w-full"
          minLength={8}
          name="password"
          placeholder="Придумайте пароль"
          required
          toggleMask
        />
        <span className="text-xs text-500">Минимум 8 символов.</span>
      </label>
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button
        disabled={state.loading}
        label="Зарегистрироваться"
        loading={state.loading}
        type="submit"
      />
    </form>
  );
}
