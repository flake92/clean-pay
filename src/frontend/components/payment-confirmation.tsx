"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { executePaymentAction } from "@/app/actions/payments";
import { InstallAppButton } from "@/frontend/components/install-app-button";
import { navigateTo, replaceWith } from "@/frontend/lib/browser-navigation";
import {
  clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey,
} from "@/frontend/lib/payment-idempotency";
import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  confirmedPaymentOffer,
} from "@/shared/domain/payment-offer";
import {
  accountLinkPath,
  emailVerificationPath,
  passkeySetupPath,
} from "@/shared/auth/account-setup-flow";
import type { CheckoutViewModel } from "@/application/models/checkout";

const defaultCheckoutModel: CheckoutViewModel = { status: "error", message: "Не удалось загрузить данные оплаты." };

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

export function PaymentConfirmation({
  durationDays = null,
  gatewayType = null,
  model = defaultCheckoutModel,
  paymentRedirectTo = "/payment",
  planCode = null,
  showAccountSetupNotice = false,
}: {
  durationDays?: string | null;
  gatewayType?: string | null;
  model?: CheckoutViewModel;
  paymentRedirectTo?: string;
  planCode?: string | null;
  showAccountSetupNotice?: boolean;
}) {
  const state = model;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const selection = useMemo(() => {
    if (state.status !== "ready") {
      return null;
    }

    return findSelection(state.offers, planCode, durationDays, gatewayType);
  }, [durationDays, gatewayType, planCode, state]);
  const verifyEmailRequired =
    state.status === "account-action-required" && state.action === "verifyEmail";

  useEffect(() => {
    if (verifyEmailRequired) {
      replaceWith(emailVerificationPath(paymentRedirectTo));
    }
  }, [paymentRedirectTo, verifyEmailRequired]);

  function finishSubmitting() {
    submittingRef.current = false;
    setSubmitting(false);
  }

  async function createPayment() {
    if (!selection || submittingRef.current) {
      return;
    }

    submittingRef.current = true;
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

    let idempotencyKey: string;

    try {
      idempotencyKey = getOrCreatePaymentIdempotencyKey("purchase", payload);
    } catch {
      finishSubmitting();
      setSubmitError(
        "Браузер не смог безопасно подготовить оплату. Обновите страницу или используйте другой браузер.",
      );
      return;
    }

    let paymentConfirmed = false;

    try {
      const result = await executePaymentAction({ kind: "purchase", request: payload, idempotencyKey });
      if (!result.ok) {
        if (result.code === "EMAIL_REQUIRED" || result.code === "EMAIL_NOT_VERIFIED") {
          replaceWith(accountLinkPath(paymentRedirectTo));
          return;
        }
        if (!result.retainIdempotencyKey) clearPaymentIdempotencyKey("purchase", payload, idempotencyKey);
        setSubmitError(result.message);
        return;
      }
      if (result.status === "pending") {
        paymentConfirmed = true;
        navigateTo(`/payment/pending?operation_id=${encodeURIComponent(result.operationId)}`);
        return;
      }
      if (result.status === "manual-review") {
        setSubmitError(`Статус оплаты требует ручной проверки. Сообщите поддержке номер операции ${result.operationId}.`);
        return;
      }

      clearPaymentIdempotencyKey("purchase", payload, idempotencyKey);
      paymentConfirmed = true;
      if (result.payment.is_free) {
        navigateTo("/cabinet");
        return;
      }

      if (result.payment.payment_url) {
        navigateTo(result.payment.payment_url);
        return;
      }

      navigateTo(
        `/payment/pending?payment_id=${encodeURIComponent(result.payment.payment_id)}`,
      );
    } catch {
      setSubmitError(
        "Не удалось определить результат оплаты. Повторите попытку — будет использован тот же запрос и новая оплата не будет создана.",
      );
    } finally {
      if (!paymentConfirmed) {
        finishSubmitting();
      }
    }
  }

  if (state.status === "account-action-required") {
    if (state.action === "verifyEmail") {
      return null;
    }
    if (state.action) {
      return (
        <AccountActionRequired
          action={state.action}
          message={state.message}
          redirectTo={paymentRedirectTo}
        />
      );
    }

    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={state.message} />
      </div>
    );
  }

  if (state.status === "error") return <Message severity="error" text={state.message} />;

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
      {showAccountSetupNotice ? (
        <Card>
          <div className="flex flex-column gap-3">
            <Message
              severity="success"
              text="E-mail подтверждён. Вы вернулись к выбранной оплате и можете продолжить."
            />
            <p className="m-0 line-height-3 text-600">
              Теперь в аккаунт можно войти по e-mail и паролю, даже если
              Telegram временно недоступен. Дополнительно можно установить
              приложение и настроить быстрый вход — это необязательно и не
              мешает оплате.
            </p>
            <div className="flex flex-wrap gap-3">
              <InstallAppButton
                alwaysVisible
                autoOpenIosGuide={false}
              />
              <LinkButton
                href={passkeySetupPath(paymentRedirectTo)}
                icon="pi pi-lock"
                label="Настроить быстрый вход"
                outlined
              />
            </div>
          </div>
        </Card>
      ) : null}
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
