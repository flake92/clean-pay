"use client";

import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

import { PasskeyLoginButton } from "@/frontend/components/passkey-actions";
import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { BffClientError, readBffError } from "@/frontend/lib/client-api";

type ApiState = { loading: boolean; error: string | null };

type AuthTurnstileContextValue = {
  enabled: boolean;
  siteKey: string | null;
  token: string | null;
  reset: () => void;
  setHandle: (handle: TurnstileHandle) => void;
  setToken: (token: string | null) => void;
};

const AuthTurnstileContext = createContext<AuthTurnstileContextValue>({
  enabled: false,
  siteKey: null,
  token: null,
  reset: () => {},
  setHandle: () => {},
  setToken: () => {},
});

async function readError(response: Response) {
  const error = await readBffError(response, "Не удалось выполнить действие.");
  if (error instanceof BffClientError && error.code === "RATE_LIMITED") {
    return "Слишком много попыток. Попробуйте позже.";
  }
  return error.message;
}

const unknownLoginResultMessage =
  "Не удалось определить результат входа. Обновите страницу, чтобы проверить состояние сессии.";

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Cloudflare Turnstile site key is not configured.";
}

function redirectAfterAuth(redirectTo: string) {
  window.location.assign(redirectTo);
}

export function AuthTurnstileProvider({
  enabled,
  children,
  siteKey,
}: {
  enabled: boolean;
  children: ReactNode;
  siteKey?: string | null;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [handle, setHandle] = useState<TurnstileHandle | null>(null);
  const value = useMemo<AuthTurnstileContextValue>(() => ({
    enabled,
    siteKey: siteKey ?? null,
    token: enabled ? token : null,
    reset: () => {
      handle?.reset();
      setToken(null);
    },
    setHandle,
    setToken,
  }), [enabled, handle, siteKey, token]);

  return <AuthTurnstileContext.Provider value={value}>{children}</AuthTurnstileContext.Provider>;
}

function AuthTurnstileChallenge({ action }: { action: string }) {
  const turnstile = useContext(AuthTurnstileContext);
  if (!turnstile.enabled) return null;
  return (
    <TurnstileWidget
      action={action}
      onReady={turnstile.setHandle}
      onToken={turnstile.setToken}
      siteKey={turnstile.siteKey}
    />
  );
}

export function LoginForm({ redirectTo = "/cabinet" }: { redirectTo?: string }) {
  const [stage, setStage] = useState<"start" | "complete">("start");
  const [state, setState] = useState<ApiState>({ loading: false, error: null });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const turnstile = useContext(AuthTurnstileContext);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (turnstile.enabled && !turnstile.token) {
      setState({ loading: false, error: missingTurnstileTokenMessage(turnstile.siteKey) });
      return;
    }

    setState({ loading: true, error: null });
    try {
      const response = await fetch(
        stage === "start" ? "/api/bff/auth/email/start" : "/api/bff/auth/email/complete",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            ...(stage === "complete" ? { code, password } : {}),
            ...(turnstile.token ? { turnstileToken: turnstile.token } : {}),
          }),
        },
      );
      turnstile.reset();
      if (!response.ok) {
        setState({ loading: false, error: await readError(response) });
        return;
      }
      if (stage === "start") {
        setStage("complete");
        setState({ loading: false, error: null });
        return;
      }
      redirectAfterAuth(redirectTo);
    } catch {
      turnstile.reset();
      setState({ loading: false, error: unknownLoginResultMessage });
    }
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={submit}>
      <PasskeyLoginButton
        redirectTo={redirectTo}
        turnstileEnabled={turnstile.enabled}
        turnstileSiteKey={turnstile.siteKey}
      />
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText
          autoComplete="username"
          disabled={stage === "complete"}
          name="email"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {stage === "start" ? (
        <Message severity="info" text="Мы отправим одноразовый код. Ответ одинаков для нового и существующего аккаунта." />
      ) : (
        <>
          <Message severity="info" text="Введите код из письма и пароль аккаунта." />
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">Код из письма</span>
            <InputText
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">Пароль</span>
            <Password
              autoComplete="current-password"
              className="w-full"
              feedback={false}
              inputClassName="w-full"
              minLength={8}
              name="password"
              required
              toggleMask
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button
            label="Изменить e-mail"
            onClick={() => {
              setStage("start");
              setCode("");
              setPassword("");
              setState({ loading: false, error: null });
            }}
            text
            type="button"
          />
        </>
      )}
      <AuthTurnstileChallenge action={stage === "start" ? "email_auth_start" : "email_auth_complete"} />
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button
        disabled={state.loading}
        label={stage === "start" ? "Получить код" : "Продолжить"}
        loading={state.loading}
        type="submit"
      />
    </form>
  );
}

export function RegisterForm() {
  return <LoginForm redirectTo="/cabinet" />;
}

export function TelegramLoginButton({ redirectTo = "/cabinet" }: { redirectTo?: string }) {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });
  const turnstile = useContext(AuthTurnstileContext);
  const [telegramToken, setTelegramToken] = useState<string | null>(null);
  const [telegramTurnstile, setTelegramTurnstile] = useState<TurnstileHandle | null>(null);

  function login() {
    if (turnstile.enabled && !telegramToken) {
      setState({ loading: false, error: missingTurnstileTokenMessage(turnstile.siteKey) });
      return;
    }
    setState({ loading: true, error: null });
    try {
      const url = new URL("/auth/telegram/start", window.location.origin);
      url.searchParams.set("redirect_to", redirectTo);
      if (telegramToken) url.searchParams.set("turnstile_token", telegramToken);
      telegramTurnstile?.reset();
      setTelegramToken(null);
      window.location.assign(url.toString());
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Telegram login failed." });
    }
  }

  return (
    <div className="flex flex-column gap-2">
      {state.error ? <Message severity="error" text={state.error} /> : null}
      {turnstile.enabled ? (
        <TurnstileWidget
          action="telegram_auth_start"
          onReady={setTelegramTurnstile}
          onToken={setTelegramToken}
          siteKey={turnstile.siteKey}
        />
      ) : null}
      <Button
        disabled={state.loading}
        icon="pi pi-send"
        label="Войти через Telegram"
        loading={state.loading}
        onClick={login}
        severity="info"
        type="button"
      />
    </div>
  );
}
