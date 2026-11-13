import { describe, expect, it, vi } from "vitest";

import { parsePaymentCommandPayload } from "@/app/actions/runtime-payload";
import { activateCabinetPromocode } from "@/application/cabinet/execute-command";
import type { CabinetCommands } from "@/application/cabinet/ports/cabinet-commands";
import { loadGiftsViewModel } from "@/application/subscriptions/load-gifts";

const request = {
  plan_code: "basic",
  duration_days: 30,
  gateway_type: "YOOKASSA",
  confirmed_amount: "300.00",
  confirmed_currency: "RUB",
  offer_version: "v1:offer",
};
const idempotencyKey = "6f1c2b9e-1d3a-4c5b-8e7f-0a1b2c3d4e5f";

function commands(activation: Awaited<ReturnType<CabinetCommands["activatePromocode"]>>): CabinetCommands {
  return {
    deleteDevice: vi.fn(async () => undefined),
    deleteAllDevices: vi.fn(async () => undefined),
    reissueSubscription: vi.fn(async () => undefined),
    activatePromocode: vi.fn(async () => activation),
    logout: vi.fn(async () => undefined),
  };
}

describe("gift payment command", () => {
  it("drops a stale anonymous flag instead of rejecting the payment", () => {
    expect(parsePaymentCommandPayload({
      kind: "gift", idempotencyKey, request: { ...request, anonymous: true },
    })).toEqual({ kind: "gift", idempotencyKey, request });
  });
});

describe("gift activation message", () => {
  it("never names who bought the gift", async () => {
    await expect(activateCabinetPromocode(commands({ isGift: true }), "GIFT-A"))
      .resolves.toEqual({ status: "success", message: "Подарок активирован. Подписка обновлена." });
    await expect(activateCabinetPromocode(commands({ isGift: false }), "SPRING"))
      .resolves.toEqual({ status: "success", message: "Промокод активирован. Данные кабинета обновлены." });
  });
});

describe("received gifts on the gift page", () => {
  it("lists gifts the user activated next to the ones they bought", async () => {
    const received = {
      code: "GIFT-RECV-RECV-RECV",
      plan_name: "Basic",
      duration_days: 30,
      traffic_limit: 0,
      device_limit: 3,
      activated_at: null,
    };
    const model = await loadGiftsViewModel(
      { loadOffers: vi.fn(async () => ({ gateways: [], has_current_subscription: false, current_subscription_status: null, plans: [] })) },
      { loadGifts: vi.fn(async () => ({ gifts: [], received: [received] })) },
    );

    expect(model).toMatchObject({ status: "ready", gifts: [], received: [received] });
  });
});
