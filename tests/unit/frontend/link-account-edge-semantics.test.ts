/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  cancelLinkedTelegramAction: vi.fn(),
  confirmLinkedTelegramAction: vi.fn(),
  linkAccountEmailAction: vi.fn(),
  navigateTo: vi.fn(),
  removeLinkedPasskeyAction: vi.fn(),
  replaceWith: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: mocks.browserSupportsWebAuthn,
}));
vi.mock("@/app/actions/link-account", () => ({
  cancelLinkedTelegramAction: mocks.cancelLinkedTelegramAction,
  confirmLinkedTelegramAction: mocks.confirmLinkedTelegramAction,
  linkAccountEmailAction: mocks.linkAccountEmailAction,
  removeLinkedPasskeyAction: mocks.removeLinkedPasskeyAction,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));
vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = String(buttonProps.label ?? "");
    for (const name of [
      "icon",
      "label",
      "loading",
      "outlined",
      "severity",
    ]) {
      delete buttonProps[name];
    }
    return createElement("button", buttonProps, label);
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ severity, text }: { severity?: string; text?: string }) =>
    createElement("div", { "data-severity": severity, role: "alert" }, text),
}));
vi.mock("primereact/password", () => ({
  Password: (props: Record<string, unknown>) => {
    const inputProps = { ...props };
    for (const name of ["feedback", "inputClassName", "toggleMask"]) {
      delete inputProps[name];
    }
    return createElement("input", { ...inputProps, type: "password" });
  },
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value?: string }) => createElement("span", null, value),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) =>
    createElement("a", { href }, label),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: (value?: string | null) => Boolean(value),
  TurnstileWidget: () => createElement("div"),
}));

import { LinkAccountPanel } from "@/frontend/components/link-account-panel";

const mergeModel = {
  status: "ready" as const,
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
};

const emailRequiredModel = {
  status: "ready" as const,
  profile: { email: null, emailVerified: false, telegramId: "777" },
  passkeys: [],
  callbackError: null,
  mergeConfirmation: null,
};

