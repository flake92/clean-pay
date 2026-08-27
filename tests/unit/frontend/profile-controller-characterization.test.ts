/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelAnimationFrame: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  focus: vi.fn(),
  navigateTo: vi.fn(),
  requestAnimationFrame: vi.fn(),
  requestVerification: vi.fn(),
  scrollIntoView: vi.fn(),
  turnstileProps: null as null | {
    action: string;
    onReady: (handle: { reset: () => void }) => void;
    onToken: (token: string | null) => void;
  },
  updateReminders: vi.fn(),
}));

vi.mock("@/app/actions/profile", () => ({
  changeProfileEmailAction: mocks.changeEmail,
  changeProfilePasswordAction: mocks.changePassword,
  requestProfileEmailVerificationAction: mocks.requestVerification,
  updateEmailReminderPreferenceAction: mocks.updateReminders,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: (value?: string | null) => Boolean(value),
  TurnstileWidget: (props: NonNullable<typeof mocks.turnstileProps>) => {
    mocks.turnstileProps = props;
    return createElement("div", { "data-action": props.action });
  },
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) =>
    createElement("a", { href }, label),
}));
vi.mock("primereact/card", () => ({
  Card: ({ children, title }: { children?: ReactNode; title?: string }) =>
    createElement("section", { "data-title": title }, children),
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ severity, text }: { severity?: string; text?: string }) =>
    createElement("div", { "data-severity": severity, role: "alert" }, text),
}));
vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = String(buttonProps.label ?? "");
    for (const name of ["label", "loading", "severity"]) {
      delete buttonProps[name];
    }
    return createElement("button", buttonProps, label);
  },
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

import { ProfilePanel } from "@/frontend/components/profile-panel";

const profileModel = {
  status: "ready" as const,
  user: {
    authType: "passkey",
    email: "old@example.com",
    emailVerified: true,
    pendingEmail: null,
    telegramId: null,
  },
  emailReminders: { status: "unavailable" as const },
};

describe("profile controller characterization", () => {
  let animationFrameCallback: FrameRequestCallback | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.turnstileProps = null;
    animationFrameCallback = null;
    mocks.requestAnimationFrame.mockImplementation((callback) => {
      animationFrameCallback = callback;
      return 41;
    });
    vi.stubGlobal("requestAnimationFrame", mocks.requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", mocks.cancelAnimationFrame);
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(mocks.focus);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: mocks.scrollIntoView,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps Passkey profile error focus deferred to the next animation frame", async () => {
    mocks.changeEmail.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Не удалось изменить e-mail.",
    });
    const view = render(createElement(ProfilePanel, { model: profileModel }));
    const email = view.container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    const form = email.closest("form")!;

    fireEvent.change(email, { target: { value: "next@example.com" } });
    fireEvent.submit(form);

    await waitFor(() => expect(mocks.changeEmail).toHaveBeenCalledOnce());
    expect(mocks.changeEmail).toHaveBeenCalledWith({
      email: "next@example.com",
    });
    await waitFor(() =>
      expect(mocks.requestAnimationFrame).toHaveBeenCalledOnce(),
    );
    expect(mocks.focus).not.toHaveBeenCalled();
    expect(mocks.scrollIntoView).not.toHaveBeenCalled();

    act(() => animationFrameCallback?.(123));

    expect(mocks.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("keeps Turnstile action changes and duplicate e-mail submission atomic", async () => {
    let resolveChange!: (value: {
      ok: true;
      message: string;
      targetEmail: string;
    }) => void;
    mocks.changeEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveChange = resolve;
      }),
    );
    const firstReset = vi.fn();
    const secondReset = vi.fn();
    const view = render(
      createElement(ProfilePanel, {
        model: profileModel,
        turnstileEnabled: true,
        turnstileSiteKey: "site-key",
      }),
    );
    const email = view.container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    const form = email.closest("form")!;

    expect(mocks.turnstileProps?.action).toBe("email_verification");
    act(() => {
      mocks.turnstileProps?.onReady({ reset: firstReset });
      mocks.turnstileProps?.onToken("verification-token");
    });
    fireEvent.change(email, { target: { value: "next@example.com" } });

    await waitFor(() =>
      expect(mocks.turnstileProps?.action).toBe("email_change"),
    );
    expect(firstReset).toHaveBeenCalledOnce();
    act(() => {
      mocks.turnstileProps?.onReady({ reset: secondReset });
      mocks.turnstileProps?.onToken("change-token");
    });

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(mocks.changeEmail).toHaveBeenCalledOnce());
    expect(mocks.changeEmail).toHaveBeenCalledWith({
      email: "next@example.com",
      turnstileToken: "change-token",
    });
    expect(mocks.requestVerification).not.toHaveBeenCalled();

    await act(async () => {
      resolveChange({
        ok: true,
        message: "Код отправлен.",
        targetEmail: "next@example.com",
      });
      await Promise.resolve();
    });

    expect(mocks.navigateTo).toHaveBeenCalledWith("/verify-email");
    expect(secondReset).toHaveBeenCalledOnce();
    expect(mocks.changeEmail.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigateTo.mock.invocationCallOrder[0]!,
    );
    expect(mocks.navigateTo.mock.invocationCallOrder[0]).toBeLessThan(
      secondReset.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps same-email verification on its original action and payload", async () => {
    let resolveVerification!: (value: {
      ok: true;
      message: string;
      targetEmail: string;
    }) => void;
    mocks.requestVerification.mockReturnValue(
      new Promise((resolve) => {
        resolveVerification = resolve;
      }),
    );
    const reset = vi.fn();
    const view = render(
      createElement(ProfilePanel, {
        model: profileModel,
        turnstileEnabled: true,
        turnstileSiteKey: "site-key",
      }),
    );
    const email = view.container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    const form = email.closest("form")!;

    expect(mocks.turnstileProps?.action).toBe("email_verification");
    act(() => {
      mocks.turnstileProps?.onReady({ reset });
      mocks.turnstileProps?.onToken("verification-token");
    });
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(mocks.requestVerification).toHaveBeenCalledOnce(),
    );
    expect(mocks.requestVerification).toHaveBeenCalledWith({
      email: "old@example.com",
      turnstileToken: "verification-token",
    });
    expect(mocks.changeEmail).not.toHaveBeenCalled();

    await act(async () => {
      resolveVerification({
        ok: true,
        message: "Код отправлен.",
        targetEmail: "old@example.com",
      });
      await Promise.resolve();
    });

    expect(mocks.navigateTo).toHaveBeenCalledWith("/verify-email");
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.requestVerification.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigateTo.mock.invocationCallOrder[0]!,
    );
    expect(mocks.navigateTo.mock.invocationCallOrder[0]).toBeLessThan(
      reset.mock.invocationCallOrder[0]!,
    );
  });
});
