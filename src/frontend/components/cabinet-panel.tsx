"use client";

import { ProgressBar } from "primereact/progressbar";
import { Tag } from "primereact/tag";

import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  CabinetDevicesSection,
  CabinetPaymentHistorySection,
} from "@/frontend/components/cabinet-responsive-sections";
import { hasRenewOffer } from "@/frontend/lib/subscription-offers";
import type { CabinetViewModel } from "@/application/models/cabinet";
import {
  detailValue,
  formatBytes,
  formatDate,
  formatDeviceLimit,
  formatTrafficLimit,
  statusLabel,
  statusSeverity,
  trafficLimitStrategyLabel,
} from "@/frontend/components/cabinet-presentation";
import {
  selectCabinetPanelData,
  selectCabinetPanelPresentation,
} from "@/frontend/components/cabinet-panel-transitions";
import { DetailLine, Metric } from "@/frontend/components/cabinet-view-parts";
import {
  Button,
  Message,
} from "@/frontend/components/sakai/form-foundation";
import { CabinetPromocodeFields } from "@/frontend/components/cabinet-promocode-fields";
import { useCabinetPanelController } from "@/frontend/hooks/use-cabinet-panel-controller";

export function CabinetPanel({ model }: { model: CabinetViewModel }) {
  const {
    devices,
    error,
    offers,
    paymentHistoryStatus,
    payments,
    subscription,
    subscriptionError,
    support,
    user,
  } = selectCabinetPanelData(model);
  const {
    actionMessage,
    activatePromocode,
    copyStatus,
    copySubscriptionUrl,
    deleteAllDevices,
    deleteDevice,
    logout,
    pendingAction,
    promocode,
    promocodeMessage,
    reissueSubscription,
    setPromocode,
  } = useCabinetPanelController({
    paymentHistoryStatus,
    subscription,
  });

  if (error) {
    return (
      <div className="card">
        <Message severity="error" text={error} />
        <div className="mt-3">
          <LinkButton
            external
            href="/cabinet"
            label="Повторить"
          />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Message severity="info" text="Загрузка кабинета..." />;
  }

  const {
    deviceCount,
    hasEmail,
    isEmailVerified,
    maxDevices,
    shouldShowLinkAccount,
    shouldShowVerifyEmail,
    usagePercent,
    usedTraffic,
  } = selectCabinetPanelPresentation({ devices, subscription, user });

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
          <h2 className="text-xl">Профиль</h2>
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
          <h2 className="text-xl">Промокод</h2>
          {promocodeMessage ? <Message severity="info" text={promocodeMessage} /> : null}
          <form className="mt-3 flex w-full flex-column gap-2 md:w-30rem" onSubmit={activatePromocode}>
            <CabinetPromocodeFields
              disabled={pendingAction !== null}
              loading={pendingAction === "promocode"}
              onValueChange={setPromocode}
              value={promocode}
            />
          </form>
        </div>
      </div>

      {subscription ? (
      <div className="col-12 xl:col-6">
          <div className="card">
            <h2 className="text-xl">Детали подписки</h2>
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
          <h2 className="text-xl">Поддержка</h2>
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
