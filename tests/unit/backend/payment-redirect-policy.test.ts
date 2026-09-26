import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePaymentResponse } from "@/backend/integrations/payments/payment-operation-snapshot";
import { isAllowedPaymentRedirectUrl } from "@/backend/payments/payment-redirect-policy";

const storedPayment = {
  payment_id: "11111111-1111-4111-8111-111111111111",
  payment_url: "https://yoomoney.ru/quickpay/confirm?order=one#continue",
  purchase_type: "NEW",
  status: "pending",
  is_free: false,
  final_amount: "100.00",
  currency: "RUB",
};

describe("payment redirect policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("matches exact HTTPS origins while allowing provider paths and query data", () => {
    const origins = ["https://yoomoney.ru", "https://pay.platega.io"];

    expect(isAllowedPaymentRedirectUrl(storedPayment.payment_url, origins)).toBe(true);
    expect(isAllowedPaymentRedirectUrl(
      "https://pay.platega.io/transaction/one?lang=ru",
      origins,
    )).toBe(true);

    for (const unsafe of [
      "https://evil.example/phish",
      "https://yoomoney.ru.evil.example/phish",
      "https://user:password@yoomoney.ru/phish",
      "http://yoomoney.ru/phish",
      "javascript:alert(1)",
    ]) {
      expect(isAllowedPaymentRedirectUrl(unsafe, origins)).toBe(false);
    }
  });

  it("fails closed when replaying a redirect stored by an older release", () => {
    vi.stubEnv(
      "PAYMENT_REDIRECT_ORIGINS",
      "https://yoomoney.ru,https://pay.platega.io",
    );

    expect(parsePaymentResponse(storedPayment)).toEqual(storedPayment);
    expect(() => parsePaymentResponse({
      ...storedPayment,
      payment_url: "https://evil.example/phish",
    })).toThrow("Stored payment operation redirect is not allowed");
    expect(() => parsePaymentResponse({
      ...storedPayment,
      payment_url: "https://user:password@yoomoney.ru/phish",
    })).toThrow("Stored payment operation redirect is not allowed");
  });
});
