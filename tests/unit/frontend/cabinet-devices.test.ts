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
vi.mock("@/frontend/lib/bff-cache", () => ({
  getAuthenticatedBffJson: vi.fn(async () => ({
    ok: true,
    data: {
      user: {
        email: "user@example.com",
        emailVerified: true,
      },
    },
  })),
  getCachedBffJson: vi.fn(async (path: string) =>
    path === "/api/bff/auth/me"
      ? {
          ok: true,
          data: {
            user: {
              email: "user@example.com",
              emailVerified: true,
            },
          },
        }
      : {
          ok: true,
          data: {
            has_current_subscription: true,
            current_subscription_status: "ACTIVE",
            plans: [],
          },
        },
  ),
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

function response(data: unknown) {
  return Response.json({ data });
}

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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);

      if (
        path ===
          `/api/bff/subscription/devices/${encodeURIComponent(internalHwid)}` &&
        init?.method === "DELETE"
      ) {
        return response({ deleted: true });
      }

      if (path === "/api/bff/subscription/current") {
        return response(currentSubscription);
      }

      if (path === "/api/bff/subscription/devices") {
        return response(devices);
      }

      if (path === "/api/bff/payments/history") {
        return response([]);
      }

      if (path === "/api/bff/support") {
        return response({
          enabled: false,
          email: null,
          telegramUsername: null,
          faqUrl: null,
        });
      }

      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(CabinetPanel)));
    await settle();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
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
    const mobileDeleteButtons = deleteButtons.filter(
      (button) => button.textContent === "",
    );
    const desktopDeleteButtons = deleteButtons.filter(
      (button) => button.textContent === "Удалить",
    );

    expect(deleteButtons).toHaveLength(devices.devices.length * 2);
    expect(mobileDeleteButtons).toHaveLength(devices.devices.length);
    expect(desktopDeleteButtons).toHaveLength(devices.devices.length);
    expect(mobileDeleteButtons[0]?.getAttribute("aria-label")).toBe(
      "Удалить устройство 1: iPhone 12 INCY 2.4.7, iOS 26.5.2",
    );
    expect(
      deleteButtons.every(
        (button) => !button.getAttribute("aria-label")?.includes(internalHwid),
      ),
    ).toBe(true);
    await click(mobileDeleteButtons[0]!);
    await click(desktopDeleteButtons[0]!);

    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bff/subscription/devices/${encodeURIComponent(internalHwid)}`,
      { method: "DELETE" },
    );
    expect(container.textContent).toContain("Устройство удалено.");
  });

  it("atomically ignores a same-tick duplicate destructive action", async () => {
    const deleteButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Удалить устройство "]',
      ),
    );
    const mobileButton = deleteButtons.find((button) => button.textContent === "")!;
    const desktopButton = deleteButtons.find((button) => button.textContent === "Удалить")!;

    await act(async () => {
      mobileButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      desktopButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await settle();

    const deletionCalls = fetchMock.mock.calls.filter(([input, init]) =>
      String(input).startsWith("/api/bff/subscription/devices/")
      && init?.method === "DELETE",
    );
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(deletionCalls).toHaveLength(1);
  });
});
