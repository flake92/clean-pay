"use client";

import { useEffect, useState } from "react";

import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { BffClientError, readBffError } from "@/frontend/lib/client-api";
import type {
  DurationGatewayPrice,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/shared/remnashop/types";
import { Card } from "primereact/card";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; action?: "login" | "linkEmail" }
  | { status: "ready"; offers: SubscriptionOffersResponse };

function formatDuration(days: number) {
  if (days <= 0) {
    return "∞";
  }

  if (days % 30 === 0) {
    const months = days / 30;
    return `${months} мес.`;
  }

  return `${days} дн.`;
}

function formatTraffic(limit: number) {
  if (limit <= 0) {
    return "Без лимита";
  }

  return `${limit} ГБ`;
}

function formatDeviceLimit(limit: number) {
  return limit > 0 ? String(limit) : "∞";
}

function bestPrice(plan: PlanOffer) {
  const prices = plan.durations.flatMap((duration) => duration.prices);

  return prices.reduce<DurationGatewayPrice | null>((best, price) => {
    if (!best) {
      return price;
    }

    return Number(price.final_amount) < Number(best.final_amount) ? price : best;
  }, null);
}

export function TariffsPanel() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selection, setSelection] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/bff/subscription/offers")
      .then(async (response) => {
        if (!response.ok) {
          throw await readBffError(
            response,
            response.status === 401 ? "Нужно войти в аккаунт." : "Не удалось загрузить тарифы.",
          );
        }

        const body = await response.json().catch(() => null);

        return body.data as SubscriptionOffersResponse;
      })
      .then((offers) => setState({ status: "ready", offers }))
      .catch((error: Error) =>
        setState({
          status: "error",
          message: error.message,
          action:
            error instanceof BffClientError && error.code === "EMAIL_REQUIRED"
              ? "linkEmail"
              : error instanceof BffClientError && error.status === 401
                ? "login"
                : undefined,
        }),
      );
  }, []);

  if (state.status === "loading") {
    return <Message severity="info" text="Загрузка тарифов..." />;
  }

  if (state.status === "error") {
    if (state.action) {
      return <AccountActionRequired action={state.action} message={state.message} />;
    }

    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={state.message} />
      </div>
    );
  }

  if (state.offers.plans.length === 0) {
    return <Message severity="info" text="Доступных тарифов пока нет." />;
  }

  const hasCurrentSubscription = state.offers.has_current_subscription;

  return (
    <div className="flex flex-column gap-4">
      {hasCurrentSubscription ? (
        <Message
          severity="warn"
          text="У вас уже есть активная подписка. Выбор тарифа здесь изменит тариф полностью: текущий тариф будет заменён без перерасчёта. Для обычного продления используйте раздел продления, если он доступен."
        />
      ) : null}
      <div className="grid">
        {state.offers.plans.map((plan) => {
          const firstDuration = plan.durations[0];
          const firstPrice = firstDuration?.prices[0];
          const defaultSelected =
            firstDuration && firstPrice
              ? `${firstDuration.days}:${firstPrice.gateway_type}`
              : "";
          const selected = selection[plan.public_code] ?? defaultSelected;
          const [selectedDays, selectedGateway] = selected.split(":");
          const selectedDuration = plan.durations.find(
            (duration) => String(duration.days) === selectedDays,
          );
          const selectedPrice = selectedDuration?.prices.find(
            (price) => price.gateway_type === selectedGateway,
          );
          const fallbackPrice = bestPrice(plan);
          const currentPrice = selectedPrice ?? fallbackPrice;
          const paymentHref = currentPrice
            ? `/payment?plan=${encodeURIComponent(plan.public_code)}&duration=${encodeURIComponent(
                selectedDuration?.days ?? plan.durations[0]?.days ?? "",
              )}&gateway=${encodeURIComponent(currentPrice.gateway_type)}`
            : "#";
          const priceOptions = plan.durations.flatMap((duration) =>
            duration.prices.map((price) => ({
              label: `${formatDuration(duration.days)} - ${price.final_amount} ${price.currency_symbol} - ${price.gateway_type}`,
              value: `${duration.days}:${price.gateway_type}`,
            })),
          );

          return (
            <div className="col-12 xl:col-6" key={plan.public_code}>
              <Card className="shadow-1 h-full">
                <div className="flex flex-column gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold">{plan.name}</h2>
                        <Tag severity="info" value={plan.type} />
                      </div>
                      {plan.description ? (
                        <p className="mt-1 line-height-3 text-600">
                          {plan.description}
                        </p>
                      ) : null}
                    </div>
                    {currentPrice ? (
                      <div className="text-right">
                        <p className="m-0 text-3xl font-semibold text-900">
                          {currentPrice.final_amount} {currentPrice.currency_symbol}
                        </p>
                        <p className="m-0 mt-1 text-sm text-500">
                          {currentPrice.gateway_type}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid">
                    {[
                      ["Устройства", formatDeviceLimit(plan.device_limit)],
                      ["Трафик", formatTraffic(plan.traffic_limit)],
                      ["Тип", plan.type],
                    ].map(([label, value]) => (
                      <div className="col-12 md:col-4" key={label}>
                        <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
                          <div className="text-xs uppercase text-500">{label}</div>
                          <div className="mt-1 font-semibold text-900">{value}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <label className="flex flex-column gap-2 text-sm font-medium text-700">
                    Длительность и способ оплаты
                    <Dropdown
                      id={plan.public_code}
                      onChange={(event) =>
                        setSelection((current) => ({
                          ...current,
                          [plan.public_code]: event.value,
                        }))
                      }
                      options={priceOptions}
                      value={selected}
                    />
                  </label>
                  <LinkButton
                    className="w-fit"
                    href={paymentHref}
                    icon="pi pi-arrow-right"
                    label={hasCurrentSubscription ? "Изменить тариф" : "Выбрать"}
                  />
                </div>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
