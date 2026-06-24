"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";

import { LinkButton } from "@/components/prime/link-button";
import { BffClientError, readBffError } from "@/lib/client-api";

type ProfileUser = {
  telegram_id: string | number | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  auth_type: string;
  email: string | null;
  is_email_verified: boolean;
  emailVerified?: boolean;
  pending_email: string | null;
  name: string;
  username: string | null;
  language: string;
};

async function readError(response: Response, fallback: string) {
  return readBffError(response, fallback);
}

function authTypeLabel(value: string) {
  return value === "telegram" ? "Telegram" : "E-mail";
}

export function ProfilePanel() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
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
    setTargetEmail(profile.pending_email);
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

  async function requestVerificationFor(nextTargetEmail: string) {
    const response = await fetch("/api/bff/auth/email/request-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextTargetEmail ? { email: nextTargetEmail } : {}),
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
      if (isSameEmail) {
        const sentTo = await requestVerificationFor(nextEmail);
        setTargetEmail(sentTo);
        showMessage(`E-mail уже указан. Код подтверждения отправлен на ${sentTo}.`, "success");
        return;
      }

      const response = await fetch("/api/bff/auth/email/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: nextEmail }),
      });

      if (!response.ok) {
        throw await readError(response, "Не удалось изменить e-mail.");
      }

      const body = await response.json().catch(() => null);
      const nextTargetEmail =
        body?.data?.emailVerification?.target_email ?? body?.data?.pending_email ?? nextEmail;
      setTargetEmail(nextTargetEmail);
      await loadProfile();
      showMessage(`Новый e-mail сохранен. Код подтверждения отправлен на ${nextTargetEmail}.`, "success");
    } catch (err) {
      showMessage(messageFromError(err, "Не удалось изменить e-mail."), "warn");
    } finally {
      setPendingAction(null);
    }
  }

  async function requestVerification() {
    setPendingAction("verification");
    setMessage(null);

    try {
      const nextTargetEmail = user?.pending_email ?? targetEmail ?? user?.email ?? email;
      const sentTo = await requestVerificationFor(nextTargetEmail);
      setTargetEmail(sentTo);
      showMessage(`Код подтверждения отправлен на ${sentTo}.`, "success");
    } catch (err) {
      showMessage(messageFromError(err, "Не удалось отправить код."), "warn");
    } finally {
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
  const isEmailVerified = user.emailVerified ?? user.is_email_verified;
  const isTelegramOnly = Boolean(telegramId) && !user.email;
  const canManageRemnashopEmail = Boolean(user.email);
  const canChangePassword = user.auth_type === "email" && Boolean(user.email);
  const canEnterCode = Boolean(targetEmail || user.pending_email);

  return (
    <div className="flex flex-column gap-4">
      {message ? <Message severity={messageSeverity} text={message} /> : null}

      <Card title="Данные аккаунта">
        <div className="grid">
          {[
            ["Имя", user.name || user.username || "-"],
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
                <Tag severity={isEmailVerified ? "success" : "warning"} value={isEmailVerified ? "Да" : "Нет"} />
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
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={pendingAction === "email"}
                label="Сохранить e-mail"
                loading={pendingAction === "email"}
                type="submit"
              />
              <Button
                disabled={pendingAction === "verification"}
                label="Отправить код"
                loading={pendingAction === "verification"}
                onClick={requestVerification}
                outlined
                type="button"
              />
              {canEnterCode ? <LinkButton href="/verify-email" label="Ввести код" outlined /> : null}
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
