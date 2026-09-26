"use client";

import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  formatTariffDeviceLimit,
  formatTariffTraffic,
  selectTariffGatewayOption,
  selectTariffPlanPresentation,
  type TariffPriceOption,
} from "@/frontend/components/tariffs-panel-presentation";
import { useTariffsPanelController } from "@/frontend/hooks/use-tariffs-panel-controller";
import { paymentGatewayLabel } from "@/frontend/lib/payment-gateway";
import type { TariffsViewModel } from "@/application/models/tariffs";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";

import { Dropdown, Message } from "@/frontend/components/sakai/form-foundation";

function priceOptionTemplate(option?: TariffPriceOption) {
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

function priceChoiceList(
  options: TariffPriceOption[],
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

export function TariffsPanel({ model }: { model: TariffsViewModel }) {
  const { selection, selectPrice } = useTariffsPanelController();

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
          const {
            currentPrice,
            discount,
            gateways,
            gatewayPriceOptions,
            paymentHref,
            priceOptions,
            selected,
            selectedGateway,
            selectedOption,
          } = selectTariffPlanPresentation(
            plan,
            selection[plan.public_code],
          );
          const selectGateway = (gateway: string) => {
            const nextOption = selectTariffGatewayOption(
              priceOptions,
              selectedOption?.days,
              gateway,
            );

            if (nextOption) {
              selectPrice(plan.public_code, nextOption.value);
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
                      ["Устройства", formatTariffDeviceLimit(plan.device_limit)],
                      ["Трафик", formatTariffTraffic(plan.traffic_limit)],
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
                        selectPrice(plan.public_code, event.value)
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
                      selectPrice(plan.public_code, value),
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
