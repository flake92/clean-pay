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
import {
  clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey,
  parsePaymentOperationStatusEnvelope,
  shouldRetainPaymentIdempotencyKey,
} from "@/frontend/lib/payment-idempotency";
import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  confirmedPaymentOffer,
  paymentOfferMatches,
} from "@/shared/payments/offer-confirmation";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; action?: "login" | "linkEmail" }
  | { status: "ready"; offers: SubscriptionOffersResponse };

function formatDuration(days: number) {
  if (days <= 0) {
    return "∞";
  }

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
    const payload = {
      plan_code: selection.plan.public_code,
      duration_days: selection.duration.days,
      gateway_type: selection.price.gateway_type,
      ...confirmedPaymentOffer(
        selection.plan,
        selection.duration.days,
        selection.price,
      ),
    };

    try {
      const offersResponse = await fetch("/api/bff/subscription/offers", {
        cache: "no-store",
      });

      if (!offersResponse.ok) {
        throw await readBffError(
          offersResponse,
          "Не удалось перепроверить цену. Оплата не создана.",
        );
      }

      const offersBody = await offersResponse.json().catch(() => null) as {
        data?: SubscriptionOffersResponse;
      } | null;
      const freshOffers = offersBody?.data;
      const freshSelection = freshOffers
        ? findSelection(freshOffers, planCode, durationDays, gatewayType)
        : null;

      if (!freshOffers || !freshSelection) {
        setSubmitting(false);
        setSubmitError("Выбранное предложение больше недоступно. Оплата не создана.");
        return;
      }

      if (
        !paymentOfferMatches(
          payload,
          freshSelection.plan,
          freshSelection.duration.days,
          freshSelection.price,
        )
      ) {
        setState({ status: "ready", offers: freshOffers });
        setSubmitting(false);
        setSubmitError(
          `Цена изменилась: было ${selection.price.final_amount} ${selection.price.currency_symbol}, стало ${freshSelection.price.final_amount} ${freshSelection.price.currency_symbol}. Проверьте новую цену перед оплатой.`,
        );
        return;
      }
    } catch {
      setSubmitting(false);
      setSubmitError("Не удалось перепроверить цену. Оплата не создана; повторите попытку позже.");
      return;
    }

    let idempotencyKey: string;

    try {
      idempotencyKey = getOrCreatePaymentIdempotencyKey("purchase", payload);
    } catch {
      setSubmitting(false);
      setSubmitError(
        "Браузер не смог безопасно подготовить оплату. Обновите страницу или используйте другой браузер.",
      );
      return;
    }

    let paymentConfirmed = false;

    try {
      let response: Response;

      try {
        response = await fetch("/api/bff/subscription/purchase", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        });
      } catch {
        setSubmitError(
          "Не удалось получить результат оплаты. Повторите попытку — новая оплата не будет создана.",
        );
        return;
      }

      const operationStatus = parsePaymentOperationStatusEnvelope(
        await response.clone().json().catch(() => null),
      );

      if (response.status === 202) {
        if (operationStatus) {
          try {
            window.localStorage.setItem(
              "cleanPayLastPaymentOperationId",
              operationStatus.operationId,
            );
          } catch {
            // The operation remains recoverable through the current URL.
          }
          paymentConfirmed = true;
          window.location.assign(
            `/payment/pending?operation_id=${encodeURIComponent(operationStatus.operationId)}`,
          );
          return;
        }
        setSubmitError(
          "Результат оплаты уточняется. Не создавайте новую оплату; повторите проверку через несколько секунд.",
        );
        return;
      }

      if (!response.ok) {
        const manualReview = operationStatus?.status === "manual_required";
        const message = manualReview
          ? `Статус оплаты не удалось определить автоматически. Не повторяйте оплату; обратитесь в поддержку и сообщите номер операции ${operationStatus.operationId}.`
          : await readError(response);

        if (manualReview) {
          try {
            window.localStorage.setItem(
              "cleanPayLastPaymentOperationId",
              operationStatus.operationId,
            );
          } catch {
            // The visible operation number is still available to the user.
          }
        }

        if (response.status < 500) {
          if (!shouldRetainPaymentIdempotencyKey(response.status, operationStatus?.status)) {
            clearPaymentIdempotencyKey("purchase", payload, idempotencyKey);
          }
          setSubmitError(message);
        } else {
          setSubmitError(
            "Не удалось подтвердить результат оплаты. Повторите попытку — новая оплата не будет создана.",
          );
        }
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        data?: PaymentInitResponse;
      } | null;

      if (!body?.data || typeof body.data.payment_id !== "string") {
        setSubmitError(
          "Не удалось подтвердить результат оплаты. Повторите попытку — новая оплата не будет создана.",
        );
        return;
      }

      clearPaymentIdempotencyKey("purchase", payload, idempotencyKey);
      paymentConfirmed = true;

      try {
        window.localStorage.setItem("cleanPayLastPaymentId", body.data.payment_id);
      } catch {
        // The payment is confirmed even when local browser storage is unavailable.
      }

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
    } catch {
      setSubmitError(
        "Не удалось определить результат оплаты. Повторите попытку — будет использован тот же запрос и новая оплата не будет создана.",
      );
    } finally {
      if (!paymentConfirmed) {
        setSubmitting(false);
      }
    }
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
