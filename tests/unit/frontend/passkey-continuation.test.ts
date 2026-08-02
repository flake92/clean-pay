/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: mocks.startAuthentication,
  startRegistration: mocks.startRegistration,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
}));
vi.mock("primereact/button", () => ({
  Button: (input: Record<string, unknown>) => {
    const props = { ...input };
    const label = props.label;
    delete props.icon;
    delete props.label;
    delete props.loading;
    delete props.outlined;
    delete props.severity;
    return createElement("button", props, String(label ?? ""));
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) =>
    createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) =>
    createElement("div", { role: "alert" }, text),
}));

import {
  PasskeyLoginButton,
  PasskeySetupPanel,
} from "@/frontend/components/passkey-actions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const paymentPath = "/payment?plan=pro&duration=30&gateway=card";

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Passkey setup continuation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mocks.startRegistration.mockResolvedValue({
      id: "credential-1",
      rawId: "credential-1",
      response: {},
      type: "public-key",
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("returns to the exact payment after successful Passkey registration", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ data: { challenge: "challenge-1" } }),
      )
      .mockResolvedValueOnce(Response.json({ data: { verified: true } }));

    await act(async () =>
      root.render(
        createElement(PasskeySetupPanel, { redirectTo: paymentPath }),
      ),
    );
    const setupButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Настроить быстрый вход",
    )!;
    await click(setupButton);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/bff/auth/passkey/register/options",
      { method: "POST" },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/bff/auth/passkey/register/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.navigateTo).toHaveBeenCalledWith(paymentPath);
  });

  it("returns to the exact payment when optional Passkey setup is skipped", async () => {
    await act(async () =>
      root.render(
        createElement(PasskeySetupPanel, { redirectTo: paymentPath }),
      ),
    );
    const skipButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Продолжить без него",
    )!;
    await click(skipButton);

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.startRegistration).not.toHaveBeenCalled();
    expect(mocks.navigateTo).toHaveBeenCalledWith(paymentPath);
  });

  it("starts only one registration flow for same-tick clicks", async () => {
    let resolveOptions!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveOptions = resolve;
      }),
    );

    await act(async () =>
      root.render(createElement(PasskeySetupPanel)),
    );
    const setupButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Настроить быстрый вход",
    )!;

    await act(async () => {
      setupButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      setupButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.startRegistration).not.toHaveBeenCalled();

    await act(async () => {
      resolveOptions(
        Response.json(
          { error: { code: "UPSTREAM_UNAVAILABLE", message: "Unavailable" } },
          { status: 503 },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("starts only one authentication flow for same-tick clicks", async () => {
    let resolveOptions!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveOptions = resolve;
      }),
    );

    await act(async () =>
      root.render(createElement(PasskeyLoginButton)),
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const loginButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Войти быстро",
    )!;

    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.startAuthentication).not.toHaveBeenCalled();

    await act(async () => {
      resolveOptions(
        Response.json(
          { error: { code: "UPSTREAM_UNAVAILABLE", message: "Unavailable" } },
          { status: 503 },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
