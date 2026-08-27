/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buttonHandlers: new Map<string, () => void | Promise<void>>(),
  clearSession: vi.fn(),
  confirm: vi.fn(),
  events: [] as string[],
  navigateTo: vi.fn(),
  requestCode: vi.fn(),
  resetChatwoot: vi.fn(),
  turnstileProps: null as null | {
    action: string;
    onReady: (handle: { reset: () => void }) => void;
    onToken: (token: string | null) => void;
    siteKey?: string | null;
  },
}));

vi.mock("@/app/actions/email-verification", () => ({
  confirmEmailVerificationCodeAction: (...args: unknown[]) => {
    mocks.events.push("confirm-action");
    return mocks.confirm(...args);
  },
  requestEmailVerificationCodeAction: (...args: unknown[]) => {
    mocks.events.push("resend-action");
    return mocks.requestCode(...args);
  },
}));
vi.mock("@/app/actions/session", () => ({
  clearSessionAction: (...args: unknown[]) => {
    mocks.events.push("clear-session");
    return mocks.clearSession(...args);
  },
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: (destination: string) => {
    mocks.events.push(`navigate:${destination}`);
    return mocks.navigateTo(destination);
  },
}));
vi.mock("@/frontend/lib/chatwoot", () => ({
  resetChatwootSession: () => {
    mocks.events.push("reset-chatwoot");
    return mocks.resetChatwoot();
  },
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: (siteKey?: string | null) => Boolean(siteKey),
  TurnstileWidget: (props: NonNullable<typeof mocks.turnstileProps>) => {
    mocks.turnstileProps = props;
    return createElement("div", { "data-turnstile-action": props.action });
  },
}));
vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = String(buttonProps.label ?? "");
    mocks.buttonHandlers.set(
      label,
      buttonProps.onClick as () => void | Promise<void>,
    );
    for (const name of ["label", "loading", "outlined", "severity"]) {
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

import { RegisterEmailConfirmForm } from "@/frontend/components/register-email-confirm-form";

function setTurnstileChallenge(token: string, reset: () => void) {
  act(() => {
    mocks.turnstileProps?.onReady({ reset });
    mocks.turnstileProps?.onToken(token);
  });
}

function submitCode(code: string) {
  const input = screen.getByPlaceholderText<HTMLInputElement>("000000");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest("form")!);
}

function invokeButton(label: string) {
  const handler = mocks.buttonHandlers.get(label);
  if (!handler) throw new Error(`Missing ${label} handler`);
  return handler();
}

