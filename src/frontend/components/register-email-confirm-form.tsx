"use client";

import { useRef, useState } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { navigateTo } from "@/frontend/lib/browser-navigation";
import { readBffError } from "@/frontend/lib/client-api";
import { passkeySetupPath } from "@/shared/auth/account-setup-flow";

async function readError(response: Response, fallback: string) {
  return (await readBffError(response, fallback)).message;
}

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

export function RegisterEmailConfirmForm({
  redirectTo = "/cabinet",
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  redirectTo?: string;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [loading, setLoading] = useState<"confirm" | "resend" | "back" | null>(null);
  const loadingRef = useRef<"confirm" | "resend" | "back" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);

  function beginLoading(action: "confirm" | "resend" | "back") {
    if (loadingRef.current) {
      return false;
    }

    loadingRef.current = action;
    setLoading(action);
    return true;
  }

  function finishLoading(action: "confirm" | "resend" | "back") {
    if (loadingRef.current !== action) {
      return;
    }

    loadingRef.current = null;
    setLoading(null);
  }

  function ensureTurnstileToken() {
    if (!turnstileEnabled || turnstileToken) {
      return true;
    }

    setError(missingTurnstileTokenMessage(turnstileSiteKey));
    return false;
  }

  async function goBackToRegister() {
    if (!beginLoading("back")) {
      return;
    }

    setError(null);

    try {
      const response = await fetch("/api/bff/auth/logout", { method: "POST" });

      if (!response.ok) {
        setError(await readError(response, "Не удалось вернуться к регистрации."));
        return;
      }

      navigateTo(`/register?${new URLSearchParams({
        redirect_to: redirectTo,
      }).toString()}`);
    } catch {
      setError("Сеть недоступна. Не удалось вернуться к регистрации.");
    } finally {
      finishLoading("back");
    }
  }

  async function resendCode() {
    setError(null);
    setMessage(null);

    if (!ensureTurnstileToken()) {
      return;
    }

    if (!beginLoading("resend")) {
      return;
    }

    try {
      const response = await fetch("/api/bff/auth/email/request-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(turnstilePayload(turnstileToken)),
      });

      if (!response.ok) {
        turnstile?.reset();
        setTurnstileToken(null);
        setError(await readError(response, "Не удалось повторно отправить код."));
        return;
      }

      const body = await response.json().catch(() => null);
      const targetEmail = body?.data?.target_email;
      setMessage(targetEmail ? `Код повторно отправлен на ${targetEmail}.` : "Код повторно отправлен.");
      turnstile?.reset();
      setTurnstileToken(null);
    } catch {
      turnstile?.reset();
      setTurnstileToken(null);
      setError("Сеть недоступна. Не удалось повторно отправить код.");
    } finally {
      finishLoading("resend");
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!ensureTurnstileToken()) {
      return;
    }

    if (!beginLoading("confirm")) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/bff/auth/email/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: formData.get("code"),
          ...turnstilePayload(turnstileToken),
        }),
      });

      if (!response.ok) {
        turnstile?.reset();
        setTurnstileToken(null);
        setError(await readError(response, "Не удалось подтвердить e-mail."));
        return;
      }

      navigateTo(passkeySetupPath(redirectTo));
    } catch {
      turnstile?.reset();
      setTurnstileToken(null);
      setError("Сеть недоступна. Не удалось подтвердить e-mail.");
    } finally {
      finishLoading("confirm");
    }
  }

  return (
    <div className="flex flex-column gap-3">
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
