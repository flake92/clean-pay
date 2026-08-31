/** @vitest-environment jsdom */

import { act, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  navigateTo: vi.fn(),
  scrollIntoView: vi.fn(),
  updateReminders: vi.fn(),
}));

vi.mock("@/app/actions/profile", () => ({
  changeProfileEmailAction: mocks.changeEmail,
  changeProfilePasswordAction: mocks.changePassword,
  requestProfileEmailVerificationAction: vi.fn(),
  updateEmailReminderPreferenceAction: mocks.updateReminders,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({ navigateTo: mocks.navigateTo }));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: () => true,
  TurnstileWidget: () => null,
}));
vi.mock("@/frontend/components/prime/link-button", () => ({ LinkButton: () => null }));
vi.mock("primereact/card", () => ({
  Card: ({ children, title }: { children?: ReactNode; title?: string }) =>
    createElement("section", { "data-title": title }, children),
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ severity, text }: { severity?: string; text?: string }) =>
    createElement("div", { role: "alert", "data-severity": severity }, text),
}));
vi.mock("primereact/button", () => ({
  Button: (props: { label?: string; type?: "button" | "submit" }) =>
    createElement("button", { type: props.type ?? "button" }, props.label),
}));
vi.mock("primereact/password", () => ({
  Password: (props: Record<string, unknown>) => createElement("input", {
    onChange: props.onChange,
    required: props.required,
    type: "password",
    value: props.value,
  }),
}));
vi.mock("primereact/tag", () => ({ Tag: () => null }));

import { ProfilePanel } from "@/frontend/components/profile-panel";

describe("profile e-mail change feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.changeEmail.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Не удалось изменить e-mail.",
    });
    mocks.changePassword.mockResolvedValue({
      ok: false,
      code: "PASSWORD_UNCHANGED",
      message: "Новый пароль должен отличаться от текущего.",
    });
    mocks.updateReminders.mockResolvedValue({
      ok: true,
      message: "Напоминания включены.",
      preference: {
        enabled: true,
        emailEligible: true,
        senderEmail: "no-reply@example.com",
        daysBefore: [7, 3, 1],
      },
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: mocks.scrollIntoView,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the Sakai e-mail form shell and control order exact", async () => {
    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user: {
            authType: "email",
            email: "old@example.com",
            emailVerified: true,
            pendingEmail: null,
            telegramId: "777",
          },
          emailReminders: { status: "unavailable" },
        },
      }));
    });

    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    const emailForm = emailInput.closest("form")!;
    expect([...emailForm.children].map(({ tagName }) => tagName)).toEqual([
      "LABEL",
      "DIV",
    ]);
    expect(emailInput).toMatchObject({
      autocomplete: "email",
      maxLength: 255,
      name: "email",
      required: true,
      value: "old@example.com",
    });
    expect(emailForm.querySelector("label")?.textContent).toBe("Новый e-mail");
    expect(emailForm.querySelector("button")?.textContent).toBe("Сохранить и отправить код");
    expect(emailForm.querySelector("button")?.type).toBe("submit");
  });

  it("keeps the Sakai password form shell and control order exact", async () => {
    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user: {
            authType: "email",
            email: "old@example.com",
            emailVerified: true,
            pendingEmail: null,
            telegramId: "777",
          },
          emailReminders: { status: "unavailable" },
        },
      }));
    });

    const passwordInputs = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    expect(passwordInputs).toHaveLength(2);
    const passwordForm = passwordInputs[0].closest("form");
    expect(passwordForm).not.toBeNull();
    if (!passwordForm) throw new Error("Password form is absent.");
    expect([...passwordForm.children].map(({ tagName }) => tagName)).toEqual([
      "LABEL",
      "LABEL",
      "BUTTON",
    ]);
    expect([...passwordForm.querySelectorAll("label")].map(({ textContent }) => textContent)).toEqual([
      "Текущий пароль",
      "Новый пароль",
    ]);
    expect(passwordForm.querySelector("button")?.textContent).toBe("Изменить пароль");
    expect(passwordForm.querySelector("button")?.type).toBe("submit");
  });

  it("shows a failed change next to the e-mail form and brings it into view", async () => {
    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user: {
            authType: "email",
            email: "old@example.com",
            emailVerified: true,
            pendingEmail: null,
            telegramId: "777",
          },
          emailReminders: { status: "unavailable" },
        },
      }));
    });

    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(emailInput, "new@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const emailForm = container.querySelector('input[type="email"]')?.closest("form") ?? null;
    const alert = emailForm?.querySelector('[role="alert"]') ?? null;
    expect(mocks.changeEmail).toHaveBeenCalledWith({ email: "new@example.com" });
    expect(alert?.closest("form")).toBe(emailForm);
    expect(alert?.getAttribute("data-severity")).toBe("error");
    expect(alert?.textContent).toBe("Не удалось изменить e-mail.");
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it("shows a password failure only inside the password form", async () => {
    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user: {
            authType: "email",
            email: "old@example.com",
            emailVerified: true,
            pendingEmail: null,
            telegramId: "777",
          },
          emailReminders: { status: "unavailable" },
        },
      }));
    });

    const passwordInputs = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    await act(async () => {
      for (const [input, value] of passwordInputs.map((input, index) => [input, index === 0 ? "old-password" : "new-password"] as const)) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const forms = container.querySelectorAll("form");
    await act(async () => {
      forms[1]?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(mocks.changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password",
    });
    expect(forms[0]?.querySelector('[role="alert"]')).toBeNull();
    expect(forms[1]?.querySelector('[role="alert"]')?.textContent)
      .toBe("Новый пароль должен отличаться от текущего.");
  });

  it("shows the sender allowlist guidance and enables reminders explicitly", async () => {
    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user: {
            authType: "email",
            email: "old@example.com",
            // The upstream eligibility flag is authoritative. A stale local
            // verification snapshot must not block an otherwise valid opt-in.
            emailVerified: false,
            pendingEmail: null,
            telegramId: null,
          },
          emailReminders: {
            status: "ready",
            enabled: false,
            emailEligible: true,
            senderEmail: "no-reply@example.com",
            daysBefore: [7, 3, 1],
          },
        },
      }));
    });

    expect(container.textContent).toContain("не включают автопродление");
    expect(container.textContent).toContain("добавьте no-reply@example.com");
    const toggle = container.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(toggle.checked).toBe(false);

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });

    expect(mocks.updateReminders).toHaveBeenCalledWith(true);
    expect(toggle.checked).toBe(true);
    expect(container.textContent).toContain("Напоминания включены.");
  });

  it("synchronizes reminder preferences received by a soft server refresh", async () => {
    const user = {
      authType: "email",
      email: "old@example.com",
      emailVerified: true,
      pendingEmail: null,
      telegramId: null,
    };

    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user,
          emailReminders: { status: "unavailable" },
        },
      }));
    });
    expect(container.querySelector('[role="switch"]')).toBeNull();

    await act(async () => {
      root.render(createElement(ProfilePanel, {
        model: {
          status: "ready",
          user,
          emailReminders: {
            status: "ready",
            enabled: true,
            emailEligible: true,
            senderEmail: "no-reply@example.com",
            daysBefore: [7, 3, 1],
          },
        },
      }));
    });

    expect(container.querySelector<HTMLInputElement>('[role="switch"]')?.checked).toBe(true);
  });
});
