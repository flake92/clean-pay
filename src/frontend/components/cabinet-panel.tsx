"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { ProgressBar } from "primereact/progressbar";
import { Tag } from "primereact/tag";

import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  CabinetDevicesSection,
  CabinetPaymentHistorySection,
} from "@/frontend/components/cabinet-responsive-sections";
import { hasRenewOffer } from "@/frontend/lib/subscription-offers";
import type {
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";
import type { CabinetViewModel } from "@/application/models/cabinet";
import {
  activatePromocodeAction,
  deleteAllDevicesAction,
  deleteDeviceAction,
  reissueSubscriptionAction,
} from "@/app/actions/cabinet";
import { logoutAction } from "@/app/actions/session";
import {
  detailValue,
  formatBytes,
  formatDate,
  formatDeviceLimit,
  formatTrafficLimit,
  statusLabel,
  statusSeverity,
  trafficLimitStrategyLabel,
  type CabinetUser,
  type CurrentSubscription,
  type SupportSettings,
} from "@/frontend/components/cabinet-presentation";
import { DetailLine, Metric } from "@/frontend/components/cabinet-view-parts";
import { resetChatwootSession } from "@/frontend/lib/chatwoot";

const PAYMENT_HISTORY_REFRESH_INTERVAL_MS = 10_000;
const PAYMENT_HISTORY_REFRESH_ATTEMPT_LIMIT = 4;

export function CabinetPanel({ model }: { model: CabinetViewModel }) {
  const router = useRouter();
  const initial = model.status === "ready" ? model : null;
  const user: CabinetUser | null = initial?.user ?? null;
  const subscription: CurrentSubscription | null = initial?.subscription ?? null;
  const offers: SubscriptionOffersResponse | null = initial?.offers ?? null;
  const devices: DevicesResponse | null = initial?.devices ?? null;
  const payments = initial?.payments ?? [];
  const paymentHistoryStatus = initial?.paymentHistoryStatus ?? "current";
  const support: SupportSettings | null = initial?.support ?? null;
  const error = model.status === "error" ? model.message : null;
  const subscriptionError = initial?.subscriptionError ?? null;
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [promocodeMessage, setPromocodeMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const paymentHistoryRefreshAttempts = useRef(0);
  const [promocode, setPromocode] = useState("");

  useEffect(() => {
    if (paymentHistoryStatus !== "refreshing") {
      paymentHistoryRefreshAttempts.current = 0;
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (
        paymentHistoryRefreshAttempts.current >=
        PAYMENT_HISTORY_REFRESH_ATTEMPT_LIMIT
      ) {
        return;
      }

      timeoutId = setTimeout(() => {
        paymentHistoryRefreshAttempts.current += 1;
        router.refresh();
        scheduleRefresh();
      }, PAYMENT_HISTORY_REFRESH_INTERVAL_MS);
    };

    scheduleRefresh();

    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [paymentHistoryStatus, router]);

  function beginPendingAction(action: string) {
    if (pendingActionRef.current) {
      return false;
    }

    pendingActionRef.current = action;
    setPendingAction(action);
    return true;
  }

  function finishPendingAction(action: string) {
    if (pendingActionRef.current !== action) {
      return;
    }

    pendingActionRef.current = null;
    setPendingAction(null);
  }

  async function logout() {
    resetChatwootSession();
    await logoutAction();
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
    if (pendingActionRef.current) {
      return;
    }

    const confirmed = window.confirm("Удалить это устройство из подписки?");

    if (!confirmed) {
      return;
    }

    const action = `delete-device-${hwid}`;
    if (!beginPendingAction(action)) {
      return;
    }
    setActionMessage(null);

    try {
      const result = await deleteDeviceAction(hwid);
      setActionMessage(result.message);
      if (result.status === "success") router.refresh();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Не удалось удалить устройство.");
    } finally {
      finishPendingAction(action);
    }
  }

  async function deleteAllDevices() {
    if (pendingActionRef.current) {
      return;
    }

    const confirmed = window.confirm("Удалить все устройства из подписки?");

    if (!confirmed) {
      return;
    }

    const action = "delete-all-devices";
    if (!beginPendingAction(action)) {
      return;
    }
    setActionMessage(null);

    try {
      const result = await deleteAllDevicesAction();
      setActionMessage(result.message);
      if (result.status === "success") router.refresh();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Не удалось удалить устройства.");
    } finally {
      finishPendingAction(action);
    }
  }

  async function reissueSubscription() {
    if (pendingActionRef.current) {
      return;
    }

    const confirmed = window.confirm(
      "Перевыпуск подписки отключит все текущие устройства. Продолжить?",
    );

    if (!confirmed) {
      return;
    }

    const action = "reissue";
    if (!beginPendingAction(action)) {
      return;
    }
    setActionMessage(null);

    try {
      const result = await reissueSubscriptionAction();
      setActionMessage(result.message);
      if (result.status === "success") router.refresh();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Не удалось перевыпустить подписку.");
    } finally {
      finishPendingAction(action);
    }
  }

  async function activatePromocode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pendingActionRef.current) {
      return;
    }

    const code = promocode.trim();

    if (!code) {
      setPromocodeMessage("Введите промокод.");
      return;
    }

    const action = "promocode";
    if (!beginPendingAction(action)) {
      return;
    }
    setPromocodeMessage(null);

    try {
      const result = await activatePromocodeAction(code);
      setPromocodeMessage(result.message);
      if (result.status === "success") {
        setPromocode("");
        router.refresh();
      }
    } catch (err) {
      setPromocodeMessage(err instanceof Error ? err.message : "Не удалось активировать промокод.");
    } finally {
      finishPendingAction(action);
    }
  }

  if (error) {
    return (
      <div className="card">
        <Message severity="error" text={error} />
        <div className="mt-3">
          <LinkButton
            external
            href="/login?redirect_to=%2Fcabinet"
            label="Войти"
          />
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
  const hasEmail = Boolean(user.email);
  const isEmailVerified = hasEmail && Boolean(user.emailVerified ?? user.is_email_verified);
  const shouldShowVerifyEmail = hasEmail && !isEmailVerified;
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
              ? `${deviceCount} из ${formatDeviceLimit(maxDevices)}`
              : maxDevices !== null
                ? `До ${formatDeviceLimit(maxDevices)}`
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
                  disabled={pendingAction !== null}
                  label="Перевыпустить подписку"
                  loading={pendingAction === "reissue"}
                  onClick={reissueSubscription}
                  outlined
                  severity="danger"
                  type="button"
                />
                {devices && devices.devices.length > 0 ? (
                  <Button
                    disabled={pendingAction !== null}
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
                  severity={hasEmail ? (isEmailVerified ? "success" : "warning") : "secondary"}
                  value={hasEmail ? (isEmailVerified ? "Да" : "Нет") : "Не привязан"}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="card">
          <h5>Промокод</h5>
          {promocodeMessage ? <Message severity="info" text={promocodeMessage} /> : null}
          <form className="mt-3 flex w-full flex-column gap-2 md:w-30rem" onSubmit={activatePromocode}>
            <label className="text-sm font-medium text-700" htmlFor="promocode">
              Введите промокод
            </label>
            <div className="p-inputgroup">
              <InputText
                id="promocode"
                onChange={(event) => setPromocode(event.target.value)}
                placeholder="Введите код"
                value={promocode}
              />
              <Button
                disabled={pendingAction !== null}
                label="Активировать"
                loading={pendingAction === "promocode"}
                type="submit"
              />
            </div>
          </form>
        </div>
      </div>

      {subscription ? (
      <div className="col-12 xl:col-6">
          <div className="card">
            <h5>Детали подписки</h5>
            {actionMessage ? <Message severity="info" text={actionMessage} /> : null}
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
        <CabinetDevicesSection
          devices={devices}
          onDelete={deleteDevice}
          pendingAction={pendingAction}
        />
      ) : null}

      <CabinetPaymentHistorySection
        payments={payments}
        status={paymentHistoryStatus}
      />

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
