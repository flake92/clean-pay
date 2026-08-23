/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = buttonProps.label;

    for (const name of ["icon", "label", "outlined", "severity", "size"]) {
      delete buttonProps[name];
    }

    return createElement("button", buttonProps, String(label ?? ""));
  },
}));
vi.mock("primereact/column", () => ({ Column: () => null }));
vi.mock("primereact/datatable", () => ({
  DataTable: ({ value }: { value?: unknown[] }) =>
    createElement("div", { "data-desktop-payment-count": value?.length ?? 0 }),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value?: ReactNode }) => createElement("span", null, value),
}));

import {
  CabinetPaymentHistorySection,
  MOBILE_PAYMENT_PREVIEW_COUNT,
} from "@/frontend/components/cabinet-responsive-sections";
import type { PaymentRecord } from "@/frontend/components/cabinet-presentation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function payment(index: number): PaymentRecord {
  return {
    payment_id: `payment-${index}`,
    purchase_type: "NEW",
    status: "completed",
    final_amount: String(index * 100),
    currency: "₽",
    gateway_type: "YOOKASSA",
    plan_name: `Тариф ${index}`,
    duration_days: 30,
    is_free: false,
    created_at: `2026-08-${String(index).padStart(2, "0")}T10:00:00.000Z`,
  };
}

describe("mobile cabinet payment history", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a bounded recent preview and expands without losing older payments", async () => {
    const payments = Array.from({ length: 8 }, (_, index) => payment(index + 1));
    await act(async () => root.render(createElement(CabinetPaymentHistorySection, {
      payments,
      status: "current",
    })));

    const mobileList = container.querySelector("#cabinet-payment-history-mobile")!;
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="cabinet-payment-history-mobile"]',
    )!;

    expect(mobileList.querySelectorAll("article")).toHaveLength(MOBILE_PAYMENT_PREVIEW_COUNT);
    expect(toggle.textContent).toBe("Показать ещё (3)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-desktop-payment-count]")?.getAttribute("data-desktop-payment-count")).toBe("8");

    await act(async () => toggle.click());

    expect(mobileList.querySelectorAll("article")).toHaveLength(8);
    expect(toggle.textContent).toBe("Свернуть историю");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await act(async () => toggle.click());

    expect(mobileList.querySelectorAll("article")).toHaveLength(MOBILE_PAYMENT_PREVIEW_COUNT);
  });

  it("does not render a disclosure control when all payments fit in the preview", async () => {
    await act(async () => root.render(createElement(CabinetPaymentHistorySection, {
      payments: [payment(1), payment(2)],
      status: "current",
    })));

    expect(container.querySelectorAll("#cabinet-payment-history-mobile article")).toHaveLength(2);
    expect(container.querySelector('[aria-controls="cabinet-payment-history-mobile"]')).toBeNull();
  });

  it("distinguishes an in-progress refresh from an upstream failure", async () => {
    await act(async () => root.render(createElement(CabinetPaymentHistorySection, {
      payments: [payment(1)],
      status: "refreshing",
    })));

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("История платежей обновляется. Пока показаны сохранённые данные.");

    await act(async () => root.render(createElement(CabinetPaymentHistorySection, {
      payments: [payment(1)],
      status: "unavailable",
    })));

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Не удалось обновить статусы платежей. Показаны сохранённые данные.");
  });
});
