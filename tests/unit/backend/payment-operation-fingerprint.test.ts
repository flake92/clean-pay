import { describe, expect, it } from "vitest";

import { operationIdentity } from "@/backend/integrations/payments/payment-operation-contract";

// The fingerprint is what makes a retry with the same idempotency key resolve
// to the same operation instead of a second charge. Nothing pinned its value,
// so any change to the hashed tuple -- a reordered field, a renamed key, a
// bumped contract version -- would have gone unnoticed while every other test
// still passed. These vectors fail loudly instead.
//
// A deliberate change to the contract must bump
// PAYMENT_OPERATION_CONTRACT_VERSION and update these constants together.
const IDEMPOTENCY_KEY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const PURCHASE = {
  kind: "PURCHASE" as const,
  payload: {
    plan_code: "test-30",
    duration_days: 30,
    gateway_type: "YOOKASSA",
    confirmed_amount: "199",
    confirmed_currency: "RUB",
    offer_version: "v1:abc",
  },
};

const EXTEND = {
  kind: "EXTEND" as const,
  payload: {
    duration_days: 30,
    gateway_type: "YOOKASSA",
    confirmed_amount: "199",
    confirmed_currency: "RUB",
    offer_version: "v1:abc",
  },
};

describe("payment operation fingerprint", () => {
  it("keeps the purchase and extension fingerprints stable", () => {
    expect(operationIdentity({ idempotencyKey: IDEMPOTENCY_KEY, operation: PURCHASE }).fingerprint)
      .toBe("OzCkEiAWTqiRAxb8UA5P5qJF6n4cY6djAMVgveSyXdk");
    expect(operationIdentity({ idempotencyKey: IDEMPOTENCY_KEY, operation: EXTEND }).fingerprint)
      .toBe("hxX63hW22pygUXWD3IZVZBylId_sS2SGuSl-eu2ZfPM");
    expect(operationIdentity({ idempotencyKey: IDEMPOTENCY_KEY, operation: PURCHASE }).idempotencyKeyHash)
      .toBe("kgidJpwTfEVMATDdtZWOpcyxAGeAQJoIcNO5vBkPj2E");
  });

  it("separates a purchase from an extension carrying identical terms", () => {
    const purchase = operationIdentity({ idempotencyKey: IDEMPOTENCY_KEY, operation: PURCHASE });
    const extend = operationIdentity({ idempotencyKey: IDEMPOTENCY_KEY, operation: EXTEND });

    expect(purchase.fingerprint).not.toBe(extend.fingerprint);
  });

  it("changes the fingerprint when any priced term changes", () => {
    const base = operationIdentity({ idempotencyKey: IDEMPOTENCY_KEY, operation: PURCHASE }).fingerprint;

    for (const changed of [
      { ...PURCHASE, payload: { ...PURCHASE.payload, plan_code: "test-90" } },
      { ...PURCHASE, payload: { ...PURCHASE.payload, duration_days: 90 } },
      { ...PURCHASE, payload: { ...PURCHASE.payload, gateway_type: "YOOMONEY" } },
      { ...PURCHASE, payload: { ...PURCHASE.payload, confirmed_amount: "299" } },
      { ...PURCHASE, payload: { ...PURCHASE.payload, confirmed_currency: "USD" } },
      { ...PURCHASE, payload: { ...PURCHASE.payload, offer_version: "v1:def" } },
    ]) {
      expect(
        operationIdentity({ idempotencyKey: IDEMPOTENCY_KEY, operation: changed }).fingerprint,
        JSON.stringify(changed.payload),
      ).not.toBe(base);
    }
  });
});
