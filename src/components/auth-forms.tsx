"use client";

import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

import { TurnstileWidget, type TurnstileHandle, hasPublicTurnstileKey } from "@/components/turnstile-widget";
import { readBffError } from "@/lib/client-api";

type ApiState = {
  loading: boolean;
  error: string | null;
};

type AuthTurnstileContextValue = {
  enabled: boolean;
  token: string | null;
  reset: () => void;
  setHandle: (handle: TurnstileHandle) => void;
  setToken: (token: string | null) => void;
};

const AuthTurnstileContext = createContext<AuthTurnstileContextValue>({
  enabled: false,
  token: null,
  reset: () => {},
  setHandle: () => {},
  setToken: () => {},
});

async function readError(response: Response) {
  return (await readBffError(response, "Не удалось выполнить действие.")).message;
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

function missingTurnstileTokenMessage() {
  return hasPublicTurnstileKey()
    ? "Пройдите проверку Cloudflare Turnstile."
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

function useAuthTurnstile() {
  return useContext(AuthTurnstileContext);
}

export function AuthTurnstileProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);

  const value = useMemo<AuthTurnstileContextValue>(
    () => ({
      enabled,
      token: enabled ? turnstileToken : null,
      reset: () => {
        turnstile?.reset();
        setTurnstileToken(null);
      },
      setHandle: setTurnstile,
      setToken: setTurnstileToken,
    }),
    [enabled, turnstile, turnstileToken],
  );

  return <AuthTurnstileContext.Provider value={value}>{children}</AuthTurnstileContext.Provider>;
}

function AuthTurnstileChallenge() {
  const turnstile = useAuthTurnstile();

  if (!turnstile.enabled) {
    return null;
  }

  return <TurnstileWidget onReady={turnstile.setHandle} onToken={turnstile.setToken} />;
}

export function LoginForm() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });
  const turnstile = useAuthTurnstile();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (turnstile.enabled && !turnstile.token) {
      setState({ loading: false, error: missingTurnstileTokenMessage() });
      return;
    }

    setState({ loading: true, error: null });

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
        ...turnstilePayload(turnstile.token),
      }),
    });

    if (!response.ok) {
      turnstile.reset();
      setState({ loading: false, error: await readError(response) });
      return;
    }

    redirectAfterAuth();
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText autoComplete="username" id="login-email" name="email" placeholder="user@example.com" required type="email" />
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
      <AuthTurnstileChallenge />
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button disabled={state.loading} label="Войти" loading={state.loading} type="submit" />
    </form>
  );
}

export function RegisterForm() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const turnstile = useAuthTurnstile();
  const passwordsDoNotMatch = confirmTouched && confirmPassword.length > 0 && password !== confirmPassword;

  const passwordFooter = (
    <div className="mt-2 text-sm text-600 line-height-3">
      Используйте минимум 8 символов. Надежнее: буквы в разных регистрах, цифры и спецсимвол.
    </div>
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const nextPassword = String(formData.get("password") ?? "");
    const nextConfirmPassword = String(formData.get("confirmPassword") ?? "");

    if (nextPassword !== nextConfirmPassword) {
      setConfirmTouched(true);
      setState({ loading: false, error: "Пароли не совпадают." });
      return;
    }

    if (turnstile.enabled && !turnstile.token) {
      setState({ loading: false, error: missingTurnstileTokenMessage() });
      return;
    }

    setState({ loading: true, error: null });

    const response = await fetch("/api/bff/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
        name: formData.get("name") || undefined,
        ...turnstilePayload(turnstile.token),
      }),
    });

    if (!response.ok) {
      turnstile.reset();
      setState({ loading: false, error: await readError(response) });
      return;
    }

    window.location.assign("/register/verify-email");
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Имя</span>
        <InputText autoComplete="name" id="register-name" name="name" placeholder="Как к вам обращаться" type="text" />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText autoComplete="username" id="register-email" name="email" placeholder="user@example.com" required type="email" />
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Пароль</span>
        <Password
          appendTo="self"
          autoComplete="new-password"
          className="w-full"
          footer={passwordFooter}
          header={<div className="font-medium mb-2">Надежность пароля</div>}
          inputId="register-password"
          inputClassName="w-full"
          mediumLabel="Средний"
          minLength={8}
          name="password"
          panelClassName="auth-password-panel"
          placeholder="Придумайте пароль"
          promptLabel="Введите пароль"
          required
          strongLabel="Надежный"
          toggleMask
          value={password}
          weakLabel="Слабый"
          onChange={(event) => setPassword(event.target.value)}
        />
        <span className="text-xs text-500">Минимум 8 символов.</span>
      </label>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Повторите пароль</span>
        <Password
          autoComplete="new-password"
          className="w-full"
          feedback={false}
          inputId="register-password-confirm"
          inputClassName={`w-full${passwordsDoNotMatch ? " p-invalid" : ""}`}
          minLength={8}
          name="confirmPassword"
          placeholder="Введите пароль еще раз"
          required
          toggleMask
          value={confirmPassword}
          onBlur={() => setConfirmTouched(true)}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        {passwordsDoNotMatch ? <span className="text-xs text-red-500">Пароли не совпадают.</span> : null}
      </label>
      <AuthTurnstileChallenge />
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button disabled={state.loading} label="Зарегистрироваться" loading={state.loading} type="submit" />
    </form>
  );
}

export function TelegramLoginButton({ redirectTo = "/cabinet" }: { redirectTo?: string }) {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });
  const turnstile = useAuthTurnstile();

  function onClick() {
    if (turnstile.enabled && !turnstile.token) {
      setState({ loading: false, error: missingTurnstileTokenMessage() });
      return;
    }

    setState({ loading: true, error: null });
    const url = new URL("/auth/telegram/start", window.location.origin);
    url.searchParams.set("redirect_to", redirectTo);
    if (turnstile.token) {
      url.searchParams.set("turnstile_token", turnstile.token);
      url.searchParams.set("cf-turnstile-response", turnstile.token);
    }
    window.location.assign(url.toString());
  }

  return (
    <div className="flex flex-column gap-2">
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button
        disabled={state.loading}
        icon="pi pi-send"
        label="Войти через Telegram"
        loading={state.loading}
        onClick={onClick}
        severity="info"
        type="button"
      />
    </div>
  );
}
