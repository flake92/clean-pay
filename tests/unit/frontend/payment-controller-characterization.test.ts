/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executePaymentAction: vi.fn(),
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
}));

vi.mock("@/app/actions/payments", () => ({
  executePaymentAction: mocks.executePaymentAction,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));
vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = String(buttonProps.label ?? "");
    for (const name of ["icon", "label", "loading", "outlined"]) {
      delete buttonProps[name];
    }
    return createElement("button", buttonProps, label);
  },
}));
vi.mock("primereact/card", () => ({
  Card: ({ children }: { children?: ReactNode }) =>
    createElement("section", null, children),
}));
vi.mock("primereact/dropdown", () => ({
  Dropdown: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) =>
    createElement("div", { "aria-label": ariaLabel }),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) =>
    createElement("div", { role: "alert" }, text),
}));
vi.mock("@/frontend/components/account-action-required", () => ({
  AccountActionRequired: ({ message }: { message?: string }) =>
    createElement("div", null, message),
}));
vi.mock("@/frontend/components/install-app-button", () => ({
  InstallAppButton: () => createElement("button", { type: "button" }, "install"),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) =>
    createElement("a", { href }, label),
}));

import { ExtendConfirmation } from "@/frontend/components/extend-confirmation";
import { PaymentConfirmation } from "@/frontend/components/payment-confirmation";
import type { CheckoutViewModel } from "@/application/models/checkout";

type PaymentScenario = "extend" | "purchase";

const purchasePlan = {
  id: 1,
  public_code: "pro",
  name: "Pro",
  description: null,
  traffic_limit: 100,
  device_limit: 5,
  type: "MONTHLY",
  recommended_purchase_type: "NEW",
  durations: [{
    days: 30,
    prices: [{
      gateway_type: "CARD",
      currency: "RUB",
      currency_symbol: "₽",
      original_amount: "500.00",
      discount_percent: 0,
      final_amount: "500.00",
      is_free: false,
    }],
  }],
};

const purchaseModel: CheckoutViewModel = {
  status: "ready",
  offers: {
    gateways: [{
      gateway_type: "CARD",
      currency: "RUB",
      currency_symbol: "₽",
    }],
    plans: [purchasePlan],
    has_current_subscription: false,
    current_subscription_status: null,
  },
};

const extendModel: CheckoutViewModel = {
  status: "ready",
  offers: {
    ...purchaseModel.offers,
    plans: [{
      ...purchasePlan,
      recommended_purchase_type: "RENEW",
    }],
    has_current_subscription: true,
    current_subscription_status: "active",
  },
};

function renderScenario(scenario: PaymentScenario) {
  if (scenario === "purchase") {
    render(createElement(PaymentConfirmation, {
      durationDays: "30",
      gatewayType: "CARD",
      model: purchaseModel,
      planCode: "pro",
    }));
    return screen.getByRole("button", { name: "Перейти к оплате" });
  }

  render(createElement(ExtendConfirmation, {
    model: extendModel,
    requestedDuration: "30",
    requestedGateway: "CARD",
  }));
  return screen.getByRole("button", { name: "Продлить" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function commandAt(index: number) {
  return mocks.executePaymentAction.mock.calls[index]?.[0] as
    | { idempotencyKey: string; kind: PaymentScenario }
    | undefined;
}

describe.each<PaymentScenario>(["purchase", "extend"])(
  "%s confirmation controller",
  (scenario) => {
    const expectedManualMessage = scenario === "purchase"
      ? "Статус оплаты требует ручной проверки. Сообщите поддержке номер операции manual-1."
      : "Статус продления требует ручной проверки. Сообщите поддержке номер операции manual-1.";

    beforeEach(() => {
      vi.clearAllMocks();
      window.sessionStorage.clear();
    });

    afterEach(() => cleanup());

    it("fences same-tick double click to one Server Action", async () => {
      const pending = deferred<unknown>();
      mocks.executePaymentAction.mockReturnValue(pending.promise);
      const button = renderScenario(scenario) as HTMLButtonElement;

      act(() => {
        button.click();
        button.click();
      });

      expect(mocks.executePaymentAction).toHaveBeenCalledTimes(1);
      expect(commandAt(0)?.kind).toBe(scenario);

      pending.resolve({
        ok: true,
        status: "pending",
        operationId: "operation-1",
        retryAfterSeconds: 3,
      });
      await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
    });

    it("reuses the idempotency key after an ambiguous failure", async () => {
      mocks.executePaymentAction
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockResolvedValueOnce({
          ok: true,
          status: "pending",
          operationId: "operation-2",
          retryAfterSeconds: 3,
        });
      const button = renderScenario(scenario);

      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      fireEvent.click(button);
      await waitFor(() =>
        expect(mocks.executePaymentAction).toHaveBeenCalledTimes(2)
      );

      expect(commandAt(0)?.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
      );
      expect(commandAt(1)?.idempotencyKey).toBe(commandAt(0)?.idempotencyKey);
    });

    it("clears a completed request before navigating", async () => {
      const storageAtNavigation: number[] = [];
      mocks.navigateTo.mockImplementation(() => {
        storageAtNavigation.push(window.sessionStorage.length);
      });
      mocks.executePaymentAction.mockResolvedValue({
        ok: true,
        status: "completed",
        operationId: "operation-3",
        payment: {
          is_free: false,
          payment_id: "payment-3",
          payment_url: "https://pay.example/operation-3",
        },
      });
      const button = renderScenario(scenario) as HTMLButtonElement;

      fireEvent.click(button);

      await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
      expect(storageAtNavigation).toEqual([0]);
      expect(window.sessionStorage.length).toBe(0);
      expect(button.disabled).toBe(true);
    });

    it("keeps a pending request stored and leaves submission disabled", async () => {
      mocks.executePaymentAction.mockResolvedValue({
        ok: true,
        status: "pending",
        operationId: "operation-4",
        retryAfterSeconds: 3,
      });
      const button = renderScenario(scenario) as HTMLButtonElement;

      fireEvent.click(button);

      await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
      expect(window.sessionStorage.length).toBe(1);
      expect(button.disabled).toBe(true);
    });

    it("keeps manual-review identity and restores the submit control", async () => {
      mocks.executePaymentAction.mockResolvedValue({
        ok: true,
        status: "manual-review",
        operationId: "manual-1",
      });
      const button = renderScenario(scenario) as HTMLButtonElement;

      fireEvent.click(button);

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(expectedManualMessage)
      );
      expect(window.sessionStorage.length).toBe(1);
      expect(button.disabled).toBe(false);
      expect(mocks.navigateTo).not.toHaveBeenCalled();
    });
  },
);
