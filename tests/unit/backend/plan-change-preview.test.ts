import { describe, expect, it, vi } from "vitest";

import { previewCabinetPromocode } from "@/application/cabinet/execute-command";
import type { CabinetCommands } from "@/application/cabinet/ports/cabinet-commands";
import { loadChangeQuote } from "@/application/payments/load-change-quote";
import { decodeRemnashopEndpointResponse } from "@/backend/integrations/remnashop/response-decoders";
import {
  changeQuoteSummary,
  giftOutcomeSummary,
  type GiftOutcome,
} from "@/shared/domain/plan-change";

const convert: GiftOutcome = {
  kind: "CONVERT",
  plan_name: "Семья",
  gift_days: 30,
  expire_at: "2027-01-22T12:00:00Z",
  current_plan_name: "Соло",
  remaining_days: 20,
  credit_days: 40,
};

function commands(preview: Awaited<ReturnType<CabinetCommands["previewPromocode"]>>): CabinetCommands {
  return {
    deleteDevice: vi.fn(async () => undefined),
    deleteAllDevices: vi.fn(async () => undefined),
    reissueSubscription: vi.fn(async () => undefined),
    activatePromocode: vi.fn(async () => ({ isGift: false })),
    previewPromocode: vi.fn(async () => preview),
    logout: vi.fn(async () => undefined),
  };
}

describe("plan change and gift summaries", () => {
  it("shows the plan-change credit like the bot", () => {
    expect(changeQuoteSummary({
      mode: "CREDIT", left_days: 12, credit_days: 18, expire_at: "2026-12-31T00:00:00Z",
    })).toEqual({
      headline: "Текущая подписка будет заменена выбранной с перерасчётом.",
      lines: [
        "Осталось: 12 дн. по текущему тарифу",
        "Перерасчёт: +18 дн. по стоимости нового тарифа",
        `Подписка будет действовать до: ${new Date("2026-12-31T00:00:00Z").toLocaleDateString("ru-RU")}`,
      ],
    });
    expect(changeQuoteSummary({ mode: "NEW", left_days: 0, credit_days: 0, expire_at: null })).toBeNull();
    expect(changeQuoteSummary({ mode: "NONE", left_days: 0, credit_days: 0, expire_at: null })?.headline)
      .toContain("Остатка для перерасчёта нет");
    expect(changeQuoteSummary({ mode: "OFF", left_days: 0, credit_days: 0, expire_at: null })?.lines)
      .toEqual(["Срок: бессрочно"]);
  });

  it("explains every gift outcome before activation", () => {
    const summary = giftOutcomeSummary(convert);
    expect(summary.headline).toContain("с «Соло» на «Семья» с перерасчётом");
    expect(summary.lines).toEqual([
      "Осталось: 20 дн. по текущему тарифу",
      "Перерасчёт: +40 дн. по стоимости тарифа подарка",
      "Подарок: +30 дн.",
      `Подписка будет действовать до: ${new Date(convert.expire_at as string).toLocaleDateString("ru-RU")}`,
    ]);
    for (const kind of ["NEW", "RESTART", "EXTEND", "KEEP_DAYS", "UNLIMITED"] as const) {
      expect(giftOutcomeSummary({ ...convert, kind }).headline).toContain("Подарок: тариф «Семья»");
    }
    expect(giftOutcomeSummary({ ...convert, kind: "UNLIMITED", expire_at: null }).headline)
      .toContain("бессрочной");
  });
});

describe("Remnashop preview decoders", () => {
  it("projects a gift preview and a change quote, rejecting unknown kinds", () => {
    expect(decodeRemnashopEndpointResponse("/subscription/promocode/preview", "POST", {
      reward_type: "SUBSCRIPTION", reward: null, is_gift: true, gift: { ...convert, secret: 1 },
    })).toEqual({ reward_type: "SUBSCRIPTION", is_gift: true, gift: convert });
    expect(decodeRemnashopEndpointResponse("/subscription/promocode/preview", "POST", {
      reward_type: "DURATION", is_gift: false, gift: null,
    })).toEqual({ reward_type: "DURATION", is_gift: false, gift: null });
    expect(() => decodeRemnashopEndpointResponse("/subscription/promocode/preview", "POST", {
      reward_type: "SUBSCRIPTION", is_gift: true, gift: { ...convert, kind: "STEAL" },
    })).toThrow("unknown kind");
    expect(decodeRemnashopEndpointResponse("/subscription/change-quote?plan_code=pro&duration_days=30", "GET", {
      mode: "CREDIT", left_days: 5, credit_days: 7, expire_at: null,
    })).toEqual({ mode: "CREDIT", left_days: 5, credit_days: 7, expire_at: null });
    expect(() => decodeRemnashopEndpointResponse("/subscription/change-quote", "GET", {
      mode: "MAYBE", left_days: 0, credit_days: 0,
    })).toThrow("unknown mode");
  });
});

describe("change quote on the payment page", () => {
  it("is best effort and hidden for a first purchase", async () => {
    const credit = { mode: "CREDIT" as const, left_days: 5, credit_days: 7, expire_at: null };
    await expect(loadChangeQuote({ loadChangeQuote: vi.fn(async () => credit) }, "pro", "30"))
      .resolves.toEqual(credit);
    await expect(loadChangeQuote(
      { loadChangeQuote: vi.fn(async () => ({ ...credit, mode: "NEW" as const })) }, "pro", "30",
    )).resolves.toBeNull();
    await expect(loadChangeQuote({ loadChangeQuote: vi.fn(async () => { throw new Error("404"); }) }, "pro", "30"))
      .resolves.toBeNull();
    const reader = { loadChangeQuote: vi.fn() };
    await expect(loadChangeQuote(reader, null, "30")).resolves.toBeNull();
    await expect(loadChangeQuote(reader, "pro", "-1")).resolves.toBeNull();
    await expect(loadChangeQuote(reader, "pro", "x")).resolves.toBeNull();
    expect(reader.loadChangeQuote).not.toHaveBeenCalled();
  });
});

describe("cabinet promocode preview", () => {
  it("asks to confirm a gift and activates anything else directly", async () => {
    await expect(previewCabinetPromocode(commands({ reward_type: "SUBSCRIPTION", is_gift: true, gift: convert }), " GIFT-A "))
      .resolves.toEqual({ status: "gift", code: "GIFT-A", outcome: convert });
    await expect(previewCabinetPromocode(commands({ reward_type: "DURATION", is_gift: false, gift: null }), "SPRING"))
      .resolves.toEqual({ status: "activate", code: "SPRING" });
    // Older Remnashop or an invalid code: activation reports the real reason.
    await expect(previewCabinetPromocode(commands(null), "SPRING"))
      .resolves.toEqual({ status: "activate", code: "SPRING" });
    await expect(previewCabinetPromocode(commands(null), "\u0000"))
      .resolves.toMatchObject({ status: "error" });
  });
});
