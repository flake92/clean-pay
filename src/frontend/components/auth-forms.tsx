"use client";

import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

import { PasskeyLoginButton } from "@/frontend/components/passkey-actions";
import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { BffClientError, readBffError } from "@/frontend/lib/client-api";

type ApiState = {
  loading: boolean;
  error: string | null;
};

type TelegramLoginPayload = {
  auth_date?: number;
  id_token?: string;
  first_name?: string;
  hash?: string;
  id?: number;
  last_name?: string;
  photo_url?: string;
  username?: string;
  error?: string;
};

type TelegramLoginApi = {
  Login?: {
    auth: (
      options: {
        client_id: number;
        scope?: string[];
        nonce: string;
      },
      callback: (payload: TelegramLoginPayload) => void,
    ) => void;
  };
};

declare global {
  interface Window {
    Telegram?: TelegramLoginApi;
  }
}

type LoginMode = "identify" | "password" | "register";

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

  if (error instanceof BffClientError && error.code === "AUTH_FAILED") {
    return "Неверный e-mail или пароль.";
  }

  if (error instanceof BffClientError && error.code === "RATE_LIMITED") {
    return "Слишком много попыток. Попробуйте позже.";
  }

  return error.message;
}

function redirectAfterAuth() {
  window.location.assign("/cabinet");
}

function shouldRedirectAfterRegisterFallback(body: { data?: { user?: { is_email_verified?: boolean }; emailVerification?: unknown } }) {
  return body.data?.user?.is_email_verified === true || !body.data?.emailVerification;
}

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
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

function loadTelegramLoginScript() {
  if (window.Telegram?.Login?.auth) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-clean-pay-telegram-login]");

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Telegram Login script failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.cleanPayTelegramLogin = "true";
    script.src = "https://telegram.org/js/telegram-login.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Telegram Login script failed to load"));
    document.head.appendChild(script);
  });
}

function openTelegramPopup(clientId: string, nonce: string) {
  return new Promise<TelegramLoginPayload>((resolve, reject) => {
    const telegramLogin = window.Telegram?.Login;

    if (!telegramLogin?.auth) {
      reject(new Error("Telegram Login is unavailable"));
      return;
    }

    telegramLogin.auth(
      {
        client_id: Number(clientId),
        scope: ["profile"],
        nonce,
      },
      (payload) => {
        if (payload.id_token || payload.hash) {
          resolve(payload);
          return;
        }

        reject(new Error(payload.error ?? "Telegram login was cancelled"));
      },
    );
  });
}

function useAuthTurnstile() {
  return useContext(AuthTurnstileContext);
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
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);

  const value = useMemo<AuthTurnstileContextValue>(
    () => ({
      enabled,
      siteKey: siteKey ?? null,
      token: enabled ? turnstileToken : null,
      reset: () => {
        turnstile?.reset();
        setTurnstileToken(null);
      },
      setHandle: setTurnstile,
      setToken: setTurnstileToken,
    }),
    [enabled, siteKey, turnstile, turnstileToken],
  );

  return <AuthTurnstileContext.Provider value={value}>{children}</AuthTurnstileContext.Provider>;
}

function AuthTurnstileChallenge() {
  const turnstile = useAuthTurnstile();

  if (!turnstile.enabled) {
    return null;
  }

  return <TurnstileWidget onReady={turnstile.setHandle} onToken={turnstile.setToken} siteKey={turnstile.siteKey} />;
}

