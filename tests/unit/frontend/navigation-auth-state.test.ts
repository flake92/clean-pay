/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NavigationViewModel } from "@/application/models/navigation";
import type { AppMenuItem } from "@/frontend/types";

const mocks = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("@/app/actions/session", () => ({ logoutAction: mocks.logout }));
vi.mock("@/shared/branding", () => ({
  getBranding: () => ({ name: "Clean Pay", logoUrl: "/logo.png" }),
}));

import { useCleanPayMenu } from "@/frontend/layout/useCleanPayMenu";

describe("navigation authentication state", () => {
  let container: HTMLDivElement;
  let root: Root;
  let menu: { model: AppMenuItem[]; flatItems: AppMenuItem[] } | null;

  function Probe({ navigation }: { navigation: NavigationViewModel }) {
    menu = useCleanPayMenu(navigation);
    return null;
  }

  async function renderMenu(navigation: NavigationViewModel) {
    await act(async () => root.render(createElement(Probe, { navigation })));
    return menu!;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    menu = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("offers login without protected account actions to anonymous visitors", async () => {
    const result = await renderMenu({
      authenticated: false,
      emailVerificationRequired: false,
    });

    expect(result.flatItems.map(({ label }) => label)).toEqual(["Тарифы", "Поддержка", "Войти"]);
    expect(result.flatItems.find(({ label }) => label === "Войти")?.to).toBe("/login");
    expect(result.model.some(({ label }) => label === "Аккаунт")).toBe(false);
  });

  it("shows account actions and logout only for authenticated users", async () => {
    const result = await renderMenu({
      authenticated: true,
      emailVerificationRequired: false,
    });

    expect(result.flatItems.map(({ label }) => label)).toEqual([
      "Кабинет",
      "Пригласить друзей",
      "Тарифы",
      "Продлить",
      "Профиль",
      "Связать аккаунт",
      "Поддержка",
      "Выйти",
    ]);
    expect(result.flatItems.some(({ label }) => label === "Войти")).toBe(false);
  });

  it("keeps tariff and renewal routes available without blocking on provider state", async () => {
    const result = await renderMenu({
      authenticated: true,
      emailVerificationRequired: false,
    });

    expect(result.flatItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Тарифы", to: "/tariffs" }),
      expect.objectContaining({ label: "Продлить", to: "/extend" }),
    ]));
  });
});
