/** @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", null, text),
}));
vi.mock("primereact/progressspinner", () => ({
  ProgressSpinner: () => createElement("span", null, "loading"),
}));

import { TurnstileWidget } from "@/frontend/components/turnstile-widget";

describe("Turnstile script loader", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("cloudflare-turnstile-script")?.remove();
    delete window.turnstile;
  });

  it("retries after the first script element fails", async () => {
    const firstView = render(createElement(TurnstileWidget, {
      action: "login",
      onToken: vi.fn(),
      siteKey: "site-key",
    }));
    const firstScript = document.getElementById("cloudflare-turnstile-script");
    expect(firstScript).not.toBeNull();

    firstScript?.dispatchEvent(new Event("error"));
    await firstView.findByText("Не удалось загрузить Cloudflare Turnstile.");
    expect(firstScript?.isConnected).toBe(false);
    firstView.unmount();

    const renderWidget = vi.fn(() => "widget-1");
    const retryView = render(createElement(TurnstileWidget, {
      action: "login",
      onToken: vi.fn(),
      siteKey: "site-key",
    }));
    const retryScript = document.getElementById("cloudflare-turnstile-script");
    expect(retryScript).not.toBeNull();
    expect(retryScript).not.toBe(firstScript);

    window.turnstile = {
      remove: vi.fn(),
      render: renderWidget,
      reset: vi.fn(),
    };
    retryScript?.dispatchEvent(new Event("load"));

    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());

    retryView.unmount();
    delete window.turnstile;
    const staleRenderWidget = vi.fn(() => "widget-2");
    render(createElement(TurnstileWidget, {
      action: "login",
      onToken: vi.fn(),
      siteKey: "site-key",
    }));
    const staleRetryScript = document.getElementById(
      "cloudflare-turnstile-script",
    );
    expect(staleRetryScript).not.toBe(retryScript);

    window.turnstile = {
      remove: vi.fn(),
      render: staleRenderWidget,
      reset: vi.fn(),
    };
    staleRetryScript?.dispatchEvent(new Event("load"));
    await waitFor(() => expect(staleRenderWidget).toHaveBeenCalledOnce());
  });

  it("cancels an HMR polling attempt when an existing script errors", async () => {
    const existing = document.createElement("script");
    existing.id = "cloudflare-turnstile-script";
    existing.dataset.cleanPayTurnstileState = "loading";
    document.head.appendChild(existing);

    const view = render(createElement(TurnstileWidget, {
      action: "login",
      onToken: vi.fn(),
      siteKey: "site-key",
    }));
    existing.dispatchEvent(new Event("error"));

    await view.findByText("Не удалось загрузить Cloudflare Turnstile.");
    expect(existing.isConnected).toBe(false);
  });
});
