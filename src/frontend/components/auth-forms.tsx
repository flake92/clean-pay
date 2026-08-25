"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

import { executeAuthAction } from "@/app/actions/auth";
import { PasskeyLoginButton } from "@/frontend/components/passkey-actions";
import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { registrationEmailVerificationPath } from "@/shared/auth/account-setup-flow";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

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

const unknownLoginResultMessage =
  "Не удалось определить результат входа. Обновите страницу, чтобы проверить состояние сессии.";

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите единую проверку безопасности."
    : "Проверка безопасности временно недоступна.";
}

function redirectAfterAuth(redirectTo: string) {
  window.location.assign(safeRedirectPath(redirectTo) ?? "/cabinet");
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
  const [stage, setStage] = useState<"identify" | "password" | "register" | "resetStart" | "resetConfirm">("identify");
  const [state, setState] = useState<ApiState>({ loading: false, error: initialError });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [hasPasskey, setHasPasskey] = useState(false);
  const [canRecoverPassword, setCanRecoverPassword] = useState(false);
  const requestPendingRef = useRef(false);
  const turnstile = useContext(AuthTurnstileContext);

  function changeEmail() {
    setStage("identify");
    setPassword("");
    setPasswordConfirmation("");
    setCode("");
    setHasPasskey(false);
    setCanRecoverPassword(false);
    setState({ loading: false, error: null });
    turnstile.reset();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPendingRef.current) {
      return;
    }
    if ((stage === "register" || stage === "resetConfirm") && password !== passwordConfirmation) {
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
      const command = stage === "identify"
        ? { kind: "identify" as const, email, ...(turnstileToken ? { turnstileToken } : {}) }
        : stage === "password"
          ? { kind: "login" as const, email, password, ...(turnstileToken ? { turnstileToken } : {}) }
          : stage === "register"
            ? { kind: "register" as const, email, password, ...(turnstileToken ? { turnstileToken } : {}) }
            : stage === "resetStart"
              ? { kind: "request-password-reset" as const, email, ...(turnstileToken ? { turnstileToken } : {}) }
              : { kind: "confirm-password-reset" as const, email, code, newPassword: password, ...(turnstileToken ? { turnstileToken } : {}) };
      const result = await executeAuthAction(command);
      turnstile.reset();
      if (!result.ok) {
        const rejectedPassword = (stage === "password" || stage === "register") && result.code === "AUTH_FAILED";
        setCanRecoverPassword(rejectedPassword);
        if (stage === "register" && rejectedPassword) setStage("password");
        setState({ loading: false, error: result.message });
        return;
      }
      if (stage === "identify") {
        if (result.kind !== "identified") {
          setState({ loading: false, error: "Сервер вернул некорректный ответ. Повторите попытку." });
          return;
        }
        setHasPasskey(result.hasPasskey);
        setStage(result.exists ? "password" : "register");
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
      if (stage === "register") {
        if (result.kind !== "authenticated") {
          setState({ loading: false, error: unknownLoginResultMessage });
          return;
        }
        if (result.emailVerified || !result.verificationRequired) {
          redirectAfterAuth(redirectTo);
        } else {
          redirectAfterAuth(registrationEmailVerificationPath(redirectTo, {
            deliveryFailed: result.verificationDeliveryFailed,
          }));
        }
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
      {stage === "password" && hasPasskey ? (
        <PasskeyLoginButton
          consumeTurnstileToken={turnstile.consumeToken}
          email={email}
          redirectTo={redirectTo}
          resetTurnstile={turnstile.reset}
          turnstileEnabled={turnstile.enabled}
        />
      ) : null}
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText
          autoComplete="username"
          disabled={stage !== "identify"}
          name="email"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {stage === "identify" ? (
        <Message severity="info" text="Введите e-mail — способ входа определится автоматически." />
      ) : stage === "resetStart" ? (
        <Message severity="info" text="Мы отправим отдельный код для восстановления пароля на подтверждённый e-mail." />
      ) : (
        <>
          {stage === "register" ? (
            <Message severity="info" text="Аккаунт не найден. Создайте пароль — код подтверждения будет отправлен на e-mail." />
          ) : null}
          {stage === "resetConfirm" ? (
            <>
              <Message severity="info" text="Введите код восстановления из письма и задайте новый пароль." />
              <label className="flex flex-column gap-2">
                <span className="text-sm font-medium text-700">Код из письма</span>
                <InputText autoComplete="one-time-code" inputMode="numeric" maxLength={6} minLength={6}
                  name="code" required value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
              </label>
            </>
          ) : null}
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">
              {stage === "password" ? "Пароль" : stage === "register" ? "Придумайте пароль" : "Новый пароль"}
            </span>
            <Password
              autoComplete={stage === "password" ? "current-password" : "new-password"}
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
          {stage === "register" || stage === "resetConfirm" ? (
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
          {stage === "password" && canRecoverPassword ? (
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
        </>
      )}
      {stage !== "identify" ? <Button disabled={state.loading} label="Изменить e-mail" onClick={changeEmail} text type="button" /> : null}
      <AuthTurnstileChallenge />
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button
        disabled={state.loading}
        label={stage === "identify"
          ? "Продолжить"
          : stage === "register"
            ? "Создать аккаунт"
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
