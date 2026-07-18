/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("plan=pro&duration=30&gateway=card"),
}));
vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = buttonProps.label;
    delete buttonProps.label;
    delete buttonProps.loading;
    return createElement("button", buttonProps, String(label ?? ""));
  },
}));
vi.mock("primereact/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => createElement("section", null, children),
}));
vi.mock("primereact/dropdown", () => ({
  Dropdown: () => createElement("div"),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("@/frontend/components/account-action-required", () => ({
  AccountActionRequired: ({ message }: { message: string }) => createElement("div", null, message),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ label }: { label: string }) => createElement("a", null, label),
}));

import { ExtendConfirmation } from "@/frontend/components/extend-confirmation";
import { PaymentConfirmation } from "@/frontend/components/payment-confirmation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const offers = {
  has_current_subscription: true,
  current_subscription_status: "ACTIVE",
  plans: [
    {
      public_code: "pro",
      name: "Pro",
      type: "regular",
      device_limit: 5,
      traffic_limit: 100,
      recommended_purchase_type: "renew",
      durations: [
        {
          days: 30,
          prices: [
            {
              gateway_type: "card",
              final_amount: "100",
              currency_symbol: "₽",
            },
          ],
        },
      ],
    },
  ],
};

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function idempotencyKey(call: [RequestInfo | URL, RequestInit?]) {
  const headers = call[1]?.headers as Record<string, string>;
  return headers["Idempotency-Key"];
}

describe("payment action loading recovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops purchase loading and reuses the same key after a lost response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new TypeError("response lost again"));
    await act(async () => root.render(createElement(PaymentConfirmation)));
    await settle();

    const paymentButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Перейти к оплате",
    )!;
    await click(paymentButton);
    expect(paymentButton.disabled).toBe(false);
    expect(container.textContent).toContain("новая оплата не будет создана");

    await click(paymentButton);
    expect(idempotencyKey(vi.mocked(fetch).mock.calls[1])).toBe(
      idempotencyKey(vi.mocked(fetch).mock.calls[2]),
    );
  });

  it("stops extend loading and reuses the same key after a lost response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new TypeError("response lost again"));
    await act(async () => root.render(createElement(ExtendConfirmation)));
    await settle();

    const extendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Продлить",
    )!;
    expect(extendButton).toBeDefined();
    await click(extendButton);
    expect(extendButton.disabled).toBe(false);
    expect(container.textContent).toContain("новая оплата не будет создана");

    await click(extendButton);
    expect(idempotencyKey(vi.mocked(fetch).mock.calls[1])).toBe(
      idempotencyKey(vi.mocked(fetch).mock.calls[2]),
    );
  });

  it.each([
    ["purchase", PaymentConfirmation, "Перейти к оплате"],
    ["extend", ExtendConfirmation, "Продлить"],
  ] as const)(
    "handles a non-JSON successful %s response as unknown and stops loading",
    async (_operation, Component, buttonLabel) => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(Response.json({ data: offers }))
        .mockResolvedValueOnce(
          new Response("upstream proxy returned HTML", {
            headers: { "content-type": "text/html" },
            status: 200,
          }),
        );
      await act(async () => root.render(createElement(Component)));
      await settle();

      const actionButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === buttonLabel,
      )!;
      await click(actionButton);

      expect(actionButton.disabled).toBe(false);
      expect(container.textContent).toContain("Не удалось подтвердить результат");
      expect(window.sessionStorage.length).toBe(1);
    },
  );
});
