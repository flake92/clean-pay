/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  activatePromocodeAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actionMocks.refresh }) }));
vi.mock("@/app/actions/cabinet", () => ({
  activatePromocodeAction: actionMocks.activatePromocodeAction,
  deleteAllDevicesAction: vi.fn(),
  deleteDeviceAction: vi.fn(),
  logoutAction: vi.fn(),
  reissueSubscriptionAction: vi.fn(),
}));

vi.mock("primereact/button", () => ({
  Button: (props: Record<string, unknown>) => {
    const buttonProps = { ...props };
    const label = buttonProps.label;

    for (const name of ["icon", "label", "loading", "outlined", "severity", "size"]) {
      delete buttonProps[name];
    }

    return createElement("button", buttonProps, String(label ?? ""));
  },
}));
vi.mock("primereact/column", () => ({
  Column: () => null,
}));
vi.mock("primereact/datatable", () => ({
  DataTable: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) =>
    createElement("div", { role: "alert" }, text),
}));
vi.mock("primereact/progressbar", () => ({
  ProgressBar: () => createElement("div"),
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value?: string }) => createElement("span", null, value),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ label }: { label: string }) => createElement("a", null, label),
}));
import { CabinetPanel } from "@/frontend/components/cabinet-panel";
import type { CabinetViewModel } from "@/application/models/cabinet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function cabinetModel(
  paymentHistoryStatus: "current" | "refreshing" | "unavailable" = "current",
): CabinetViewModel {
  return {
    status: "ready",
    user: { email: "user@example.com", emailVerified: true, telegramId: "777" },
    subscription: null,
    subscriptionError: null,
    offers: {
      gateways: [],
      plans: [],
      has_current_subscription: false,
      current_subscription_status: null,
    },
    devices: { devices: [], current_count: 0, max_count: 0 },
    payments: [],
    paymentHistoryStatus,
    support: {
      enabled: false,
      email: null,
      telegramUsername: null,
      faqUrl: null,
      liveChatEnabled: false,
    },
  };
}

describe("cabinet promocode activation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    actionMocks.activatePromocodeAction.mockResolvedValue({
      status: "success",
      message: "Промокод активирован. Данные кабинета обновлены.",
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(CabinetPanel, {
      model: cabinetModel(),
    })));
    await settle();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("shows activation when there is no current subscription", () => {
    expect(container.textContent).toContain("Подписка не активна");
    expect(container.textContent).not.toContain("Детали подписки");
    expect(container.querySelector<HTMLLabelElement>('label[for="promocode"]')?.textContent)
      .toBe("Введите промокод");
    expect(container.querySelector<HTMLInputElement>("#promocode")?.placeholder)
      .toBe("Введите код");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Активировать",
      ),
    ).toBe(true);
  });

  it("shows validation feedback without calling the API for an empty code", async () => {
    const form = container.querySelector<HTMLFormElement>("#promocode")?.closest("form");
    expect(form).not.toBeNull();

    await submit(form!);
    await settle();

    expect(container.textContent).toContain("Введите промокод.");
    expect(
      actionMocks.activatePromocodeAction.mock.calls.length > 0,
    ).toBe(false);
  });

  it("activates a code and refreshes cabinet data without a subscription", async () => {
    const input = container.querySelector<HTMLInputElement>("#promocode")!;
    const form = input.closest("form")!;

    await setInputValue(input, "  WELCOME-2026  ");
    await submit(form);
    await settle();

    expect(actionMocks.activatePromocodeAction).toHaveBeenCalledOnce();
    expect(actionMocks.activatePromocodeAction).toHaveBeenCalledWith("WELCOME-2026");
    expect(container.querySelector<HTMLInputElement>("#promocode")?.value).toBe("");
    expect(container.textContent).toContain(
      "Промокод активирован. Данные кабинета обновлены.",
    );

    expect(actionMocks.refresh).toHaveBeenCalledOnce();
  });

  it("refreshes a pending payment snapshot with a finite polling budget", async () => {
    vi.useFakeTimers();
    await act(async () => root.render(createElement(CabinetPanel, {
      model: cabinetModel("refreshing"),
    })));

    await act(async () => vi.advanceTimersByTimeAsync(40_000));

    expect(actionMocks.refresh).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
