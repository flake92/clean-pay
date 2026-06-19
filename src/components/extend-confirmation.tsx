"use client";

import { useEffect, useState } from "react";

import type {
  DurationGatewayPrice,
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

function findRenewPlan(offers: SubscriptionOffersResponse) {
  return offers.plans.find(
    (plan) => plan.recommended_purchase_type === "renew",
  );
}

function firstSelection(plan: PlanOffer | undefined) {
  const duration = plan?.durations[0];
  const price = duration?.prices[0];

  if (!duration || !price) {
    return "";
  }

  return `${duration.days}:${price.gateway_type}`;
}

async function readError(response: Response) {
  const body = await response.json().catch(() => null);

  return body?.error?.message ?? "Не удалось создать платёж.";
}

export function ExtendConfirmation() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selection, setSelection] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/bff/subscription/offers")
      .then(async (response) => {
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            body?.error?.message ??
              (response.status === 401
                ? "Нужно войти в аккаунт."
                : "Не удалось загрузить предложения продления."),
          );
        }

        return body.data as SubscriptionOffersResponse;
      })
      .then((offers) => {
        setState({ status: "ready", offers });
        setSelection(firstSelection(findRenewPlan(offers)));
      })
      .catch((error: Error) =>
        setState({
          status: "error",
          message: error.message,
          unauthorized: error.message.includes("войти"),
        }),
      );
  }, []);

  if (state.status === "loading") {
    return <p className="text-zinc-600">Загрузка предложений...</p>;
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

  const plan = findRenewPlan(state.offers);

  if (!state.offers.has_current_subscription || !plan) {
    return (
      <div className="grid gap-4">
        <p className="text-zinc-700">Действующая подписка не найдена.</p>
        <a className="text-cyan-700" href="/tariffs">
          Выбрать тариф
        </a>
      </div>
    );
  }

  const [selectedDays, selectedGateway] = selection.split(":");
  const selectedDuration = plan.durations.find(
    (duration) => String(duration.days) === selectedDays,
  );
  const selectedPrice = selectedDuration?.prices.find(
    (price): price is DurationGatewayPrice =>
      price.gateway_type === selectedGateway,
  );

  async function extendSubscription() {
    if (!selectedDuration || !selectedPrice) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const response = await fetch("/api/bff/subscription/extend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        duration_days: selectedDuration.days,
        gateway_type: selectedPrice.gateway_type,
      }),
    });

    if (!response.ok) {
      setSubmitting(false);
      setSubmitError(await readError(response));
      return;
    }

    const body = (await response.json()) as { data: PaymentInitResponse };
    window.localStorage.setItem("cleanPayLastPaymentId", body.data.payment_id);

    if (body.data.is_free) {
      window.location.assign("/cabinet");
      return;
    }

    if (body.data.payment_url) {
      window.location.assign(body.data.payment_url);
      return;
    }

    window.location.assign(
      `/payment/pending?payment_id=${encodeURIComponent(body.data.payment_id)}`,
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 border border-zinc-200 bg-white p-5">
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        <p className="text-sm text-zinc-600">
          Текущий статус: {state.offers.current_subscription_status ?? "—"}
        </p>
        <label className="text-sm font-medium" htmlFor="extend-offer">
          Длительность и способ оплаты
        </label>
        <select
          className="h-11 border border-zinc-300 bg-white px-3"
          id="extend-offer"
          onChange={(event) => setSelection(event.target.value)}
          value={selection}
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
        {selectedPrice ? (
          <p className="text-2xl font-semibold">
            {selectedPrice.final_amount} {selectedPrice.currency_symbol}
          </p>
        ) : null}
      </div>
      {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          className="h-11 bg-zinc-950 px-4 text-white disabled:opacity-60"
          disabled={submitting || !selectedPrice}
          onClick={extendSubscription}
          type="button"
        >
          Продлить
        </button>
        <a className="inline-flex h-11 items-center border border-zinc-300 px-4" href="/cabinet">
          Вернуться в кабинет
        </a>
      </div>
    </div>
  );
}
