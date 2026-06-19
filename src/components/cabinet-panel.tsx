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

type CurrentSubscription = {
  user_remna_id: string;
  status: string;
  is_trial: boolean;
  traffic_limit: number;
  device_limit: number;
  traffic_limit_strategy: string;
  expire_at: string;
  url: string;
  plan_name: string;
  plan_duration_days: number;
  used_traffic_bytes?: number | null;
  lifetime_used_traffic_bytes?: number | null;
  online_at?: string | null;
};

type SubscriptionDevice = {
  hwid: string;
  platform?: string | null;
  device_model?: string | null;
  os_version?: string | null;
  user_agent?: string | null;
};

type DevicesResponse = {
  devices: SubscriptionDevice[];
  current_count: number;
  max_count: number;
};

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value?: number | null) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (value <= 0) {
    return "0 Б";
  }

  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;

  return `${amount.toLocaleString("ru-RU", {
    maximumFractionDigits: amount >= 10 ? 1 : 2,
  })} ${units[index]}`;
}

function formatTrafficLimit(value: number) {
  return value > 0 ? formatBytes(value) : "Без лимита";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Активна",
    disabled: "Отключена",
    expired: "Истекла",
    limited: "Ограничена",
  };

  return labels[status] ?? status;
}

function detailValue(value?: string | number | boolean | null) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Да" : "Нет";
  }

  return String(value);
}

