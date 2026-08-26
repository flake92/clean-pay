"use client";

import { useState } from "react";

import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { paymentGatewayLabel } from "@/frontend/lib/payment-gateway";
import type {
  DurationGatewayPrice,
  PlanOffer,
} from "@/shared/domain/subscriptions";
import type { TariffsViewModel } from "@/application/models/tariffs";
import { Card } from "primereact/card";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";

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

function formatDeviceLimit(limit: number) {
  return limit > 0 ? String(limit) : "∞";
}

function discountedPrice(price: DurationGatewayPrice) {
  const original = Number(price.original_amount);
  const final = Number(price.final_amount);

  if (
    !Number.isFinite(original)
    || !Number.isFinite(final)
    || !Number.isFinite(price.discount_percent)
    || price.discount_percent <= 0
    || original <= final
  ) {
    return null;
  }

  return {
    originalAmount: price.original_amount,
    percent: new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 })
      .format(price.discount_percent),
  };
}

function priceOptionTemplate(option?: PriceOption) {
  if (!option) {
    return <span>Выберите длительность</span>;
  }

  return (
    <div className="clean-pay-price-option">
      <div className="clean-pay-price-option__main">
        <span className="clean-pay-price-option__duration">{option.duration}</span>
        <span className="clean-pay-price-option__price">
          {option.amount} {option.currency}
        </span>
      </div>
    </div>
  );
}

function gatewaySwitcher(
  gateways: string[],
  selectedGateway: string,
  onSelect: (gateway: string) => void,
) {
  if (gateways.length <= 1) {
    return null;
  }

  const selectedIndex = Math.max(gateways.indexOf(selectedGateway), 0);
  const move = (offset: number) => {
    const nextIndex = (selectedIndex + offset + gateways.length) % gateways.length;
    const nextGateway = gateways[nextIndex];

    if (nextGateway) {
      onSelect(nextGateway);
    }
  };

  return (
    <div className="clean-pay-gateway-field">
      <span className="text-sm font-medium text-700">Платёжный шлюз</span>
      <div
        aria-label="Выбор платёжного шлюза"
        className="clean-pay-gateway-switcher"
        role="group"
      >
        <button
          aria-label="Предыдущий платёжный шлюз"
          className="clean-pay-gateway-switcher__button"
          onClick={() => move(-1)}
          type="button"
        >
          <i aria-hidden="true" className="pi pi-chevron-left" />
        </button>
        <div aria-live="polite" className="clean-pay-gateway-switcher__current">
          <strong>{paymentGatewayLabel(selectedGateway)}</strong>
          <span>{selectedIndex + 1} из {gateways.length}</span>
        </div>
        <button
          aria-label="Следующий платёжный шлюз"
          className="clean-pay-gateway-switcher__button"
          onClick={() => move(1)}
          type="button"
        >
          <i aria-hidden="true" className="pi pi-chevron-right" />
        </button>
      </div>
    </div>
  );
}

