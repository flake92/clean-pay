import { describe, expect, it } from "vitest";

import { operationIdentity } from "@/backend/integrations/payments/payment-operation-contract";

const payload = {
  plan_code: "basic",
  duration_days: 30,
  gateway_type: "YOOKASSA",
  confirmed_amount: "300.00",
  confirmed_currency: "RUB",
  offer_version: "v1:offer",
};
const idempotencyKey = "6f1c2b9e-1d3a-4c5b-8e7f-0a1b2c3d4e5f";

describe("gift payment operation identity", () => {
  it("stores a gift as a marked PURCHASE so no database enum value is needed", () => {
    const gift = operationIdentity({ idempotencyKey, operation: { kind: "GIFT", payload } });

    expect(gift.kind).toBe("PURCHASE");
    expect(gift.payload).toEqual({ ...payload, gift: true });
  });

  it("never lets one idempotency key switch between a gift and a purchase", () => {
    const gift = operationIdentity({ idempotencyKey, operation: { kind: "GIFT", payload } });
    const purchase = operationIdentity({ idempotencyKey, operation: { kind: "PURCHASE", payload } });

    expect(gift.idempotencyKeyHash).toBe(purchase.idempotencyKeyHash);
    expect(gift.fingerprint).not.toBe(purchase.fingerprint);
    expect(purchase.payload).not.toHaveProperty("gift");
  });
});

describe("gift operation identity without a privacy choice", () => {
  it("ignores a stale anonymous flag from an old browser tab", () => {
    const named = operationIdentity({ idempotencyKey, operation: { kind: "GIFT", payload } });
    const stale = operationIdentity({
      idempotencyKey,
      operation: { kind: "GIFT", payload: { ...payload, anonymous: true } as typeof payload },
    });

    expect(stale.fingerprint).toBe(named.fingerprint);
    expect(stale.payload).toEqual({ ...payload, gift: true });
  });
});
