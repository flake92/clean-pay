/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/frontend/lib/bff-cache", () => ({
  getAuthenticatedBffJson: vi.fn(async () => ({
    ok: true,
    data: {
      user: {
        email: "user@example.com",
        emailVerified: true,
        telegramId: "777",
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
              telegramId: "777",
            },
          },
        }
      : {
          ok: true,
          data: {
            has_current_subscription: false,
            current_subscription_status: null,
            plans: [],
          },
        },
  ),
}));

import { CabinetPanel } from "@/frontend/components/cabinet-panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function response(data: unknown) {
  return Response.json({ data });
}

function subscriptionNotFound() {
  return Response.json(
    {
      error: {
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Подписка не найдена.",
      },
    },
    { status: 404 },
  );
}

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

describe("cabinet promocode activation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);

      if (path === "/api/bff/subscription/current") {
        return subscriptionNotFound();
      }

      if (path === "/api/bff/subscription/promocode" && init?.method === "POST") {
        return response({ success: true, reward_type: "DAYS" });
      }

      if (path === "/api/bff/subscription/offers") {
        return response({
          has_current_subscription: false,
          current_subscription_status: null,
          plans: [],
        });
      }

      if (path === "/api/bff/subscription/devices") {
        return response({ devices: [], current_count: 0, max_count: 0 });
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
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/bff/subscription/promocode" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("activates a code and refreshes cabinet data without a subscription", async () => {
    const input = container.querySelector<HTMLInputElement>("#promocode")!;
    const form = input.closest("form")!;

    await setInputValue(input, "  WELCOME-2026  ");
    await submit(form);
    await settle();

    const promocodeCalls = fetchMock.mock.calls.filter(
      ([request, init]) =>
        String(request) === "/api/bff/subscription/promocode" && init?.method === "POST",
    );
    expect(promocodeCalls).toHaveLength(1);
    expect(promocodeCalls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "WELCOME-2026" }),
    });
    expect(container.querySelector<HTMLInputElement>("#promocode")?.value).toBe("");
    expect(container.textContent).toContain(
      "Промокод активирован. Данные кабинета обновлены.",
    );

    for (const path of [
      "/api/bff/subscription/current",
      "/api/bff/subscription/devices",
      "/api/bff/payments/history",
    ]) {
      expect(fetchMock.mock.calls.filter(([request]) => String(request) === path)).toHaveLength(2);
    }
    expect(
      fetchMock.mock.calls.filter(
        ([request]) => String(request) === "/api/bff/subscription/offers",
      ),
    ).toHaveLength(1);
  });
});
