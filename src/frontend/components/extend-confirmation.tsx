"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import type {
  DurationGatewayPrice,
  PaymentInitResponse,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/shared/remnashop/types";
import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { replaceWith } from "@/frontend/lib/browser-navigation";
import { BffClientError, readBffError } from "@/frontend/lib/client-api";
import {
  clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey,
  parsePaymentOperationStatusEnvelope,
  shouldRetainPaymentIdempotencyKey,
} from "@/frontend/lib/payment-idempotency";
import { storePaymentReturnReference } from "@/frontend/lib/payment-return-storage";
import { findRenewPlan } from "@/frontend/lib/subscription-offers";
import {
  confirmedPaymentOffer,
  paymentOfferMatches,
} from "@/shared/payments/offer-confirmation";
import {
  accountLinkPath,
  emailVerificationPath,
} from "@/shared/auth/account-setup-flow";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; action?: "login" | "linkEmail" }
  | { status: "ready"; offers: SubscriptionOffersResponse };

type PriceOption = {
  amount: string;
  currency: string;
  days: number;
  duration: string;
  gateway: string;
  label: string;
  value: string;
};

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
        value: `${duration.days}:${price.gateway_type}`,
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
  const requested = duration && gateway ? `${duration}:${gateway}` : "";

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

