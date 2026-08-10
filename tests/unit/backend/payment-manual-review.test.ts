import { describe, expect, it } from "vitest";

import { isPaymentManualRequired, PAYMENT_MANUAL_REQUIRED_CODE } from "@/backend/payments/manual-review";

describe("payment manual review marker", () => {
  it("accepts only a reconciled unknown outcome with the exact marker", () => {
    const base = { status: "OUTCOME_UNKNOWN", reconciledAt: new Date(), reconcileErrorSnapshot: { code: PAYMENT_MANUAL_REQUIRED_CODE } };
    expect(isPaymentManualRequired(base)).toBe(true);
    expect(isPaymentManualRequired({ ...base, status: "SUCCEEDED" })).toBe(false);
    expect(isPaymentManualRequired({ ...base, reconciledAt: null })).toBe(false);
    expect(isPaymentManualRequired({ ...base, reconcileErrorSnapshot: null })).toBe(false);
    expect(isPaymentManualRequired({ ...base, reconcileErrorSnapshot: [] })).toBe(false);
    expect(isPaymentManualRequired({ ...base, reconcileErrorSnapshot: { code: "OTHER" } })).toBe(false);
  });
});
