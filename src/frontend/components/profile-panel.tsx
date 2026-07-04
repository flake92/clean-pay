"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { BffClientError, readBffError } from "@/frontend/lib/client-api";

type ProfileUser = {
  telegram_id: string | number | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  auth_type: string;
  email: string | null;
  is_email_verified: boolean;
  emailVerified?: boolean;
  pending_email: string | null;
  language: string;
};

async function readError(response: Response, fallback: string) {
  return readBffError(response, fallback);
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

function authTypeLabel(value: string) {
  return value === "telegram" ? "Telegram" : "E-mail";
}

export function ProfilePanel({
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageSeverity, setMessageSeverity] = useState<"success" | "info" | "warn">("info");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function fetchProfile() {
    const response = await fetch("/api/bff/auth/me");

    if (!response.ok) {
      throw await readBffError(response, "Не удалось загрузить профиль.");
    }

    const body = await response.json().catch(() => null);

    return body.data.user as ProfileUser;
  }

  const loadProfile = useCallback(async () => {
    const profile = await fetchProfile();

    setUser(profile);
    setEmail(profile.pending_email ?? profile.email ?? "");
  }, []);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        await loadProfile();
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить профиль.");
        }
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, [loadProfile]);

  function showMessage(text: string, severity: "success" | "info" | "warn" = "info") {
    setMessage(text);
    setMessageSeverity(severity);
  }

  function ensureTurnstileToken() {
    if (!turnstileEnabled || turnstileToken) {
      return true;
    }

    showMessage(missingTurnstileTokenMessage(turnstileSiteKey), "warn");
    return false;
  }

  function resetTurnstile() {
    turnstile?.reset();
    setTurnstileToken(null);
  }

  async function requestVerificationFor(nextTargetEmail: string) {
    const response = await fetch("/api/bff/auth/email/request-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(nextTargetEmail ? { email: nextTargetEmail } : {}),
        ...turnstilePayload(turnstileToken),
      }),
    });

    if (!response.ok) {
      throw await readError(response, "Не удалось отправить код.");
    }

    const body = await response.json().catch(() => null);

    return body?.data?.target_email ?? nextTargetEmail;
  }

  function messageFromError(err: unknown, fallback: string) {
    if (err instanceof BffClientError && err.code === "EMAIL_REQUIRED") {
      return "Чтобы привязать e-mail к Telegram-аккаунту, используйте раздел «Связать аккаунт».";
    }

    if (err instanceof BffClientError && err.code === "CONFLICT") {
      return "Этот e-mail уже используется другим аккаунтом.";
    }

    return err instanceof Error ? err.message : fallback;
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("email");
    setMessage(null);

    const nextEmail = email.trim();
    const currentTarget = user?.pending_email ?? user?.email ?? "";
    const isSameEmail = nextEmail.toLowerCase() === currentTarget.toLowerCase();

    try {
      if (!ensureTurnstileToken()) {
        return;
      }

      if (isSameEmail) {
        const sentTo = await requestVerificationFor(nextEmail);
        showMessage(`E-mail уже указан. Код подтверждения отправлен на ${sentTo}.`, "success");
        window.location.assign("/verify-email");
        return;
      }

      const response = await fetch("/api/bff/auth/email/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: nextEmail,
          ...turnstilePayload(turnstileToken),
        }),
      });

      if (!response.ok) {
        throw await readError(response, "Не удалось изменить e-mail.");
      }

      const body = await response.json().catch(() => null);
      const nextTargetEmail =
        body?.data?.emailVerification?.target_email ?? body?.data?.pending_email ?? nextEmail;
      await loadProfile();
      showMessage(`Новый e-mail сохранен. Код подтверждения отправлен на ${nextTargetEmail}.`, "success");
      window.location.assign("/verify-email");
    } catch (err) {
      showMessage(messageFromError(err, "Не удалось изменить e-mail."), "warn");
    } finally {
      resetTurnstile();
      setPendingAction(null);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("password");
    setMessage(null);

    try {
      const response = await fetch("/api/bff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!response.ok) {
        throw await readError(response, "Не удалось изменить пароль.");
      }

      setCurrentPassword("");
      setNewPassword("");
      showMessage("Пароль изменен.", "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Не удалось изменить пароль.", "warn");
    } finally {
      setPendingAction(null);
    }
  }

  if (error) {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={error} />
        <LinkButton className="w-fit" href="/login" label="Войти" />
      </div>
    );
  }

  if (!user) {
    return <Message severity="info" text="Загрузка профиля..." />;
  }

  const telegramId = user.telegramId ?? user.telegram_id;
  const hasEmail = Boolean(user.email);
  const isEmailVerified = hasEmail && Boolean(user.emailVerified ?? user.is_email_verified);
  const isTelegramOnly = Boolean(telegramId) && !user.email;
  const canManageRemnashopEmail = Boolean(user.email);
  const canChangePassword = user.auth_type === "email" && Boolean(user.email);
  return (
    <div className="flex flex-column gap-4">
      {message ? <Message severity={messageSeverity} text={message} /> : null}

      <Card title="Данные аккаунта">
        <div className="grid">
          {[
            ["E-mail", user.email ?? "Не привязан"],
            ["Тип входа", authTypeLabel(user.auth_type)],
            ["Telegram", telegramId ?? "Не привязан"],
          ].map(([label, value]) => (
            <div className="col-12 md:col-6" key={label}>
              <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
                <div className="text-xs uppercase text-500">{label}</div>
                <div className="mt-1 font-medium text-900 break-words">{value}</div>
              </div>
            </div>
          ))}
          <div className="col-12 md:col-6">
            <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
              <div className="text-xs uppercase text-500">E-mail подтвержден</div>
              <div className="mt-2">
                <Tag
                  severity={hasEmail ? (isEmailVerified ? "success" : "warning") : "secondary"}
                  value={hasEmail ? (isEmailVerified ? "Да" : "Нет") : "Не привязан"}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {isTelegramOnly ? (
        <Card title="Привязать e-mail">
          <div className="flex flex-column gap-3">
            <p className="m-0 line-height-3 text-600">
              Вы вошли через Telegram. Чтобы оплачивать и управлять подпиской, привяжите e-mail к аккаунту.
            </p>
            <LinkButton className="w-fit" href="/link-account" label="Привязать e-mail" />
          </div>
        </Card>
      ) : null}

      {canManageRemnashopEmail ? (
        <Card title="Смена e-mail">
          <form className="flex flex-column gap-3" onSubmit={changeEmail}>
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Новый e-mail</span>
              <InputText
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            {turnstileEnabled ? (
              <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} siteKey={turnstileSiteKey} />
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={pendingAction === "email"}
                label="Сохранить и отправить код"
                loading={pendingAction === "email"}
                type="submit"
              />
            </div>
          </form>
        </Card>
      ) : null}

      {canChangePassword ? (
        <Card title="Смена пароля">
          <form className="flex flex-column gap-3" onSubmit={changePassword}>
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Текущий пароль</span>
              <Password
                className="w-full"
                feedback={false}
                inputClassName="w-full"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                toggleMask
                value={currentPassword}
              />
            </label>
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Новый пароль</span>
              <Password
                className="w-full"
                inputClassName="w-full"
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                toggleMask
                value={newPassword}
              />
            </label>
            <Button
              className="w-fit"
              disabled={pendingAction === "password"}
              label="Изменить пароль"
              loading={pendingAction === "password"}
              type="submit"
            />
          </form>
        </Card>
      ) : null}
    </div>
  );
}
