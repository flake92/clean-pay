import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("payment status subscription errors", () => {
  // This used to assert that the adapter source mentioned SUBSCRIPTION_NOT_FOUND
  // and "throw error". That guarded a mechanism nothing used: the port exposed
  // isSubscriptionMissing, the adapter implemented it, and no use case ever
  // called it, while loadPaymentStatus caught every failure from
  // loadSubscription and rendered it as "no subscription". The string match
  // passed regardless, so it asserted a distinction the product did not make.
  //
  // Assert the property that is real instead: the adapter must carry an
  // upstream error's own code through rather than flattening every failure
  // into one, and must not blanket-catch a lookup into null itself.
  const source = readFileSync(
    "src/backend/integrations/payments/payment-status-reader.ts",
    "utf8",
  );

  it("preserves the upstream error code instead of flattening every failure", () => {
    expect(source).toMatch(/error instanceof ServiceError \? error\.code : "INTERNAL_ERROR"/);
    expect(source).toContain("if (error instanceof PaymentStatusGatewayError) throw error;");
  });

  it("leaves the decision to degrade to the caller rather than swallowing it", () => {
    expect(source).not.toMatch(/catch\s*\{\s*\r?\n\s*subscription = null;/);
    expect(source).not.toMatch(/catch\s*\{\s*\r?\n\s*return null;/);
  });

  it("keeps that degradation deliberate and stated where it happens", () => {
    const useCase = readFileSync("src/application/payments/load-payment-status.ts", "utf8");

    // The catch is intentional -- payment synchronization is authoritative and
    // the subscription is decoration -- but it must stay commented, because an
    // unexplained empty catch here is indistinguishable from a swallowed bug.
    expect(useCase).toMatch(/catch\s*\{[\s\S]{0,200}?authoritative/);
  });
});
