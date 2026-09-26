import { describe, expect, it } from "vitest";

import {
  buildExtendPriceOptions,
  extendDurationLabel,
  extensionDestination,
  initialExtendSelection,
  parseExtendSelection,
  selectExtendConfirmationView,
} from "@/frontend/components/extend-confirmation-presentation";
import {
  findPaymentSelection,
  paymentDeviceLimitLabel,
  paymentDurationLabel,
  paymentPlanDescription,
  paymentTrafficLabel,
  selectPaymentConfirmationView,
} from "@/frontend/components/payment-confirmation-presentation";
import type {
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";

const plan: PlanOffer = {
  id: 1,
  public_code: "pro",
  name: "Pro",
  description: null,
  traffic_limit: 100,
  device_limit: 3,
  type: "standard",
  recommended_purchase_type: "NEW",
  durations: [
    {
      days: 30,
      prices: [
        {
          gateway_type: "CARD",
          currency: "RUB",
          currency_symbol: "₽",
          original_amount: "500.00",
          discount_percent: 0,
          final_amount: "500.00",
          is_free: false,
        },
        {
          gateway_type: "SBP",
          currency: "RUB",
          currency_symbol: "₽",
          original_amount: "450.00",
          discount_percent: 0,
          final_amount: "450.00",
          is_free: false,
        },
      ],
    },
  ],
};

const offers: SubscriptionOffersResponse = {
  gateways: [],
  plans: [plan],
  has_current_subscription: true,
  current_subscription_status: "active",
};

describe("purchase and extension presentation selectors", () => {
  it("selects only an exact purchase plan, duration and gateway tuple", () => {
    expect(findPaymentSelection(offers, "pro", "30", "CARD")).toEqual({
      plan,
      duration: plan.durations[0],
      price: plan.durations[0]?.prices[0],
    });
    expect(findPaymentSelection(offers, "pro", "30", "missing")).toBeNull();
    expect(findPaymentSelection(offers, "missing", "30", "CARD")).toBeNull();
  });

  it("preserves the exact purchase labels", () => {
    expect(paymentDurationLabel(0)).toBe("∞");
    expect(paymentDurationLabel(30)).toBe("1 мес.");
    expect(paymentDurationLabel(14)).toBe("14 дн.");
    expect(paymentDeviceLimitLabel(0)).toBe("∞");
    expect(paymentTrafficLabel(0)).toBe("Без лимита");
    expect(paymentPlanDescription(plan)).toBe("3 устройств · 100 ГБ · standard");
  });

  it("builds extension options in the established numeric sort order", () => {
    const options = buildExtendPriceOptions(plan);

    expect(options.map(({ amount, days, gateway }) => ({ amount, days, gateway }))).toEqual([
      { amount: "450.00", days: 30, gateway: "SBP" },
      { amount: "500.00", days: 30, gateway: "CARD" },
    ]);
    expect(options[0]?.duration).toBe(extendDurationLabel(30));
    expect(initialExtendSelection(plan, "30", "CARD")).toBe('["30","CARD"]');
    expect(initialExtendSelection(plan, "90", "CARD")).toBe(options[0]?.value);
  });

  it("fails closed for corrupt selection state and unsafe extension destinations", () => {
    expect(parseExtendSelection('["30","CARD"]')).toEqual(["30", "CARD"]);
    expect(parseExtendSelection("not-json")).toEqual(["", ""]);
    expect(parseExtendSelection('[30,"CARD"]')).toEqual(["", ""]);
    expect(extensionDestination(30, "CARD")).toBe("/extend?duration=30&gateway=CARD");
    expect(extensionDestination("030", "CARD")).toBe("/extend");
    expect(extensionDestination(30, "x".repeat(101))).toBe("/extend");
  });

  it("projects checkout models into discriminated purchase and extension view states", () => {
    expect(selectPaymentConfirmationView(
      { status: "ready", offers },
      "pro",
      "30",
      "CARD",
    )).toMatchObject({ kind: "ready", selection: { plan } });
    expect(selectPaymentConfirmationView(
      { status: "account-action-required", action: "verifyEmail", message: "verify" },
      null,
      null,
      null,
    )).toEqual({ kind: "verify-email" });
    expect(selectPaymentConfirmationView(
      { status: "provider-session-recovery-required" },
      null,
      null,
      null,
    )).toEqual({ kind: "provider-session-recovery" });

    const renewPlan = { ...plan, recommended_purchase_type: "RENEW" };
    const renewalOffers = { ...offers, plans: [renewPlan] };
    expect(selectExtendConfirmationView({ status: "ready", offers: renewalOffers })).toMatchObject({
      kind: "ready",
      plan: renewPlan,
    });
    expect(selectExtendConfirmationView({
      status: "ready",
      offers: { ...offers, has_current_subscription: false },
    })).toEqual({ kind: "no-subscription" });
    expect(selectExtendConfirmationView({ status: "error", message: "failed" })).toEqual({
      kind: "error",
      message: "failed",
    });
  });
});
