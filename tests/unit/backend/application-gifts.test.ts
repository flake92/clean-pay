import { describe, expect, it, vi } from "vitest";

import { loadGiftsViewModel } from "@/application/subscriptions/load-gifts";
import { SubscriptionCatalogAccessError } from "@/application/subscriptions/ports/subscription-catalog";
import type { Gift } from "@/shared/domain/gifts";

const discounted = {
  gateway_type: "YOOKASSA",
  currency: "RUB",
  currency_symbol: "₽",
  original_amount: "300.00",
  discount_percent: 10,
  final_amount: "270.00",
  is_free: false,
};
const free = { ...discounted, original_amount: "0.00", final_amount: "0.00", discount_percent: 0, is_free: true };

const offers = {
  gateways: [],
  has_current_subscription: true,
  current_subscription_status: "ACTIVE",
  plans: [
    {
      id: 1,
      public_code: "basic",
      name: "Basic",
      description: null,
      traffic_limit: 0,
      device_limit: 3,
      type: "UNLIMITED",
      recommended_purchase_type: "renew",
      durations: [{ days: 30, prices: [discounted] }],
    },
    {
      id: 2,
      public_code: "free",
      name: "Free",
      description: null,
      traffic_limit: 0,
      device_limit: 1,
      type: "UNLIMITED",
      recommended_purchase_type: "new",
      durations: [{ days: 7, prices: [free] }],
    },
  ],
};

const gift: Gift = {
  code: "GIFT-ABCD-EFGH-JKMN",
  payment_id: "p-1",
  status: "AVAILABLE",
  plan_name: "Basic",
  duration_days: 30,
  traffic_limit: 0,
  device_limit: 3,
  created_at: null,
  expires_at: null,
  activated_at: null,
};

describe("gift page", () => {
  it("offers paid plans at the list price and lists bought codes", async () => {
    const model = await loadGiftsViewModel(
      { loadOffers: vi.fn(async () => offers) },
      { loadGifts: vi.fn(async () => ({ gifts: [gift] })) },
    );

    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.offers.plans.map((plan) => plan.public_code)).toEqual(["basic"]);
    expect(model.offers.plans[0]?.durations[0]?.prices[0]).toMatchObject({
      final_amount: "300.00",
      discount_percent: 0,
    });
    expect(model.gifts).toEqual([gift]);
    expect(model.giftsError).toBeNull();
  });

  it("still sells gifts when the bought-codes list is unavailable", async () => {
    const model = await loadGiftsViewModel(
      { loadOffers: vi.fn(async () => offers) },
      { loadGifts: vi.fn(async () => { throw new Error("404"); }) },
    );

    expect(model).toMatchObject({ status: "ready", gifts: [] });
    expect(model.status === "ready" && model.giftsError).toBeTruthy();
  });

  it("asks to sign in like the tariffs page", async () => {
    const gifts = { loadGifts: vi.fn() };
    const model = await loadGiftsViewModel(
      { loadOffers: vi.fn(async () => { throw new SubscriptionCatalogAccessError("unauthorized"); }) },
      gifts,
    );

    expect(model).toMatchObject({ status: "error", action: "login" });
    expect(gifts.loadGifts).not.toHaveBeenCalled();
  });
});