export function ExtendConfirmation() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selection, setSelection] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const requestedDuration = searchParams.get("duration");
  const requestedGateway = searchParams.get("gateway");
  const requestedExtendDestination = extensionDestination(
    requestedDuration,
    requestedGateway,
  );

  useEffect(() => {
    let active = true;

    async function loadExtension() {
      try {
        const profileResponse = await fetch("/api/bff/auth/me", {
          cache: "no-store",
        });

        if (!profileResponse.ok) {
          throw await readBffError(
            profileResponse,
            profileResponse.status === 401
              ? "Нужно войти в аккаунт."
              : "Не удалось проверить готовность аккаунта.",
          );
        }

        const profileBody = await profileResponse.json().catch(() => null);
        const user = profileBody?.data?.user;
        const emailVerified = Boolean(
          user?.email &&
            (user.emailVerified ?? user.is_email_verified),
        );
        const accountSyncPending = Boolean(
          user?.accountSyncPending ?? user?.account_sync_pending,
        );

        if (accountSyncPending) {
          replaceWith(
            emailVerificationPath(requestedExtendDestination),
          );
          return;
        }

        if (!emailVerified) {
          if (active) {
            setState({
              status: "error",
              message:
                "Для продления добавьте e-mail и пароль, затем подтвердите адрес кодом из письма.",
              action: "linkEmail",
            });
          }
          return;
        }

        const offersResponse = await fetch("/api/bff/subscription/offers");

        if (!offersResponse.ok) {
          throw await readBffError(
            offersResponse,
            offersResponse.status === 401
              ? "Нужно войти в аккаунт."
              : "Не удалось загрузить предложения продления.",
          );
        }

        const offersBody = await offersResponse.json().catch(() => null);

        if (!offersBody?.data) {
          throw new Error("Сервер вернул некорректные данные продления.");
        }

        if (active) {
          const offers = offersBody.data as SubscriptionOffersResponse;
          setState({ status: "ready", offers });
          setSelection(
            initialSelection(
              findRenewPlan(offers),
              requestedDuration,
              requestedGateway,
            ),
          );
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Не удалось загрузить предложения продления.",
          action:
            error instanceof BffClientError &&
            (error.code === "EMAIL_REQUIRED" ||
              error.code === "EMAIL_NOT_VERIFIED")
              ? "linkEmail"
              : error instanceof BffClientError && error.status === 401
                ? "login"
                : undefined,
        });
      }
    }

    void loadExtension();

    return () => {
      active = false;
    };
  }, [requestedDuration, requestedGateway, requestedExtendDestination]);

  if (state.status === "loading") {
    return <Message severity="info" text="Загрузка предложений..." />;
  }

  if (state.status === "error") {
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
          text="Продление текущего тарифа недоступно. Можно изменить тариф, но Remnashop применит новый тариф как замену текущего без перерасчета."
        />
        <LinkButton className="w-fit" href="/tariffs" label="Изменить тариф" />
      </div>
    );
  }

  const [selectedDays, selectedGateway] = selection.split(":");
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

    try {
      const offersResponse = await fetch("/api/bff/subscription/offers", {
        cache: "no-store",
      });

      if (!offersResponse.ok) {
        throw await readBffError(
          offersResponse,
          "Не удалось перепроверить цену. Продление не создано.",
        );
      }

      const offersBody = await offersResponse.json().catch(() => null) as {
        data?: SubscriptionOffersResponse;
      } | null;
      const freshOffers = offersBody?.data;
      const freshPlan = freshOffers ? findRenewPlan(freshOffers) : undefined;
      const freshDuration = freshPlan?.durations.find(
        (duration) => duration.days === selectedDuration.days,
      );
      const freshPrice = freshDuration?.prices.find(
        (price) => price.gateway_type === selectedPrice.gateway_type,
      );

      if (!freshOffers || !freshPlan || !freshDuration || !freshPrice) {
        finishSubmitting();
        setSubmitError("Выбранное предложение продления больше недоступно. Оплата не создана.");
        return;
      }

      if (!paymentOfferMatches(payload, freshPlan, freshDuration.days, freshPrice)) {
        setState({ status: "ready", offers: freshOffers });
        setSelection(`${freshDuration.days}:${freshPrice.gateway_type}`);
        finishSubmitting();
        setSubmitError(
          `Цена изменилась: было ${selectedPrice.final_amount} ${selectedPrice.currency_symbol}, стало ${freshPrice.final_amount} ${freshPrice.currency_symbol}. Проверьте новую цену перед оплатой.`,
        );
        return;
      }
    } catch (error) {
      if (
        error instanceof BffClientError &&
        (error.code === "EMAIL_REQUIRED" ||
          error.code === "EMAIL_NOT_VERIFIED")
      ) {
        replaceWith(accountLinkPath(selectedExtendDestination));
        return;
      }

      finishSubmitting();
      setSubmitError("Не удалось перепроверить цену. Продление не создано; повторите попытку позже.");
      return;
    }

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
      let response: Response;

      try {
        response = await fetch("/api/bff/subscription/extend", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        });
      } catch {
        setSubmitError(
          "Не удалось получить результат продления. Повторите попытку — новая оплата не будет создана.",
        );
        return;
      }

      const operationStatus = parsePaymentOperationStatusEnvelope(
        await response.clone().json().catch(() => null),
      );

      if (response.status === 202) {
        if (operationStatus) {
          storePaymentReturnReference({
            operationId: operationStatus.operationId,
          });
          paymentConfirmed = true;
          window.location.assign(
            `/payment/pending?operation_id=${encodeURIComponent(operationStatus.operationId)}`,
          );
          return;
        }
        setSubmitError(
          "Результат продления уточняется. Не создавайте новую оплату; повторите проверку через несколько секунд.",
        );
        return;
      }

      if (!response.ok) {
        const manualReview = operationStatus?.status === "manual_required";
        const responseError = manualReview
          ? null
          : await readBffError(response, "Не удалось выполнить действие.");

        if (
          responseError instanceof BffClientError &&
          (responseError.code === "EMAIL_REQUIRED" ||
            responseError.code === "EMAIL_NOT_VERIFIED")
        ) {
          replaceWith(accountLinkPath(selectedExtendDestination));
          return;
        }

        const message = manualReview
          ? `Статус продления не удалось определить автоматически. Не повторяйте оплату; обратитесь в поддержку и сообщите номер операции ${operationStatus.operationId}.`
          : responseError?.message ?? "Не удалось выполнить действие.";

        if (manualReview) {
          storePaymentReturnReference({
            operationId: operationStatus.operationId,
          });
        }

        if (response.status < 500) {
          if (!shouldRetainPaymentIdempotencyKey(response.status, operationStatus?.status)) {
            clearPaymentIdempotencyKey("extend", payload, idempotencyKey);
          }
          setSubmitError(message);
        } else {
          setSubmitError(
            "Не удалось подтвердить результат продления. Повторите попытку — новая оплата не будет создана.",
          );
        }
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        data?: PaymentInitResponse;
      } | null;

      if (!body?.data || typeof body.data.payment_id !== "string") {
        setSubmitError(
          "Не удалось подтвердить результат продления. Повторите попытку — новая оплата не будет создана.",
        );
        return;
      }

      clearPaymentIdempotencyKey("extend", payload, idempotencyKey);
      paymentConfirmed = true;

      storePaymentReturnReference({ paymentId: body.data.payment_id });

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
