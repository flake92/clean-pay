/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));
vi.mock("primereact/button", () => ({
  Button: (input: Record<string, unknown>) => {
    const props = { ...input };
    const label = props.label;
    delete props.label;
    delete props.loading;
    delete props.severity;
    delete props.outlined;
    return createElement("button", props, String(label ?? ""));
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) =>
    createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({
    text,
    severity,
  }: {
    text?: string;
    severity?: string;
  }) => createElement("div", { role: "alert", "data-severity": severity }, text),
}));
vi.mock("primereact/password", () => ({
  Password: (input: Record<string, unknown>) => {
    const props = { ...input };
    delete props.feedback;
    delete props.inputClassName;
    delete props.toggleMask;
    return createElement("input", { ...props, type: "password" });
  },
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value?: string }) =>
    createElement("span", null, value),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  hasTurnstileSiteKey: () => false,
}));

import { LinkAccountPanel } from "@/frontend/components/link-account-panel";

const paymentPath = "/payment?plan=pro&duration=30&gateway=card";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function telegramOnlyResponses() {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        data: {
          user: {
            email: null,
            emailVerified: false,
            telegramId: "777",
          },
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { credentials: [] } }),
    );
}

describe("guided Telegram e-mail setup", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("explains the recovery purpose and asks for e-mail plus a confirmed password", async () => {
    telegramOnlyResponses();

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    expect(container.textContent).toContain("Вы вошли через Telegram");
    expect(container.textContent).toContain(
      "вернём вас к выбранной оплате",
    );
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
    expect(
      container
        .querySelector('input[name="password"]')
        ?.getAttribute("autocomplete"),
    ).toBe("new-password");
    expect(
      container
        .querySelector('input[name="password"]')
        ?.getAttribute("minlength"),
    ).toBe("8");
    expect(container.textContent).toContain(
      "Для нового e-mail придумайте пароль не короче 8 символов",
    );
    expect(
      container.querySelector('input[name="confirmPassword"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Сохранить e-mail и пароль");
    expect(container.textContent).not.toContain("Перепроверить связь Telegram");
    expect(container.textContent).not.toContain("Настроить");
  });

  it("returns an expired initial session to login with the setup and payment continuation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Session is required",
          },
        },
        { status: 401 },
      ),
    );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    const loginDestination =
      "/login?redirect_to=%2Flink-account%3Freason%3Demail-required%26redirect_to%3D%252Fpayment%253Fplan%253Dpro%2526duration%253D30%2526gateway%253Dcard";

    expect(mocks.replaceWith).toHaveBeenCalledWith(loginDestination);
    expect(container.textContent).toContain(
      "Сессия завершилась. Войдите снова",
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      loginDestination,
    );
  });

  it("does not call the link endpoint when password confirmation differs", async () => {
    telegramOnlyResponses();

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="email"]')!,
        "user@example.com",
      );
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="password"]')!,
        "correct-password",
      );
      setInputValue(
        container.querySelector<HTMLInputElement>(
          'input[name="confirmPassword"]',
        )!,
        "different-password",
      );
    });
    await submit(container.querySelector("form")!);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Пароли не совпадают");
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it("sends only e-mail and password, then preserves payment through verification", async () => {
    telegramOnlyResponses();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        data: { linked: false, pendingVerification: true },
      }),
    );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    for (const [name, value] of Object.entries({
      email: "user@example.com",
      password: "correct-password",
      confirmPassword: "correct-password",
    })) {
      await act(async () =>
        setInputValue(
          container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!,
          value,
        ),
      );
    }
    await submit(container.querySelector("form")!);

    const linkCall = vi.mocked(fetch).mock.calls[2]!;
    expect(linkCall[0]).toBe("/api/bff/link/remnashop");
    expect(JSON.parse(String(linkCall[1]?.body))).toEqual({
      email: "user@example.com",
      password: "correct-password",
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
  });

  it("returns a session that expires during submit to the same guided step", async () => {
    telegramOnlyResponses();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Session is required",
          },
        },
        { status: 401 },
      ),
    );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    for (const [name, value] of Object.entries({
      email: "user@example.com",
      password: "correct-password",
      confirmPassword: "correct-password",
    })) {
      await act(async () =>
        setInputValue(
          container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!,
          value,
        ),
      );
    }
    await submit(container.querySelector("form")!);
    await settle();

    expect(mocks.replaceWith).toHaveBeenCalledWith(
      "/login?redirect_to=%2Flink-account%3Freason%3Demail-required%26redirect_to%3D%252Fpayment%253Fplan%253Dpro%2526duration%253D30%2526gateway%253Dcard",
    );
    expect(container.textContent).toContain("Войти и продолжить");
    expect(container.querySelector("form")).toBeNull();
  });

  it("keeps an invalid existing password in the form instead of treating it as an expired session", async () => {
    telegramOnlyResponses();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "AUTH_FAILED",
              message: "Неверный e-mail или пароль.",
            },
          },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: null,
              emailVerified: false,
              telegramId: "777",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { credentials: [] } }),
      );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    for (const [name, value] of Object.entries({
      email: "existing@example.com",
      password: "wrong-password",
      confirmPassword: "wrong-password",
    })) {
      await act(async () =>
        setInputValue(
          container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!,
          value,
        ),
      );
    }
    await submit(container.querySelector("form")!);
    await settle();

    expect(container.textContent).toContain("Неверный e-mail или пароль.");
    expect(container.querySelector("form")).not.toBeNull();
    expect(mocks.replaceWith).not.toHaveBeenCalled();
  });

  it("returns an already verified e-mail account directly to the payment", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "owner@example.com",
              emailVerified: true,
              telegramId: "777",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { credentials: [] } }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { linked: true } }),
      );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    expect(container.querySelector('input[name="email"]')?.getAttribute("type"))
      .toBe("hidden");
    expect(
      container.querySelector('input[name="confirmPassword"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('input[name="password"]')
        ?.getAttribute("autocomplete"),
    ).toBe("current-password");
    expect(
      container
        .querySelector('input[name="password"]')
        ?.getAttribute("minlength"),
    ).toBe("1");
    await act(async () =>
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="password"]')!,
        "existing-password",
      ),
    );
    await submit(container.querySelector("form")!);

    const linkCall = vi.mocked(fetch).mock.calls[2]!;
    expect(linkCall[0]).toBe("/api/bff/link/remnashop");
    expect(JSON.parse(String(linkCall[1]?.body))).toEqual({
      email: "owner@example.com",
      password: "existing-password",
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/payment?plan=pro&duration=30&gateway=card&account_setup=account-ready",
    );
  });

  it("continues an already pending e-mail with the same payment destination", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "pending@example.com",
              emailVerified: false,
              telegramId: "777",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { credentials: [] } }),
      );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    expect(container.querySelector("form")).toBeNull();
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Подтвердить e-mail",
    )!;
    await act(async () => confirmButton.click());

    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
  });

  it("asks for the current password when a pending Telegram session lost its proof", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "pending@example.com",
              emailVerified: false,
              telegramId: "777",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { credentials: [] } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: { linked: false, pendingVerification: true },
        }),
      );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          passwordRequired: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    expect(container.textContent).toContain(
      "Сессия подтверждения изменилась",
    );
    expect(container.querySelector("form")).not.toBeNull();
    await act(async () =>
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="password"]')!,
        "pending-email-password",
      ),
    );
    await submit(container.querySelector("form")!);

    const linkCall = vi.mocked(fetch).mock.calls[2]!;
    expect(linkCall[0]).toBe("/api/bff/link/remnashop");
    expect(JSON.parse(String(linkCall[1]?.body))).toEqual({
      email: "pending@example.com",
      password: "pending-email-password",
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
  });

  it("accepts an existing short password when the pending e-mail belongs to another local user", async () => {
    telegramOnlyResponses();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        data: { linked: false, pendingVerification: true },
      }),
    );

    await act(async () =>
      root.render(
        createElement(LinkAccountPanel, {
          guided: true,
          passwordRequired: true,
          redirectTo: paymentPath,
        }),
      ),
    );
    await settle();

    const passwordInput = container.querySelector<HTMLInputElement>(
      'input[name="password"]',
    )!;
    expect(passwordInput.getAttribute("autocomplete")).toBe(
      "current-password",
    );
    expect(passwordInput.getAttribute("minlength")).toBe("1");
    const confirmPasswordInput =
      container.querySelector<HTMLInputElement>(
        'input[name="confirmPassword"]',
      )!;
    expect(confirmPasswordInput).not.toBeNull();

    await act(async () => {
      setInputValue(
        container.querySelector<HTMLInputElement>('input[name="email"]')!,
        "existing@example.com",
      );
      setInputValue(passwordInput, "short");
      setInputValue(confirmPasswordInput, "short");
    });
    await submit(container.querySelector("form")!);

    const linkCall = vi.mocked(fetch).mock.calls[2]!;
    expect(JSON.parse(String(linkCall[1]?.body))).toEqual({
      email: "existing@example.com",
      password: "short",
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
  });

  it("preserves the original nonguided verification route", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          data: {
            user: {
              email: "pending@example.com",
              emailVerified: false,
              telegramId: "777",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { credentials: [] } }),
      );

    await act(async () =>
      root.render(createElement(LinkAccountPanel)),
    );
    await settle();

    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Подтвердить e-mail",
    )!;
    await act(async () => confirmButton.click());

    expect(mocks.navigateTo).toHaveBeenCalledWith("/verify-email");
  });
});
