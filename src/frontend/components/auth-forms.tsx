"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

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
  consumeToken: () => string | null;
  reset: () => void;
  setHandle: (handle: TurnstileHandle) => void;
  setToken: (token: string | null) => void;
};

const AuthTurnstileContext = createContext<AuthTurnstileContextValue>({
  enabled: false,
  siteKey: null,
  token: null,
  consumeToken: () => null,
  reset: () => {},
  setHandle: () => {},
  setToken: () => {},
});

async function readAuthError(response: Response) {
  const error = await readBffError(response, "Не удалось выполнить действие.");
  if (error instanceof BffClientError && error.code === "RATE_LIMITED") {
    error.message = "Слишком много попыток. Попробуйте позже.";
  }
  return error;
}

const unknownLoginResultMessage =
  "Не удалось определить результат входа. Обновите страницу, чтобы проверить состояние сессии.";

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите единую проверку безопасности."
    : "Проверка безопасности временно недоступна.";
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
  const tokenRef = useRef<string | null>(null);
  const updateToken = useCallback((nextToken: string | null) => {
    tokenRef.current = nextToken;
    setToken(nextToken);
  }, []);
  const consumeToken = useCallback(() => {
    const currentToken = tokenRef.current;
    tokenRef.current = null;
    setToken(null);
    return currentToken;
  }, []);
  const reset = useCallback(() => {
    handle?.reset();
    updateToken(null);
  }, [handle, updateToken]);
  const value = useMemo<AuthTurnstileContextValue>(() => ({
    enabled,
    siteKey: siteKey ?? null,
    token: enabled ? token : null,
    consumeToken,
    reset,
    setHandle,
    setToken: updateToken,
  }), [consumeToken, enabled, reset, siteKey, token, updateToken]);

  return <AuthTurnstileContext.Provider value={value}>{children}</AuthTurnstileContext.Provider>;
}

function AuthTurnstileChallenge() {
  const turnstile = useContext(AuthTurnstileContext);
  if (!turnstile.enabled) return null;
  return (
    <TurnstileWidget
      action="auth_login"
      onReady={turnstile.setHandle}
      onToken={turnstile.setToken}
      siteKey={turnstile.siteKey}
    />
  );
}

export function LoginForm({
  initialError = null,
  redirectTo = "/cabinet",
}: {
  initialError?: string | null;
  redirectTo?: string;
}) {
  const [stage, setStage] = useState<"start" | "complete" | "resetStart" | "resetConfirm">("start");
  const [state, setState] = useState<ApiState>({ loading: false, error: initialError });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [canRecoverPassword, setCanRecoverPassword] = useState(false);
  const requestPendingRef = useRef(false);
  const turnstile = useContext(AuthTurnstileContext);
  const endpoint = {
    start: "/api/bff/auth/email/start",
    complete: "/api/bff/auth/email/complete",
    resetStart: "/api/bff/auth/password/reset/start",
    resetConfirm: "/api/bff/auth/password/reset/confirm",
  }[stage];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPendingRef.current) {
      return;
    }
    if (stage === "resetConfirm" && password !== passwordConfirmation) {
      setState({ loading: false, error: "Пароли не совпадают." });
      return;
    }
    const turnstileToken = turnstile.enabled ? turnstile.consumeToken() : null;
    if (turnstile.enabled && !turnstileToken) {
      setState({ loading: false, error: missingTurnstileTokenMessage(turnstile.siteKey) });
      return;
    }

    requestPendingRef.current = true;
    setState({ loading: true, error: null });
    try {
      const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            ...(stage === "complete" ? { code, password } : {}),
            ...(stage === "resetConfirm" ? { code, newPassword: password } : {}),
            ...(turnstileToken ? { turnstileToken } : {}),
          }),
        });
      turnstile.reset();
      if (!response.ok) {
        const error = await readAuthError(response);
        setCanRecoverPassword(stage === "complete" && error.code === "AUTH_FAILED");
        setState({ loading: false, error: error.message });
        return;
      }
      if (stage === "start") {
        setStage("complete");
        setState({ loading: false, error: null });
        return;
      }
      if (stage === "resetStart") {
        setStage("resetConfirm");
        setCode("");
        setPassword("");
        setPasswordConfirmation("");
        setState({ loading: false, error: null });
        return;
      }
      redirectAfterAuth(redirectTo);
    } catch {
      turnstile.reset();
      setState({ loading: false, error: unknownLoginResultMessage });
    } finally {
      requestPendingRef.current = false;
    }
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={submit}>
      <PasskeyLoginButton
        consumeTurnstileToken={turnstile.consumeToken}
        redirectTo={redirectTo}
        resetTurnstile={turnstile.reset}
        turnstileEnabled={turnstile.enabled}
      />
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText
          autoComplete="username"
          disabled={stage !== "start"}
          name="email"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {stage === "start" ? (
        <Message severity="info" text="Отправим одноразовый код на указанный e-mail." />
      ) : stage === "resetStart" ? (
        <Message severity="info" text="Мы отправим отдельный код для восстановления пароля на подтверждённый e-mail." />
      ) : (
        <>
          <Message
            severity="info"
            text={stage === "complete"
              ? "Введите код из письма и пароль от кабинета. Если входите впервые, придумайте новый пароль."
              : "Введите код восстановления из нового письма и задайте новый пароль."}
          />
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
            <span className="text-sm font-medium text-700">
              {stage === "complete" ? "Пароль" : "Новый пароль"}
            </span>
            <Password
              autoComplete={stage === "complete" ? "current-password" : "new-password"}
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
          {stage === "resetConfirm" ? (
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Повторите новый пароль</span>
              <Password
                autoComplete="new-password"
                className="w-full"
                feedback={false}
                inputClassName="w-full"
                minLength={8}
                name="passwordConfirmation"
                required
                toggleMask
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
              />
            </label>
          ) : null}
          {stage === "complete" && canRecoverPassword ? (
            <Button
              disabled={state.loading}
              label="Забыли пароль?"
              onClick={() => {
                setStage("resetStart");
                setCode("");
                setPassword("");
                setCanRecoverPassword(false);
                setState({ loading: false, error: null });
              }}
              text
              type="button"
            />
          ) : null}
          <Button
            disabled={state.loading}
            label="Изменить e-mail"
            onClick={() => {
              setStage("start");
              setCode("");
              setPassword("");
              setPasswordConfirmation("");
              setCanRecoverPassword(false);
              setState({ loading: false, error: null });
            }}
            text
            type="button"
          />
        </>
      )}
      <AuthTurnstileChallenge />
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button
        disabled={state.loading}
        label={stage === "start"
          ? "Получить код"
          : stage === "resetStart"
            ? "Получить код восстановления"
            : stage === "resetConfirm"
              ? "Сохранить новый пароль"
              : "Продолжить"}
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

  function login() {
    const telegramToken = turnstile.enabled ? turnstile.consumeToken() : null;
    if (turnstile.enabled && !telegramToken) {
      setState({ loading: false, error: missingTurnstileTokenMessage(turnstile.siteKey) });
      return;
    }
    setState({ loading: true, error: null });
    try {
      const url = new URL("/auth/telegram/start", window.location.origin);
      url.searchParams.set("redirect_to", redirectTo);
      if (telegramToken) url.searchParams.set("turnstile_token", telegramToken);
      window.location.assign(url.toString());
    } catch (error) {
      turnstile.reset();
      setState({ loading: false, error: error instanceof Error ? error.message : "Telegram login failed." });
    }
  }

  return (
    <div className="flex flex-column gap-2">
      {state.error ? <Message severity="error" text={state.error} /> : null}
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
