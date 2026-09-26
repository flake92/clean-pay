"use client";

import {
  Button,
  InputText,
  Message,
} from "@/frontend/components/sakai/form-foundation";
import { TurnstileWidget } from "@/frontend/components/turnstile-widget";
import {
  registerEmailConfirmComposition,
  useRegisterEmailConfirmController,
} from "@/frontend/hooks/use-register-email-confirm-controller";

export function RegisterEmailConfirmForm({
  redirectTo = "/cabinet",
  turnstileEnabled = false,
  turnstileSiteKey,
  verificationDeliveryFailed = false,
}: {
  redirectTo?: string;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
  verificationDeliveryFailed?: boolean;
}) {
  const {
    error,
    goBackToRegister,
    loading,
    message,
    onSubmit,
    resendCode,
    setTurnstile,
    setTurnstileToken,
  } = useRegisterEmailConfirmController({
    resetSupportSession: registerEmailConfirmComposition.resetChatwootSession(),
    clearSession: registerEmailConfirmComposition.clearSessionAction(),
    passkeyDestination: registerEmailConfirmComposition.passkeySetupPath(redirectTo),
    redirectTo,
    turnstileEnabled,
    turnstileSiteKey,
  });

  return (
    <div className="flex flex-column gap-3">
      {verificationDeliveryFailed ? (
        <Message
          severity="warn"
          text="Аккаунт создан, но письмо с кодом не удалось отправить автоматически. Нажмите «Отправить код повторно»."
        />
      ) : null}
      {turnstileEnabled ? (
        <TurnstileWidget action="email_verification" onReady={setTurnstile} onToken={setTurnstileToken} siteKey={turnstileSiteKey} />
      ) : null}
      <form className="flex flex-column gap-3" onSubmit={onSubmit}>
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">Код подтверждения</span>
          <InputText
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            name="code"
            pattern="[0-9]{6}"
            placeholder="000000"
            required
          />
        </label>
        {error ? <Message severity="error" text={error} /> : null}
        {message ? <Message severity="success" text={message} /> : null}
        <div className="flex flex-column gap-2 sm:flex-row">
          <Button
            className="flex-1"
            disabled={loading !== null}
            label="Подтвердить e-mail"
            loading={loading === "confirm"}
            type="submit"
          />
          <Button
            className="flex-1"
            disabled={loading !== null}
            label="Отправить код повторно"
            loading={loading === "resend"}
            onClick={resendCode}
            outlined
            type="button"
          />
          <Button
            className="flex-1"
            disabled={loading !== null}
            label="Назад"
            loading={loading === "back"}
            onClick={goBackToRegister}
            outlined
            severity="secondary"
            type="button"
          />
        </div>
      </form>
    </div>
  );
}
