/** @vitest-environment jsdom */

import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetTurnstile = vi.fn();

vi.mock("primereact/button", () => ({
  Button: (input: Record<string, unknown>) => {
    const props = { ...input };
    const label = props.label;
    delete props.label;
    delete props.loading;
    delete props.severity;
    return createElement("button", props, String(label ?? ""));
  },
}));
vi.mock("primereact/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => createElement("section", null, children),
}));
vi.mock("primereact/inputtext", () => ({ InputText: (props: Record<string, unknown>) => createElement("input", props) }));
vi.mock("primereact/message", () => ({ Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text) }));
vi.mock("primereact/password", () => ({ Password: (props: Record<string, unknown>) => createElement("input", props) }));
vi.mock("primereact/tag", () => ({ Tag: ({ value }: { value?: string }) => createElement("span", null, value) }));
vi.mock("@/frontend/components/prime/link-button", () => ({ LinkButton: () => null }));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  hasTurnstileSiteKey: (key?: string | null) => Boolean(key),
  TurnstileWidget: ({ onReady, onToken }: {
    onReady?: (handle: { reset: () => void }) => void;
    onToken: (token: string | null) => void;
  }) => {
    useEffect(() => onReady?.({ reset: resetTurnstile }), [onReady]);
    return createElement("button", {
      "data-testid": "turnstile",
      onClick: () => onToken("profile-turnstile-token"),
      type: "button",
    }, "Turnstile");
  },
}));

import { ProfilePanel } from "@/frontend/components/profile-panel";

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe("profile e-mail Turnstile policy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetTurnstile.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({
      data: {
        user: {
          email: "user@example.com",
          emailVerified: true,
          telegram_id: null,
          auth_type: "email",
          is_email_verified: true,
          pending_email: null,
          language: "ru",
        },
      },
    })));
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

  it("blocks submission without a token, sends it once and resets after a response", async () => {
    await act(async () => root.render(createElement(ProfilePanel, {
      turnstileEnabled: true,
      turnstileSiteKey: "site-key",
    })));
    await flush();
    const form = container.querySelector("form")!;
    const email = form.querySelector('input[type="email"]') as HTMLInputElement;
    await act(async () => setInputValue(email, "next@example.com"));

    await submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      (container.querySelector('[data-testid="turnstile"]') as HTMLButtonElement).click();
    });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      error: { code: "CONFLICT", message: "already used" },
    }, { status: 409 }));
    await submit(form);
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    const request = vi.mocked(fetch).mock.calls[1]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      email: "next@example.com",
      turnstileToken: "profile-turnstile-token",
      "cf-turnstile-response": "profile-turnstile-token",
    });
    expect(resetTurnstile).toHaveBeenCalledOnce();
  });
});