describe("link-account deferred edge semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(
      {},
      "",
      "/link-account?reason=email-required&redirect_to=%2Fpayment%3Fplan%3Dpro",
    );
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("continues to discard redirect_to after a successful Telegram merge cancellation", async () => {
    mocks.cancelLinkedTelegramAction.mockResolvedValue({
      ok: true,
      kind: "merge-cancelled",
    });
    const replaceState = vi.spyOn(window.history, "replaceState");
    const user = userEvent.setup();

    render(
      createElement(LinkAccountPanel, {
        model: mergeModel,
        redirectTo: "/payment?plan=pro",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Отмена" }));

    await waitFor(() =>
      expect(mocks.cancelLinkedTelegramAction).toHaveBeenCalledOnce(),
    );
    expect(replaceState).toHaveBeenCalledWith({}, "", "/link-account");
    expect(window.location.pathname).toBe("/link-account");
    expect(window.location.search).toBe("");
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it("continues to render no standalone EMAIL_REQUIRED feedback in guided recovery", () => {
    const view = render(
      createElement(LinkAccountPanel, {
        guided: true,
        model: emailRequiredModel,
        redirectTo: "/payment?plan=pro",
      }),
    );

    expect(screen.getByText("Добавьте резервный вход")).toBeTruthy();
    expect(view.container.querySelector('[data-severity="error"]')).toBeNull();
    expect(mocks.linkAccountEmailAction).not.toHaveBeenCalled();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    expect(mocks.replaceWith).not.toHaveBeenCalled();
  });

  it("submits the exact e-mail payload once under a same-tick duplicate", async () => {
    let resolveAction!: (value: {
      ok: true;
      kind: "verification-required";
    }) => void;
    mocks.linkAccountEmailAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    const view = render(
      createElement(LinkAccountPanel, {
        guided: true,
        model: emailRequiredModel,
        redirectTo: "/payment?plan=pro",
      }),
    );
    const email = view.container.querySelector<HTMLInputElement>(
      'input[name="email"]',
    )!;
    const password = view.container.querySelector<HTMLInputElement>(
      'input[name="password"]',
    )!;
    const confirmation = view.container.querySelector<HTMLInputElement>(
      'input[name="confirmPassword"]',
    )!;
    const form = view.container.querySelector<HTMLFormElement>("form")!;

    await user.type(email, "  user@example.com  ");
    await user.type(password, "password-123");
    await user.type(confirmation, "password-123");
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(mocks.linkAccountEmailAction).toHaveBeenCalledOnce(),
    );
    expect(mocks.linkAccountEmailAction).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password-123",
    });

    await act(async () => {
      resolveAction({ ok: true, kind: "verification-required" });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mocks.navigateTo).toHaveBeenCalledWith(
        "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro",
      ),
    );
    expect(mocks.linkAccountEmailAction).toHaveBeenCalledOnce();
  });

  it.each([
    ["AUTH_FAILED", "Неверный e-mail или пароль."],
    ["RATE_LIMITED", "Слишком много попыток. Попробуйте позже."],
  ] as const)("renders the exact %s link failure instead of a generic fallback", async (code, message) => {
    mocks.linkAccountEmailAction.mockResolvedValue({
      ok: false,
      code,
      message,
    });
    const user = userEvent.setup();
    const view = render(
      createElement(LinkAccountPanel, {
        guided: true,
        model: emailRequiredModel,
        redirectTo: "/payment?plan=pro",
      }),
    );

    await user.type(
      view.container.querySelector<HTMLInputElement>('input[name="email"]')!,
      "existing@example.com",
    );
    await user.type(
      view.container.querySelector<HTMLInputElement>('input[name="password"]')!,
      "wrong-password",
    );
    await user.type(
      view.container.querySelector<HTMLInputElement>('input[name="confirmPassword"]')!,
      "wrong-password",
    );
    fireEvent.submit(view.container.querySelector<HTMLFormElement>("form")!);

    await waitFor(() =>
      expect(view.container.querySelector('[data-severity="error"]')?.textContent)
        .toBe(message),
    );
    expect(mocks.linkAccountEmailAction).toHaveBeenCalledOnce();
    expect(screen.queryByText("Не удалось связать e-mail с аккаунтом.")).toBeNull();
    expect(screen.queryByText("Сеть недоступна. Не удалось связать e-mail с аккаунтом.")).toBeNull();
  });

  it("removes only the requested passkey with one Server Action call", async () => {
    mocks.removeLinkedPasskeyAction.mockResolvedValue({
      ok: true,
      kind: "passkey-deleted",
    });
    const user = userEvent.setup();
    render(
      createElement(LinkAccountPanel, {
        model: {
          ...emailRequiredModel,
          passkeys: [
            {
              id: "key-1",
              name: "Phone",
              createdAt: "2026-08-01T00:00:00.000Z",
              lastUsedAt: null,
            },
            {
              id: "key-2",
              name: "Laptop",
              createdAt: "2026-08-02T00:00:00.000Z",
              lastUsedAt: null,
            },
          ],
        },
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Удалить ключ Phone 1" }),
    );

    await waitFor(() =>
      expect(mocks.removeLinkedPasskeyAction).toHaveBeenCalledOnce(),
    );
    expect(mocks.removeLinkedPasskeyAction).toHaveBeenCalledWith("key-1");
    expect(screen.getByText("Ключ быстрого входа удалён.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Удалить ключ Phone 1" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Удалить ключ Laptop 1" }),
    ).toBeTruthy();
  });

  it("keeps Telegram linking blocked until the configured Turnstile has a token", async () => {
    const user = userEvent.setup();
    render(
      createElement(LinkAccountPanel, {
        model: emailRequiredModel,
        turnstileEnabled: true,
        turnstileSiteKey: "site-key",
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Перепроверить связь Telegram" }),
    );

    expect(
      screen.getByText("Пройдите проверку Cloudflare Turnstile."),
    ).toBeTruthy();
    expect(mocks.linkAccountEmailAction).not.toHaveBeenCalled();
    expect(mocks.confirmLinkedTelegramAction).not.toHaveBeenCalled();
    expect(mocks.cancelLinkedTelegramAction).not.toHaveBeenCalled();
  });
});
