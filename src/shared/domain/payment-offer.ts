import type { DurationGatewayPrice, PlanOffer } from "@/shared/domain/subscriptions";

export type ConfirmedPaymentOffer = {
  confirmed_amount: string;
  confirmed_currency: string;
  offer_version: string;
};

export function paymentOfferVersion(
  plan: Pick<PlanOffer, "id" | "public_code">,
  durationDays: number,
  price: DurationGatewayPrice,
) {
  const canonical = JSON.stringify([
    "clean-pay.offer",
    1,
    plan.id,
    plan.public_code,
    durationDays,
    price.gateway_type,
    price.currency,
    price.original_amount,
    price.discount_percent,
    price.final_amount,
    price.is_free,
  ]);

  return `v1:${encodeURIComponent(canonical)}`;
}

export function confirmedPaymentOffer(
  plan: Pick<PlanOffer, "id" | "public_code">,
  durationDays: number,
  price: DurationGatewayPrice,
): ConfirmedPaymentOffer {
  return {
    confirmed_amount: price.final_amount,
    confirmed_currency: price.currency,
    offer_version: paymentOfferVersion(plan, durationDays, price),
  };
}

/**
 * A gift is sold at the list price: the buyer's personal and one-time discounts
 * apply only to their own subscription, so Remnashop charges `original_amount`.
 */
export function giftPrice(price: DurationGatewayPrice): DurationGatewayPrice {
  return {
    ...price,
    discount_percent: 0,
    final_amount: price.original_amount,
    is_free: Number(price.original_amount) <= 0,
  };
}

export function paymentOfferMatches(
  confirmed: ConfirmedPaymentOffer,
  plan: Pick<PlanOffer, "id" | "public_code">,
  durationDays: number,
  price: DurationGatewayPrice,
) {
  return (
    confirmed.confirmed_amount === price.final_amount &&
    confirmed.confirmed_currency === price.currency &&
    confirmed.offer_version === paymentOfferVersion(plan, durationDays, price)
  );
}
