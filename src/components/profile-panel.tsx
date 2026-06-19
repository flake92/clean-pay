"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

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
  const body = await response.json().catch(() => null);

  return body?.error?.message ?? fallback;
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
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(body?.error?.message ?? "Не удалось загрузить профиль.");
    }

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
      setMessage("Новый e-mail сохранён как ожидающий подтверждения.");
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
      <div className="grid gap-4">
        <p className="text-red-700">{error}</p>
        <a className="text-cyan-700" href="/login">
          Войти
        </a>
      </div>
    );
  }

  if (!user) {
    return <p className="text-zinc-600">Загрузка профиля...</p>;
  }

  return (
    <div className="grid gap-6">
      {message ? (
        <p className="border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          {message}
        </p>
      ) : null}

      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Данные аккаунта</h2>
        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
            <dt className="text-zinc-500">Имя</dt>
            <dd>{user.name}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
            <dt className="text-zinc-500">E-mail</dt>
            <dd>{user.email ?? "Не указан"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
            <dt className="text-zinc-500">Ожидает подтверждения</dt>
            <dd>{user.pending_email ?? "-"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
            <dt className="text-zinc-500">E-mail подтверждён</dt>
            <dd>{user.is_email_verified ? "Да" : "Нет"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
            <dt className="text-zinc-500">Тип входа</dt>
            <dd>{user.auth_type}</dd>
          </div>
        </dl>
      </section>

      <form className="grid gap-4 border border-zinc-200 p-5" onSubmit={changeEmail}>
        <h2 className="text-xl font-semibold">Смена e-mail</h2>
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-zinc-700">Новый e-mail</span>
          <input
            className="h-11 border border-zinc-300 px-3 outline-none focus:border-cyan-600"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            className="h-11 bg-zinc-950 px-4 text-white disabled:opacity-60"
            disabled={pendingAction === "email"}
            type="submit"
          >
            Сохранить e-mail
          </button>
          <button
            className="h-11 border border-zinc-300 px-4 disabled:opacity-60"
            disabled={pendingAction === "verification"}
            onClick={requestVerification}
            type="button"
          >
            Отправить код
          </button>
          <a
            className="inline-flex h-11 items-center border border-zinc-300 px-4"
            href="/verify-email"
          >
            Ввести код
          </a>
        </div>
      </form>

      <form className="grid gap-4 border border-zinc-200 p-5" onSubmit={changePassword}>
        <h2 className="text-xl font-semibold">Смена пароля</h2>
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-zinc-700">Текущий пароль</span>
          <input
            className="h-11 border border-zinc-300 px-3 outline-none focus:border-cyan-600"
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            value={currentPassword}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-zinc-700">Новый пароль</span>
          <input
            className="h-11 border border-zinc-300 px-3 outline-none focus:border-cyan-600"
            minLength={8}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />
        </label>
        <button
          className="h-11 w-fit bg-zinc-950 px-4 text-white disabled:opacity-60"
          disabled={pendingAction === "password"}
          type="submit"
        >
          Изменить пароль
        </button>
      </form>
    </div>
  );
}
