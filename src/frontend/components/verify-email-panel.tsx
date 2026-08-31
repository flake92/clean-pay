"use client";

import { Card } from "primereact/card";

import type { AccountReadiness } from "@/application/models/email-verification";
import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  Button,
  InputText,
  Message,
} from "@/frontend/components/sakai/form-foundation";
import { TurnstileWidget } from "@/frontend/components/turnstile-widget";
import { useVerifyEmailController } from "@/frontend/hooks/use-verify-email-controller";
import { sessionRefreshPath } from "@/shared/auth/session-navigation";

const defaultReadiness: AccountReadiness = {
  status: "pending",
  emailVerified: false,
};

export function VerifyEmailPanel({
  autoContinue = false,
  initialReadiness = defaultReadiness,
  redirectTo = "/profile",
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  autoContinue?: boolean;
  initialReadiness?: AccountReadiness;
  redirectTo?: string;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const {
    accountSyncPending,
    confirmed,
    confirmCode,
    continueFromConfirmation,
    error,
    loading,
    message,
    messageSeverity,
    requestCode,
    setTurnstile,
    setTurnstileToken,
    syncProblem,
    verificationDestination,
  } = useVerifyEmailController({
    autoContinue,
    initialReadiness,
    redirectTo,
    turnstileEnabled,
    turnstileSiteKey,
  });

  if (confirmed) {
    return (
      <Card title="Подтверждение e-mail">
        <div className="flex flex-column gap-3" aria-live="polite">
          <Message severity={messageSeverity} text={message ?? "E-mail подтверждён."} />
          {syncProblem === "merge-conflict" ? (
            <LinkButton
              className="w-fit"
              href="/support"
              label="Обратиться в поддержку"
            />
          ) : syncProblem === "unauthorized" ? (
            <LinkButton
              className="w-fit"
              href={sessionRefreshPath(verificationDestination)}
              label="Войти и продолжить"
            />
          ) : (
            <Button
              className="w-fit"
              disabled={loading !== null}
              label={
                autoContinue
                  ? accountSyncPending
                    ? "Проверить и продолжить"
                    : "Продолжить"
                  : "Перейти в профиль"
              }
              loading={loading === "continue"}
              onClick={continueFromConfirmation}
              type="button"
            />
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-column gap-4">
      {error || message ? (
        <div className="sticky top-0 z-5" aria-live="assertive">
          <Message
            className="w-full shadow-2"
            severity={error ? "error" : messageSeverity}
            text={error ?? message ?? ""}
          />
        </div>
      ) : null}
      {turnstileEnabled ? (
        <TurnstileWidget action="email_verification" onReady={setTurnstile} onToken={setTurnstileToken} siteKey={turnstileSiteKey} />
      ) : null}
      <Card title="Введите код из письма">
        <p className="mt-0 line-height-3 text-600">
          Если код уже отправлен, просто введите 6 цифр из письма. Повторная отправка доступна ниже.
        </p>
        <form className="flex flex-column gap-3" onSubmit={confirmCode}>
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
          <Button
            disabled={loading !== null}
            label="Подтвердить e-mail"
            loading={loading === "confirm"}
            type="submit"
          />
        </form>
      </Card>
      <Card title="Отправить код повторно">
        <p className="mt-0 line-height-3 text-600">
          Код можно запросить не чаще одного раза в минуту.
        </p>
        <form className="flex flex-column gap-3" onSubmit={requestCode}>
          <label className="flex flex-column gap-2">
            <span className="text-sm font-medium text-700">E-mail</span>
            <InputText name="email" placeholder="user@example.com" type="email" />
          </label>
          <Button
            disabled={loading !== null}
            label="Отправить код повторно"
            loading={loading === "request"}
            severity="info"
            type="submit"
          />
        </form>
      </Card>
    </div>
  );
}
