"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { readBffError } from "@/frontend/lib/client-api";
import { ProgressBar } from "primereact/progressbar";
import { Tag } from "primereact/tag";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { hasRenewOffer } from "@/frontend/lib/subscription-offers";
import type { SubscriptionOffersResponse } from "@/shared/remnashop/types";

type CabinetUser = {
  email: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
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

function statusSeverity(status?: string): "success" | "warning" | "danger" | "info" {
  if (status === "active" || status === "completed") {
    return "success";
  }

  if (status === "pending" || status === "limited") {
    return "warning";
  }

  if (status === "failed" || status === "canceled" || status === "expired" || status === "disabled") {
    return "danger";
  }

  return "info";
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

function trafficLimitStrategyLabel(strategy?: string | null) {
  const normalized = strategy?.toUpperCase();

  if (normalized === "NO_RESET") {
    return "Не сбрасывать";
  }

  if (normalized === "RESET") {
    return "Сбрасывать";
  }

  return detailValue(strategy);
}

async function getBffMessage(response: Response, fallback: string) {
  return (await readBffError(response, fallback)).message;
}

export function CabinetPanel() {
  const [user, setUser] = useState<CabinetUser | null>(null);
  const [subscription, setSubscription] = useState<CurrentSubscription | null>(null);
  const [offers, setOffers] = useState<SubscriptionOffersResponse | null>(null);
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

  const loadOffers = useCallback(async () => {
    const offersResponse = await fetch("/api/bff/subscription/offers");

    if (offersResponse.ok) {
      const offersBody = await offersResponse.json();
      setOffers(offersBody.data);
    } else {
      setOffers(null);
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
        await loadOffers();
        await loadDevices();
        await loadPayments();
        await loadSupport();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить кабинет.");
      }
    }

    loadCabinet();
  }, [loadDevices, loadOffers, loadPayments, loadSubscription, loadSupport]);

  async function logout() {
    await fetch("/api/bff/auth/logout", { method: "POST", cache: "no-store" }).catch(() => null);
    window.location.replace("/login");
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
      <div className="card">
        <Message severity="error" text={error} />
        <div className="mt-3">
          <LinkButton href="/login" label="Войти" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Message severity="info" text="Загрузка кабинета..." />;
  }

  const usedTraffic = subscription?.used_traffic_bytes ?? null;
  const trafficLimit = subscription?.traffic_limit ?? 0;
  const usagePercent =
    usedTraffic !== null && trafficLimit > 0
      ? Math.min(100, Math.round((usedTraffic / trafficLimit) * 100))
      : null;
  const deviceCount = devices?.current_count ?? null;
  const maxDevices = devices?.max_count ?? subscription?.device_limit ?? null;
  const isEmailVerified = user.emailVerified ?? user.is_email_verified ?? false;
  const shouldShowVerifyEmail = Boolean(user.email) && !isEmailVerified;
  const shouldShowLinkAccount = !user.email || !user.telegramId;

  return (
    <div className="grid">
      <div className="col-12 lg:col-6 xl:col-3">
        <Metric icon="pi pi-shield" label="Подписка" tone="blue" value={subscription?.plan_name ?? "Не активна"} />
      </div>
      <div className="col-12 lg:col-6 xl:col-3">
        <Metric icon="pi pi-calendar" label="Действует до" tone="orange" value={subscription ? formatDate(subscription.expire_at) : "-"} />
      </div>
      <div className="col-12 lg:col-6 xl:col-3">
        <Metric
          icon="pi pi-mobile"
          label="Устройства"
          tone="cyan"
          value={
            deviceCount !== null && maxDevices !== null
              ? `${deviceCount} из ${maxDevices}`
              : maxDevices !== null
                ? `До ${maxDevices}`
                : "-"
          }
        />
      </div>
      <div className="col-12 lg:col-6 xl:col-3">
        <Metric icon="pi pi-database" label="Трафик" tone="purple" value={`${formatBytes(usedTraffic)} / ${subscription ? formatTrafficLimit(subscription.traffic_limit) : "-"}`} />
      </div>

      <div className="col-12 xl:col-8">
      <div className="card">
        <div className="flex flex-column gap-4">
          <div className="flex flex-column gap-3 md:flex-row md:align-items-start md:justify-content-between">
            <div>
              <span className="text-sm font-medium text-500">Текущая подписка</span>
              <h2 className="mt-2 mb-0 text-3xl font-semibold text-900">
                {subscription?.plan_name ?? "Подписка не активна"}
              </h2>
            </div>
            <Tag
              severity={subscription ? statusSeverity(subscription.status) : "warning"}
              value={subscription ? statusLabel(subscription.status) : "Нет подписки"}
            />
          </div>

          {subscriptionError ? <Message severity="error" text={subscriptionError} /> : null}

          {subscription ? (
            <>
              {usagePercent !== null ? (
                <div>
                  <ProgressBar value={usagePercent} />
                  <p className="mt-2 mb-0 text-sm text-600">
                    Использовано {usagePercent}% текущего лимита
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap align-items-center gap-2">
                <LinkButton
                  external
                  href={subscription.url}
                  icon="pi pi-external-link"
                  label="Подключиться"
                />
                <Button
                  icon="pi pi-copy"
                  label="Скопировать ссылку"
                  onClick={copySubscriptionUrl}
                  outlined
                  type="button"
                />
                {copyStatus ? <Message severity="info" text={copyStatus} /> : null}
              </div>

              <Message
                severity="warn"
                text="Перевыпуск подписки отключит все текущие устройства."
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={pendingAction === "reissue"}
                  label="Перевыпустить подписку"
                  loading={pendingAction === "reissue"}
                  onClick={reissueSubscription}
                  outlined
                  severity="danger"
                  type="button"
                />
                {devices && devices.devices.length > 0 ? (
                  <Button
                    disabled={pendingAction === "delete-all-devices"}
                    label="Удалить все устройства"
                    loading={pendingAction === "delete-all-devices"}
                    onClick={deleteAllDevices}
                    outlined
                    severity="danger"
                    type="button"
                  />
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/tariffs" label="Выбрать тариф" />
              <LinkButton href="/link-account" label="Привязать аккаунт" outlined />
            </div>
          )}
        </div>
      </div>
      </div>

      <div className="col-12 xl:col-4">
        <div className="card">
          <h5>Профиль</h5>
          <div className="grid">
            <div className="col-12">
              <DetailLine label="E-mail" value={user.email ?? "Не привязан"} />
            </div>
            <div className="col-12">
              <DetailLine
              label="Telegram"
              value={
                user.telegramId
                  ? user.telegramId
                  : "Не привязан"
              }
            />
            </div>
            <div>
              <span className="text-xs uppercase text-500">E-mail подтверждён</span>
              <div className="mt-2">
                <Tag
                  severity={user.is_email_verified ?? user.emailVerified ? "success" : "warning"}
                  value={user.is_email_verified ?? user.emailVerified ? "Да" : "Нет"}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

        {subscription ? (
      <div className="col-12 xl:col-6">
          <div className="card">
            <h5>Детали подписки</h5>
            {actionMessage ? <Message severity="info" text={actionMessage} /> : null}
            <form className="mt-3 mb-4 flex flex-column gap-2" onSubmit={activatePromocode}>
              <label className="text-sm font-medium text-700" htmlFor="promocode">
                Промокод
              </label>
              <div className="p-inputgroup">
                <InputText
                  id="promocode"
                  onChange={(event) => setPromocode(event.target.value)}
                  placeholder="Введите код"
                  value={promocode}
                />
                <Button
                  disabled={pendingAction === "promocode"}
                  label="Активировать"
                  loading={pendingAction === "promocode"}
                  type="submit"
                />
              </div>
            </form>
            <div className="grid">
              <div className="col-12 md:col-6">
                <DetailLine label="RW_ID" value={subscription.user_remna_id} />
              </div>
              <div className="col-12 md:col-6">
                <DetailLine label="Пробная" value={detailValue(subscription.is_trial)} />
              </div>
              <div className="col-12 md:col-6">
                <DetailLine label="Длительность тарифа" value={`${subscription.plan_duration_days} дней`} />
              </div>
              <div className="col-12 md:col-6">
                <DetailLine label="Стратегия лимита" value={trafficLimitStrategyLabel(subscription.traffic_limit_strategy)} />
              </div>
              <div className="col-12 md:col-6">
                <DetailLine label="Использовано всего" value={formatBytes(subscription.lifetime_used_traffic_bytes)} />
              </div>
              <div className="col-12 md:col-6">
                <DetailLine label="Онлайн" value={formatDate(subscription.online_at)} />
              </div>
            </div>
          </div>
      </div>
        ) : null}

      {devices ? (
      <div className="col-12 xl:col-6">
        <div className="card">
          <h5>Устройства</h5>
          <DataTable
            emptyMessage="Подключенных устройств пока нет."
            responsiveLayout="scroll"
            value={devices.devices}
          >
            <Column
              body={(device: SubscriptionDevice) => (
                <div>
                  <div className="font-medium">
                    {device.device_model ?? device.platform ?? "Устройство"}
                  </div>
                  <div className="mt-1 text-xs text-500 break-all">{device.hwid}</div>
                </div>
              )}
              header="Устройство"
            />
            <Column
              body={(device: SubscriptionDevice) => detailValue(device.os_version)}
              header="OS"
            />
            <Column
              body={(device: SubscriptionDevice) => (
                <span className="text-xs text-500 break-all">{device.user_agent ?? "-"}</span>
              )}
              header="User agent"
            />
            <Column
              body={(device: SubscriptionDevice) => (
                <Button
                  disabled={pendingAction === `delete-device-${device.hwid}`}
                  icon="pi pi-trash"
                  label="Удалить"
                  loading={pendingAction === `delete-device-${device.hwid}`}
                  onClick={() => deleteDevice(device.hwid)}
                  outlined
                  severity="danger"
                  size="small"
                  type="button"
                />
              )}
              header=""
            />
          </DataTable>
        </div>
      </div>
      ) : null}

      <div className="col-12">
      <div className="card">
        <h5>История платежей</h5>
        <DataTable
          emptyMessage="Платежей через web-кабинет пока нет."
          responsiveLayout="scroll"
          value={payments}
        >
          <Column
            body={(payment: PaymentRecord) => (
              <div>
                <div className="font-medium">{payment.plan_name ?? payment.purchase_type}</div>
                <div className="mt-1 text-xs text-500 break-all">{payment.payment_id}</div>
              </div>
            )}
            header="Платёж"
          />
          <Column body={(payment: PaymentRecord) => formatDate(payment.created_at)} header="Дата" />
          <Column field="gateway_type" header="Gateway" />
          <Column
            body={(payment: PaymentRecord) => (
              <span>
                {payment.final_amount} {payment.currency}
              </span>
            )}
            header="Сумма"
          />
          <Column
            body={(payment: PaymentRecord) => (
              <Tag
                severity={payment.is_free ? "info" : statusSeverity(payment.status)}
                value={payment.is_free ? "Бесплатно" : paymentStatusLabel(payment.status)}
              />
            )}
            header="Статус"
          />
        </DataTable>
      </div>
      </div>

      {support?.enabled &&
      (support.email || support.telegramUsername || support.faqUrl) ? (
      <div className="col-12">
        <div className="card">
          <h5>Поддержка</h5>
          <div className="flex flex-wrap gap-2">
            {support.email ? (
              <LinkButton href={`mailto:${support.email}`} label="Написать на почту" outlined />
            ) : null}
            {support.telegramUsername ? (
              <LinkButton
                external
                href={`https://t.me/${support.telegramUsername.replace(/^@/, "")}`}
                label="Telegram"
                outlined
              />
            ) : null}
            {support.faqUrl ? (
              <LinkButton external href={support.faqUrl} label="FAQ" outlined />
            ) : null}
          </div>
        </div>
      </div>
      ) : null}

      <div className="col-12 flex flex-wrap gap-2">
        {hasRenewOffer(offers) ? (
          <LinkButton href="/extend" label="Продлить" outlined />
        ) : null}
        <LinkButton href="/tariffs" label={subscription ? "Изменить тариф" : "Выбрать тариф"} outlined />
        {shouldShowVerifyEmail ? (
          <LinkButton href="/verify-email" label="Подтвердить e-mail" outlined />
        ) : null}
        <LinkButton href="/profile" label="Профиль" outlined />
        <LinkButton href="/support" label="Поддержка" outlined />
        {shouldShowLinkAccount ? (
          <LinkButton href="/link-account" label="Привязать аккаунт" outlined />
        ) : null}
        <Button icon="pi pi-sign-out" label="Выйти" onClick={logout} severity="secondary" />
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  tone,
  value,
}: {
  icon: string;
  label: string;
  tone: "blue" | "orange" | "cyan" | "purple";
  value: React.ReactNode;
}) {
  return (
    <div className="card mb-0 h-full">
      <div className="flex h-full justify-content-between gap-3">
        <div className="min-w-0">
          <span className="block text-500 font-medium mb-3">{label}</span>
          <div className="text-900 font-medium text-xl break-words">{value}</div>
        </div>
        <div
          className={`flex flex-shrink-0 align-items-center justify-content-center bg-${tone}-100 border-round`}
          style={{ width: "2.5rem", height: "2.5rem" }}
        >
          <i className={`${icon} text-${tone}-500 text-xl`} />
        </div>
      </div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-2 border-bottom-1 surface-border">
      <div className="text-xs uppercase text-500">{label}</div>
      <div className="mt-1 font-medium text-900 break-words">{value}</div>
    </div>
  );
}
