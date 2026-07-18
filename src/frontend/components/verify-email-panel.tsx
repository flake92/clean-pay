"use client";

import { useEffect, useState } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { BffClientError, readBffError } from "@/frontend/lib/client-api";

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Ключ сайта Cloudflare Turnstile не настроен.";
}

function turnstilePayload(token: string | null) {
  return token
    ? {
        turnstileToken: token,
        "cf-turnstile-response": token,
      }
    : {};
}

export function VerifyEmailPanel({
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageSeverity, setMessageSeverity] = useState<"success" | "warn">("success");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadVerificationState() {
      try {
        const response = await fetch("/api/bff/auth/me", { cache: "no-store" });
        const body = response.ok ? await response.json() : null;
        const user = body?.data?.user;

        if (
          alive &&
          user?.email &&
          Boolean(user.emailVerified ?? user.is_email_verified)
        ) {
          setConfirmed(true);
          setMessageSeverity("success");
          setMessage("E-mail уже подтверждён. Повторно вводить код не нужно.");
        }
      } catch {
        // The form remains usable when this optional state preflight is unavailable.
      }
    }

    void loadVerificationState();

    return () => {
      alive = false;
    };
  }, []);

  function resetTurnstile() {
    turnstile?.reset();
    setTurnstileToken(null);
  }

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading("request");

    if (turnstileEnabled && !turnstileToken) {
      setLoading(null);
      setError(missingTurnstileTokenMessage(turnstileSiteKey));
      return;
    }

    try {
      const formData = new FormData(event.currentTarget);
      const email = formData.get("email");
      const response = await fetch("/api/bff/auth/email/request-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email ? String(email) : undefined,
          ...turnstilePayload(turnstileToken),
        }),
      });

      if (!response.ok) {
        resetTurnstile();
        setTargetEmail(null);
        const requestError = await readBffError(response, "Не удалось отправить код.");
        if (requestError instanceof BffClientError && requestError.code === "EMAIL_REQUIRED") {
          setError(null);
        } else {
          setError(requestError.message);
        }
        return;
      }

      const body = await response.json();
      setTargetEmail(body.data.target_email);
      setMessageSeverity("success");
      setMessage(`Код отправлен на ${body.data.target_email}.`);
      resetTurnstile();
    } catch {
      resetTurnstile();
      setTargetEmail(null);
      setError("Не удалось отправить код. Проверьте соединение и попробуйте снова.");
    } finally {
      setLoading(null);
    }
  }

  async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading("confirm");

    if (turnstileEnabled && !turnstileToken) {
      setLoading(null);
      setError(missingTurnstileTokenMessage(turnstileSiteKey));
      return;
    }

    try {
      const formData = new FormData(event.currentTarget);
      const response = await fetch("/api/bff/auth/email/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: targetEmail ?? undefined,
          code: formData.get("code"),
          ...turnstilePayload(turnstileToken),
        }),
      });

      if (!response.ok) {
        resetTurnstile();
        const confirmError = await readBffError(response, "Не удалось подтвердить e-mail.");
        if (confirmError instanceof BffClientError && confirmError.code === "EMAIL_REQUIRED") {
          setError(null);
        } else {
          setError(confirmError.message);
        }
        return;
      }

      const body = await response.json();
      const accountSyncPending = Boolean(body?.data?.account_sync_pending);
      setConfirmed(true);
      setMessageSeverity(accountSyncPending ? "warn" : "success");
      setMessage(
        accountSyncPending
          ? "E-mail подтверждён. Синхронизация с Telegram продолжится автоматически; если подписка не появилась, обратитесь в поддержку."
          : "E-mail успешно подтверждён.",
      );
      resetTurnstile();
    } catch {
      resetTurnstile();
      setError("Не удалось подтвердить e-mail. Проверьте соединение и попробуйте снова.");
    } finally {
      setLoading(null);
    }
  }

  if (confirmed) {
    return (
      <Card title="Подтверждение e-mail">
        <div className="flex flex-column gap-3" aria-live="polite">
          <Message severity={messageSeverity} text={message ?? "E-mail подтверждён."} />
          <Button
            className="w-fit"
            label="Перейти в профиль"
            onClick={() => window.location.assign("/profile")}
            type="button"
          />
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
        <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} siteKey={turnstileSiteKey} />
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
            disabled={loading === "confirm"}
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
            disabled={loading === "request"}
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
