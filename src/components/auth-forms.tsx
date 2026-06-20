"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { readBffError } from "@/lib/client-api";
import { Password } from "primereact/password";

type ApiState = {
  loading: boolean;
  error: string | null;
};

async function readError(response: Response) {
  return (await readBffError(response, 'Не удалось выполнить действие.')).message;
}


function redirectAfterAuth() {
  const params = new URLSearchParams(window.location.search);
  const redirectTo = params.get("redirect_to");

  if (redirectTo?.startsWith("/") && !redirectTo.startsWith("//")) {
    window.location.assign(redirectTo);
    return;
  }

  window.location.assign("/cabinet");
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

    redirectAfterAuth();
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText
          autoComplete="username"
          id="login-email"
          name="email"
          placeholder="user@example.com"
          required
          type="email"
        />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Пароль</span>
        <Password
          autoComplete="current-password"
          className="w-full"
          feedback={false}
          inputId="login-password"
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

    redirectAfterAuth();
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Имя</span>
        <InputText autoComplete="name" id="register-name" name="name" placeholder="Как к вам обращаться" type="text" />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText
          autoComplete="username"
          id="register-email"
          name="email"
          placeholder="user@example.com"
          required
          type="email"
        />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Пароль</span>
        <Password
          autoComplete="new-password"
          className="w-full"
          inputId="register-password"
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
