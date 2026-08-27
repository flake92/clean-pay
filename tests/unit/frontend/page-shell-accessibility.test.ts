/** @vitest-environment jsdom */

import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LayoutState } from "@/frontend/types";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const imageProps = { ...props };
    delete imageProps.unoptimized;
    return createElement("img", imageProps);
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: ReactNode }) =>
    createElement("a", props, children),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => "/tariffs",
}));
vi.mock("primereact/hooks", () => ({
  useEventListener: () => [vi.fn(), vi.fn()],
}));
vi.mock("primereact/utils", () => ({
  classNames: () => "layout-wrapper layout-static",
}));
vi.mock("@/shared/branding", () => ({
  getBranding: () => ({ name: "Clean Pay", logoUrl: "/logo.png" }),
}));
vi.mock("@/frontend/components/chatwoot-widget", () => ({
  ChatwootGuestBoundary: () => null,
}));
vi.mock("@/frontend/layout/AppTopbar", () => ({
  default: () => createElement("header", null, "topbar"),
}));
vi.mock("@/frontend/layout/AppMenu", () => ({
  default: () => createElement("nav", { "aria-label": "Навигация" }),
}));
vi.mock("@/frontend/layout/AppFooter", () => ({
  default: () => createElement("footer", null, "footer"),
}));
vi.mock("@/frontend/components/auth-forms", () => ({
  AuthTurnstileProvider: ({ children }: { children?: ReactNode }) => children,
  LoginForm: () => createElement("form", null, "login"),
  TelegramLoginButton: () => createElement("button", null, "telegram"),
}));
vi.mock("@/app/_components/app-shell", () => ({
  AppShell: ({ children }: { children?: ReactNode }) =>
    createElement("main", null, children),
}));
vi.mock("@/application/subscriptions/load-tariffs", () => ({
  loadTariffsViewModel: vi.fn().mockResolvedValue({ status: "ready", offers: [] }),
}));
vi.mock("@/app/_composition/request-scoped-readers", () => ({
  requestSubscriptionCatalog: {},
}));
vi.mock("@/frontend/components/tariffs-panel", () => ({
  TariffsPanel: () => createElement("section", null, "tariffs"),
}));
vi.mock("@/application/support/load-support", () => ({
  loadSupportViewModel: () => ({ enabled: false }),
  supportPageDescription: () => "Описание поддержки",
}));
vi.mock("@/backend/integrations/support/support-reader", () => ({
  productionSupportReader: {},
}));
vi.mock("@/frontend/components/support-panel", () => ({
  SupportPanel: () => createElement("section", null, "support"),
}));

import { AuthShell } from "@/frontend/components/auth-shell";
import { AuthLogo } from "@/frontend/components/auth-logo";
import Layout from "@/frontend/layout/layout";
import { LayoutContext } from "@/frontend/layout/context/layoutcontext";
import LoginPage from "@/app/login/page";
import TariffsPage from "@/app/tariffs/page";
import SupportPage from "@/app/support/page";

type OptionalChildren<T> = T extends ComponentType<infer Props>
  ? ComponentType<Omit<Props, "children"> & { children?: ReactNode }>
  : never;

const AuthShellElement = AuthShell as OptionalChildren<typeof AuthShell>;
const LayoutElement = Layout as OptionalChildren<typeof Layout>;

const layoutState: LayoutState = {
  staticMenuDesktopInactive: false,
  profileSidebarVisible: false,
  staticMenuMobileActive: false,
};

describe("public and authentication page shell accessibility", () => {
  afterEach(() => cleanup());

  it("renders one primary landmark and one level-one title in AuthShell", () => {
    render(createElement(
      AuthShellElement,
      { title: "Вход", description: "Описание" },
      createElement("form", null, "Форма"),
    ));

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Вход");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps CSS-free fallback pixels while hydrating decorative semantics", () => {
    const serverMarkup = renderToString(createElement(AuthLogo, {
      src: "/logo.png",
      unoptimized: true,
    }));
    expect(serverMarkup).toContain('alt="Clean Pay"');
    expect(serverMarkup).toContain('aria-hidden="true"');
    expect(serverMarkup).toContain('height="68"');
    expect(serverMarkup).toContain('width="68"');

    const view = render(createElement(AuthLogo, { src: "/logo.png", unoptimized: true }));
    const image = view.container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.hasAttribute("aria-hidden")).toBe(false);
    expect(image?.getAttribute("height")).toBe("68");
    expect(image?.getAttribute("width")).toBe("68");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders page content inside one primary landmark in the application shell", () => {
    render(createElement(
      LayoutContext.Provider,
      {
        value: {
          layoutState,
          setLayoutState: vi.fn(),
          onMenuToggle: vi.fn(),
          showProfileSidebar: vi.fn(),
        },
      },
      createElement(
        LayoutElement,
        { navigation: { authenticated: false, emailVerificationRequired: false } },
        createElement("h1", null, "Тарифы"),
      ),
    ));

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("main").contains(screen.getByRole("heading", { level: 1 })))
      .toBe(true);
  });

  it.each([
    ["/login", "Вход", async () => LoginPage({ searchParams: Promise.resolve({}) })],
    ["/tariffs", "Тарифы", async () => TariffsPage()],
    ["/support", "Поддержка", async () => SupportPage()],
  ])("composes the actual %s route with one main and one h1", async (_route, title, page) => {
    render(await page());

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(screen.getByRole("main").contains(screen.getByRole("heading", { level: 1 })))
      .toBe(true);
  });
});
