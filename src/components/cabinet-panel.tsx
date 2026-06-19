"use client";

import { useEffect, useState } from "react";

type CabinetUser = {
  email: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  name?: string;
  fullName?: string | null;
  displayName?: string | null;
  is_email_verified?: boolean;
  emailVerified?: boolean;
};

export function CabinetPanel() {
  const [user, setUser] = useState<CabinetUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bff/auth/me")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Нужно войти в аккаунт.");
        }

        return response.json();
      })
      .then((body) => setUser(body.data.user))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function logout() {
    await fetch("/api/bff/auth/logout", { method: "POST" });
    window.location.href = "/login";
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
    return <p className="text-zinc-600">Загрузка...</p>;
  }

  return (
    <div className="grid gap-5">
      <dl className="grid gap-3 text-sm">
        <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
          <dt className="text-zinc-500">Имя</dt>
          <dd>{user.name ?? user.fullName ?? user.displayName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
          <dt className="text-zinc-500">E-mail</dt>
          <dd>{user.email ?? "Не привязан"}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
          <dt className="text-zinc-500">Telegram</dt>
          <dd>
            {user.telegramUsername
              ? `@${user.telegramUsername}`
              : user.telegramId
                ? user.telegramId
                : "Не привязан"}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
          <dt className="text-zinc-500">E-mail подтверждён</dt>
          <dd>{user.is_email_verified ?? user.emailVerified ? "Да" : "Нет"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        <a className="border border-zinc-300 px-4 py-2" href="/extend">
          Продлить
        </a>
        <a className="border border-zinc-300 px-4 py-2" href="/tariffs">
          Тарифы
        </a>
        <a className="border border-zinc-300 px-4 py-2" href="/verify-email">
          Подтвердить e-mail
        </a>
        <a className="border border-zinc-300 px-4 py-2" href="/link-account">
          Привязать аккаунт
        </a>
        <button className="bg-zinc-950 px-4 py-2 text-white" onClick={logout}>
          Выйти
        </button>
      </div>
    </div>
  );
}
