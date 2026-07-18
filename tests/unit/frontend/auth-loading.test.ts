/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = buttonProps.label;
    delete buttonProps.label;
    delete buttonProps.loading;
    return createElement("button", buttonProps, String(label ?? ""));
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

import { LoginForm } from "@/frontend/components/auth-forms";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe("login loading recovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(LoginForm)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops loading when identity lookup loses the network response", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network unavailable"));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email).not.toBeNull();

    await act(async () => setInputValue(email!, "user@example.com"));
    await submit(container.querySelector("form")!);

    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(container.textContent).toContain("Не удалось проверить e-mail");
  });

  it("stops loading and reports an unknown result after a login transport error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: { exists: true, hasPasskey: false } }))
      .mockRejectedValueOnce(new TypeError("response lost"));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;

    await act(async () => setInputValue(email, "user@example.com"));
    await submit(container.querySelector("form")!);

    const password = container.querySelector<HTMLInputElement>('input[name="password"]');
    expect(password).not.toBeNull();
    await act(async () => setInputValue(password!, "valid-password"));
    await submit(container.querySelector("form")!);

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.type === "submit",
    );
    expect(submitButton?.disabled).toBe(false);
    expect(container.textContent).toContain("Не удалось определить результат входа");
  });

  it("rejects a successful identity response with a non-JSON body without hanging", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;

    await act(async () => setInputValue(email, "user@example.com"));
    await submit(container.querySelector("form")!);

    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(container.textContent).toContain("Сервер вернул некорректный ответ");
  });
});
