"use client";

import { useEffect, useState } from "react";

import type {
  DurationGatewayPrice,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/lib/remnashop/types";
import { Card } from "primereact/card";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";
import { LinkButton } from "@/components/prime/link-button";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; unauthorized?: boolean }
  | { status: "ready"; offers: SubscriptionOffersResponse };

function formatDuration(days: number) {
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
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            body?.error?.message ??
              (response.status === 401
                ? "Нужно войти в аккаунт."
                : "Не удалось загрузить тарифы."),
          );
        }

        return body.data as SubscriptionOffersResponse;
      })
      .then((offers) => setState({ status: "ready", offers }))
      .catch((error: Error) =>
        setState({
          status: "error",
          message: error.message,
          unauthorized: error.message.includes("войти"),
        }),
      );
  }, []);

  if (state.status === "loading") {
    return <Message severity="info" text="Загрузка тарифов..." />;
  }

  if (state.status === "error") {
    return (
      <div className="grid gap-4">
        <Message severity="error" text={state.message} />
        {state.unauthorized ? (
          <LinkButton className="w-fit" href="/login" label="Войти" />
        ) : null}
      </div>
    );
  }

  if (state.offers.plans.length === 0) {
    return <Message severity="info" text="Доступных тарифов пока нет." />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
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
          <Card className="shadow-1" key={plan.public_code}>
            <div className="grid gap-4">
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
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ["Устройства", plan.device_limit],
                  ["Трафик", formatTraffic(plan.traffic_limit)],
                  ["Тип", plan.type],
                ].map(([label, value]) => (
                  <div className="surface-50 border-1 border-200 border-round-lg p-3" key={label}>
                    <div className="text-xs uppercase text-500">{label}</div>
                    <div className="mt-1 font-semibold text-900">{value}</div>
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
                label="Выбрать"
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
