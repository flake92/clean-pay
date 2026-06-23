"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { readBffError } from "@/lib/client-api";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";
import { LinkButton } from "@/components/prime/link-button";

type ProfileUser = {
  telegram_id: number | null;
  auth_type: string;
  email: string | null;
  is_email_verified: boolean;
  pending_email: string | null;
  name: string;
  username: string | null;
  language: string;
};

async function readError(response: Response, fallback: string) {
  return (await readBffError(response, fallback)).message;
}

export function ProfilePanel() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function fetchProfile() {
    const response = await fetch("/api/bff/auth/me");

    if (!response.ok) {
      throw await readBffError(response, 'Не удалось загрузить профиль.');
    }

    const body = await response.json().catch(() => null);

    return body.data.user as ProfileUser;
  }

  async function loadProfile() {
    const profile = await fetchProfile();

    setUser(profile);
    setEmail(profile.pending_email ?? profile.email ?? "");
  }

  useEffect(() => {
    fetchProfile()
      .then((profile) => {
        setUser(profile);
        setEmail(profile.pending_email ?? profile.email ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("email");
    setMessage(null);

    try {
      const response = await fetch("/api/bff/auth/email/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Не удалось изменить e-mail."));
      }

      await loadProfile();
      setMessage("Новый e-mail сохранён, код подтверждения отправлен.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не удалось изменить e-mail.");
    } finally {
      setPendingAction(null);
    }
  }

  async function requestVerification() {
    setPendingAction("verification");
    setMessage(null);

    try {
      const targetEmail = user?.pending_email ?? user?.email ?? email;
      const response = await fetch("/api/bff/auth/email/request-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(targetEmail ? { email: targetEmail } : {}),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Не удалось отправить код."));
      }

      setMessage("Код подтверждения отправлен.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не удалось отправить код.");
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
        throw new Error(await readError(response, "Не удалось изменить пароль."));
      }

      setCurrentPassword("");
      setNewPassword("");
      setMessage("Пароль изменён.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не удалось изменить пароль.");
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

  return (
    <div className="flex flex-column gap-4">
      {message ? (
        <Message severity="info" text={message} />
      ) : null}

      <Card title="Данные аккаунта">
        <div className="grid">
          {[
            ["Имя", user.name],
            ["E-mail", user.email ?? "Не указан"],
            ["Ожидает подтверждения", user.pending_email ?? "-"],
            ["Тип входа", user.auth_type],
          ].map(([label, value]) => (
            <div className="col-12 md:col-6" key={label}>
            <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
              <div className="text-xs uppercase text-500">{label}</div>
              <div className="mt-1 font-medium text-900">{value}</div>
            </div>
            </div>
          ))}
          <div className="col-12 md:col-6">
          <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
            <div className="text-xs uppercase text-500">E-mail подтверждён</div>
            <div className="mt-2">
              <Tag
                severity={user.is_email_verified ? "success" : "warning"}
                value={user.is_email_verified ? "Да" : "Нет"}
              />
            </div>
          </div>
          </div>
        </div>
      </Card>

      <Card title="Смена e-mail">
      <form className="flex flex-column gap-3" onSubmit={changeEmail}>
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">Новый e-mail</span>
          <InputText onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
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
          <LinkButton href="/verify-email" label="Ввести код" outlined />
        </div>
      </form>
      </Card>

      <Card title="Смена пароля">
      <form className="flex flex-column gap-3" onSubmit={changePassword}>
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">Текущий пароль</span>
          <Password
            className="w-full"
            feedback={false}
            inputClassName="w-full"
            onChange={(event) => setCurrentPassword(event.target.value)}
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
    </div>
  );
}
