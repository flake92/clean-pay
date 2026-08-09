"use client";

import { useRef, useState } from "react";

import type {
  DurationGatewayPrice,
  PlanOffer,
} from "@/shared/domain/subscriptions";
import { executePaymentAction } from "@/app/actions/payments";
import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { replaceWith } from "@/frontend/lib/browser-navigation";
import {
  clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey,
} from "@/frontend/lib/payment-idempotency";
import { storePaymentReturnReference } from "@/frontend/lib/payment-return-storage";
import { findRenewPlan } from "@/frontend/lib/subscription-offers";
import {
  confirmedPaymentOffer,
} from "@/shared/payments/offer-confirmation";
import {
  accountLinkPath,
  emailVerificationPath,
} from "@/shared/auth/account-setup-flow";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";
import type { CheckoutViewModel } from "@/shared/presentation/checkout";

const defaultCheckoutModel: CheckoutViewModel = { status: "error", message: "Не удалось загрузить предложения продления." };

type PriceOption = {
  amount: string;
  currency: string;
  days: number;
  duration: string;
  gateway: string;
  label: string;
  value: string;
};

function selectionValue(days: number | string, gateway: string) {
  return JSON.stringify([String(days), gateway]);
}

function parseSelection(value: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Invalid UI state is handled as no selection below.
  }

  return ["", ""];
}

function formatDuration(days: number) {
  if (days <= 0) {
    return "∞";
  }

  if (days % 30 === 0) {
    return `${days / 30} мес.`;
  }

  return `${days} дн.`;
}

function priceOptionTemplate(option?: PriceOption) {
  if (!option) {
    return <span>Выберите срок и способ оплаты</span>;
  }

  return (
    <div className="clean-pay-price-option">
      <div className="clean-pay-price-option__main">
        <span className="clean-pay-price-option__duration">{option.duration}</span>
        <span className="clean-pay-price-option__price">
          {option.amount} {option.currency}
        </span>
      </div>
      <span className="clean-pay-price-option__gateway">{option.gateway}</span>
    </div>
  );
}

function buildPriceOptions(plan: PlanOffer | undefined) {
  if (!plan) {
    return [];
  }

  return plan.durations
    .flatMap((duration) =>
      duration.prices.map((price) => ({
        amount: String(price.final_amount),
        currency: price.currency_symbol,
        days: duration.days,
        duration: formatDuration(duration.days),
        gateway: price.gateway_type,
        label: `${formatDuration(duration.days)} - ${price.final_amount} ${price.currency_symbol} - ${price.gateway_type}`,
        value: selectionValue(duration.days, price.gateway_type),
      })),
    )
    .sort(
      (left, right) =>
        Number(left.amount) - Number(right.amount) ||
        left.days - right.days ||
        left.gateway.localeCompare(right.gateway),
    );
}

function firstSelection(plan: PlanOffer | undefined) {
  return buildPriceOptions(plan)[0]?.value ?? "";
}

function extensionDestination(
  duration: string | number | null | undefined,
  gateway: string | null | undefined,
) {
  const normalizedDuration =
    duration === null || duration === undefined ? "" : String(duration);
  const normalizedGateway = gateway ?? "";

  if (
    !/^(?:0|[1-9]\d{0,5})$/.test(normalizedDuration) ||
    !normalizedGateway ||
    normalizedGateway.length > 100
  ) {
    return "/extend";
  }

  return `/extend?${new URLSearchParams({
    duration: normalizedDuration,
    gateway: normalizedGateway,
  }).toString()}`;
}

function initialSelection(
  plan: PlanOffer | undefined,
  duration: string | null,
  gateway: string | null,
) {
  const requested = duration && gateway ? selectionValue(duration, gateway) : "";

  return buildPriceOptions(plan).some(({ value }) => value === requested)
    ? requested
    : firstSelection(plan);
}

function priceChoiceList(
  options: PriceOption[],
  selected: string,
  onSelect: (value: string) => void,
  disabled = false,
) {
  return (
    <div className="clean-pay-price-choice-list">
      {options.map((option) => (
        <button
          className={
            option.value === selected
              ? "clean-pay-price-choice clean-pay-price-choice--selected"
              : "clean-pay-price-choice"
          }
          disabled={disabled}
          key={option.value}
          onClick={() => onSelect(option.value)}
          type="button"
        >
          {priceOptionTemplate(option)}
        </button>
      ))}
    </div>
  );
}

