/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
}));

vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));
vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = buttonProps.label;
    delete buttonProps.label;
    delete buttonProps.loading;
    delete buttonProps.severity;
    return createElement("button", buttonProps, String(label ?? ""));
  },
}));
vi.mock("primereact/card", () => ({
  Card: ({ title, children }: { title?: string; children?: ReactNode }) =>
    createElement("section", null, createElement("h2", null, title), children),
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text, severity }: { text?: string; severity?: string }) =>
    createElement("div", { role: "alert", "data-severity": severity }, text),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  hasTurnstileSiteKey: () => false,
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) =>
    createElement("a", { href }, label),
}));

import { VerifyEmailPanel } from "@/frontend/components/verify-email-panel";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("e-mail verification feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("does not offer another code submission when the e-mail is already verified", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      data: { user: { email: "verified@example.com", emailVerified: true } },
    }));

    await act(async () => root.render(createElement(VerifyEmailPanel)));
    await flush();

    expect(container.textContent).toContain("E-mail уже подтверждён");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Перейти в профиль");
  });

  it("renders a confirmation error before the forms instead of below the fold", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        data: { user: { email: "user@example.com", emailVerified: false } },
      }))
      .mockResolvedValueOnce(Response.json({
        error: { code: "EMAIL_CODE_INVALID", message: "Код не подошёл." },
      }, { status: 400 }));

    await act(async () => root.render(createElement(VerifyEmailPanel)));
    await flush();
    const code = container.querySelector<HTMLInputElement>('input[name="code"]')!;
    await act(async () => setInputValue(code, "123456"));
    await submit(container.querySelector("form")!);

    const alert = container.querySelector<HTMLElement>('[role="alert"]')!;
    const firstForm = container.querySelector("form")!;
    expect(alert.textContent).toContain("Код не подошёл");
    expect(alert.compareDocumentPosition(firstForm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reports verified e-mail as success even when account synchronization is pending", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        data: { user: { email: "user@example.com", emailVerified: false } },
      }))
      .mockResolvedValueOnce(Response.json({
        data: {
          success: true,
          email: "user@example.com",
          account_sync_pending: true,
        },
      }));

    await act(async () => root.render(createElement(VerifyEmailPanel)));
    await flush();
    const code = container.querySelector<HTMLInputElement>('input[name="code"]')!;
    await act(async () => setInputValue(code, "123456"));
    await submit(container.querySelector("form")!);

    expect(container.textContent).toContain("E-mail подтверждён");
    expect(container.textContent).toContain("Синхронизация аккаунта");
    expect(container.querySelector('[data-severity="warn"]')).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("verifies convergence and returns a guided flow to the exact payment", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        data: { user: { email: "user@example.com", emailVerified: false } },
      }))
      .mockResolvedValueOnce(Response.json({
        data: {
          success: true,
          email: "user@example.com",
          account_sync_pending: false,
        },
      }))
      .mockResolvedValueOnce(Response.json({
        data: { user: { email: "user@example.com", emailVerified: true } },
      }));

    await act(async () =>
      root.render(
        createElement(VerifyEmailPanel, {
          autoContinue: true,
          redirectTo: "/payment?plan=pro&duration=30&gateway=card",
        }),
      ),
    );
    await flush();
    await act(async () =>
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="code"]')!,
        "123456",
      ),
    );
    await submit(container.querySelector("form")!);

    expect(mocks.replaceWith).toHaveBeenCalledWith(
      "/payment?plan=pro&duration=30&gateway=card&account_setup=account-ready",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Возвращаем");
  });

  it("does not return to payment while post-confirm synchronization is pending", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        data: { user: { email: "user@example.com", emailVerified: false } },
      }))
      .mockResolvedValueOnce(Response.json({
        data: {
          success: true,
          email: "user@example.com",
          account_sync_pending: true,
        },
      }));

    await act(async () =>
      root.render(
        createElement(VerifyEmailPanel, {
          autoContinue: true,
          redirectTo: "/payment?plan=pro",
        }),
      ),
    );
    await flush();
    await act(async () =>
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="code"]')!,
        "123456",
      ),
    );
    await submit(container.querySelector("form")!);

    expect(mocks.replaceWith).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Синхронизация с Telegram ещё продолжается",
    );
    expect(container.textContent).toContain("Проверить и продолжить");
  });

  it("waits for account_sync_pending to clear before returning to payment", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "user@example.com",
              emailVerified: true,
              accountSyncPending: true,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "user@example.com",
              emailVerified: true,
              accountSyncPending: true,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "user@example.com",
              emailVerified: true,
              accountSyncPending: false,
            },
          },
        }),
      );

    await act(async () =>
      root.render(
        createElement(VerifyEmailPanel, {
          autoContinue: true,
          redirectTo: "/payment?plan=pro",
        }),
      ),
    );
    await flush();

    const checkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Проверить и продолжить",
    )!;
    await click(checkButton);
    expect(mocks.replaceWith).not.toHaveBeenCalled();
    expect(container.textContent).toContain("ещё не завершена");

    await click(checkButton);
    expect(mocks.replaceWith).toHaveBeenCalledWith(
      "/payment?plan=pro&account_setup=account-ready",
    );
  });

  it("returns a guided EMAIL_REQUIRED response to e-mail and password setup", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          data: { user: { email: "user@example.com", emailVerified: false } },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "EMAIL_REQUIRED",
              message: "Связь с e-mail потеряна.",
            },
          },
          { status: 401 },
        ),
      );

    await act(async () =>
      root.render(
        createElement(VerifyEmailPanel, {
          autoContinue: true,
          redirectTo: "/payment?plan=pro",
        }),
      ),
    );
    await flush();
    await act(async () =>
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="code"]')!,
        "123456",
      ),
    );
    await submit(container.querySelector("form")!);

    expect(mocks.replaceWith).toHaveBeenCalledWith(
      "/link-account?reason=email-required&step=password&redirect_to=%2Fpayment%3Fplan%3Dpro",
    );
  });

  it("sends a terminal merge conflict to support without retrying payment", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "ACCOUNT_MERGE_REQUIRED",
            message: "Merge conflict.",
          },
        },
        { status: 409 },
      ),
    );

    await act(async () =>
      root.render(
        createElement(VerifyEmailPanel, {
          autoContinue: true,
          redirectTo: "/payment?plan=pro",
        }),
      ),
    );
    await flush();

    expect(container.textContent).toContain("обратитесь в поддержку");
    expect(
      Array.from(container.querySelectorAll("a")).find(
        (link) => link.textContent === "Обратиться в поддержку",
      )?.getAttribute("href"),
    ).toBe("/support");
    expect(mocks.replaceWith).not.toHaveBeenCalled();
  });

  it("retries unavailable readiness before deciding whether the code is still required", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "Remnashop unavailable.",
            },
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "user@example.com",
              emailVerified: false,
              accountSyncPending: false,
            },
          },
        }),
      );

    await act(async () =>
      root.render(
        createElement(VerifyEmailPanel, {
          autoContinue: true,
          redirectTo: "/payment?plan=pro",
        }),
      ),
    );
    await flush();

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(
      "Пока не вводите код повторно",
    );
    expect(container.textContent).toContain("Проверить и продолжить");
    expect(mocks.replaceWith).not.toHaveBeenCalled();

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Проверить и продолжить",
    )!;
    await click(retryButton);

    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    expect(container.textContent).toContain("E-mail ещё не подтверждён");
  });

  it("does not overlap code confirmation and resend in the same tick", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        data: { user: { email: "user@example.com", emailVerified: false } },
      }),
    );
    let resolveConfirmation!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveConfirmation = resolve;
      }),
    );

    await act(async () => root.render(createElement(VerifyEmailPanel)));
    await flush();
    const [confirmForm, requestForm] = container.querySelectorAll("form");

    await act(async () => {
      confirmForm!.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
      requestForm!.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      "/api/bff/auth/email/confirm",
    );
    expect(
      [...container.querySelectorAll("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);

    await act(async () => {
      resolveConfirmation(
        Response.json(
          { error: { code: "EMAIL_CODE_INVALID", message: "Invalid code" } },
          { status: 400 },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("starts only one readiness check for same-tick continue clicks", async () => {
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
    let resolveReadiness!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveReadiness = resolve;
      }),
    );

    await act(async () =>
      root.render(
        createElement(VerifyEmailPanel, {
          autoContinue: true,
          redirectTo: "/payment?plan=pro",
        }),
      ),
    );
    await flush();
    const continueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Проверить и продолжить",
    )!;

    await act(async () => {
      continueButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      continueButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveReadiness(
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
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
