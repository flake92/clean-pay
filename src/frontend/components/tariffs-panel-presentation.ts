import { paymentGatewayLabel } from "@/frontend/lib/payment-gateway";
import type {
  DurationGatewayPrice,
  PlanOffer,
} from "@/shared/domain/subscriptions";

export type TariffPriceOption = {
  amount: string;
  currency: string;
  days: number;
  duration: string;
  gateway: string;
  label: string;
  value: string;
};

export function formatTariffDuration(days: number) {
  if (days <= 0) {
    return "∞";
  }

  if (days % 30 === 0) {
    const months = days / 30;
    return `${months} мес.`;
  }

  return `${days} дн.`;
}

export function formatTariffTraffic(limit: number) {
  if (limit <= 0) {
    return "Без лимита";
  }

  return `${limit} ГБ`;
}

export function formatTariffDeviceLimit(limit: number) {
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

function buildPriceOptions(plan: PlanOffer) {
  return plan.durations
    .flatMap((duration) =>
      duration.prices.map((price) => ({
        amount: String(price.final_amount),
        currency: price.currency_symbol,
        days: duration.days,
        duration: formatTariffDuration(duration.days),
        gateway: price.gateway_type,
        label: `${formatTariffDuration(duration.days)} - ${price.final_amount} ${price.currency_symbol} - ${paymentGatewayLabel(price.gateway_type)}`,
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

function bestPrice(plan: PlanOffer) {
  const prices = plan.durations.flatMap((duration) => duration.prices);

  return prices.reduce<DurationGatewayPrice | null>((best, price) => {
    if (!best) {
      return price;
    }

    return Number(price.final_amount) < Number(best.final_amount) ? price : best;
  }, null);
}

export function selectTariffPlanPresentation(
  plan: PlanOffer,
  selectedValue?: string,
) {
  const priceOptions = buildPriceOptions(plan);
  const defaultSelected = priceOptions[0]?.value ?? "";
  const selected = selectedValue ?? defaultSelected;
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

  return {
    currentPrice,
    discount,
    gateways,
    gatewayPriceOptions,
    paymentHref,
    priceOptions,
    selected,
    selectedGateway,
    selectedOption,
  };
}

export function selectTariffGatewayOption(
  priceOptions: TariffPriceOption[],
  selectedDays: number | undefined,
  gateway: string,
) {
  const nextOptions = priceOptions.filter(
    (option) => option.gateway === gateway,
  );

  return nextOptions.find((option) => option.days === selectedDays) ?? nextOptions[0];
}
