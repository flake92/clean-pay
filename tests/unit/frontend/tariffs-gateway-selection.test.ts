/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("primereact/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => createElement("section", null, children),
}));
vi.mock("primereact/dropdown", () => ({
  Dropdown: ({ options }: { options?: unknown[] }) =>
    createElement("div", { "data-dropdown-options": options?.length ?? 0 }),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value?: string }) => createElement("span", null, value),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href?: string; label: string }) =>
    createElement("a", { href }, label),
}));

import { TariffsPanel } from "@/frontend/components/tariffs-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const gatewayPrice = (gateway: string, amount: string) => ({
  gateway_type: gateway,
  currency: "RUB",
  final_amount: amount,
  currency_symbol: "₽",
  original_amount: amount,
  discount_percent: 0,
  is_free: false,
});

function offers(gateways: string[], description: string | null = null) {
  return {
    gateways: gateways.map((gateway) => ({
      gateway_type: gateway,
      currency: "RUB",
      currency_symbol: "₽",
    })),
    has_current_subscription: false,
    current_subscription_status: null,
    plans: [
      {
        id: 1,
        public_code: "pro",
        name: "Pro",
        description,
        type: "regular",
        device_limit: 5,
        traffic_limit: 0,
        recommended_purchase_type: "purchase",
        durations: [
          {
            days: 30,
            prices: gateways.map((gateway, index) =>
              gatewayPrice(gateway, String(100 + index * 10)),
            ),
          },
          {
            days: 90,
            prices: gateways.map((gateway, index) =>
              gatewayPrice(gateway, String(250 + index * 10)),
            ),
          },
        ],
      },
    ],
  };
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe("tariff payment gateway selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("keeps a single gateway compact", async () => {
    await act(async () => root.render(createElement(TariffsPanel, {
      model: { status: "ready", offers: offers(["YOOKASSA"]) },
    })));

    expect(container.querySelector('[aria-label="Выбор платёжного шлюза"]')).toBeNull();
    expect(container.querySelector('[data-dropdown-options="2"]')).not.toBeNull();
    expect(container.querySelectorAll(".clean-pay-price-choice")).toHaveLength(2);
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-pressed="false"]')).toHaveLength(1);
  });

  it("allows long tariff descriptions to wrap on narrow screens", async () => {
    const description = "https://teletype.in/very-long-unbroken-tariff-instructions-link";
    await act(async () => root.render(createElement(TariffsPanel, {
      model: { status: "ready", offers: offers(["YOOKASSA"], description) },
    })));

    const descriptionNode = Array.from(container.querySelectorAll("p")).find(
      (node) => node.textContent === description,
    );
    expect(descriptionNode?.classList.contains("break-words")).toBe(true);
    expect(descriptionNode?.parentElement?.classList.contains("min-w-0")).toBe(true);
    expect(descriptionNode?.parentElement?.classList.contains("flex-1")).toBe(true);
  });

  it("separates gateways and moves forward and backward without mixing durations", async () => {
    await act(async () => root.render(createElement(TariffsPanel, {
      model: { status: "ready", offers: offers(["YOOKASSA", "SBP"]) },
    })));

    const gatewayGroup = container.querySelector('[aria-label="Выбор платёжного шлюза"]');
    expect(gatewayGroup?.textContent).toContain("ЮKassa");
    expect(gatewayGroup?.textContent).toContain("1 из 2");
    expect(container.querySelector('[data-dropdown-options="2"]')).not.toBeNull();
    expect(container.querySelectorAll(".clean-pay-price-choice")).toHaveLength(2);
    expect(container.querySelector<HTMLAnchorElement>('a[href*="gateway=YOOKASSA"]')).not.toBeNull();

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Следующий платёжный шлюз"]')!);

    expect(gatewayGroup?.textContent).toContain("SBP");
    expect(gatewayGroup?.textContent).toContain("2 из 2");
    expect(container.querySelector<HTMLAnchorElement>('a[href*="gateway=SBP"]')).not.toBeNull();
    expect(container.querySelectorAll(".clean-pay-price-choice")).toHaveLength(2);

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Предыдущий платёжный шлюз"]')!);

    expect(gatewayGroup?.textContent).toContain("ЮKassa");
    expect(container.querySelector<HTMLAnchorElement>('a[href*="gateway=YOOKASSA"]')).not.toBeNull();
  });

  it("shows the original amount and discount for the selected offer", async () => {
    const discountedOffers = offers(["YOOKASSA"]);
    const price = discountedOffers.plans[0]?.durations[0]?.prices[0];
    if (!price) throw new Error("Expected test price");
    price.original_amount = "150";
    price.final_amount = "100";
    price.discount_percent = 33;

    await act(async () => root.render(createElement(TariffsPanel, {
      model: { status: "ready", offers: discountedOffers },
    })));

    expect(container.textContent).toContain("150 ₽");
    expect(container.textContent).toContain("Скидка 33%");
    expect(container.textContent).toContain("ЮKassa");
  });
});
