/** @vitest-environment jsdom */

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginPasskeyRegistrationAction: vi.fn(),
  browserSupportsWebAuthn: vi.fn(),
  cancelLinkedTelegramAction: vi.fn(),
  confirmEmailVerificationCodeAction: vi.fn(),
  confirmLinkedTelegramAction: vi.fn(),
  executePaymentAction: vi.fn(),
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
  startRegistration: vi.fn(),
  verifyPasskeyRegistrationAction: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: mocks.browserSupportsWebAuthn,
  startAuthentication: vi.fn(),
  startRegistration: mocks.startRegistration,
}));
vi.mock("@/app/actions/payments", () => ({
  executePaymentAction: mocks.executePaymentAction,
}));
vi.mock("@/app/actions/passkeys", () => ({
  beginPasskeyLoginAction: vi.fn(),
  beginPasskeyRegistrationAction: mocks.beginPasskeyRegistrationAction,
  verifyPasskeyLoginAction: vi.fn(),
  verifyPasskeyRegistrationAction: mocks.verifyPasskeyRegistrationAction,
}));
vi.mock("@/app/actions/email-verification", () => ({
  confirmEmailVerificationCodeAction: mocks.confirmEmailVerificationCodeAction,
  requestEmailVerificationCodeAction: vi.fn(),
}));
vi.mock("@/app/actions/link-account", () => ({
  cancelLinkedTelegramAction: mocks.cancelLinkedTelegramAction,
  confirmLinkedTelegramAction: mocks.confirmLinkedTelegramAction,
  linkAccountEmailAction: vi.fn(),
  removeLinkedPasskeyAction: vi.fn(),
}));
vi.mock("@/app/actions/session", () => ({
  clearSessionAction: vi.fn(),
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));
vi.mock("@/frontend/lib/payment-idempotency", () => ({
  clearPaymentIdempotencyKey: vi.fn(),
  getOrCreatePaymentIdempotencyKey: vi.fn(() => "payment-key"),
}));

vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = String(buttonProps.label ?? "");
    for (const name of ["icon", "label", "loading", "outlined", "severity", "size", "text"]) {
      delete buttonProps[name];
    }
    return createElement("button", buttonProps, label);
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/password", () => ({
  Password: (props: Record<string, unknown>) => {
    const inputProps = { ...props };
    for (const name of ["feedback", "inputClassName", "toggleMask"]) delete inputProps[name];
    return createElement("input", { ...inputProps, type: "password" });
  },
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("primereact/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => createElement("section", null, children),
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value?: string }) => createElement("span", null, value),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) =>
    createElement("a", { href }, label),
}));
vi.mock("@/frontend/components/install-app-button", () => ({
  InstallAppButton: () => createElement("button", { type: "button" }, "install"),
}));
vi.mock("@/frontend/components/account-action-required", () => ({
  AccountActionRequired: ({ message }: { message: string }) =>
    createElement("div", null, message),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: (value?: string | null) => Boolean(value),
  TurnstileWidget: () => createElement("div", { "data-testid": "turnstile" }),
}));

import { LinkAccountPanel } from "@/frontend/components/link-account-panel";
import { PasskeySetupPanel } from "@/frontend/components/passkey-actions";
import { PaymentConfirmation } from "@/frontend/components/payment-confirmation";
import { RegisterEmailConfirmForm } from "@/frontend/components/register-email-confirm-form";

const checkoutModel = {
  status: "ready" as const,
  offers: {
    gateways: [{ gateway_type: "CARD", currency: "RUB", currency_symbol: "₽" }],
    plans: [{
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
    }],
    has_current_subscription: false,
    current_subscription_status: null,
  },
};

describe("critical user-flow components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.browserSupportsWebAuthn.mockReturnValue(true);
  });

  afterEach(() => cleanup());

  it("submits the selected payment once and opens operation status", async () => {
    mocks.executePaymentAction.mockResolvedValue({
      ok: true,
      status: "pending",
      operationId: "operation-1",
      retryAfterSeconds: 3,
    });
    const user = userEvent.setup();
    render(createElement(PaymentConfirmation, {
      durationDays: "30",
      gatewayType: "CARD",
      model: checkoutModel,
      planCode: "pro",
    }));

    await user.click(screen.getByRole("button", { name: /Перейти к оплате/i }));

    await waitFor(() => expect(mocks.executePaymentAction).toHaveBeenCalledTimes(1));
    expect(mocks.executePaymentAction).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "payment-key",
      kind: "purchase",
      request: expect.objectContaining({
        duration_days: 30,
        gateway_type: "CARD",
        plan_code: "pro",
      }),
    }));
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/payment/pending?operation_id=operation-1",
    );
  });

  it("confirms registration e-mail and keeps the original destination", async () => {
    mocks.confirmEmailVerificationCodeAction.mockResolvedValue({
      ok: true,
      kind: "verified",
    });
    const user = userEvent.setup();
    render(createElement(RegisterEmailConfirmForm, {
      redirectTo: "/payment?plan=pro",
    }));

    await user.type(screen.getByPlaceholderText("000000"), "123456");
    fireEvent.submit(screen.getByPlaceholderText("000000").closest("form")!);

    await waitFor(() => {
      expect(mocks.confirmEmailVerificationCodeAction).toHaveBeenCalledWith({
        code: "123456",
      });
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro",
    );
  });

  it("requires explicit confirmation before merging Telegram accounts", async () => {
    mocks.confirmLinkedTelegramAction.mockResolvedValue({
      ok: true,
      kind: "merge-confirmed",
    });
    const user = userEvent.setup();
    render(createElement(LinkAccountPanel, {
      model: {
        status: "ready",
        profile: {
          email: "target@example.com",
          emailVerified: true,
          telegramId: null,
        },
        passkeys: [],
        callbackError: null,
        mergeConfirmation: {
          targetEmail: "target@example.com",
          sourceEmailMasked: "s***@example.com",
          emailWillBeReplaced: true,
          telegramId: "777",
        },
      },
    }));

    expect(mocks.confirmLinkedTelegramAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Объединить аккаунты/i }));

    await waitFor(() => expect(mocks.confirmLinkedTelegramAction).toHaveBeenCalledOnce());
    expect(mocks.navigateTo).toHaveBeenCalledWith("/cabinet");
  });

  it("creates a named Passkey and proceeds only after server verification", async () => {
    mocks.beginPasskeyRegistrationAction.mockResolvedValue({
      ok: true,
      options: { challenge: "challenge" },
    });
    mocks.startRegistration.mockResolvedValue({ id: "credential-1" });
    mocks.verifyPasskeyRegistrationAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(createElement(PasskeySetupPanel, { redirectTo: "/cabinet" }));

    await user.type(screen.getByPlaceholderText(/Android Chrome/i), "Рабочий ноутбук");
    await user.click(screen.getByRole("button", { name: /Настроить быстрый вход/i }));

    await waitFor(() => {
      expect(mocks.verifyPasskeyRegistrationAction).toHaveBeenCalledWith({
        id: "credential-1",
        name: "Рабочий ноутбук",
      });
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith("/cabinet");
  });
});