export function ExtendConfirmation({ model = defaultCheckoutModel, requestedDuration = null, requestedGateway = null }: {
  model?: CheckoutViewModel;
  requestedDuration?: string | null;
  requestedGateway?: string | null;
}) {
  const state = model;
  const initialPlan = state.status === "ready" ? findRenewPlan(state.offers) : undefined;
  const [selection, setSelection] = useState(() => initialSelection(initialPlan, requestedDuration, requestedGateway));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const requestedExtendDestination = extensionDestination(
    requestedDuration,
    requestedGateway,
  );

  if (state.status === "account-action-required") {
    if (state.action === "verifyEmail") {
      replaceWith(emailVerificationPath(requestedExtendDestination));
      return null;
    }
    if (state.action) {
      return (
        <AccountActionRequired
          action={state.action}
          message={state.message}
          redirectTo={requestedExtendDestination}
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

  const plan = findRenewPlan(state.offers);

  if (!state.offers.has_current_subscription) {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="info" text="Действующая подписка не найдена. Сначала выберите тариф." />
        <LinkButton className="w-fit" href="/tariffs" label="Выбрать тариф" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-column gap-4">
        <Message
          severity="info"
          text="Продление текущего тарифа недоступно. Можно изменить тариф: новый тариф заменит текущий без перерасчёта."
        />
        <LinkButton className="w-fit" href="/tariffs" label="Изменить тариф" />
      </div>
    );
  }

  const [selectedDays, selectedGateway] = parseSelection(selection);
  const selectedDuration = plan.durations.find(
    (duration) => String(duration.days) === selectedDays,
  );
  const selectedPrice = selectedDuration?.prices.find(
    (price): price is DurationGatewayPrice => price.gateway_type === selectedGateway,
  );
  const priceOptions = buildPriceOptions(plan);
  const selectedExtendDestination = extensionDestination(
    selectedDuration?.days,
    selectedPrice?.gateway_type,
  );

  function finishSubmitting() {
    submittingRef.current = false;
    setSubmitting(false);
  }

  async function extendSubscription() {
    if (
      !plan ||
      !selectedDuration ||
      !selectedPrice ||
      submittingRef.current
    ) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      duration_days: selectedDuration.days,
      gateway_type: selectedPrice.gateway_type,
      ...confirmedPaymentOffer(plan, selectedDuration.days, selectedPrice),
    };

    let idempotencyKey: string;

    try {
      idempotencyKey = getOrCreatePaymentIdempotencyKey("extend", payload);
    } catch {
      finishSubmitting();
      setSubmitError(
        "Браузер не смог безопасно подготовить продление. Обновите страницу или используйте другой браузер.",
      );
      return;
    }

    let paymentConfirmed = false;

    try {
      const result = await executePaymentAction({ kind: "extend", request: payload, idempotencyKey });
      if (!result.ok) {
        if (result.code === "EMAIL_REQUIRED" || result.code === "EMAIL_NOT_VERIFIED") {
          replaceWith(accountLinkPath(selectedExtendDestination));
          return;
        }
        if (!result.retainIdempotencyKey) clearPaymentIdempotencyKey("extend", payload, idempotencyKey);
        setSubmitError(result.message);
        return;
      }
      if (result.status === "pending") {
        storePaymentReturnReference({ operationId: result.operationId });
        paymentConfirmed = true;
        window.location.assign(`/payment/pending?operation_id=${encodeURIComponent(result.operationId)}`);
        return;
      }
      if (result.status === "manual-review") {
        storePaymentReturnReference({ operationId: result.operationId });
        setSubmitError(`Статус продления требует ручной проверки. Сообщите поддержке номер операции ${result.operationId}.`);
        return;
      }

      clearPaymentIdempotencyKey("extend", payload, idempotencyKey);
      paymentConfirmed = true;
      storePaymentReturnReference({ paymentId: result.payment.payment_id });
      if (result.payment.is_free) {
        window.location.assign("/cabinet");
        return;
      }

      if (result.payment.payment_url) {
        window.location.assign(result.payment.payment_url);
        return;
      }

      window.location.assign(
        `/payment/pending?payment_id=${encodeURIComponent(result.payment.payment_id)}`,
      );
    } catch {
      setSubmitError(
        "Не удалось определить результат продления. Повторите попытку — будет использован тот же запрос и новая оплата не будет создана.",
      );
    } finally {
      if (!paymentConfirmed) {
        finishSubmitting();
      }
    }
  }

  return (
    <div className="flex flex-column gap-4">
      {plan.renewal_terms_changed ? (
        <Message
          severity="warn"
          text="Условия тарифа изменились с момента последней покупки. Продление будет оформлено по актуальным лимитам и цене, указанным ниже."
        />
      ) : null}
      <Card className="w-full md:w-30rem">
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        <p className="text-sm text-600">
          Текущий статус: {state.offers.current_subscription_status ?? "-"}
        </p>
        <div className="flex flex-column gap-2 text-sm font-medium text-700">
          <span>Длительность и способ оплаты</span>
          <Dropdown
            aria-label="Длительность и способ оплаты"
            className="clean-pay-price-dropdown"
            disabled={submitting}
            id="extend-offer"
            onChange={(event) => setSelection(event.value)}
            optionLabel="label"
            optionValue="value"
            itemTemplate={priceOptionTemplate}
            options={priceOptions}
            panelClassName="clean-pay-price-dropdown-panel"
            value={selection}
            valueTemplate={priceOptionTemplate}
          />
          {priceChoiceList(priceOptions, selection, setSelection, submitting)}
        </div>
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
