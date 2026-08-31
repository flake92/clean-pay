"use client";

import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  Button,
  Dropdown,
  Message,
} from "@/frontend/components/sakai/form-foundation";
import { paymentGatewayLabel } from "@/frontend/lib/payment-gateway";
import { useExtendConfirmationController } from "@/frontend/hooks/use-extend-confirmation-controller";
import { Card } from "primereact/card";
import type { CheckoutViewModel } from "@/application/models/checkout";
import {
  type ExtendPriceOption,
} from "@/frontend/components/extend-confirmation-presentation";

const defaultCheckoutModel: CheckoutViewModel = { status: "error", message: "Не удалось загрузить предложения продления." };

function pendingOperationDestination(operationId: string) {
  return `/payment/pending?operation_id=${encodeURIComponent(operationId)}`;
}

function pendingPaymentDestination(paymentId: string) {
  return `/payment/pending?payment_id=${encodeURIComponent(paymentId)}`;
}

function priceOptionTemplate(option?: ExtendPriceOption) {
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
      <span className="clean-pay-price-option__gateway">
        {paymentGatewayLabel(option.gateway)}
      </span>
    </div>
  );
}

function priceChoiceList(
  options: ExtendPriceOption[],
  selected: string,
  onSelect: (value: string) => void,
  disabled = false,
) {
  return (
    <div
      aria-label="Выбор срока и способа оплаты"
      className="clean-pay-price-choice-list"
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={option.value === selected}
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
  const {
    extendSubscription,
    priceOptions,
    requestedExtendDestination,
    selectedPrice,
    selection,
    setSelection,
    submitError,
    submitting,
    view,
  } = useExtendConfirmationController({
    model,
    pendingOperationDestination,
    pendingPaymentDestination,
    requestedDuration,
    requestedGateway,
  });

  if (view.kind === "verify-email") return null;

  if (view.kind === "account-action") {
    return (
      <AccountActionRequired
        action={view.action}
        message={view.message}
        redirectTo={requestedExtendDestination}
      />
    );
  }

  if (view.kind === "account-error") {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={view.message} />
      </div>
    );
  }

  if (view.kind === "provider-session-recovery") {
    return (
      <AccountActionRequired
        action="recover-session"
        redirectTo={requestedExtendDestination}
      />
    );
  }

  if (view.kind === "error") return <Message severity="error" text={view.message} />;

  if (view.kind === "no-subscription") {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="info" text="Действующая подписка не найдена. Сначала выберите тариф." />
        <LinkButton className="w-fit" href="/tariffs" label="Выбрать тариф" />
      </div>
    );
  }

  if (view.kind === "renew-unavailable") {
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

  const { model: readyModel, plan } = view;

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
          Текущий статус: {readyModel.offers.current_subscription_status ?? "-"}
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
