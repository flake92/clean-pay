/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("primereact/button", () => ({
  Button: ({ label, ...props }: Record<string, unknown>) => {
    delete props.loading;
    delete props.text;
    return createElement("button", props, String(label ?? ""));
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("primereact/password", () => ({
  Password: (props: Record<string, unknown>) => {
    const inputProps = { ...props };
    delete inputProps.feedback;
    delete inputProps.inputClassName;
    delete inputProps.toggleMask;
    return createElement("input", { ...inputProps, type: "password" });
  },
}));
vi.mock("@/frontend/components/passkey-actions", () => ({
  PasskeyLoginButton: () => null,
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  hasTurnstileSiteKey: () => false,
}));

import { LoginForm, RegisterForm } from "@/frontend/components/auth-forms";

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe.each([
  ["login", LoginForm],
  ["registration alias", RegisterForm],
])("generic email %s loading recovery", (_label, Component) => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Component)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops loading after a start transport failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network unavailable"));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => setInputValue(email, "user@example.com"));
    await submit(container.querySelector("form")!);

    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    expect(container.textContent).toContain("Не удалось определить результат входа");
  });

  it("atomically ignores a same-tick duplicate start request", async () => {
    let resolveRequest!: (response: Response) => void;
    const pendingRequest = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(() => pendingRequest);
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => setInputValue(email, "user@example.com"));
    const form = container.querySelector("form")!;

    await act(async () => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled)
      .toBe(true);

    resolveRequest(Response.json({ data: { success: true } }, { status: 202 }));
    await act(async () => {
      await pendingRequest;
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the generic start endpoint and reveals no account branch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: { success: true } }, { status: 202 }));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => setInputValue(email, "user@example.com"));
    await submit(container.querySelector("form")!);

    expect(fetch).toHaveBeenCalledWith("/api/bff/auth/email/start", expect.any(Object));
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')).not.toBeNull();
    expect(container.textContent).toContain("Введите код из письма");
  });

  it("offers password recovery only after an existing account rejects its password", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: { success: true } }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        error: { code: "AUTH_FAILED", message: "Неверный пароль." },
      }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: { success: true } }, { status: 202 }));

    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => setInputValue(email, "existing@example.com"));
    await submit(container.querySelector("form")!);

    const inputs = container.querySelectorAll<HTMLInputElement>("input");
    await act(async () => {
      setInputValue(Array.from(inputs).find((input) => input.name === "code")!, "123456");
      setInputValue(Array.from(inputs).find((input) => input.name === "password")!, "wrong-password");
    });
    await submit(container.querySelector("form")!);

    const recoveryButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Забыли пароль?");
    expect(recoveryButton).toBeDefined();

    await act(async () => recoveryButton!.click());
    expect(container.textContent).toContain("отдельный код для восстановления");
    await submit(container.querySelector("form")!);

    expect(fetch).toHaveBeenLastCalledWith(
      "/api/bff/auth/password/reset/start",
      expect.objectContaining({ method: "POST" }),
    );
    expect(container.textContent).toContain("задайте новый пароль");
  });

  it("does not offer recovery for an invalid e-mail code", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: { success: true } }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        error: { code: "EMAIL_CODE_INVALID", message: "Неверный код." },
      }, { status: 400 }));

    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => setInputValue(email, "user@example.com"));
    await submit(container.querySelector("form")!);
    const inputs = container.querySelectorAll<HTMLInputElement>("input");
    await act(async () => {
      setInputValue(Array.from(inputs).find((input) => input.name === "code")!, "000000");
      setInputValue(Array.from(inputs).find((input) => input.name === "password")!, "some-password");
    });
    await submit(container.querySelector("form")!);

    expect(container.textContent).not.toContain("Забыли пароль?");
  });
});
