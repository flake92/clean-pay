/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
}));

vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
}));
vi.mock("primereact/button", () => ({
  Button: (input: Record<string, unknown>) => {
    const props = { ...input };
    const label = props.label;
    for (const name of ["label", "loading", "outlined", "severity"]) {
      delete props[name];
    }
    return createElement("button", props, String(label ?? ""));
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", null, text),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  TurnstileWidget: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
  hasTurnstileSiteKey: (key?: string | null) => Boolean(key),
}));

import { RegisterEmailConfirmForm } from "@/frontend/components/register-email-confirm-form";

const paymentPath = "/payment?plan=pro&duration=30&gateway=card";

describe("registration e-mail continuation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      data: { confirmed: true },
    })));
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

  it("passes the exact payment selection into Passkey setup after confirmation", async () => {
    await act(async () => root.render(createElement(RegisterEmailConfirmForm, {
      redirectTo: paymentPath,
    })));
    const input = container.querySelector<HTMLInputElement>('input[name="code"]')!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "123456");

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/bff/auth/email/confirm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
  });

  it("keeps the payment selection when returning to registration", async () => {
    await act(async () => root.render(createElement(RegisterEmailConfirmForm, {
      redirectTo: paymentPath,
    })));
    const backButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Назад",
    )!;

    await act(async () => {
      backButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/bff/auth/logout",
      { method: "POST" },
    );
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/register?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
  });

  it("stays on verification when logout fails instead of entering a redirect loop", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      error: { code: "UPSTREAM_UNAVAILABLE", message: "try later" },
    }, { status: 503 }));
    await act(async () => root.render(createElement(RegisterEmailConfirmForm, {
      redirectTo: paymentPath,
    })));
    const backButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Назад",
    )!;

    await act(async () => {
      backButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.navigateTo).not.toHaveBeenCalled();
    expect(container.textContent).toContain("try later");
    expect(backButton.disabled).toBe(false);
  });

  it("atomically ignores a second confirmation action while the first is pending", async () => {
    let resolveRequest!: (response: Response) => void;
    const pendingRequest = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(() => pendingRequest);

    await act(async () => root.render(createElement(RegisterEmailConfirmForm, {
      redirectTo: paymentPath,
    })));

    const form = container.querySelector("form")!;
    const resendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Отправить код повторно",
    )!;

    await act(async () => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      resendButton.click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/bff/auth/email/confirm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .every((button) => button.disabled)).toBe(true);

    resolveRequest(Response.json({
      error: { code: "RATE_LIMITED", message: "try later" },
    }, { status: 429 }));
    await act(async () => {
      await pendingRequest;
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
