/** @vitest-environment jsdom */

import { createElement } from "react";
import type { ReactNode } from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executePaymentAction: vi.fn(),
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
}));

vi.mock("@/app/actions/payments", () => ({ executePaymentAction: mocks.executePaymentAction }));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));
vi.mock("primereact/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => createElement("section", null, children),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) =>
    createElement("a", { href }, label),
}));

import { ExtendConfirmation } from "@/frontend/components/extend-confirmation";

const price = {
  gateway_type: "CARD",
  currency: "RUB",
  currency_symbol: "₽",
  original_amount: "500.00",
  discount_percent: 0,
  final_amount: "500.00",
  is_free: false,
};

const readyModel = {
  status: "ready" as const,
  offers: {
    has_current_subscription: true,
    current_subscription_status: "ACTIVE",
    gateways: [{ gateway_type: "CARD", currency: "RUB", currency_symbol: "₽" }],
    plans: [{
      id: 1,
      public_code: "pro",
      name: "Pro",
      description: null,
      traffic_limit: 100,
      device_limit: 5,
      type: "MONTHLY",
      recommended_purchase_type: "renew",
      renewal_terms_changed: false,
      durations: [{ days: 30, prices: [price] }],
    }],
  },
};

// The extension flow had one server-rendering smoke test and no coverage of
// the path a subscriber actually takes, which left the priced offer, the
// dispatch and every outcome branch unexercised at 25%.
describe("ExtendConfirmation", () => {
  beforeEach(() => {
    mocks.executePaymentAction.mockReset();
    mocks.navigateTo.mockReset();
    mocks.replaceWith.mockReset();
  });
  afterEach(cleanup);

  it("shows the renewal plan, its status and the price before extending", () => {
    render(createElement(ExtendConfirmation, { model: readyModel } as never));

    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText(/Текущий статус: ACTIVE/)).toBeTruthy();
    expect(screen.getAllByText(/500\.00/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Продлить/ })).toBeTruthy();
  });

  it("warns when the plan terms changed since the last purchase", () => {
    render(createElement(ExtendConfirmation, {
      model: {
        ...readyModel,
        offers: {
          ...readyModel.offers,
          plans: [{ ...readyModel.offers.plans[0], renewal_terms_changed: true }],
        },
      },
    } as never));

    expect(screen.getByRole("alert").textContent).toContain("Условия тарифа изменились");
  });

  it("sends the confirmed offer and follows the provider payment url", async () => {
    mocks.executePaymentAction.mockResolvedValue({
      ok: true,
      status: "completed",
      payment: { payment_id: "pay-1", payment_url: "https://pay.example.com/1" },
    });
    const user = userEvent.setup();
    render(createElement(ExtendConfirmation, { model: readyModel } as never));

    await user.click(screen.getByRole("button", { name: /Продлить/ }));

    await waitFor(() => expect(mocks.executePaymentAction).toHaveBeenCalled());
    const [call] = mocks.executePaymentAction.mock.calls;
    expect(call?.[0]).toMatchObject({
      kind: "extend",
      request: expect.objectContaining({
        duration_days: 30,
        gateway_type: "CARD",
        confirmed_amount: "500.00",
        confirmed_currency: "RUB",
      }),
    });
    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledWith("https://pay.example.com/1"));
  });

  it("keeps the reader on the page and explains a refused extension", async () => {
    mocks.executePaymentAction.mockResolvedValue({
      ok: false,
      code: "OFFER_CHANGED",
      message: "Цена изменилась.",
      retainIdempotencyKey: false,
    });
    const user = userEvent.setup();
    render(createElement(ExtendConfirmation, { model: readyModel } as never));

    await user.click(screen.getByRole("button", { name: /Продлить/ }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert").map((node) => node.textContent ?? "");
      expect(alerts.some((text) => text.includes("Цена изменилась."))).toBe(true);
    });
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });
});
