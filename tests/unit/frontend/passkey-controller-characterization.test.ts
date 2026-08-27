/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";

import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginLogin: vi.fn(),
  beginRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(),
  clearSession: vi.fn(),
  events: [] as string[],
  navigateTo: vi.fn(),
  restartClick: null as null | (() => Promise<void>),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  verifyLogin: vi.fn(),
  verifyRegistration: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: mocks.browserSupportsWebAuthn,
  startAuthentication: (...args: unknown[]) => {
    mocks.events.push("start-authentication");
    return mocks.startAuthentication(...args);
  },
  startRegistration: (...args: unknown[]) => {
    mocks.events.push("start-registration");
    return mocks.startRegistration(...args);
  },
}));
vi.mock("@/app/actions/passkeys", () => ({
  beginPasskeyLoginAction: (...args: unknown[]) => {
    mocks.events.push("begin-login");
    return mocks.beginLogin(...args);
  },
  beginPasskeyRegistrationAction: (...args: unknown[]) => {
    mocks.events.push("begin-registration");
    return mocks.beginRegistration(...args);
  },
  verifyPasskeyLoginAction: (...args: unknown[]) => {
    mocks.events.push("verify-login");
    return mocks.verifyLogin(...args);
  },
  verifyPasskeyRegistrationAction: (...args: unknown[]) => {
    mocks.events.push("verify-registration");
    return mocks.verifyRegistration(...args);
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
vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = String(buttonProps.label ?? "");
    if (label === "Начать вход заново") {
      mocks.restartClick = buttonProps.onClick as () => Promise<void>;
    }
    for (const name of ["icon", "label", "loading", "outlined", "severity"]) {
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

import {
  PasskeyLoginButton,
  PasskeySetupPanel,
} from "@/frontend/components/passkey-actions";

describe("passkey controller characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.restartClick = null;
    mocks.browserSupportsWebAuthn.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("checks WebAuthn support through the existing zero-delay effect timer", async () => {
    const setTimeout = vi.spyOn(window, "setTimeout");

    render(createElement(PasskeyLoginButton, { email: "person@example.test" }));

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(mocks.browserSupportsWebAuthn).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Войти быстро" })).toBeNull();
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Войти быстро" }),
    ).toBeTruthy());
    expect(mocks.browserSupportsWebAuthn).toHaveBeenCalledOnce();
  });

  it("keeps the passkey façade at exactly two runtime exports and no type exports", () => {
    const source = readFileSync(
      "src/frontend/components/passkey-actions.tsx",
      "utf8",
    );
    expect(Array.from(
      source.matchAll(/^export function (\w+)/gm),
      (match) => match[1],
    )).toEqual(["PasskeyLoginButton", "PasskeySetupPanel"]);
    expect(source).not.toMatch(/^export (?:type|interface) /m);
  });

  it("fences duplicate login and preserves Turnstile/action/navigation order", async () => {
    let resolveOptions!: (value: {
      ok: true;
      options: { challenge: string };
    }) => void;
    const consumeTurnstileToken = vi.fn(() => {
      mocks.events.push("consume-turnstile");
      return "turnstile-token";
    });
    const resetTurnstile = vi.fn(() => mocks.events.push("reset-turnstile"));
    mocks.beginLogin.mockReturnValue(new Promise((resolve) => {
      resolveOptions = resolve;
    }));
    mocks.startAuthentication.mockResolvedValue({ id: "login-credential" });
    mocks.verifyLogin.mockResolvedValue({ ok: true });
    render(createElement(PasskeyLoginButton, {
      consumeTurnstileToken,
      email: "person@example.test",
      redirectTo: "/cabinet?tab=devices#active",
      resetTurnstile,
      turnstileEnabled: true,
    }));
    const button = await screen.findByRole("button", { name: "Войти быстро" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(consumeTurnstileToken).toHaveBeenCalledOnce();
    expect(mocks.beginLogin).toHaveBeenCalledOnce();
    expect(mocks.beginLogin).toHaveBeenCalledWith({
      email: "person@example.test",
      turnstileToken: "turnstile-token",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.events).toEqual(["consume-turnstile", "begin-login"]);

    await act(async () => resolveOptions({
      ok: true,
      options: { challenge: "login-options" },
    }));

    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
    expect(mocks.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "login-options" },
    });
    expect(mocks.verifyLogin).toHaveBeenCalledWith({ id: "login-credential" });
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/cabinet?tab=devices#active",
    );
    expect(mocks.events).toEqual([
      "consume-turnstile",
      "begin-login",
      "reset-turnstile",
      "start-authentication",
      "verify-login",
      "navigate:/cabinet?tab=devices#active",
    ]);
  });

  it("fences duplicate setup and preserves the trimmed registration name payload", async () => {
    let resolveOptions!: (value: {
      ok: true;
      options: { challenge: string };
    }) => void;
    mocks.beginRegistration.mockReturnValue(new Promise((resolve) => {
      resolveOptions = resolve;
    }));
    mocks.startRegistration.mockResolvedValue({ id: "new-credential" });
    mocks.verifyRegistration.mockResolvedValue({ ok: true });
    const view = render(createElement(PasskeySetupPanel, {
      redirectTo: "/profile#security",
    }));
    const button = await screen.findByRole("button", {
      name: "Настроить быстрый вход",
    });
    fireEvent.change(view.getByPlaceholderText("Например: Android Chrome или ноутбук"), {
      target: { value: "  Рабочий ноутбук  " },
    });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(mocks.beginRegistration).toHaveBeenCalledOnce();
    expect(mocks.beginRegistration).toHaveBeenCalledWith();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.events).toEqual(["begin-registration"]);

    await act(async () => resolveOptions({
      ok: true,
      options: { challenge: "registration-options" },
    }));

    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
    expect(mocks.startRegistration).toHaveBeenCalledWith({
      optionsJSON: { challenge: "registration-options" },
    });
    expect(mocks.verifyRegistration).toHaveBeenCalledWith({
      id: "new-credential",
      name: "Рабочий ноутбук",
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith("/profile#security");
    expect(mocks.events).toEqual([
      "begin-registration",
      "start-registration",
      "verify-registration",
      "navigate:/profile#security",
    ]);
  });

  it("keeps optional skip as a direct navigation with no Server Action", async () => {
    mocks.browserSupportsWebAuthn.mockReturnValue(false);
    render(createElement(PasskeySetupPanel, {
      redirectTo: "/cabinet?tab=devices#active",
    }));
    const button = await screen.findByRole("button", {
      name: "Продолжить без быстрого входа",
    });

    fireEvent.click(button);

    expect(mocks.beginRegistration).not.toHaveBeenCalled();
    expect(mocks.verifyRegistration).not.toHaveBeenCalled();
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.navigateTo).toHaveBeenCalledOnce();
    expect(mocks.events).toEqual([
      "navigate:/cabinet?tab=devices#active",
    ]);
  });

  it("fences duplicate restart and navigates only after session clear succeeds", async () => {
    let resolveClear!: (value: { status: "success" }) => void;
    mocks.browserSupportsWebAuthn.mockReturnValue(false);
    mocks.clearSession.mockReturnValue(new Promise((resolve) => {
      resolveClear = resolve;
    }));
    render(createElement(PasskeySetupPanel, {
      redirectTo: "/payment?plan=pro#checkout",
      required: true,
    }));
    await screen.findByRole("button", {
      name: "Начать вход заново",
    });

    act(() => {
      void mocks.restartClick?.();
      void mocks.restartClick?.();
    });

    await waitFor(() => expect(mocks.clearSession).toHaveBeenCalledOnce());
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    expect((screen.getByRole("button", {
      name: "Начать вход заново",
    }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.events).toEqual(["clear-session"]);

    await act(async () => resolveClear({ status: "success" }));

    await waitFor(() => expect(mocks.navigateTo).toHaveBeenCalledOnce());
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/login?redirect_to=%2Fpayment%3Fplan%3Dpro%23checkout",
    );
    expect(mocks.events).toEqual([
      "clear-session",
      "navigate:/login?redirect_to=%2Fpayment%3Fplan%3Dpro%23checkout",
    ]);
  });
});
