"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type {
  PaymentInitResponse,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/shared/remnashop/types";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { BffClientError, readBffError } from "@/frontend/lib/client-api";
import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";

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

function formatTraffic(limit: number) {
  return limit <= 0 ? "Без лимита" : `${limit} ГБ`;
}

function formatDeviceLimit(limit: number) {
  return limit > 0 ? String(limit) : "∞";
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
    `${formatDeviceLimit(plan.device_limit)} устройств`,
    formatTraffic(plan.traffic_limit),
    plan.type,
  ].join(" · ");
}

async function readError(response: Response) {
  return (await readBffError(response, 'Не удалось выполнить действие.')).message;
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
        if (!response.ok) {
          throw await readBffError(response, response.status === 401 ? 'Нужно войти в аккаунт.' : 'Не удалось загрузить данные оплаты.');
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

  if (state.status === "loading") {
    return <Message severity="info" text="Загрузка данных оплаты..." />;
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

  if (!selection) {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="info" text="Для оплаты сначала выберите тариф, срок и способ оплаты." />
        <LinkButton className="w-fit" href="/tariffs" label="Выбрать тариф" />
      </div>
    );
  }

  return (
    <div className="flex flex-column gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{selection.plan.name}</h2>
            <p className="mt-1 line-height-3 text-600">
              {describePlan(selection.plan)}
            </p>
          </div>
          <div className="text-right">
            <p className="m-0 text-3xl font-semibold text-900">
              {selection.price.final_amount} {selection.price.currency_symbol}
            </p>
            <p className="m-0 mt-1 text-sm text-500">
              {selection.price.gateway_type}
            </p>
          </div>
        </div>
        <div className="mt-4 grid">
          <div className="col-12 md:col-4">
            <Metric label="Длительность" value={formatDuration(selection.duration.days)} />
          </div>
          <div className="col-12 md:col-4">
            <Metric label="Устройства" value={formatDeviceLimit(selection.plan.device_limit)} />
          </div>
          <div className="col-12 md:col-4">
            <Metric label="Трафик" value={formatTraffic(selection.plan.traffic_limit)} />
          </div>
        </div>
      </Card>
      {submitError ? <Message severity="error" text={submitError} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={submitting}
          label="Перейти к оплате"
          loading={submitting}
          onClick={createPayment}
          type="button"
        />
        <LinkButton href="/tariffs" label="Изменить выбор" outlined />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="surface-50 border-1 border-200 border-round-lg p-3">
      <div className="text-xs uppercase text-500">{label}</div>
      <div className="mt-1 font-medium text-900">{value}</div>
    </div>
  );
}
