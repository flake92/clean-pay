import { describe, expect, it } from "vitest";

import {
  confirmedPaymentOffer,
  giftPrice,
  paymentOfferMatches,
  paymentOfferVersion,
} from "@/shared/domain/payment-offer";

const plan = { id: 7, public_code: "standard" };
const price = {
  gateway_type: "YOOKASSA",
  currency: "RUB",
  currency_symbol: "₽",
  original_amount: "120.00",
  discount_percent: 10,
  final_amount: "108.00",
  is_free: false,
};

describe("payment offer policy", () => {
  it("builds a deterministic confirmation bound to every price dimension", () => {
    const confirmation = confirmedPaymentOffer(plan, 30, price);

    expect(confirmation).toEqual({
      confirmed_amount: "108.00",
      confirmed_currency: "RUB",
      offer_version: paymentOfferVersion(plan, 30, price),
    });
    expect(paymentOfferMatches(confirmation, plan, 30, price)).toBe(true);
  });

  it("rejects stale amount, currency, duration and offer metadata", () => {
    const confirmation = confirmedPaymentOffer(plan, 30, price);

    expect(paymentOfferMatches({ ...confirmation, confirmed_amount: "109.00" }, plan, 30, price)).toBe(false);
    expect(paymentOfferMatches({ ...confirmation, confirmed_currency: "USD" }, plan, 30, price)).toBe(false);
    expect(paymentOfferMatches(confirmation, plan, 60, price)).toBe(false);
    expect(paymentOfferMatches(confirmation, plan, 30, { ...price, discount_percent: 0 })).toBe(false);
  });

  it("prices a gift at the list price without the buyer's discount", () => {
    const gift = giftPrice(price);

    expect(gift).toEqual({ ...price, discount_percent: 0, final_amount: "120.00", is_free: false });
    // A confirmation of the discounted own-purchase price cannot pay for a gift.
    expect(paymentOfferMatches(confirmedPaymentOffer(plan, 30, price), plan, 30, gift)).toBe(false);
    expect(paymentOfferMatches(confirmedPaymentOffer(plan, 30, gift), plan, 30, gift)).toBe(true);
    expect(giftPrice({ ...price, original_amount: "0.00", final_amount: "0.00", is_free: true }).is_free)
      .toBe(true);
  });
});
