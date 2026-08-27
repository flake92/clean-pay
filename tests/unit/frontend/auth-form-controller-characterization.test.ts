/** @vitest-environment jsdom */

import {
  act,
  createElement,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  executeAuthAction: vi.fn(),
  passkeyProps: null as null | Record<string, unknown>,
  reset: vi.fn(),
  turnstileProps: null as null | {
    action: string;
    onReady: (handle: { reset: () => void }) => void;
    onToken: (token: string | null) => void;
    siteKey?: string | null;
  },
}));

vi.mock("@/app/actions/auth", () => ({
  executeAuthAction: (...args: unknown[]) => {
    mocks.events.push("action");
    return mocks.executeAuthAction(...args);
  },
}));
vi.mock("@/frontend/components/passkey-actions", () => ({
  PasskeyLoginButton: (props: Record<string, unknown>) => {
    mocks.passkeyProps = props;
    return createElement("button", { type: "button" }, "Войти быстро");
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
    for (const name of ["icon", "label", "loading", "severity", "text"]) {
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
    createElement("div", { "data-severity": severity }, text),
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

import {
  AuthTurnstileProvider,
  LoginForm,
} from "@/frontend/components/auth-forms";
import {
  useAuthFormController,
  useTelegramLoginController,
  type AuthTurnstileControllerValue,
} from "@/frontend/hooks/use-auth-form-controller";

function inputChange(value: string) {
  return { target: { value } } as ChangeEvent<HTMLInputElement>;
}

function submitEvent() {
  return { preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>;
}

function turnstileController(
  overrides: Partial<AuthTurnstileControllerValue> = {},
): AuthTurnstileControllerValue {
  return {
    enabled: false,
    siteKey: null,
    token: null,
    consumeToken: vi.fn(() => null),
    reset: vi.fn(),
    setHandle: vi.fn(),
    setToken: vi.fn(),
    ...overrides,
  };
}

describe("auth form controller characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.passkeyProps = null;
    mocks.turnstileProps = null;
    mocks.reset.mockImplementation(() => mocks.events.push("reset"));
  });

  afterEach(() => cleanup());

  it("consumes each challenge once and preserves action payload/order across identify and password", async () => {
    let resolveIdentify!: (result: {
      ok: true;
      kind: "identified";
      exists: true;
      hasPasskey: true;
    }) => void;
    mocks.executeAuthAction
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveIdentify = resolve;
      }))
      .mockResolvedValueOnce({
        ok: false,
        code: "AUTH_FAILED",
        message: "Неверный e-mail или пароль.",
      });

    const view = render(
      createElement(
        AuthTurnstileProvider as (props: {
          enabled: boolean;
          siteKey?: string | null;
          children?: ReactNode;
        }) => ReactNode,
        { enabled: true, siteKey: "site-key" },
        createElement(LoginForm, {
          redirectTo: "/cabinet?tab=devices#active",
        }),
      ),
    );
    const form = view.container.querySelector("form")!;
    const email = view.container.querySelector<HTMLInputElement>('input[name="email"]')!;

    act(() => {
      mocks.turnstileProps?.onReady({ reset: mocks.reset });
      mocks.turnstileProps?.onToken("identify-challenge");
    });
    fireEvent.change(email, { target: { value: "person@example.test" } });
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(mocks.executeAuthAction).toHaveBeenCalledOnce();
    expect(mocks.executeAuthAction).toHaveBeenNthCalledWith(1, {
      kind: "identify",
      email: "person@example.test",
      turnstileToken: "identify-challenge",
    });
    expect(mocks.events).toEqual(["action"]);
    expect(
      view.getByRole("button", { name: "Продолжить" }).hasAttribute("disabled"),
    ).toBe(true);

    await act(async () => resolveIdentify({
      ok: true,
      kind: "identified",
      exists: true,
      hasPasskey: true,
    }));

    await waitFor(() => expect(mocks.reset).toHaveBeenCalledOnce());
    expect(mocks.events).toEqual(["action", "reset"]);
    expect(mocks.passkeyProps).toMatchObject({
      email: "person@example.test",
      redirectTo: "/cabinet?tab=devices#active",
      turnstileEnabled: true,
    });

    const password = view.container.querySelector<HTMLInputElement>('input[name="password"]')!;
    fireEvent.change(password, { target: { value: "correct horse battery staple" } });
    act(() => mocks.turnstileProps?.onToken("password-challenge"));
    fireEvent.submit(form);

    await waitFor(() => expect(mocks.executeAuthAction).toHaveBeenCalledTimes(2));
    expect(mocks.executeAuthAction).toHaveBeenNthCalledWith(2, {
      kind: "login",
      email: "person@example.test",
      password: "correct horse battery staple",
      turnstileToken: "password-challenge",
    });
    await waitFor(() => expect(mocks.reset).toHaveBeenCalledTimes(2));
    expect(mocks.events).toEqual(["action", "reset", "action", "reset"]);
    expect(
      view.getByRole("button", { name: "Забыли пароль?" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(view.getByText("Неверный e-mail или пароль.")).not.toBeNull();
  });

  it("preserves registration action order and the verification redirect with query/hash", async () => {
    const navigateAfterAuth = vi.fn();
    const turnstile = turnstileController();
    mocks.executeAuthAction
      .mockResolvedValueOnce({
        ok: true,
        kind: "identified",
        exists: false,
        hasPasskey: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        kind: "authenticated",
        emailVerified: false,
        verificationRequired: true,
        verificationDeliveryFailed: true,
      });
    const hook = renderHook(() => useAuthFormController({
      initialError: null,
      navigateAfterAuth,
      redirectTo: "/payment?plan=pro#checkout",
      turnstile,
    }));

    act(() => hook.result.current.changeEmailInput(inputChange("new@example.test")));
    await act(async () => hook.result.current.submit(submitEvent()));
    expect(hook.result.current.stage).toBe("register");
    act(() => {
      hook.result.current.changePasswordInput(inputChange("new password"));
      hook.result.current.changePasswordConfirmationInput(inputChange("new password"));
    });
    await act(async () => hook.result.current.submit(submitEvent()));

    expect(mocks.executeAuthAction.mock.calls).toEqual([
      [{ kind: "identify", email: "new@example.test" }],
      [{
        kind: "register",
        email: "new@example.test",
        password: "new password",
      }],
    ]);
    expect(navigateAfterAuth).toHaveBeenCalledOnce();
    expect(navigateAfterAuth).toHaveBeenCalledWith(
      "/register/verify-email?delivery=failed&redirect_to=%2Fpayment%3Fplan%3Dpro%23checkout",
    );
    expect(turnstile.reset).toHaveBeenCalledTimes(2);
  });

  it("preserves password recovery payloads, code filtering and terminal destination", async () => {
    const navigateAfterAuth = vi.fn();
    const turnstile = turnstileController();
    mocks.executeAuthAction
      .mockResolvedValueOnce({
        ok: true,
        kind: "identified",
        exists: true,
        hasPasskey: false,
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "AUTH_FAILED",
        message: "Неверный e-mail или пароль.",
      })
      .mockResolvedValueOnce({
        ok: true,
        kind: "password-reset-requested",
      })
      .mockResolvedValueOnce({
        ok: true,
        kind: "authenticated",
        emailVerified: true,
        verificationRequired: false,
        verificationDeliveryFailed: false,
      });
    const hook = renderHook(() => useAuthFormController({
      initialError: null,
      navigateAfterAuth,
      redirectTo: "/cabinet?tab=devices#active",
      turnstile,
    }));

    act(() => hook.result.current.changeEmailInput(inputChange("person@example.test")));
    await act(async () => hook.result.current.submit(submitEvent()));
    act(() => hook.result.current.changePasswordInput(inputChange("old password")));
    await act(async () => hook.result.current.submit(submitEvent()));
    expect(hook.result.current.canRecoverPassword).toBe(true);

    act(() => hook.result.current.requestPasswordRecovery());
    await act(async () => hook.result.current.submit(submitEvent()));
    expect(hook.result.current.stage).toBe("resetConfirm");
    act(() => {
      hook.result.current.changeCodeInput(inputChange("a12-34567"));
      hook.result.current.changePasswordInput(inputChange("new password"));
      hook.result.current.changePasswordConfirmationInput(inputChange("new password"));
    });
    await act(async () => hook.result.current.submit(submitEvent()));

    expect(mocks.executeAuthAction.mock.calls).toEqual([
      [{ kind: "identify", email: "person@example.test" }],
      [{
        kind: "login",
        email: "person@example.test",
        password: "old password",
      }],
      [{ kind: "request-password-reset", email: "person@example.test" }],
      [{
        kind: "confirm-password-reset",
        email: "person@example.test",
        code: "123456",
        newPassword: "new password",
      }],
    ]);
    expect(navigateAfterAuth).toHaveBeenCalledWith(
      "/cabinet?tab=devices#active",
    );
    expect(turnstile.reset).toHaveBeenCalledTimes(4);
  });

  it("does not call the Server Action when the enabled shared challenge is absent", async () => {
    const turnstile = turnstileController({
      enabled: true,
      siteKey: "site-key",
    });
    const hook = renderHook(() => useAuthFormController({
      initialError: null,
      navigateAfterAuth: vi.fn(),
      redirectTo: "/cabinet",
      turnstile,
    }));

    await act(async () => hook.result.current.submit(submitEvent()));

    expect(turnstile.consumeToken).toHaveBeenCalledOnce();
    expect(turnstile.reset).not.toHaveBeenCalled();
    expect(mocks.executeAuthAction).not.toHaveBeenCalled();
    expect(hook.result.current.api).toEqual({
      loading: false,
      error: "Пройдите единую проверку безопасности.",
    });

    const telegram = renderHook(() => useTelegramLoginController({
      redirectTo: "/cabinet",
      turnstile,
    }));
    act(() => telegram.result.current.login());
    expect(telegram.result.current).toMatchObject({
      loading: false,
      error: "Пройдите единую проверку безопасности.",
    });
    expect(turnstile.reset).not.toHaveBeenCalled();
  });

  it("resets the challenge and preserves the generic feedback after an action exception", async () => {
    const turnstile = turnstileController();
    mocks.executeAuthAction.mockRejectedValueOnce(new Error("network"));
    const hook = renderHook(() => useAuthFormController({
      initialError: null,
      navigateAfterAuth: vi.fn(),
      redirectTo: "/cabinet",
      turnstile,
    }));

    await act(async () => hook.result.current.submit(submitEvent()));

    expect(turnstile.reset).toHaveBeenCalledOnce();
    expect(hook.result.current.api).toEqual({
      loading: false,
      error: "Не удалось определить результат входа. Обновите страницу, чтобы проверить состояние сессии.",
    });
  });
});
