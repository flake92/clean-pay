"use client";

import { useEffect, useState } from "react";

import type {
  DurationGatewayPrice,
  PaymentInitResponse,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/lib/remnashop/types";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";
import { BffClientError, readBffError } from "@/lib/client-api";
import { AccountActionRequired } from "@/components/account-action-required";
import { LinkButton } from "@/components/prime/link-button";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; action?: "login" | "linkEmail" }
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
  return (await readBffError(response, 'Не удалось выполнить действие.')).message;
}

export function ExtendConfirmation() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selection, setSelection] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/bff/subscription/offers")
      .then(async (response) => {
        if (!response.ok) {
          throw await readBffError(response, response.status === 401 ? 'Нужно войти в аккаунт.' : 'Не удалось загрузить предложения продления.');
        }

        const body = await response.json().catch(() => null);

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
    return <Message severity="info" text="Загрузка предложений..." />;
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

  const plan = findRenewPlan(state.offers);

  if (!state.offers.has_current_subscription || !plan) {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="info" text="Действующая подписка не найдена." />
        <LinkButton className="w-fit" href="/tariffs" label="Выбрать тариф" />
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
  const priceOptions = plan.durations.flatMap((duration) =>
    duration.prices.map((price) => ({
      label: `${formatDuration(duration.days)} - ${price.final_amount} ${price.currency_symbol} - ${price.gateway_type}`,
      value: `${duration.days}:${price.gateway_type}`,
    })),
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
    <div className="flex flex-column gap-4">
      <Card className="w-full md:w-30rem">
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        <p className="text-sm text-600">
          Текущий статус: {state.offers.current_subscription_status ?? "—"}
        </p>
        <label className="flex flex-column gap-2 text-sm font-medium text-700" htmlFor="extend-offer">
          Длительность и способ оплаты
          <Dropdown
            id="extend-offer"
            onChange={(event) => setSelection(event.value)}
            options={priceOptions}
            value={selection}
          />
        </label>
        {selectedPrice ? (
          <p className="text-2xl font-semibold">
            {selectedPrice.final_amount} {selectedPrice.currency_symbol}
          </p>
        ) : null}
      </Card>
      {submitError ? <Message severity="error" text={submitError} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={submitting || !selectedPrice}
          label="Продлить"
          loading={submitting}
          onClick={extendSubscription}
          type="button"
        />
        <LinkButton href="/cabinet" label="Вернуться в кабинет" outlined />
      </div>
    </div>
  );
}
