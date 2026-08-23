/** @vitest-environment jsdom */

import {
  act,
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  deleteDeviceAction: vi.fn(),
  refresh: vi.fn(),
  reissueSubscriptionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actionMocks.refresh }) }));
vi.mock("@/app/actions/cabinet", () => ({
  activatePromocodeAction: vi.fn(),
  deleteAllDevicesAction: vi.fn(),
  deleteDeviceAction: actionMocks.deleteDeviceAction,
  logoutAction: vi.fn(),
  reissueSubscriptionAction: actionMocks.reissueSubscriptionAction,
}));

type ColumnProps = {
  body?: (value: unknown) => ReactNode;
  header?: ReactNode;
};

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
  DataTable: ({
    children,
    value,
  }: {
    children?: ReactNode;
    value?: unknown[];
  }) => {
    const columns = Children.toArray(children).filter(isValidElement) as ReactElement<ColumnProps>[];

    return createElement(
      "table",
      null,
      createElement(
        "thead",
        null,
        createElement(
          "tr",
          null,
          columns.map((column, index) =>
            createElement("th", { key: index }, column.props.header),
          ),
        ),
      ),
      createElement(
        "tbody",
        null,
        (value ?? []).map((row, rowIndex) =>
          createElement(
            "tr",
            { key: rowIndex },
            columns.map((column, columnIndex) =>
              createElement(
                "td",
                { key: columnIndex },
                column.props.body?.(row),
              ),
            ),
          ),
        ),
      ),
    );
  },
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
  LinkButton: ({ label }: { label: string }) =>
    createElement("a", null, label),
}));
import { CabinetPanel } from "@/frontend/components/cabinet-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const internalHwid = "device/one?internal=true";
const rawUserAgent =
  "INCY/2.4.7/ios CFNetwork/private-trailing-data Darwin/private";

const devices = {
  current_count: 3,
  max_count: 5,
  devices: [
    {
      hwid: internalHwid,
      platform: "iOS",
      device_model: "iPhone 12",
      os_version: "26.5.2",
      user_agent: rawUserAgent,
    },
    {
      hwid: "windows-device",
      platform: "Windows",
      device_model: "byte_x86_64",
      os_version: "11_10.0.22631",
      user_agent: "Happ/3.3.6/Windows/private-trailing-data",
    },
    {
      hwid: "missing-telemetry",
      platform: null,
      device_model: null,
      os_version: null,
      user_agent: null,
    },
  ],
};

const currentSubscription = {
  user_remna_id: "subscription-user",
  status: "active",
  is_trial: false,
  traffic_limit: 0,
  device_limit: 5,
  traffic_limit_strategy: "NO_RESET",
  expire_at: "2026-08-29T00:00:00.000Z",
  url: "https://subscription.example.com/example",
  plan_name: "Standard",
  plan_duration_days: 30,
  used_traffic_bytes: 0,
  lifetime_used_traffic_bytes: 0,
  online_at: null,
};

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

describe("cabinet device records", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    actionMocks.deleteDeviceAction.mockResolvedValue({ status: "success", message: "Устройство удалено." });
    actionMocks.reissueSubscriptionAction.mockResolvedValue({
      status: "success",
      message: "Подписка перевыпущена.",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(CabinetPanel, {
      model: {
        status: "ready",
        user: { email: "user@example.com", emailVerified: true },
        subscription: currentSubscription,
        subscriptionError: null,
        offers: { gateways: [], plans: [], has_current_subscription: true, current_subscription_status: "ACTIVE" },
        devices,
        payments: [],
        paymentHistoryStatus: "current",
        support: { enabled: false, email: null, telegramUsername: null, faqUrl: null },
      },
    })));
    await settle();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders compact device, OS and client fields without HWID or raw user agent", () => {
    const text = container.textContent ?? "";

    expect(text).toContain("Тип устройства");
    expect(text).toContain("ОС");
    expect(text).toContain("Клиент");
    expect(text).toContain("iPhone 12 INCY 2.4.7");
    expect(text).toContain("iOS 26.5.2");
    expect(text).toContain("Windows Happ 3.3.6");
    expect(text).toContain("Windows 11_10.0.22631");
    expect(text).toContain("—");
    expect(text).not.toContain(internalHwid);
    expect(text).not.toContain(rawUserAgent);
    expect(text).not.toContain("CFNetwork");
    expect(text).not.toContain("private-trailing-data");
    expect(container.innerHTML).not.toContain(internalHwid);
    expect(container.innerHTML).not.toContain(encodeURIComponent(internalHwid));
  });

  it("keeps deletion bound to the original encoded HWID", async () => {
    const deleteButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Удалить устройство "]',
      ),
    );

    expect(deleteButtons).toHaveLength(devices.devices.length);
    expect(deleteButtons.every((button) => button.textContent === "Удалить")).toBe(true);
    expect(deleteButtons[0]?.getAttribute("aria-label")).toBe(
      "Удалить устройство 1: iPhone 12 INCY 2.4.7, iOS 26.5.2",
    );
    expect(
      deleteButtons.every(
        (button) => !button.getAttribute("aria-label")?.includes(internalHwid),
      ),
    ).toBe(true);
    await click(deleteButtons[0]!);

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(actionMocks.deleteDeviceAction).toHaveBeenCalledWith(internalHwid);
    expect(container.textContent).toContain("Устройство удалено.");
  });

  it("atomically ignores a same-tick duplicate destructive action", async () => {
    const deleteButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Удалить устройство "]',
      ),
    );
    const deleteButton = deleteButtons[0]!;

    await act(async () => {
      deleteButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      deleteButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await settle();

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(actionMocks.deleteDeviceAction).toHaveBeenCalledOnce();
  });

  it("fully explains the consequences before reissuing a subscription", async () => {
    const reissueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Перевыпустить подписку",
    );

    expect(reissueButton).toBeDefined();
    await click(reissueButton!);

    expect(window.confirm).toHaveBeenCalledWith(
      [
        "Перевыпуск подписки отключит все текущие устройства.",
        "",
        "После перевыпуска старая ссылка перестанет работать, и все устройства придётся заново переподключить.",
        "",
        "Вам потребуется:",
        "• Удалить старую подписку из приложения",
        "• Добавить новую ссылку из раздела «Подключиться»",
        "",
        "Вы уверены, что хотите перевыпустить подписку?",
      ].join("\n"),
    );
    expect(actionMocks.reissueSubscriptionAction).toHaveBeenCalledOnce();
    expect(actionMocks.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Подписка перевыпущена.");
  });

  it("does not reissue a subscription when the detailed confirmation is cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const reissueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Перевыпустить подписку",
    );

    expect(reissueButton).toBeDefined();
    await click(reissueButton!);

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(actionMocks.reissueSubscriptionAction).not.toHaveBeenCalled();
    expect(actionMocks.refresh).not.toHaveBeenCalled();
  });
});
