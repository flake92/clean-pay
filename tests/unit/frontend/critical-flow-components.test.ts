/** @vitest-environment jsdom */

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginPasskeyRegistrationAction: vi.fn(),
  beginPasskeyLoginAction: vi.fn(),
  browserSupportsWebAuthn: vi.fn(),
  cancelLinkedTelegramAction: vi.fn(),
  confirmEmailVerificationCodeAction: vi.fn(),
  confirmLinkedTelegramAction: vi.fn(),
  clearPaymentIdempotencyKey: vi.fn(),
  clearSessionAction: vi.fn(),
  executePaymentAction: vi.fn(),
  getOrCreatePaymentIdempotencyKey: vi.fn(() => "payment-key"),
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
  requestEmailVerificationCodeAction: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  verifyPasskeyLoginAction: vi.fn(),
  verifyPasskeyRegistrationAction: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: mocks.browserSupportsWebAuthn,
  startAuthentication: mocks.startAuthentication,
  startRegistration: mocks.startRegistration,
}));
vi.mock("@/app/actions/payments", () => ({
  executePaymentAction: mocks.executePaymentAction,
}));
vi.mock("@/app/actions/passkeys", () => ({
  beginPasskeyLoginAction: mocks.beginPasskeyLoginAction,
  beginPasskeyRegistrationAction: mocks.beginPasskeyRegistrationAction,
  verifyPasskeyLoginAction: mocks.verifyPasskeyLoginAction,
  verifyPasskeyRegistrationAction: mocks.verifyPasskeyRegistrationAction,
}));
vi.mock("@/app/actions/email-verification", () => ({
  confirmEmailVerificationCodeAction: mocks.confirmEmailVerificationCodeAction,
  requestEmailVerificationCodeAction: mocks.requestEmailVerificationCodeAction,
}));
vi.mock("@/app/actions/link-account", () => ({
  cancelLinkedTelegramAction: mocks.cancelLinkedTelegramAction,
  confirmLinkedTelegramAction: mocks.confirmLinkedTelegramAction,
  linkAccountEmailAction: vi.fn(),
  removeLinkedPasskeyAction: vi.fn(),
}));
vi.mock("@/app/actions/session", () => ({
  clearSessionAction: mocks.clearSessionAction,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));
vi.mock("@/frontend/lib/payment-idempotency", () => ({
  clearPaymentIdempotencyKey: mocks.clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey: mocks.getOrCreatePaymentIdempotencyKey,
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
import { PasskeyLoginButton, PasskeySetupPanel } from "@/frontend/components/passkey-actions";
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
    mocks.getOrCreatePaymentIdempotencyKey.mockReturnValue("payment-key");
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

  it.each([
    {
      result: { ok: true, status: "completed", payment: { is_free: true, payment_id: "free", payment_url: null } },
      destination: "/cabinet",
    },
    {
      result: { ok: true, status: "completed", payment: { is_free: false, payment_id: "paid", payment_url: "https://pay.example/paid" } },
      destination: "https://pay.example/paid",
    },
    {
      result: { ok: true, status: "completed", payment: { is_free: false, payment_id: "pending id", payment_url: null } },
      destination: "/payment/pending?payment_id=pending%20id",
    },
  ])("routes a completed payment to $destination", async ({ result, destination }) => {
    mocks.executePaymentAction.mockResolvedValue(result);
    const user = userEvent.setup();
    render(createElement(PaymentConfirmation, {
      durationDays: "30",
      gatewayType: "CARD",
      model: checkoutModel,
      planCode: "pro",
    }));

    await user.click(screen.getByRole("button", { name: /Перейти к оплате/i }));

    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledWith(destination));
    expect(mocks.clearPaymentIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("preserves retry identity on ambiguous failures and redirects account setup errors", async () => {
    const user = userEvent.setup();
    mocks.executePaymentAction.mockRejectedValueOnce(new Error("network"));
    const view = render(createElement(PaymentConfirmation, {
      durationDays: "30", gatewayType: "CARD", model: checkoutModel, planCode: "pro",
    }));

    await user.click(screen.getByRole("button", { name: /Перейти к оплате/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(mocks.clearPaymentIdempotencyKey).not.toHaveBeenCalled();

    mocks.executePaymentAction.mockResolvedValueOnce({
      ok: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "verify",
      retainIdempotencyKey: true,
    });
    await user.click(screen.getByRole("button", { name: /Перейти к оплате/i }));
    await waitFor(() => expect(mocks.replaceWith).toHaveBeenCalledWith(expect.stringContaining("/link-account")));
    view.unmount();
  });

  it("renders invalid selections and account-action states without starting payment", async () => {
    const view = render(createElement(PaymentConfirmation, { model: checkoutModel, planCode: "missing" }));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/tariffs");
    expect(mocks.executePaymentAction).not.toHaveBeenCalled();

    view.rerender(createElement(PaymentConfirmation, {
      model: { status: "account-action-required", action: "verifyEmail", message: "verify" },
      paymentRedirectTo: "/payment?plan=pro",
    }));
    await waitFor(() => expect(mocks.replaceWith).toHaveBeenCalled());
    expect(view.container.textContent).toBe("");
  });

  it("reports a manual-review payment without discarding its idempotency key", async () => {
    mocks.executePaymentAction.mockResolvedValue({ ok: true, status: "manual-review", operationId: "manual-1" });
    const user = userEvent.setup();
    render(createElement(PaymentConfirmation, {
      durationDays: "30", gatewayType: "CARD", model: checkoutModel, planCode: "pro",
    }));

    await user.click(screen.getByRole("button", { name: /Перейти к оплате/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("manual-1"));
    expect(mocks.clearPaymentIdempotencyKey).not.toHaveBeenCalled();
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

  it("handles resend and back-to-registration outcomes", async () => {
    mocks.requestEmailVerificationCodeAction.mockResolvedValue({
      ok: true,
      kind: "code-sent",
      targetEmail: "user@example.com",
    });
    mocks.clearSessionAction.mockResolvedValue({ status: "success" });
    const user = userEvent.setup();
    render(createElement(RegisterEmailConfirmForm, { redirectTo: "/payment?plan=pro" }));

    await user.click(screen.getByRole("button", { name: /Отправить код повторно/i }));
    await waitFor(() => expect(mocks.requestEmailVerificationCodeAction).toHaveBeenCalledWith({}));
    expect(screen.getByRole("alert").textContent).toContain("user@example.com");

    await user.click(screen.getByRole("button", { name: "Назад" }));
    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledWith("/register?redirect_to=%2Fpayment%3Fplan%3Dpro"));
  });

  it("requires Turnstile before confirming or resending a registration code", async () => {
    const user = userEvent.setup();
    render(createElement(RegisterEmailConfirmForm, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));

    await user.type(screen.getByPlaceholderText("000000"), "123456");
    fireEvent.submit(screen.getByPlaceholderText("000000").closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /Отправить код повторно/i }));

    expect(mocks.confirmEmailVerificationCodeAction).not.toHaveBeenCalled();
    expect(mocks.requestEmailVerificationCodeAction).not.toHaveBeenCalled();
  });

  it("surfaces verification, resend and session-clear failures", async () => {
    const user = userEvent.setup();
    mocks.confirmEmailVerificationCodeAction.mockResolvedValueOnce({ ok: false, message: "invalid code" });
    mocks.requestEmailVerificationCodeAction.mockRejectedValueOnce(new Error("network"));
    mocks.clearSessionAction.mockResolvedValueOnce({ status: "error", message: "cannot clear" });
    render(createElement(RegisterEmailConfirmForm));

    await user.type(screen.getByPlaceholderText("000000"), "000000");
    fireEvent.submit(screen.getByPlaceholderText("000000").closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("invalid code"));

    await user.click(screen.getByRole("button", { name: /Отправить код повторно/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Назад" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("cannot clear"));
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

  it("allows continuing when WebAuthn is unavailable", async () => {
    mocks.browserSupportsWebAuthn.mockReturnValue(false);
    const user = userEvent.setup();
    render(createElement(PasskeySetupPanel, { redirectTo: "/cabinet" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Продолжить без быстрого входа/i })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /Продолжить без быстрого входа/i }));
    expect(mocks.navigateTo).toHaveBeenCalledWith("/cabinet");
  });

  it("shows Passkey registration provider and browser failures", async () => {
    const user = userEvent.setup();
    mocks.beginPasskeyRegistrationAction.mockResolvedValueOnce({ ok: false, message: "registration unavailable" });
    const view = render(createElement(PasskeySetupPanel));

    await user.click(screen.getByRole("button", { name: /Настроить быстрый вход/i }));
    await waitFor(() => expect(screen.getByText("registration unavailable")).toBeTruthy());

    mocks.beginPasskeyRegistrationAction.mockResolvedValueOnce({ ok: true, options: { challenge: "next" } });
    const cancelled = new Error("cancelled");
    cancelled.name = "NotAllowedError";
    mocks.startRegistration.mockRejectedValueOnce(cancelled);
    await user.click(screen.getByRole("button", { name: /Настроить быстрый вход/i }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(1));
    view.unmount();
  });

  it("validates Passkey login prerequisites and provider errors", async () => {
    const user = userEvent.setup();
    const resetTurnstile = vi.fn();
    const view = render(createElement(PasskeyLoginButton, {
      consumeTurnstileToken: () => null,
      email: "user@example.com",
      resetTurnstile,
      turnstileEnabled: true,
    }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Войти быстро/i })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /Войти быстро/i }));
    expect(mocks.beginPasskeyLoginAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();

    view.unmount();
    mocks.beginPasskeyLoginAction.mockResolvedValueOnce({ ok: false, message: "login unavailable" });
    render(createElement(PasskeyLoginButton, { email: "user@example.com" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Войти быстро/i })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /Войти быстро/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("login unavailable"));
    expect(resetTurnstile).not.toHaveBeenCalled();
  });
});
