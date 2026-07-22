import { describe, expect, it } from "vitest";

import {
  readExtendRequest,
  readPurchaseRequest,
} from "@/backend/payments/request-validation";
import {
  confirmedPaymentOffer,
  paymentOfferMatches,
  paymentOfferVersion,
} from "@/shared/payments/offer-confirmation";

const plan = { id: 7, public_code: "pro" };
const price = {
  gateway_type: "YOOKASSA",
  currency: "RUB",
  currency_symbol: "₽",
  original_amount: "120.00",
  discount_percent: 10,
  final_amount: "108.00",
  is_free: false,
};
const confirmation = confirmedPaymentOffer(plan, 30, price);

function request(body: BodyInit) {
  return new Request("http://clean-pay.local/payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("payment request validation", () => {
  it("returns a controlled validation error for malformed or non-object JSON", async () => {
    await expect(readPurchaseRequest(request("{"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    await expect(readPurchaseRequest(request("[]"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it.each([
    { duration_days: -1 },
    { duration_days: 1.5 },
    { gateway_type: "" },
    { confirmed_amount: "1e6" },
    { confirmed_currency: "rub" },
    { offer_version: "" },
  ])("rejects invalid payment fields: %j", async (override) => {
    const body = {
      plan_code: "pro",
      duration_days: 30,
      gateway_type: "YOOKASSA",
      ...confirmation,
      ...override,
    };

    await expect(
      readPurchaseRequest(request(JSON.stringify(body))),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("returns only validated purchase and extend fields", async () => {
    const common = {
      duration_days: 30,
      gateway_type: "YOOKASSA",
      ...confirmation,
      ignored: "never forwarded",
    };

    await expect(
      readPurchaseRequest(request(JSON.stringify({ plan_code: "pro", ...common }))),
    ).resolves.toEqual({ plan_code: "pro", ...confirmation, duration_days: 30, gateway_type: "YOOKASSA" });
    await expect(
      readExtendRequest(request(JSON.stringify(common))),
    ).resolves.toEqual({ ...confirmation, duration_days: 30, gateway_type: "YOOKASSA" });
  });
});

describe("payment offer confirmation", () => {
  it("is deterministic and binds every invoice-relevant price field", () => {
    expect(paymentOfferVersion(plan, 30, price)).toBe(
      paymentOfferVersion(plan, 30, { ...price }),
    );
    expect(paymentOfferMatches(confirmation, plan, 30, price)).toBe(true);

    for (const changed of [
      { ...price, final_amount: "109.00" },
      { ...price, currency: "USD" },
      { ...price, discount_percent: 11 },
      { ...price, original_amount: "121.00" },
      { ...price, gateway_type: "OTHER" },
      { ...price, is_free: true },
    ]) {
      expect(paymentOfferMatches(confirmation, plan, 30, changed)).toBe(false);
    }
    expect(paymentOfferMatches(confirmation, plan, 31, price)).toBe(false);
    expect(paymentOfferMatches(confirmation, { ...plan, id: 8 }, 30, price)).toBe(false);
  });
});
