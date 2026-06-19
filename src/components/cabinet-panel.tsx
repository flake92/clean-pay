"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

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

type PaymentRecord = {
  payment_id: string;
  purchase_type: string;
  status: string;
  final_amount: string;
  currency: string;
  gateway_type: string;
  plan_name: string | null;
  duration_days: number | null;
  is_free: boolean;
  created_at: string;
};

type SupportSettings = {
  enabled: boolean;
  email: string | null;
  telegramUsername: string | null;
  faqUrl: string | null;
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

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Ожидает",
    completed: "Оплачен",
    failed: "Ошибка",
    canceled: "Отменён",
    refunded: "Возврат",
    unknown: "Неизвестно",
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

async function getBffMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);

  return body?.error?.message ?? fallback;
}

export function CabinetPanel() {
  const [user, setUser] = useState<CabinetUser | null>(null);
  const [subscription, setSubscription] = useState<CurrentSubscription | null>(null);
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [support, setSupport] = useState<SupportSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [promocode, setPromocode] = useState("");

  const loadSubscription = useCallback(async () => {
    const subscriptionResponse = await fetch("/api/bff/subscription/current");

    if (subscriptionResponse.ok) {
      const subscriptionBody = await subscriptionResponse.json();
      setSubscription(subscriptionBody.data);
      setSubscriptionError(null);
    } else if (subscriptionResponse.status === 404) {
      setSubscription(null);
      setSubscriptionError(null);
    } else {
      setSubscriptionError(
        await getBffMessage(subscriptionResponse, "Не удалось загрузить подписку."),
      );
    }
  }, []);

  const loadDevices = useCallback(async () => {
    const devicesResponse = await fetch("/api/bff/subscription/devices");

    if (devicesResponse.ok) {
      const devicesBody = await devicesResponse.json();
      setDevices(devicesBody.data);
    }
  }, []);

  const loadPayments = useCallback(async () => {
    const paymentsResponse = await fetch("/api/bff/payments/history");

    if (paymentsResponse.ok) {
      const paymentsBody = await paymentsResponse.json();
      setPayments(paymentsBody.data);
    }
  }, []);

  const loadSupport = useCallback(async () => {
    const supportResponse = await fetch("/api/bff/support");

    if (supportResponse.ok) {
      const supportBody = await supportResponse.json();
      setSupport(supportBody.data);
    }
  }, []);

  useEffect(() => {
    async function loadCabinet() {
      try {
        const profileResponse = await fetch("/api/bff/auth/me");

        if (!profileResponse.ok) {
          throw new Error("Нужно войти в аккаунт.");
        }

        const profileBody = await profileResponse.json();
        setUser(profileBody.data.user);

        await loadSubscription();
        await loadDevices();
        await loadPayments();
        await loadSupport();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить кабинет.");
      }
    }

    loadCabinet();
  }, [loadDevices, loadPayments, loadSubscription, loadSupport]);

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

  async function deleteDevice(hwid: string) {
    const confirmed = window.confirm("Удалить это устройство из подписки?");

    if (!confirmed) {
      return;
    }

    setPendingAction(`delete-device-${hwid}`);
    setActionMessage(null);

    try {
      const response = await fetch(
        `/api/bff/subscription/devices/${encodeURIComponent(hwid)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error(await getBffMessage(response, "Не удалось удалить устройство."));
      }

      setActionMessage("Устройство удалено.");
      await loadDevices();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Не удалось удалить устройство.");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteAllDevices() {
    const confirmed = window.confirm("Удалить все устройства из подписки?");

    if (!confirmed) {
      return;
    }

    setPendingAction("delete-all-devices");
    setActionMessage(null);

    try {
      const response = await fetch("/api/bff/subscription/devices", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getBffMessage(response, "Не удалось удалить устройства."));
      }

      setActionMessage("Все устройства удалены.");
      await loadDevices();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Не удалось удалить устройства.");
    } finally {
      setPendingAction(null);
    }
  }

  async function reissueSubscription() {
    const confirmed = window.confirm(
      "Перевыпуск подписки отключит все текущие устройства. Продолжить?",
    );

    if (!confirmed) {
      return;
    }

    setPendingAction("reissue");
    setActionMessage(null);

    try {
      const response = await fetch("/api/bff/subscription/reissue", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await getBffMessage(response, "Не удалось перевыпустить подписку."));
      }

      setActionMessage("Подписка перевыпущена. Ссылка обновлена.");
      await loadSubscription();
      await loadDevices();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Не удалось перевыпустить подписку.");
    } finally {
      setPendingAction(null);
    }
  }

  async function activatePromocode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const code = promocode.trim();

    if (!code) {
      setActionMessage("Введите промокод.");
      return;
    }

    setPendingAction("promocode");
    setActionMessage(null);

    try {
      const response = await fetch("/api/bff/subscription/promocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        throw new Error(await getBffMessage(response, "Не удалось активировать промокод."));
      }

      setPromocode("");
      setActionMessage("Промокод активирован.");
      await loadSubscription();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Не удалось активировать промокод.");
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

            <div className="grid gap-3 border-t border-zinc-200 pt-4">
              <div className="flex flex-wrap gap-3">
                <button
                  className="border border-red-300 bg-white px-4 py-2 text-red-700 disabled:opacity-60"
                  disabled={pendingAction === "reissue"}
                  onClick={reissueSubscription}
                  type="button"
                >
                  Перевыпустить подписку
                </button>
                {devices && devices.devices.length > 0 ? (
                  <button
                    className="border border-red-300 bg-white px-4 py-2 text-red-700 disabled:opacity-60"
                    disabled={pendingAction === "delete-all-devices"}
                    onClick={deleteAllDevices}
                    type="button"
                  >
                    Удалить все устройства
                  </button>
                ) : null}
              </div>
              <p className="text-sm text-zinc-600">
                Перевыпуск подписки отключит все текущие устройства.
              </p>
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
          {actionMessage ? (
            <p className="border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              {actionMessage}
            </p>
          ) : null}

          <form
            className="grid gap-3 border border-zinc-200 bg-white p-4 sm:grid-cols-[1fr_auto]"
            onSubmit={activatePromocode}
          >
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-zinc-700">Промокод</span>
              <input
                className="border border-zinc-300 px-3 py-2 outline-none focus:border-cyan-600"
                onChange={(event) => setPromocode(event.target.value)}
                placeholder="Введите код"
                value={promocode}
              />
            </label>
            <button
              className="self-end bg-zinc-950 px-4 py-2 text-white disabled:opacity-60"
              disabled={pendingAction === "promocode"}
              type="submit"
            >
              Активировать
            </button>
          </form>

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
                  <div className="mt-3">
                    <button
                      className="border border-zinc-300 px-3 py-2 text-sm text-zinc-700 disabled:opacity-60"
                      disabled={pendingAction === `delete-device-${device.hwid}`}
                      onClick={() => deleteDevice(device.hwid)}
                      type="button"
                    >
                      Удалить устройство
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">Подключенных устройств пока нет.</p>
          )}
        </section>
      ) : null}

      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">История платежей</h2>
        {payments.length > 0 ? (
          <div className="grid gap-3">
            {payments.map((payment) => (
              <div
                className="grid gap-3 border border-zinc-200 p-4 sm:grid-cols-[1fr_auto]"
                key={payment.payment_id}
              >
                <div>
                  <p className="font-medium">
                    {payment.plan_name ?? payment.purchase_type}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {formatDate(payment.created_at)} · {payment.gateway_type}
                    {payment.duration_days ? ` · ${payment.duration_days} дней` : ""}
                  </p>
                  <p className="mt-1 break-all text-xs text-zinc-500">
                    {payment.payment_id}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="font-semibold">
                    {payment.final_amount} {payment.currency}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {payment.is_free ? "Бесплатно" : paymentStatusLabel(payment.status)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-600">Платежей через web-кабинет пока нет.</p>
        )}
      </section>

      {support?.enabled &&
      (support.email || support.telegramUsername || support.faqUrl) ? (
        <section className="grid gap-4 border border-zinc-200 bg-zinc-50 p-5">
          <h2 className="text-xl font-semibold">Поддержка</h2>
          <div className="flex flex-wrap gap-3">
            {support.email ? (
              <a
                className="border border-zinc-300 bg-white px-4 py-2"
                href={`mailto:${support.email}`}
              >
                Написать на почту
              </a>
            ) : null}
            {support.telegramUsername ? (
              <a
                className="border border-zinc-300 bg-white px-4 py-2"
                href={`https://t.me/${support.telegramUsername.replace(/^@/, "")}`}
                rel="noreferrer"
                target="_blank"
              >
                Telegram
              </a>
            ) : null}
            {support.faqUrl ? (
              <a
                className="border border-zinc-300 bg-white px-4 py-2"
                href={support.faqUrl}
                rel="noreferrer"
                target="_blank"
              >
                FAQ
              </a>
            ) : null}
          </div>
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
        <a className="border border-zinc-300 px-4 py-2" href="/profile">
          Профиль
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
