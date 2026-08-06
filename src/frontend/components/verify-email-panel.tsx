"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import {
  checkAccountReadinessAction,
  confirmEmailVerificationCodeAction,
  requestEmailVerificationCodeAction,
} from "@/app/actions/email-verification";
import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { navigateTo, replaceWith } from "@/frontend/lib/browser-navigation";
import {
  accountLinkPath,
  accountSetupCompletePath,
  emailVerificationPath,
} from "@/shared/auth/account-setup-flow";
import type { AccountReadiness } from "@/shared/presentation/email-verification";

const defaultReadiness: AccountReadiness = { status: "pending", emailVerified: false };

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Ключ сайта Cloudflare Turnstile не настроен.";
}

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageSeverity, setMessageSeverity] = useState<"success" | "warn">("success");
  const [confirmed, setConfirmed] = useState(false);
  const [accountSyncPending, setAccountSyncPending] = useState(false);
  const [syncProblem, setSyncProblem] = useState<
    "merge-conflict" | "unauthorized" | null
  >(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);
  const actionLoadingRef = useRef<string | null>(null);
  const completedDestination = accountSetupCompletePath(redirectTo);
  const verificationDestination = emailVerificationPath(redirectTo);

  useEffect(() => {
    let alive = true;

    async function loadVerificationState() {
      const readiness = initialReadiness;

      if (!alive) {
        return;
      }

      if (readiness.status === "ready") {
        setConfirmed(true);
        setAccountSyncPending(false);
        setSyncProblem(null);
        setMessageSeverity("success");
        setMessage(
          autoContinue
            ? "E-mail уже подтверждён. Возвращаем вас к прерванному действию."
            : "E-mail уже подтверждён. Повторно вводить код не нужно.",
        );

        if (autoContinue) {
          replaceWith(completedDestination);
        }
        return;
      }

      if (
        autoContinue &&
        readiness.status === "pending" &&
        readiness.emailVerified
      ) {
        setConfirmed(true);
        setAccountSyncPending(true);
        setMessageSeverity("warn");
        setMessage(
          "E-mail подтверждён. Синхронизация с Telegram ещё продолжается; оплату пока не создаём. Проверьте готовность ещё раз.",
        );
        return;
      }

      if (
        autoContinue &&
        (readiness.status === "merge-conflict" ||
          readiness.status === "unauthorized" ||
          readiness.status === "unavailable")
      ) {
        setConfirmed(true);
        setAccountSyncPending(true);
        setSyncProblem(
          readiness.status === "unavailable" ? null : readiness.status,
        );
        setMessageSeverity("warn");
        setMessage(
          readiness.status === "merge-conflict"
            ? "Автоматическое объединение аккаунтов остановлено из-за конфликта данных. Оплата не создана; обратитесь в поддержку."
            : readiness.status === "unauthorized"
              ? "Сессия завершилась во время настройки. Войдите снова, чтобы безопасно продолжить с той же оплаты."
              : "Не удалось определить статус подтверждения. Пока не вводите код повторно; сначала повторите безопасную проверку.",
        );
      }
    }

    void loadVerificationState();

    return () => {
      alive = false;
    };
  }, [autoContinue, completedDestination, initialReadiness]);

  function resetTurnstile() {
    turnstile?.reset();
    setTurnstileToken(null);
  }

  function beginAction(action: string) {
    if (actionLoadingRef.current !== null) {
      return false;
    }

    actionLoadingRef.current = action;
    setLoading(action);
    return true;
  }

  function finishAction(action: string) {
    if (actionLoadingRef.current !== action) {
      return;
    }

    actionLoadingRef.current = null;
    setLoading(null);
  }

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLoadingRef.current !== null) {
      return;
    }
    setMessage(null);
    setError(null);

    if (turnstileEnabled && !turnstileToken) {
      setError(missingTurnstileTokenMessage(turnstileSiteKey));
      return;
    }
    if (!beginAction("request")) {
      return;
    }

    try {
      const formData = new FormData(event.currentTarget);
      const email = formData.get("email");
      const result = await requestEmailVerificationCodeAction({
        ...(email ? { email: String(email) } : {}),
        ...(turnstileToken ? { turnstileToken } : {}),
      });

      if (!result.ok) {
        resetTurnstile();
        setTargetEmail(null);
        if (result.code === "EMAIL_REQUIRED") {
          if (autoContinue) {
            setError(
              "Связь с e-mail нужно восстановить. Возвращаем к вводу e-mail и пароля.",
            );
            replaceWith(
              accountLinkPath(redirectTo, { passwordRequired: true }),
            );
          } else {
            setError(null);
          }
        } else {
          setError(result.message);
        }
        return;
      }

      if (result.kind !== "code-sent") return;
      setTargetEmail(result.targetEmail);
      setMessageSeverity("success");
      setMessage(`Код отправлен на ${result.targetEmail}.`);
      resetTurnstile();
    } catch {
      resetTurnstile();
      setTargetEmail(null);
      setError("Не удалось отправить код. Проверьте соединение и попробуйте снова.");
    } finally {
      finishAction("request");
    }
  }

  async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLoadingRef.current !== null) {
      return;
    }
    setMessage(null);
    setError(null);

    if (turnstileEnabled && !turnstileToken) {
      setError(missingTurnstileTokenMessage(turnstileSiteKey));
      return;
    }
    if (!beginAction("confirm")) {
      return;
    }

    try {
      const formData = new FormData(event.currentTarget);
      const result = await confirmEmailVerificationCodeAction({
        ...(targetEmail ? { email: targetEmail } : {}),
        code: String(formData.get("code") ?? ""),
        ...(turnstileToken ? { turnstileToken } : {}),
      });

      if (!result.ok) {
        resetTurnstile();
        if (result.code === "EMAIL_REQUIRED") {
          if (autoContinue) {
            setError(
              "Связь с e-mail нужно восстановить. Возвращаем к вводу e-mail и пароля.",
            );
            replaceWith(
              accountLinkPath(redirectTo, { passwordRequired: true }),
            );
          } else {
            setError(null);
          }
        } else {
          setError(result.message);
        }
        return;
      }

      if (result.kind !== "confirmed") return;
      const readiness = result.readiness;

      const accountReady = readiness.status === "ready";
      setConfirmed(true);
      setAccountSyncPending(!accountReady);
      setSyncProblem(
        readiness.status === "merge-conflict" ||
          readiness.status === "unauthorized"
          ? readiness.status
          : null,
      );
      setMessageSeverity(accountReady ? "success" : "warn");
      setMessage(
        accountReady
          ? autoContinue
            ? "E-mail подтверждён. Возвращаем вас к прерванному действию."
            : "E-mail успешно подтверждён."
          : readiness.status === "merge-conflict"
            ? "E-mail подтверждён, но автоматическое объединение остановлено из-за конфликта данных. Оплата не создана; обратитесь в поддержку."
            : readiness.status === "unauthorized"
              ? "E-mail подтверждён, но сессия завершилась. Войдите снова, чтобы безопасно продолжить с той же оплаты."
              : readiness.status === "unavailable"
                ? "E-mail подтверждён, но готовность аккаунта сейчас проверить не удалось. Код повторно вводить не нужно; повторите проверку."
              : autoContinue
                ? "E-mail подтверждён. Синхронизация с Telegram ещё продолжается; оплату пока не создаём. Проверьте готовность ещё раз."
                : "E-mail подтверждён. Синхронизация аккаунта ещё продолжается; статус можно проверить в профиле.",
      );
      resetTurnstile();

      if (autoContinue && accountReady) {
        replaceWith(completedDestination);
      }
    } catch {
      resetTurnstile();
      setError("Не удалось подтвердить e-mail. Проверьте соединение и попробуйте снова.");
    } finally {
      finishAction("confirm");
    }
  }

  async function continueAfterSynchronization() {
    if (!beginAction("continue")) {
      return;
    }
    setMessageSeverity("warn");
    setMessage("Проверяем готовность аккаунта...");

    const readiness = await checkAccountReadinessAction();

    if (readiness.status === "ready") {
      setAccountSyncPending(false);
      setSyncProblem(null);
      setMessageSeverity("success");
      setMessage("Аккаунт готов. Возвращаем вас к прерванному действию.");
      replaceWith(completedDestination);
      finishAction("continue");
      return;
    }

    if (
      readiness.status === "pending" &&
      !readiness.emailVerified
    ) {
      setConfirmed(false);
      setAccountSyncPending(false);
      setSyncProblem(null);
      setMessageSeverity("warn");
      setMessage(
        "E-mail ещё не подтверждён. Введите код из письма, чтобы продолжить.",
      );
      finishAction("continue");
      return;
    }

    setAccountSyncPending(true);
    setSyncProblem(
      readiness.status === "merge-conflict" ||
        readiness.status === "unauthorized"
        ? readiness.status
        : null,
    );
    setMessage(
      readiness.status === "merge-conflict"
        ? "Автоматическое объединение аккаунтов остановлено из-за конфликта данных. Повторная оплата не создавалась; обратитесь в поддержку."
        : readiness.status === "unauthorized"
          ? "Сессия завершилась. Войдите снова, чтобы продолжить с той же оплаты."
          : readiness.status === "unavailable"
            ? "Готовность аккаунта сейчас проверить не удалось. Код повторно вводить не нужно; повторите проверку позже."
          : "E-mail подтверждён, но синхронизация аккаунта ещё не завершена. Подождите немного и повторите проверку; повторная оплата не создавалась.",
    );
    finishAction("continue");
  }

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
              href={`/login?${new URLSearchParams({
                redirect_to: verificationDestination,
              }).toString()}`}
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
              onClick={() => {
                if (autoContinue && accountSyncPending) {
                  void continueAfterSynchronization();
                  return;
                }

                navigateTo(autoContinue ? completedDestination : "/profile");
              }}
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
