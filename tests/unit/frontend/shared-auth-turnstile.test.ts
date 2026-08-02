/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("primereact/button", () => ({
  Button: ({ label, ...props }: Record<string, unknown>) => {
    delete props.icon;
    delete props.loading;
    delete props.severity;
    return createElement("button", props, String(label ?? ""));
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", null, text),
}));
vi.mock("primereact/password", () => ({
  Password: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("@/frontend/components/passkey-actions", () => ({
  PasskeyLoginButton: () => createElement("button", { type: "button" }, "Войти быстро"),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  TurnstileWidget: ({ action }: { action: string }) =>
    createElement("div", { "data-turnstile-action": action }),
  hasTurnstileSiteKey: (siteKey?: string | null) => Boolean(siteKey),
}));

import {
  AuthTurnstileProvider,
  LoginForm,
  TelegramLoginButton,
} from "@/frontend/components/auth-forms";

describe("shared authentication Turnstile", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders one challenge for e-mail, Passkey and Telegram", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const TestProvider = AuthTurnstileProvider as (props: {
      enabled: boolean;
      siteKey?: string | null;
      children?: ReactNode;
    }) => ReactNode;

    await act(async () => {
      root.render(
        createElement(
          TestProvider,
          { enabled: true, siteKey: "site-key" },
          createElement(
            "div",
            null,
            createElement(LoginForm),
            createElement(TelegramLoginButton),
          ),
        ),
      );
    });

    const challenges = container.querySelectorAll("[data-turnstile-action]");
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.getAttribute("data-turnstile-action")).toBe("auth_login");
    expect(container.textContent).not.toContain("Ответ одинаков");
    expect(container.textContent).not.toMatch(/Remnashop|Remnawave/i);

    await act(async () => root.unmount());
  });
});
