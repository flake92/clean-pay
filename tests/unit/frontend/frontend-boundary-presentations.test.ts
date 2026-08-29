import { describe, expect, it } from "vitest";

import { selectCabinetPaymentHistoryPresentation } from "@/frontend/components/cabinet-payment-history-presentation";
import type { PaymentRecord } from "@/frontend/components/cabinet-presentation";
import {
  formatTariffDeviceLimit,
  formatTariffDuration,
  formatTariffTraffic,
  selectTariffGatewayOption,
  selectTariffPlanPresentation,
} from "@/frontend/components/tariffs-panel-presentation";
import type {
  DurationGatewayPrice,
  PlanOffer,
} from "@/shared/domain/subscriptions";

function price(
  gateway: string,
  amount: string,
  overrides: Partial<DurationGatewayPrice> = {},
): DurationGatewayPrice {
  return {
    gateway_type: gateway,
    currency: "RUB",
    currency_symbol: "₽",
    original_amount: amount,
    discount_percent: 0,
    final_amount: amount,
    is_free: false,
    ...overrides,
  };
}

function tariffPlan(): PlanOffer {
  return {
    id: 1,
    public_code: "pro plus",
    name: "Pro",
    description: null,
    traffic_limit: 0,
    device_limit: 5,
    type: "regular",
    recommended_purchase_type: "purchase",
    durations: [
      {
        days: 30,
        prices: [
          price("YOOKASSA", "120", {
            original_amount: "150",
            discount_percent: 20,
          }),
          price("SBP", "100"),
        ],
      },
      {
        days: 90,
        prices: [price("YOOKASSA", "250"), price("SBP", "240")],
      },
    ],
  };
}

function payment(index: number): PaymentRecord {
  return {
    payment_id: `payment-${index}`,
    purchase_type: "NEW",
    status: "completed",
    final_amount: String(index * 100),
    currency: index % 2 === 0 ? "$" : "₽",
    gateway_type: "YOOKASSA",
    plan_name: null,
    duration_days: 30,
    is_free: false,
    created_at: `2026-08-${String(index).padStart(2, "0")}T10:00:00.000Z`,
  };
}

describe("frontend boundary presentations", () => {
  it("keeps tariff formatting and gateway selection pure", () => {
    expect(formatTariffDuration(0)).toBe("∞");
    expect(formatTariffDuration(30)).toBe("1 мес.");
    expect(formatTariffDuration(31)).toBe("31 дн.");
    expect(formatTariffTraffic(0)).toBe("Без лимита");
    expect(formatTariffTraffic(12)).toBe("12 ГБ");
    expect(formatTariffDeviceLimit(0)).toBe("∞");
    expect(formatTariffDeviceLimit(3)).toBe("3");

    const presentation = selectTariffPlanPresentation(tariffPlan());
    expect(presentation.selected).toBe("30:SBP");
    expect(presentation.currentPrice?.final_amount).toBe("100");
    expect(presentation.paymentHref).toBe(
      "/payment?plan=pro%20plus&duration=30&gateway=SBP",
    );
    expect(selectTariffGatewayOption(
      presentation.priceOptions,
      presentation.selectedOption?.days,
      "YOOKASSA",
    )?.value).toBe("30:YOOKASSA");
    expect(selectTariffGatewayOption(
      presentation.priceOptions,
      365,
      "YOOKASSA",
    )?.value).toBe("30:YOOKASSA");
    expect(selectTariffGatewayOption(
      presentation.priceOptions,
      30,
      "UNKNOWN",
    )).toBeUndefined();
  });

  it("preserves selected discounts and an unavailable-price fallback", () => {
    const discounted = selectTariffPlanPresentation(
      tariffPlan(),
      "30:YOOKASSA",
    );
    expect(discounted.discount).toEqual({
      originalAmount: "150",
      percent: "20",
    });

    const unavailable = selectTariffPlanPresentation({
      ...tariffPlan(),
      durations: [],
    });
    expect(unavailable.currentPrice).toBeNull();
    expect(unavailable.paymentHref).toBe("#");
  });

  it("selects the bounded cabinet preview without normalizing currencies", () => {
    const payments = Array.from({ length: 8 }, (_, index) => payment(index + 1));
    const collapsed = selectCabinetPaymentHistoryPresentation({
      isExpanded: false,
      payments,
      status: "refreshing",
    });
    expect(collapsed.mobilePayments).toEqual(payments.slice(0, 5));
    expect(collapsed.hiddenPaymentCount).toBe(3);
    expect(collapsed.mobilePayments.map((record) => record.currency))
      .toEqual(["₽", "$", "₽", "$", "₽"]);
    expect(collapsed.notice).toEqual({
      severity: "info",
      text: "История платежей обновляется. Пока показаны сохранённые данные.",
    });

    const expanded = selectCabinetPaymentHistoryPresentation({
      isExpanded: true,
      payments,
      status: "unavailable",
    });
    expect(expanded.mobilePayments).toBe(payments);
    expect(expanded.notice?.severity).toBe("warn");
    expect(selectCabinetPaymentHistoryPresentation({
      isExpanded: false,
      payments: [],
      status: "current",
    }).notice).toBeNull();
  });
});