export function CabinetPanel() {
  const [user, setUser] = useState<CabinetUser | null>(null);
  const [subscription, setSubscription] = useState<CurrentSubscription | null>(null);
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    async function loadCabinet() {
      try {
        const profileResponse = await fetch("/api/bff/auth/me");

        if (!profileResponse.ok) {
          throw new Error("Нужно войти в аккаунт.");
        }

        const profileBody = await profileResponse.json();
        setUser(profileBody.data.user);

        const subscriptionResponse = await fetch("/api/bff/subscription/current");

        if (subscriptionResponse.ok) {
          const subscriptionBody = await subscriptionResponse.json();
          setSubscription(subscriptionBody.data);
        } else if (subscriptionResponse.status !== 404) {
          const body = await subscriptionResponse.json().catch(() => null);
          setSubscriptionError(body?.error?.message ?? "Не удалось загрузить подписку.");
        }

        const devicesResponse = await fetch("/api/bff/subscription/devices");

        if (devicesResponse.ok) {
          const devicesBody = await devicesResponse.json();
          setDevices(devicesBody.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить кабинет.");
      }
    }

    loadCabinet();
  }, []);

  async function logout() {
    await fetch("/api/bff/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  async function copySubscriptionUrl() {
    if (!subscription?.url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(subscription.url);
      setCopyStatus("Ссылка скопирована");
    } catch {
      setCopyStatus("Не удалось скопировать");
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
    return <p className="text-zinc-600">Загрузка...</p>;
  }

  const usedTraffic = subscription?.used_traffic_bytes ?? null;
  const trafficLimit = subscription?.traffic_limit ?? 0;
  const usagePercent =
    usedTraffic !== null && trafficLimit > 0
      ? Math.min(100, Math.round((usedTraffic / trafficLimit) * 100))
      : null;
  const deviceCount = devices?.current_count ?? null;
  const maxDevices = devices?.max_count ?? subscription?.device_limit ?? null;

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500">Текущая подписка</p>
            <h2 className="mt-1 text-2xl font-semibold">
              {subscription?.plan_name ?? "Подписка не активна"}
            </h2>
          </div>
          <span className="w-fit border border-cyan-200 bg-cyan-50 px-3 py-1 text-sm font-medium text-cyan-800">
            {subscription ? statusLabel(subscription.status) : "Нет подписки"}
          </span>
        </div>

        {subscriptionError ? (
          <p className="text-sm text-red-700">{subscriptionError}</p>
        ) : null}

        {subscription ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase text-zinc-500">Действует до</p>
                <p className="mt-2 font-medium">{formatDate(subscription.expire_at)}</p>
              </div>
              <div className="border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase text-zinc-500">Устройства</p>
                <p className="mt-2 font-medium">
                  {deviceCount !== null && maxDevices !== null
                    ? `${deviceCount} из ${maxDevices}`
                    : maxDevices !== null
                      ? `До ${maxDevices}`
                      : "-"}
                </p>
              </div>
              <div className="border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase text-zinc-500">Трафик</p>
                <p className="mt-2 font-medium">
                  {formatBytes(usedTraffic)} / {formatTrafficLimit(subscription.traffic_limit)}
                </p>
              </div>
            </div>

            {usagePercent !== null ? (
              <div>
                <div className="h-2 w-full overflow-hidden bg-zinc-200">
                  <div
                    className="h-full bg-cyan-600"
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-zinc-600">
                  Использовано {usagePercent}% текущего лимита
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <a
                className="bg-zinc-950 px-4 py-2 text-white"
                href={subscription.url}
                rel="noreferrer"
                target="_blank"
              >
                Подключиться
              </a>
              <button
                className="border border-zinc-300 bg-white px-4 py-2"
                onClick={copySubscriptionUrl}
                type="button"
              >
                Скопировать ссылку подписки
              </button>
              {copyStatus ? (
                <span className="text-sm text-zinc-600">{copyStatus}</span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-3">
            <a className="bg-zinc-950 px-4 py-2 text-white" href="/tariffs">
              Выбрать тариф
            </a>
            <a className="border border-zinc-300 bg-white px-4 py-2" href="/link-account">
              Привязать аккаунт
            </a>
          </div>
        )}
      </section>

      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Профиль</h2>
        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between gap-4 border-b border-zinc-200 pb-2">
            <dt className="text-zinc-500">Имя</dt>
            <dd>{user.name ?? user.fullName ?? user.displayName ?? "-"}</dd>
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
      </section>

      {subscription ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-semibold">Детали подписки</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="border border-zinc-200 p-3">
              <dt className="text-zinc-500">Remnawave ID</dt>
              <dd className="mt-1 break-all">{subscription.user_remna_id}</dd>
            </div>
            <div className="border border-zinc-200 p-3">
              <dt className="text-zinc-500">Пробная</dt>
              <dd className="mt-1">{detailValue(subscription.is_trial)}</dd>
            </div>
            <div className="border border-zinc-200 p-3">
              <dt className="text-zinc-500">Длительность тарифа</dt>
              <dd className="mt-1">{subscription.plan_duration_days} дней</dd>
            </div>
            <div className="border border-zinc-200 p-3">
              <dt className="text-zinc-500">Стратегия лимита</dt>
              <dd className="mt-1">{detailValue(subscription.traffic_limit_strategy)}</dd>
            </div>
            <div className="border border-zinc-200 p-3">
              <dt className="text-zinc-500">Использовано всего</dt>
              <dd className="mt-1">
                {formatBytes(subscription.lifetime_used_traffic_bytes)}
              </dd>
            </div>
            <div className="border border-zinc-200 p-3">
              <dt className="text-zinc-500">Онлайн</dt>
              <dd className="mt-1">{formatDate(subscription.online_at)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {devices ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-semibold">Устройства</h2>
          {devices.devices.length > 0 ? (
            <div className="grid gap-3">
              {devices.devices.map((device) => (
                <div className="border border-zinc-200 p-4" key={device.hwid}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {device.device_model ?? device.platform ?? "Устройство"}
                      </p>
                      <p className="mt-1 break-all text-sm text-zinc-500">{device.hwid}</p>
                    </div>
                    <p className="text-sm text-zinc-500">
                      {detailValue(device.os_version)}
                    </p>
                  </div>
                  {device.user_agent ? (
                    <p className="mt-3 break-all text-xs text-zinc-500">
                      {device.user_agent}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">Подключенных устройств пока нет.</p>
          )}
        </section>
      ) : null}

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
