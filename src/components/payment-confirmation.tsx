"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type {
  PaymentInitResponse,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/lib/remnashop/types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; unauthorized?: boolean }
  | { status: "ready"; offers: SubscriptionOffersResponse };

function formatDuration(days: number) {
  if (days % 30 === 0) {
    return `${days / 30} мес.`;
  }

  return `${days} дн.`;
}

function formatTraffic(limit: number) {
  return limit <= 0 ? "Без лимита" : `${limit} ГБ`;
}

function findSelection(
  offers: SubscriptionOffersResponse,
  planCode: string | null,
  durationDays: string | null,
  gatewayType: string | null,
) {
  const plan = offers.plans.find((item) => item.public_code === planCode);
  const duration = plan?.durations.find(
    (item) => String(item.days) === durationDays,
  );
  const price = duration?.prices.find(
    (item) => item.gateway_type === gatewayType,
  );

  if (!plan || !duration || !price) {
    return null;
  }

  return { plan, duration, price };
}

function describePlan(plan: PlanOffer) {
  return [
    `${plan.device_limit} устройств`,
    formatTraffic(plan.traffic_limit),
    plan.type,
  ].join(" · ");
}

async function readError(response: Response) {
  const body = await response.json().catch(() => null);

  return body?.error?.message ?? "Не удалось создать платёж.";
}

export function PaymentConfirmation() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const planCode = searchParams.get("plan");
  const durationDays = searchParams.get("duration");
  const gatewayType = searchParams.get("gateway");

  useEffect(() => {
    fetch("/api/bff/subscription/offers")
      .then(async (response) => {
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            body?.error?.message ??
              (response.status === 401
                ? "Нужно войти в аккаунт."
                : "Не удалось загрузить данные оплаты."),
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

  const selection = useMemo(() => {
    if (state.status !== "ready") {
      return null;
    }

    return findSelection(state.offers, planCode, durationDays, gatewayType);
  }, [durationDays, gatewayType, planCode, state]);

  async function createPayment() {
    if (!selection) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const response = await fetch("/api/bff/subscription/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan_code: selection.plan.public_code,
        duration_days: selection.duration.days,
        gateway_type: selection.price.gateway_type,
      }),
    });

    if (!response.ok) {
      setSubmitting(false);
      setSubmitError(await readError(response));
      return;
    }

    const body = (await response.json()) as { data: PaymentInitResponse };

    if (body.data.is_free) {
      window.location.assign("/cabinet");
      return;
    }

    if (body.data.payment_url) {
      window.location.assign(body.data.payment_url);
      return;
    }

    window.location.assign("/payment/pending");
  }

  if (state.status === "loading") {
    return <p className="text-zinc-600">Загрузка данных оплаты...</p>;
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

  if (!selection) {
    return (
      <div className="grid gap-4">
        <p className="text-red-700">Выбранный тариф недоступен.</p>
        <a className="text-cyan-700" href="/tariffs">
          Вернуться к тарифам
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{selection.plan.name}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {describePlan(selection.plan)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">
              {selection.price.final_amount} {selection.price.currency_symbol}
            </p>
            <p className="text-xs text-zinc-500">
              {selection.price.gateway_type}
            </p>
          </div>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="border border-zinc-200 p-3">
            <dt className="text-zinc-500">Длительность</dt>
            <dd className="mt-1 font-medium">
              {formatDuration(selection.duration.days)}
            </dd>
          </div>
          <div className="border border-zinc-200 p-3">
            <dt className="text-zinc-500">Устройства</dt>
            <dd className="mt-1 font-medium">{selection.plan.device_limit}</dd>
          </div>
          <div className="border border-zinc-200 p-3">
            <dt className="text-zinc-500">Трафик</dt>
            <dd className="mt-1 font-medium">
              {formatTraffic(selection.plan.traffic_limit)}
            </dd>
          </div>
        </dl>
      </div>
      {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          className="h-11 bg-zinc-950 px-4 text-white disabled:opacity-60"
          disabled={submitting}
          onClick={createPayment}
          type="button"
        >
          Перейти к оплате
        </button>
        <a className="inline-flex h-11 items-center border border-zinc-300 px-4" href="/tariffs">
          Изменить выбор
        </a>
      </div>
    </div>
  );
}
