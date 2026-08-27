"use client";

import { createContext, useContext, type ReactNode } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

import {
  authPasswordLabel,
  authSubmitLabel,
} from "@/frontend/components/auth-form-presentation";
import { selectAuthFormView } from "@/frontend/components/auth-form-transitions";
import { PasskeyLoginButton } from "@/frontend/components/passkey-actions";
import { passwordToggleA11y } from "@/frontend/components/password-toggle-a11y";
import { TurnstileWidget } from "@/frontend/components/turnstile-widget";
import {
  useAuthFormController,
  useAuthTurnstileController,
  useTelegramLoginController,
  type AuthTurnstileControllerValue,
} from "@/frontend/hooks/use-auth-form-controller";

const AuthTurnstileContext = createContext<AuthTurnstileControllerValue>({
  enabled: false,
  siteKey: null,
  token: null,
  consumeToken: () => null,
  reset: () => {},
  setHandle: () => {},
  setToken: () => {},
});

export function AuthTurnstileProvider({
  enabled,
  children,
  siteKey,
}: {
  enabled: boolean;
  children: ReactNode;
  siteKey?: string | null;
}) {
  const value = useAuthTurnstileController({ enabled, siteKey });

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
  const turnstile = useContext(AuthTurnstileContext);
  const controller = useAuthFormController({
    initialError,
    redirectTo,
    turnstile,
  });
  const {
    api,
    changeCodeInput,
    changeEmail,
    changeEmailInput,
    changePasswordConfirmationInput,
    changePasswordInput,
    code,
    email,
    password,
    passwordConfirmation,
    requestPasswordRecovery,
    stage,
    submit,
  } = controller;
  const view = selectAuthFormView(controller);

  return (
    <form className="flex flex-column gap-3" onSubmit={submit}>
      {view.showPasskey ? (
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
          onChange={changeEmailInput}
        />
      </label>
      {view.showIdentifyMessage ? (
        <Message severity="info" text="Введите e-mail — способ входа определится автоматически." />
      ) : view.showResetStartMessage ? (
        <Message severity="info" text="Мы отправим отдельный код для восстановления пароля на подтверждённый e-mail." />
      ) : (
        <>
          {view.showRegisterMessage ? (
            <Message severity="info" text="Аккаунт не найден. Создайте пароль — код подтверждения будет отправлен на e-mail." />
          ) : null}
          {view.showResetConfirmation ? (
            <>
              <Message severity="info" text="Введите код восстановления из письма и задайте новый пароль." />
              <label className="flex flex-column gap-2">
                <span className="text-sm font-medium text-700">Код из письма</span>
                <InputText autoComplete="one-time-code" inputMode="numeric" maxLength={6} minLength={6}
                  name="code" required value={code}
                  onChange={changeCodeInput} />
              </label>
            </>
          ) : null}
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">
              {authPasswordLabel(stage)}
            </span>
            <Password
              autoComplete={stage === "password" ? "current-password" : "new-password"}
              className="w-full"
              feedback={false}
              inputClassName="w-full"
              maxLength={256}
              minLength={8}
              name="password"
              pt={passwordToggleA11y.primary}
              required
              toggleMask
              value={password}
              onChange={changePasswordInput}
            />
          </label>
          {view.showPasswordConfirmation ? (
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Повторите новый пароль</span>
              <Password
                autoComplete="new-password"
                className="w-full"
                feedback={false}
                inputClassName="w-full"
                maxLength={256}
                minLength={8}
                name="passwordConfirmation"
                pt={passwordToggleA11y.confirmation}
                required
                toggleMask
                value={passwordConfirmation}
                onChange={changePasswordConfirmationInput}
              />
            </label>
          ) : null}
          {view.showPasswordRecovery ? (
            <Button
              disabled={api.loading}
              label="Забыли пароль?"
              onClick={requestPasswordRecovery}
              text
              type="button"
            />
          ) : null}
        </>
      )}
      {view.showEmailChange ? <Button disabled={api.loading} label="Изменить e-mail" onClick={changeEmail} text type="button" /> : null}
      <AuthTurnstileChallenge />
      {api.error ? <Message severity="error" text={api.error} /> : null}
      <Button
        disabled={api.loading}
        label={authSubmitLabel(stage)}
        loading={api.loading}
        type="submit"
      />
    </form>
  );
}

export function TelegramLoginButton({ redirectTo = "/cabinet" }: { redirectTo?: string }) {
  const turnstile = useContext(AuthTurnstileContext);
  const { error, loading, login } = useTelegramLoginController({
    redirectTo,
    turnstile,
  });

  return (
    <div className="flex flex-column gap-2">
      {error ? <Message severity="error" text={error} /> : null}
      <Button
        disabled={loading}
        icon="pi pi-send"
        label="Войти через Telegram"
        loading={loading}
        onClick={login}
        severity="info"
        type="button"
      />
    </div>
  );
}
