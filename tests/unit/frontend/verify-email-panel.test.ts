/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("e-mail verification feedback", () => {
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
    expect(container.textContent).toContain("Синхронизация с Telegram");
    expect(container.querySelector('[data-severity="warn"]')).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });
});