export function LoginForm() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<LoginMode>("identify");
  const [knownLocalUser, setKnownLocalUser] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const turnstile = useAuthTurnstile();
  const passwordsDoNotMatch = confirmTouched && confirmPassword.length > 0 && password !== confirmPassword;

  async function identifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim()) {
      setState({ loading: false, error: "Введите e-mail." });
      return;
    }

    setState({ loading: true, error: null });

    const response = await fetch("/api/bff/auth/identify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      setState({ loading: false, error: await readError(response) });
      return;
    }

    const body = (await response.json()) as { data?: { exists?: boolean; hasPasskey?: boolean } };

    setHasPasskey(Boolean(body.data?.hasPasskey));
    setKnownLocalUser(Boolean(body.data?.exists));
    setMode("password");
    setState({ loading: false, error: null });
  }

  function changeEmail() {
    setState({ loading: false, error: null });
    setMode("identify");
    setKnownLocalUser(false);
    setHasPasskey(false);
    setPassword("");
    setConfirmPassword("");
    setConfirmTouched(false);
  }

  async function continueWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (turnstile.enabled && !turnstile.token) {
      setState({ loading: false, error: missingTurnstileTokenMessage(turnstile.siteKey) });
      return;
    }

    setState({ loading: true, error: null });

    const formData = new FormData(event.currentTarget);
    const response = await fetch(knownLocalUser ? "/api/bff/auth/login" : "/api/bff/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: formData.get("password"),
        ...turnstilePayload(turnstile.token),
      }),
    });

    if (!response.ok) {
      turnstile.reset();
      setState({ loading: false, error: await readError(response) });
      return;
    }

    if (knownLocalUser) {
      redirectAfterAuth();
      return;
    }

    const body = (await response.json()) as { data?: { user?: { is_email_verified?: boolean }; emailVerification?: unknown } };
    if (shouldRedirectAfterRegisterFallback(body)) {
      redirectAfterAuth();
      return;
    }

    window.location.assign("/register/verify-email");
  }

  async function register(event: FormEvent<HTMLFormElement>) {
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
      setState({ loading: false, error: missingTurnstileTokenMessage(turnstile.siteKey) });
      return;
    }

    setState({ loading: true, error: null });

    const response = await fetch("/api/bff/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: formData.get("password"),
        ...turnstilePayload(turnstile.token),
      }),
    });

    if (!response.ok) {
      turnstile.reset();
      setState({ loading: false, error: await readError(response) });
      return;
    }

    const body = (await response.json()) as { data?: { user?: { is_email_verified?: boolean }; emailVerification?: unknown } };
    if (shouldRedirectAfterRegisterFallback(body)) {
      redirectAfterAuth();
      return;
    }

    window.location.assign("/register/verify-email");
  }

  const accountHeader =
    mode === "identify" ? null : (
      <div
        className="auth-account-summary"
        style={{
          alignItems: "center",
          display: "flex",
          gap: "12px",
          justifyContent: "space-between",
          minWidth: 0,
        }}
      >
        <div className="auth-account-identity" style={{ minWidth: 0 }}>
          <i className="pi pi-envelope auth-account-icon" />
          <div className="auth-account-text" style={{ minWidth: 0 }}>
            <div className="auth-account-label">E-mail</div>
            <div className="auth-account-email" title={email}>{email}</div>
          </div>
        </div>
        <Button className="auth-account-change" label="Изменить" onClick={changeEmail} size="small" text type="button" />
      </div>
    );

  if (mode === "identify") {
    return (
      <form className="flex flex-column gap-3" onSubmit={identifyEmail}>
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">E-mail</span>
          <InputText
            autoComplete="username"
            id="login-email"
            name="email"
            placeholder="user@example.com"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <AuthTurnstileChallenge />
        {state.error ? <Message severity="error" text={state.error} /> : null}
        <Button disabled={state.loading} label="Продолжить" loading={state.loading} type="submit" />
      </form>
    );
  }

  if (mode === "register") {
    return (
      <form className="flex flex-column gap-3" onSubmit={register}>
        {accountHeader}
        <Message severity="info" text="Аккаунт не найден. Создайте пароль, и мы отправим код подтверждения на e-mail." />
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">Пароль</span>
          <Password
            appendTo="self"
            autoComplete="new-password"
            className="w-full"
            feedback={false}
            inputId="register-password-inline"
            inputClassName="w-full"
            minLength={8}
            name="password"
            placeholder="Придумайте пароль"
            required
            toggleMask
            value={password}
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
            inputId="register-password-confirm-inline"
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
        <Button disabled={state.loading} label="Создать аккаунт" loading={state.loading} type="submit" />
      </form>
    );
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={continueWithPassword}>
      {accountHeader}
      {hasPasskey ? <PasskeyLoginButton /> : null}
      {!knownLocalUser ? (
        <Message
          severity="info"
          text="Введите пароль. Если аккаунт уже есть, мы войдем в него. Если аккаунта нет, создадим и отправим код на e-mail."
        />
      ) : null}
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Пароль</span>
        <Password
          autoComplete={knownLocalUser ? "current-password" : "new-password"}
          className="w-full"
          feedback={false}
          inputId="login-password"
          inputClassName="w-full"
          minLength={knownLocalUser ? undefined : 8}
          name="password"
          placeholder="Введите пароль"
          required
          toggleMask
        />
      </label>
      <AuthTurnstileChallenge />
      {state.error ? <Message severity="error" text={state.error} /> : null}
      <Button disabled={state.loading} label="Продолжить" loading={state.loading} type="submit" />
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
      setState({ loading: false, error: missingTurnstileTokenMessage(turnstile.siteKey) });
      return;
    }

    setState({ loading: true, error: null });

    const response = await fetch("/api/bff/auth/register", {
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

    const body = (await response.json()) as { data?: { user?: { is_email_verified?: boolean }; emailVerification?: unknown } };
    if (shouldRedirectAfterRegisterFallback(body)) {
      redirectAfterAuth();
      return;
    }

    window.location.assign("/register/verify-email");
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
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
  const missingTurnstileMessage = missingTurnstileTokenMessage(turnstile.siteKey);

  useEffect(() => {
    setState((current) => (current.error === missingTurnstileMessage ? { loading: false, error: null } : current));
  }, [missingTurnstileMessage, turnstile.token]);

  async function onClick() {
    if (turnstile.enabled && !turnstile.token) {
      setState({ loading: false, error: missingTurnstileMessage });
      return;
    }

    setState({ loading: true, error: null });

    try {
      const url = new URL("/auth/telegram/start", window.location.origin);
      url.searchParams.set("mode", "popup");
      url.searchParams.set("redirect_to", redirectTo);
      if (turnstile.token) {
        url.searchParams.set("turnstile_token", turnstile.token);
        url.searchParams.set("cf-turnstile-response", turnstile.token);
      }

      const startResponse = await fetch(url.toString(), {
        cache: "no-store",
      });

      if (!startResponse.ok) {
        throw new Error(await readError(startResponse));
      }

      const startBody = await startResponse.json() as { clientId?: string; nonce?: string };

      if (!startBody.clientId || !startBody.nonce) {
        throw new Error("Telegram login configuration is invalid.");
      }

      await loadTelegramLoginScript();
      const telegramPayload = await openTelegramPopup(startBody.clientId, startBody.nonce);
      const callbackResponse = await fetch("/auth/telegram/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(telegramPayload.id_token
          ? { idToken: telegramPayload.id_token }
          : { authData: telegramPayload }),
      });

      if (!callbackResponse.ok) {
        throw new Error(await readError(callbackResponse));
      }

      const callbackBody = await callbackResponse.json() as { redirectTo?: string };
      window.location.assign(callbackBody.redirectTo ?? redirectTo);
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : "Telegram login failed.",
      });
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
        onClick={onClick}
        severity="info"
        type="button"
      />
    </div>
  );
}
