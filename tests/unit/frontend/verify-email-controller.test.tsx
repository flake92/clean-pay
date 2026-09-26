/** @vitest-environment jsdom */

import { createElement } from "react";
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkAccountReadinessAction: vi.fn(),
  confirmEmailVerificationCodeAction: vi.fn(),
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
  requestEmailVerificationCodeAction: vi.fn(),
}));

vi.mock("@/app/actions/email-verification", () => ({
  checkAccountReadinessAction: mocks.checkAccountReadinessAction,
  confirmEmailVerificationCodeAction:
    mocks.confirmEmailVerificationCodeAction,
  requestEmailVerificationCodeAction:
    mocks.requestEmailVerificationCodeAction,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
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
vi.mock("primereact/card", () => ({
  Card: ({ children, title }: { children?: ReactNode; title?: string }) =>
    createElement("section", { "data-title": title }, children),
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) =>
    createElement("div", { role: "alert" }, text),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) =>
    createElement("a", { href }, label),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: (value?: string | null) => Boolean(value),
  TurnstileWidget: () => createElement("div", { "data-testid": "turnstile" }),
}));

import { VerifyEmailPanel } from "@/frontend/components/verify-email-panel";

describe("verify-email controller characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it("preserves entry-view DOM order, classes, copy and controls", () => {
    const view = render(createElement(VerifyEmailPanel));
    const root = view.container.firstElementChild;

    expect(root?.className).toBe("flex flex-column gap-4");
    expect(
      [...view.container.querySelectorAll("section")]
        .map((section) => section.getAttribute("data-title")),
    ).toEqual([
      "Введите код из письма",
      "Отправить код повторно",
    ]);
    expect(screen.getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Подтвердить e-mail", "Отправить код повторно"]);
    expect(screen.getByPlaceholderText("000000").getAttribute("pattern"))
      .toBe("[0-9]{6}");
    expect(screen.getByPlaceholderText("user@example.com"))
      .toHaveProperty("type", "email");
  });

  it("keeps EMAIL_REQUIRED silent outside guided recovery", async () => {
    mocks.requestEmailVerificationCodeAction.mockResolvedValueOnce({
      ok: false,
      code: "EMAIL_REQUIRED",
      message: "provider detail must stay hidden",
    });
    const user = userEvent.setup();
    render(createElement(VerifyEmailPanel));

    await user.type(
      screen.getByPlaceholderText("user@example.com"),
      "owner@example.com",
    );
    await user.click(screen.getByRole("button", {
      name: "Отправить код повторно",
    }));

    await waitFor(() => {
      expect(mocks.requestEmailVerificationCodeAction).toHaveBeenCalledWith({
        email: "owner@example.com",
      });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.replaceWith).not.toHaveBeenCalled();
  });

  it("preserves guided EMAIL_REQUIRED feedback and redirect", async () => {
    mocks.requestEmailVerificationCodeAction.mockResolvedValueOnce({
      ok: false,
      code: "EMAIL_REQUIRED",
      message: "provider detail must stay hidden",
    });
    const user = userEvent.setup();
    render(createElement(VerifyEmailPanel, {
      autoContinue: true,
      redirectTo: "/tariffs",
    }));

    await user.click(screen.getByRole("button", {
      name: "Отправить код повторно",
    }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Связь с e-mail нужно восстановить. Возвращаем к вводу e-mail и пароля.",
      );
    });
    expect(mocks.replaceWith).toHaveBeenCalledWith(
      "/link-account?reason=email-required&step=password&redirect_to=%2Ftariffs",
    );
  });

  it("fences duplicate request submissions while preserving payload", async () => {
    let resolveRequest!: (value: {
      ok: true;
      kind: "code-sent";
      targetEmail: string;
    }) => void;
    mocks.requestEmailVerificationCodeAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const view = render(createElement(VerifyEmailPanel));
    const email = screen.getByPlaceholderText("user@example.com");
    fireEvent.change(email, { target: { value: "owner@example.com" } });
    const requestForm = view.container.querySelectorAll("form")[1]!;

    fireEvent.submit(requestForm);
    fireEvent.submit(requestForm);
    expect(mocks.requestEmailVerificationCodeAction).toHaveBeenCalledOnce();
    expect(mocks.requestEmailVerificationCodeAction).toHaveBeenCalledWith({
      email: "owner@example.com",
    });

    resolveRequest({
      ok: true,
      kind: "code-sent",
      targetEmail: "owner@example.com",
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent)
        .toBe("Код отправлен на owner@example.com.");
    });
  });
});
