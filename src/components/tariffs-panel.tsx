"use client";

import { useEffect, useState } from "react";

import type {
  DurationGatewayPrice,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/lib/remnashop/types";

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
    return <p className="text-zinc-600">Загрузка тарифов...</p>;
  }

  if (state.status === "error") {
    return (
      <div className="grid gap-4">
        <p className="text-red-700">{state.message}</p>
        {state.unauthorized ? (
          <a className="text-cyan-700" href="/login">
            Войти
          </a>
        ) : null}
      </div>
    );
  }

  if (state.offers.plans.length === 0) {
    return <p className="text-zinc-600">Доступных тарифов пока нет.</p>;
  }

  return (
    <div className="grid gap-5">
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

        return (
          <article
            className="grid gap-5 border border-zinc-200 bg-white p-5"
            key={plan.public_code}
          >
            <div className="grid gap-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{plan.name}</h2>
                  {plan.description ? (
                    <p className="mt-1 text-sm text-zinc-600">{plan.description}</p>
                  ) : null}
                </div>
                {currentPrice ? (
                  <div className="text-right">
                    <p className="text-2xl font-semibold">
                      {currentPrice.final_amount} {currentPrice.currency_symbol}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {currentPrice.gateway_type}
                    </p>
                  </div>
                ) : null}
              </div>
              <dl className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-3">
                <div className="border border-zinc-200 p-3">
                  <dt className="text-zinc-500">Устройства</dt>
                  <dd className="mt-1 font-medium">{plan.device_limit}</dd>
                </div>
                <div className="border border-zinc-200 p-3">
                  <dt className="text-zinc-500">Трафик</dt>
                  <dd className="mt-1 font-medium">
                    {formatTraffic(plan.traffic_limit)}
                  </dd>
                </div>
                <div className="border border-zinc-200 p-3">
                  <dt className="text-zinc-500">Тип</dt>
                  <dd className="mt-1 font-medium">{plan.type}</dd>
                </div>
              </dl>
            </div>
            <div className="grid gap-3">
              <label className="text-sm font-medium" htmlFor={plan.public_code}>
                Длительность и способ оплаты
              </label>
              <select
                className="h-11 border border-zinc-300 bg-white px-3"
                id={plan.public_code}
                onChange={(event) =>
                  setSelection((current) => ({
                    ...current,
                    [plan.public_code]: event.target.value,
                  }))
                }
                value={selected}
              >
                {plan.durations.flatMap((duration) =>
                  duration.prices.map((price) => (
                    <option
                      key={`${duration.days}:${price.gateway_type}`}
                      value={`${duration.days}:${price.gateway_type}`}
                    >
                      {formatDuration(duration.days)} — {price.final_amount}{" "}
                      {price.currency_symbol} — {price.gateway_type}
                    </option>
                  )),
                )}
              </select>
            </div>
            <a
              className="inline-flex h-11 w-fit items-center bg-zinc-950 px-4 text-white aria-disabled:pointer-events-none aria-disabled:opacity-60"
              aria-disabled={!currentPrice}
              href={paymentHref}
            >
              Выбрать
            </a>
          </article>
        );
      })}
    </div>
  );
}