describe("register e-mail confirmation controller characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buttonHandlers.clear();
    mocks.events.length = 0;
    mocks.turnstileProps = null;
  });

  afterEach(() => cleanup());

  it("fences duplicate confirmation and keeps payload/navigation without success reset", async () => {
    let resolveConfirm!: (value: { ok: true; kind: "verified" }) => void;
    mocks.confirm.mockReturnValue(new Promise((resolve) => {
      resolveConfirm = resolve;
    }));
    const reset = vi.fn(() => mocks.events.push("turnstile-reset"));
    render(createElement(RegisterEmailConfirmForm, {
      redirectTo: "/payment?plan=pro#checkout",
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));
    setTurnstileChallenge("confirm-token", reset);

    submitCode("123456");
    fireEvent.submit(screen.getByPlaceholderText("000000").closest("form")!);

    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledWith({
      code: "123456",
      turnstileToken: "confirm-token",
    });
    expect(mocks.events).toEqual(["confirm-action"]);
    for (const label of [
      "Подтвердить e-mail",
      "Отправить код повторно",
      "Назад",
    ]) {
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled)
        .toBe(true);
    }

    await act(async () => resolveConfirm({ ok: true, kind: "verified" }));

    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro%23checkout",
    );
    expect(reset).not.toHaveBeenCalled();
    expect(mocks.events).toEqual([
      "confirm-action",
      "navigate:/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro%23checkout",
    ]);
  });

  it("resets Turnstile after confirmation provider and network failures", async () => {
    const reset = vi.fn();
    mocks.confirm.mockResolvedValueOnce({
      ok: false,
      message: "Код не подошёл.",
    });
    const first = render(createElement(RegisterEmailConfirmForm, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));
    setTurnstileChallenge("provider-token", reset);
    submitCode("111111");

    await waitFor(() => expect(screen.getByText("Код не подошёл.")).toBeTruthy());
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledWith({
      code: "111111",
      turnstileToken: "provider-token",
    });

    first.unmount();
    mocks.turnstileProps = null;
    reset.mockClear();
    mocks.confirm.mockRejectedValueOnce(new Error("network"));
    render(createElement(RegisterEmailConfirmForm, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));
    setTurnstileChallenge("network-token", reset);
    submitCode("222222");

    await waitFor(() => expect(screen.getByText(
      "Сеть недоступна. Не удалось подтвердить e-mail.",
    )).toBeTruthy());
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      code: "222222",
      turnstileToken: "network-token",
    });
  });

  it("fences duplicate resend, preserves payload/message and consumes token only by reset", async () => {
    let resolveResend!: (value: {
      ok: true;
      kind: "code-sent";
      targetEmail: string;
    }) => void;
    mocks.requestCode.mockReturnValue(new Promise((resolve) => {
      resolveResend = resolve;
    }));
    const reset = vi.fn(() => mocks.events.push("turnstile-reset"));
    render(createElement(RegisterEmailConfirmForm, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));
    setTurnstileChallenge("resend-token", reset);

    act(() => {
      void invokeButton("Отправить код повторно");
      void invokeButton("Отправить код повторно");
    });

    expect(mocks.requestCode).toHaveBeenCalledOnce();
    expect(mocks.requestCode).toHaveBeenCalledWith({
      turnstileToken: "resend-token",
    });
    expect(mocks.events).toEqual(["resend-action"]);

    await act(async () => resolveResend({
      ok: true,
      kind: "code-sent",
      targetEmail: "person@example.test",
    }));

    await waitFor(() => expect(screen.getByText(
      "Код повторно отправлен на person@example.test.",
    )).toBeTruthy());
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.events).toEqual(["resend-action", "turnstile-reset"]);

    act(() => void invokeButton("Отправить код повторно"));
    expect(mocks.requestCode).toHaveBeenCalledOnce();
    expect(screen.getByText("Пройдите проверку Cloudflare Turnstile.")).toBeTruthy();
  });

  it("resets Turnstile after resend provider and network failures", async () => {
    const reset = vi.fn();
    mocks.requestCode.mockResolvedValueOnce({
      ok: false,
      message: "Повторная отправка недоступна.",
    });
    const first = render(createElement(RegisterEmailConfirmForm, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));
    setTurnstileChallenge("provider-token", reset);
    act(() => void invokeButton("Отправить код повторно"));

    await waitFor(() => expect(screen.getByText(
      "Повторная отправка недоступна.",
    )).toBeTruthy());
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.requestCode).toHaveBeenCalledWith({
      turnstileToken: "provider-token",
    });

    first.unmount();
    mocks.buttonHandlers.clear();
    mocks.turnstileProps = null;
    reset.mockClear();
    mocks.requestCode.mockRejectedValueOnce(new Error("network"));
    render(createElement(RegisterEmailConfirmForm, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));
    setTurnstileChallenge("network-token", reset);
    act(() => void invokeButton("Отправить код повторно"));

    await waitFor(() => expect(screen.getByText(
      "Сеть недоступна. Не удалось повторно отправить код.",
    )).toBeTruthy());
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.requestCode).toHaveBeenLastCalledWith({
      turnstileToken: "network-token",
    });
  });

  it("blocks confirm and resend when the configured challenge token is missing", () => {
    render(createElement(RegisterEmailConfirmForm, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    }));

    submitCode("123456");
    act(() => void invokeButton("Отправить код повторно"));

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.requestCode).not.toHaveBeenCalled();
    expect(screen.getByText("Пройдите проверку Cloudflare Turnstile.")).toBeTruthy();
  });

  it("fences duplicate back and preserves Chatwoot-clear-navigation order", async () => {
    let resolveClear!: (value: { status: "success" }) => void;
    mocks.clearSession.mockReturnValue(new Promise((resolve) => {
      resolveClear = resolve;
    }));
    render(createElement(RegisterEmailConfirmForm, {
      redirectTo: "/payment?plan=pro#checkout",
    }));

    act(() => {
      void invokeButton("Назад");
      void invokeButton("Назад");
    });

    expect(mocks.resetChatwoot).toHaveBeenCalledOnce();
    expect(mocks.clearSession).toHaveBeenCalledOnce();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["reset-chatwoot", "clear-session"]);

    await act(async () => resolveClear({ status: "success" }));

    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/register?redirect_to=%2Fpayment%3Fplan%3Dpro%23checkout",
    );
    expect(mocks.events).toEqual([
      "reset-chatwoot",
      "clear-session",
      "navigate:/register?redirect_to=%2Fpayment%3Fplan%3Dpro%23checkout",
    ]);
  });

  it("keeps back provider and network failures local after resetting Chatwoot", async () => {
    mocks.clearSession.mockResolvedValueOnce({
      status: "error",
      message: "Сессию не удалось очистить.",
    });
    const first = render(createElement(RegisterEmailConfirmForm));
    act(() => void invokeButton("Назад"));

    await waitFor(() => expect(screen.getByText(
      "Сессию не удалось очистить.",
    )).toBeTruthy());
    expect(mocks.events).toEqual(["reset-chatwoot", "clear-session"]);
    expect(mocks.navigateTo).not.toHaveBeenCalled();

    first.unmount();
    mocks.buttonHandlers.clear();
    mocks.events.length = 0;
    mocks.clearSession.mockRejectedValueOnce(new Error("network"));
    render(createElement(RegisterEmailConfirmForm));
    act(() => void invokeButton("Назад"));

    await waitFor(() => expect(screen.getByText(
      "Сеть недоступна. Не удалось вернуться к регистрации.",
    )).toBeTruthy());
    expect(mocks.events).toEqual(["reset-chatwoot", "clear-session"]);
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it("keeps the initial delivery warning copy unchanged", () => {
    render(createElement(RegisterEmailConfirmForm, {
      verificationDeliveryFailed: true,
    }));

    expect(screen.getByText(
      "Аккаунт создан, но письмо с кодом не удалось отправить автоматически. Нажмите «Отправить код повторно».",
    )).toBeTruthy();
  });
});
