/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({
  search: "plan=pro&duration=30&gateway=card",
}));
const navigationMocks = vi.hoisted(() => ({
  replaceWith: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  replaceWith: navigationMocks.replaceWith,
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
  AccountActionRequired: ({
    action,
    message,
    redirectTo,
  }: {
    action: string;
    message: string;
    redirectTo?: string;
  }) =>
    createElement(
      "div",
      {
        "data-account-action": action,
        "data-redirect-to": redirectTo,
      },
      message,
    ),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href?: string; label: string }) =>
    createElement("a", { href }, label),
}));
vi.mock("@/frontend/components/install-app-button", () => ({
  InstallAppButton: () => createElement("button", null, "Установить приложение"),
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
      id: 1,
      public_code: "pro",
      name: "Pro",
      description: null,
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
              currency: "RUB",
              final_amount: "100",
              currency_symbol: "₽",
              original_amount: "100",
              discount_percent: 0,
              is_free: false,
            },
          ],
        },
      ],
    },
  ],
};

function verifiedProfileResponse() {
  return Response.json({
    data: {
      user: {
        email: "user@example.com",
        emailVerified: true,
      },
    },
  });
}

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
    vi.clearAllMocks();
    navigationState.search = "plan=pro&duration=30&gateway=card";
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
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json({ data: offers }))
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
    expect(idempotencyKey(vi.mocked(fetch).mock.calls[3])).toBe(
      idempotencyKey(vi.mocked(fetch).mock.calls[5]),
    );
  });

  it("warns before renewing a plan whose terms changed in Remnashop", async () => {
    const modifiedOffers = {
      ...structuredClone(offers),
      plans: offers.plans.map((plan) => ({
        ...structuredClone(plan),
        renewal_terms_changed: true,
      })),
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: modifiedOffers }));

    await act(async () => root.render(createElement(ExtendConfirmation)));
    await settle();

    expect(container.textContent).toContain("Условия тарифа изменились");
    expect(container.textContent).toContain("по актуальным лимитам и цене");
  });

  it("guides an unverified Telegram session before creating a payment operation", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        data: {
          user: {
            email: null,
            emailVerified: false,
            telegramId: "777",
          },
        },
      }));

    await act(async () => root.render(createElement(PaymentConfirmation)));
    await settle();

    const action = container.querySelector<HTMLElement>(
      '[data-account-action="linkEmail"]',
    );
    expect(action).not.toBeNull();
    expect(action?.dataset.redirectTo).toBe(
      "/payment?plan=pro&duration=30&gateway=card",
    );
    expect(container.textContent).toContain("e-mail и пароль");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Перейти к оплате",
      ),
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("offers optional installation and Passkey without blocking the returned payment", async () => {
    navigationState.search =
      "plan=pro&duration=30&gateway=card&account_setup=account-ready";
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: offers }));

    await act(async () => root.render(createElement(PaymentConfirmation)));
    await settle();

    expect(container.textContent).toContain("Вы вернулись к выбранной оплате");
    expect(container.textContent).toContain("Установить приложение");
    expect(
      Array.from(container.querySelectorAll("a")).find(
        (link) => link.textContent === "Настроить быстрый вход",
      )?.getAttribute("href"),
    ).toBe(
      "/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
    expect(container.textContent).toContain("Перейти к оплате");
  });

  it("returns a verification race to guided setup before retrying payment", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "EMAIL_NOT_VERIFIED",
              message: "Подтвердите e-mail.",
            },
          },
          { status: 403 },
        ),
      );

    await act(async () => root.render(createElement(PaymentConfirmation)));
    await settle();
    const paymentButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Перейти к оплате",
    )!;
    await click(paymentButton);

    expect(navigationMocks.replaceWith).toHaveBeenCalledWith(
      "/link-account?reason=email-required&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
    expect(window.sessionStorage.length).toBe(1);

    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Операция отклонена после возврата.",
            },
          },
          { status: 400 },
        ),
      );
    await click(paymentButton);
    expect(idempotencyKey(vi.mocked(fetch).mock.calls[3])).toBe(
      idempotencyKey(vi.mocked(fetch).mock.calls[5]),
    );
  });

  it.each([
    [
      "purchase",
      PaymentConfirmation,
      "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    ],
    [
      "extend",
      ExtendConfirmation,
      "/verify-email?flow=telegram-email&redirect_to=%2Fextend%3Fduration%3D30%26gateway%3Dcard",
    ],
  ] as const)(
    "keeps a synchronizing %s account away from payment operations",
    async (_operation, Component, expectedDestination) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "user@example.com",
              emailVerified: true,
              accountSyncPending: true,
            },
          },
        }),
      );

      await act(async () => root.render(createElement(Component)));
      await settle();

      expect(navigationMocks.replaceWith).toHaveBeenCalledWith(
        expectedDestination,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("stops extend loading and reuses the same key after a lost response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json({ data: offers }))
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
    expect(idempotencyKey(vi.mocked(fetch).mock.calls[3])).toBe(
      idempotencyKey(vi.mocked(fetch).mock.calls[5]),
    );
  });

  it("guides an unverified Telegram session before creating an extend operation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        data: {
          user: {
            email: null,
            emailVerified: false,
            telegramId: "777",
          },
        },
      }),
    );

    await act(async () => root.render(createElement(ExtendConfirmation)));
    await settle();

    const action = container.querySelector<HTMLElement>(
      '[data-account-action="linkEmail"]',
    );
    expect(action).not.toBeNull();
    expect(action?.dataset.redirectTo).toBe(
      "/extend?duration=30&gateway=card",
    );
    expect(container.textContent).toContain("e-mail и пароль");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Продлить",
      ),
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a verification race to guided setup before retrying extend", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "EMAIL_NOT_VERIFIED",
              message: "Подтвердите e-mail.",
            },
          },
          { status: 403 },
        ),
      );

    await act(async () => root.render(createElement(ExtendConfirmation)));
    await settle();
    const extendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Продлить",
    )!;
    await click(extendButton);

    expect(navigationMocks.replaceWith).toHaveBeenCalledWith(
      "/link-account?reason=email-required&redirect_to=%2Fextend%3Fduration%3D30%26gateway%3Dcard",
    );
    expect(window.sessionStorage.length).toBe(1);

    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Операция отклонена после возврата.",
            },
          },
          { status: 400 },
        ),
      );
    await click(extendButton);
    expect(idempotencyKey(vi.mocked(fetch).mock.calls[3])).toBe(
      idempotencyKey(vi.mocked(fetch).mock.calls[5]),
    );
  });

  it.each([
    [
      "purchase",
      PaymentConfirmation,
      "Перейти к оплате",
      "EMAIL_REQUIRED",
      "/link-account?reason=email-required&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    ],
    [
      "purchase",
      PaymentConfirmation,
      "Перейти к оплате",
      "EMAIL_NOT_VERIFIED",
      "/link-account?reason=email-required&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    ],
    [
      "extend",
      ExtendConfirmation,
      "Продлить",
      "EMAIL_REQUIRED",
      "/link-account?reason=email-required&redirect_to=%2Fextend%3Fduration%3D30%26gateway%3Dcard",
    ],
    [
      "extend",
      ExtendConfirmation,
      "Продлить",
      "EMAIL_NOT_VERIFIED",
      "/link-account?reason=email-required&redirect_to=%2Fextend%3Fduration%3D30%26gateway%3Dcard",
    ],
  ] as const)(
    "redirects a %s %s price-check race before creating an operation",
    async (
      _operation,
      Component,
      buttonLabel,
      errorCode,
      expectedDestination,
    ) => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(verifiedProfileResponse())
        .mockResolvedValueOnce(Response.json({ data: offers }))
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: errorCode,
                message: "Подтвердите e-mail.",
              },
            },
            { status: errorCode === "EMAIL_REQUIRED" ? 401 : 403 },
          ),
        );

      await act(async () => root.render(createElement(Component)));
      await settle();
      const actionButton = Array.from(
        container.querySelectorAll("button"),
      ).find((button) => button.textContent === buttonLabel)!;
      await click(actionButton);

      expect(navigationMocks.replaceWith).toHaveBeenCalledWith(
        expectedDestination,
      );
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(window.sessionStorage.length).toBe(0);
    },
  );

  it("restores a non-default extension choice and preserves it through setup", async () => {
    navigationState.search = "duration=90&gateway=sbp";
    const multipleOffers = structuredClone(offers);
    multipleOffers.plans[0]!.durations.push({
      days: 90,
      prices: [
        {
          gateway_type: "sbp",
          currency: "RUB",
          final_amount: "250",
          currency_symbol: "₽",
          original_amount: "250",
          discount_percent: 0,
          is_free: false,
        },
      ],
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: multipleOffers }))
      .mockResolvedValueOnce(Response.json({ data: multipleOffers }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "EMAIL_NOT_VERIFIED",
              message: "Подтвердите e-mail.",
            },
          },
          { status: 403 },
        ),
      );

    await act(async () => root.render(createElement(ExtendConfirmation)));
    await settle();

    expect(
      container.querySelector(".clean-pay-price-choice--selected")?.textContent,
    ).toContain("250 ₽");
    const extendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Продлить",
    )!;
    await click(extendButton);

    expect(navigationMocks.replaceWith).toHaveBeenCalledWith(
      "/link-account?reason=email-required&redirect_to=%2Fextend%3Fduration%3D90%26gateway%3Dsbp",
    );
  });

  it("preserves a lifetime extension choice through account setup", async () => {
    navigationState.search = "duration=0&gateway=card";
    const lifetimeOffers = structuredClone(offers);
    lifetimeOffers.plans[0]!.durations.push({
      days: 0,
      prices: [
        {
          gateway_type: "card",
          currency: "RUB",
          final_amount: "900",
          currency_symbol: "₽",
          original_amount: "900",
          discount_percent: 0,
          is_free: false,
        },
      ],
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: lifetimeOffers }))
      .mockResolvedValueOnce(Response.json({ data: lifetimeOffers }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "EMAIL_REQUIRED",
              message: "Добавьте e-mail и пароль.",
            },
          },
          { status: 401 },
        ),
      );

    await act(async () => root.render(createElement(ExtendConfirmation)));
    await settle();

    expect(
      container.querySelector(".clean-pay-price-choice--selected")?.textContent,
    ).toContain("∞");
    const extendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Продлить",
    )!;
    await click(extendButton);

    expect(navigationMocks.replaceWith).toHaveBeenCalledWith(
      "/link-account?reason=email-required&redirect_to=%2Fextend%3Fduration%3D0%26gateway%3Dcard",
    );
  });

  it("preserves gateway values with colons, Unicode and spaces through extension setup", async () => {
    navigationState.search = "duration=90&gateway=%20bank%3A%D0%B1%D1%8B%D1%81%D1%82%D1%80%D0%BE%20";
    const whitespaceGatewayOffers = structuredClone(offers);
    whitespaceGatewayOffers.plans[0]!.durations.push({
      days: 90,
      prices: [
        {
          gateway_type: " bank:быстро ",
          currency: "RUB",
          final_amount: "250",
          currency_symbol: "₽",
          original_amount: "250",
          discount_percent: 0,
          is_free: false,
        },
      ],
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: whitespaceGatewayOffers }))
      .mockResolvedValueOnce(Response.json({ data: whitespaceGatewayOffers }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "EMAIL_REQUIRED",
              message: "Добавьте e-mail и пароль.",
            },
          },
          { status: 401 },
        ),
      );

    await act(async () => root.render(createElement(ExtendConfirmation)));
    await settle();

    expect(
      container.querySelector(".clean-pay-price-choice--selected")?.textContent,
    ).toContain("250 ₽");
    const extendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Продлить",
    )!;
    await click(extendButton);

    expect(navigationMocks.replaceWith).toHaveBeenCalledWith(
      "/link-account?reason=email-required&redirect_to=%2Fextend%3Fduration%3D90%26gateway%3D%2Bbank%253A%25D0%25B1%25D1%258B%25D1%2581%25D1%2582%25D1%2580%25D0%25BE%2B",
    );
  });

  it.each([
    ["purchase", PaymentConfirmation, "Перейти к оплате"],
    ["extend", ExtendConfirmation, "Продлить"],
  ] as const)(
    "handles a non-JSON successful %s response as unknown and stops loading",
    async (_operation, Component, buttonLabel) => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(verifiedProfileResponse())
        .mockResolvedValueOnce(Response.json({ data: offers }))
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

  it.each([
    ["purchase", PaymentConfirmation, "Перейти к оплате"],
    ["extend", ExtendConfirmation, "Продлить"],
  ] as const)("shows the changed %s price before creating an invoice", async (
    operation,
    Component,
    buttonLabel,
  ) => {
    const changedOffers = structuredClone(offers);
    changedOffers.plans[0]!.durations[0]!.prices[0]!.final_amount = "150";
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(verifiedProfileResponse())
      .mockResolvedValueOnce(Response.json({ data: offers }))
      .mockResolvedValueOnce(Response.json({ data: changedOffers }));
    await act(async () => root.render(createElement(Component)));
    await settle();

    const actionButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === buttonLabel,
    )!;
    await click(actionButton);

    expect(actionButton.disabled).toBe(false);
    expect(container.textContent).toContain("было 100 ₽, стало 150 ₽");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([
    ["purchase", PaymentConfirmation, "Перейти к оплате"],
    ["extend", ExtendConfirmation, "Продлить"],
  ] as const)(
    "runs only one %s price preflight for same-tick clicks",
    async (_operation, Component, buttonLabel) => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(verifiedProfileResponse())
        .mockResolvedValueOnce(Response.json({ data: offers }));
      let resolvePreflight!: (response: Response) => void;
      fetchMock.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolvePreflight = resolve;
        }),
      );

      await act(async () => root.render(createElement(Component)));
      await settle();
      const actionButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === buttonLabel,
      )!;

      await act(async () => {
        actionButton.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        actionButton.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledTimes(3);

      const changedOffers = structuredClone(offers);
      changedOffers.plans[0]!.durations[0]!.prices[0]!.final_amount = "150";
      await act(async () => {
        resolvePreflight(Response.json({ data: changedOffers }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(actionButton.disabled).toBe(false);
    },
  );
});
