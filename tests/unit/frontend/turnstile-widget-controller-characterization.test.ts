/** @vitest-environment jsdom */

import { createElement } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadScript: vi.fn(),
}));

vi.mock("@/frontend/lib/turnstile-loader", () => ({
  loadTurnstileScript: () => mocks.loadScript(),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", null, text),
}));
vi.mock("primereact/progressspinner", () => ({
  ProgressSpinner: () => createElement("span", null, "loading"),
}));

import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/frontend/components/turnstile-widget";

type TurnstileApi = NonNullable<Window["turnstile"]>;
type TurnstileOptions = Parameters<TurnstileApi["render"]>[1];

describe("Turnstile widget controller characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadScript.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    delete window.turnstile;
  });

  it("preserves SDK options, callbacks, reset order, and owned cleanup", async () => {
    const events: string[] = [];
    let options: TurnstileOptions | undefined;
    let handle: TurnstileHandle | undefined;
    const remove = vi.fn((widgetId: string) => events.push(`remove:${widgetId}`));
    const reset = vi.fn((widgetId: string) => events.push(`reset:${widgetId}`));
    const renderWidget = vi.fn((container: HTMLElement, next: TurnstileOptions) => {
      expect(container.className).toBe("turnstile-widget-container");
      options = next;
      events.push("render");
      return "widget-1";
    });
    window.turnstile = { remove, render: renderWidget, reset };
    const onToken = vi.fn((token: string | null) => {
      events.push(`token:${token ?? "null"}`);
    });
    const view = render(createElement(TurnstileWidget, {
      action: "auth_login",
      onReady: (next: TurnstileHandle) => {
        handle = next;
        events.push("ready");
      },
      onToken,
      siteKey: "site-key",
    }));

    expect(screen.getByText("Загрузка проверки безопасности...")).toBeTruthy();
    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
    expect(options).toMatchObject({
      action: "auth_login",
      sitekey: "site-key",
      size: "flexible",
    });
    expect(events).toEqual(["render", "ready"]);
    expect(screen.queryByText("Загрузка проверки безопасности...")).toBeNull();

    act(() => options?.callback("challenge-token"));
    expect(onToken).toHaveBeenLastCalledWith("challenge-token");

    act(() => options?.["expired-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);

    act(() => options?.["error-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Не удалось пройти проверку Cloudflare Turnstile."))
      .toBeTruthy();

    act(() => handle?.reset());
    expect(reset).toHaveBeenCalledWith("widget-1");
    expect(events.slice(-2)).toEqual(["reset:widget-1", "token:null"]);

    view.unmount();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("widget-1");
  });

  it("ignores a late SDK load after unmount", async () => {
    let resolveScript!: () => void;
    mocks.loadScript.mockReturnValue(new Promise<void>((resolve) => {
      resolveScript = resolve;
    }));
    const renderWidget = vi.fn(() => "widget-late");
    const remove = vi.fn();
    window.turnstile = {
      remove,
      render: renderWidget,
      reset: vi.fn(),
    };
    const onReady = vi.fn();
    const view = render(createElement(TurnstileWidget, {
      action: "auth_login",
      onReady,
      onToken: vi.fn(),
      siteKey: "site-key",
    }));

    view.unmount();
    await act(async () => resolveScript());

    expect(renderWidget).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