function buildPriceOptions(plan: PlanOffer) {
  return plan.durations
    .flatMap((duration) =>
      duration.prices.map((price) => ({
        amount: String(price.final_amount),
        currency: price.currency_symbol,
        days: duration.days,
        duration: formatDuration(duration.days),
        gateway: price.gateway_type,
        label: `${formatDuration(duration.days)} - ${price.final_amount} ${price.currency_symbol} - ${paymentGatewayLabel(price.gateway_type)}`,
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

function priceChoiceList(
  options: PriceOption[],
  selected: string,
  onSelect: (value: string) => void,
) {
  return (
    <div
      aria-label="Выбор срока оплаты"
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

function bestPrice(plan: PlanOffer) {
  const prices = plan.durations.flatMap((duration) => duration.prices);

  return prices.reduce<DurationGatewayPrice | null>((best, price) => {
    if (!best) {
      return price;
    }

    return Number(price.final_amount) < Number(best.final_amount) ? price : best;
  }, null);
}

export function TariffsPanel({ model }: { model: TariffsViewModel }) {
  const [selection, setSelection] = useState<Record<string, string>>({});

  if (model.status === "error") {
    if (model.action) {
      return (
        <AccountActionRequired
          action={model.action}
          message={model.message}
          redirectTo="/tariffs"
        />
      );
    }

    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={model.message} />
      </div>
    );
  }

  if (model.offers.plans.length === 0) {
    return <Message severity="info" text="Доступных тарифов пока нет." />;
  }

  const hasCurrentSubscription = model.offers.has_current_subscription;

  return (
    <div className="flex flex-column gap-4">
      {hasCurrentSubscription ? (
        <Message
          severity="warn"
          text="У вас уже есть активная подписка. Выбор тарифа здесь изменит тариф полностью: текущий тариф будет заменён без перерасчёта. Для обычного продления используйте раздел продления, если он доступен."
        />
      ) : null}
      <div className="grid">
        {model.offers.plans.map((plan) => {
          const priceOptions = buildPriceOptions(plan);
          const defaultSelected = priceOptions[0]?.value ?? "";
          const selected = selection[plan.public_code] ?? defaultSelected;
          const selectedOption =
            priceOptions.find((option) => option.value === selected) ?? priceOptions[0];
          const selectedGateway = selectedOption?.gateway ?? "";
          const gateways = Array.from(
            new Set(priceOptions.map((option) => option.gateway)),
          );
          const gatewayPriceOptions = priceOptions.filter(
            (option) => option.gateway === selectedGateway,
          );
          const selectedDuration = plan.durations.find(
            (duration) => duration.days === selectedOption?.days,
          );
          const selectedPrice = selectedDuration?.prices.find(
            (price) => price.gateway_type === selectedGateway,
          );
          const fallbackPrice = bestPrice(plan);
          const currentPrice = selectedPrice ?? fallbackPrice;
          const discount = currentPrice ? discountedPrice(currentPrice) : null;
          const paymentHref = currentPrice
            ? `/payment?plan=${encodeURIComponent(plan.public_code)}&duration=${encodeURIComponent(
                selectedDuration?.days ?? selectedOption?.days ?? plan.durations[0]?.days ?? "",
              )}&gateway=${encodeURIComponent(currentPrice.gateway_type)}`
            : "#";
          const selectGateway = (gateway: string) => {
            const nextOptions = priceOptions.filter(
              (option) => option.gateway === gateway,
            );
            const nextOption =
              nextOptions.find((option) => option.days === selectedOption?.days) ?? nextOptions[0];

            if (nextOption) {
              setSelection((current) => ({
                ...current,
                [plan.public_code]: nextOption.value,
              }));
            }
          };

          return (
            <div className="col-12 xl:col-6" key={plan.public_code}>
              <Card className="shadow-1 h-full">
                <div className="flex flex-column gap-4">
                  <div className="flex flex-wrap align-items-start justify-content-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap align-items-center gap-2">
                        <h2 className="text-xl font-semibold break-words">{plan.name}</h2>
                        <Tag severity="info" value={plan.type} />
                      </div>
                      {plan.description ? (
                        <p className="mt-1 line-height-3 text-600 break-words">
                          {plan.description}
                        </p>
                      ) : null}
                    </div>
                    {currentPrice ? (
                      <div className="text-right">
                        <p className="m-0 text-3xl font-semibold text-900">
                          {currentPrice.final_amount} {currentPrice.currency_symbol}
                        </p>
                        {discount ? (
                          <div className="mt-1 flex align-items-center justify-content-end gap-2">
                            <del className="text-sm text-500">
                              {discount.originalAmount} {currentPrice.currency_symbol}
                            </del>
                            <Tag severity="success" value={`Скидка ${discount.percent}%`} />
                          </div>
                        ) : null}
                        <p className="m-0 mt-1 text-sm text-500">
                          {paymentGatewayLabel(currentPrice.gateway_type)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid">
                    {[
                      ["Устройства", formatDeviceLimit(plan.device_limit)],
                      ["Трафик", formatTraffic(plan.traffic_limit)],
                      ["Тип", plan.type],
                    ].map(([label, value]) => (
                      <div className="col-12 md:col-4" key={label}>
                        <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
                          <div className="text-xs uppercase text-500">{label}</div>
                          <div className="mt-1 font-semibold text-900">{value}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-column gap-3">
                    {gatewaySwitcher(gateways, selectedGateway, selectGateway)}
                    <span className="text-sm font-medium text-700">Длительность</span>
                    <Dropdown
                      aria-label="Длительность"
                      className="clean-pay-price-dropdown"
                      id={plan.public_code}
                      onChange={(event) =>
                        setSelection((current) => ({
                          ...current,
                          [plan.public_code]: event.value,
                        }))
                      }
                      optionLabel="label"
                      optionValue="value"
                      itemTemplate={priceOptionTemplate}
                      options={gatewayPriceOptions}
                      panelClassName="clean-pay-price-dropdown-panel"
                      value={selected}
                      valueTemplate={priceOptionTemplate}
                    />
                    {priceChoiceList(gatewayPriceOptions, selected, (value) =>
                      setSelection((current) => ({
                        ...current,
                        [plan.public_code]: value,
                      })),
                    )}
                  </div>
                  <LinkButton
                    className="w-fit"
                    href={paymentHref}
                    icon="pi pi-arrow-right"
                    label={hasCurrentSubscription ? "Изменить тариф" : "Выбрать"}
                  />
                </div>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
