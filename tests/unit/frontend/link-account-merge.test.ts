/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("auth=telegram_email_replace"),
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => true }));
vi.mock("primereact/button", () => ({
  Button: (input: Record<string, unknown>) => {
    const props = { ...input };
    const label = props.label;
    delete props.label;
    delete props.loading;
    delete props.severity;
    delete props.outlined;
    return createElement("button", props, String(label ?? ""));
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text, severity }: { text?: string; severity?: string }) =>
    createElement("div", { role: "alert", "data-severity": severity }, text),
}));
vi.mock("primereact/password", () => ({
  Password: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value?: string }) => createElement("span", null, value),
}));
vi.mock("@/frontend/components/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  hasTurnstileSiteKey: () => false,
}));

import { LinkAccountPanel } from "@/frontend/components/link-account-panel";

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

describe("Telegram e-mail replacement confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        data: { user: { email: "owner@example.com", emailVerified: true } },
      }))
      .mockResolvedValueOnce(Response.json({
        data: {
          targetEmail: "owner@example.com",
          sourceEmailMasked: "ol***@example.net",
          telegramId: "777",
        },
      }))
      .mockResolvedValueOnce(Response.json({ data: { credentials: [] } })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the replacement consequence prominently before account controls", async () => {
    await act(async () => root.render(createElement(LinkAccountPanel)));
    await flush();

    const warning = container.querySelector<HTMLElement>('[data-severity="warn"]')!;
    const controls = container.querySelector<HTMLElement>(".account-method-grid")!;
    expect(warning.textContent).toContain("ol***@example.net");
    expect(warning.textContent).toContain("owner@example.com");
    expect(warning.textContent).toContain("подписка, платежи и остальные данные");
    expect(warning.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(container.textContent).toContain("Да, заменить e-mail и объединить");
  });

  it("renders a merge failure above the confirmation card", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      error: {
        code: "ACCOUNT_MERGE_REQUIRED",
        message: "У обеих учётных записей есть активные подписки. Обратитесь в поддержку.",
      },
    }, { status: 409 }));

    await act(async () => root.render(createElement(LinkAccountPanel)));
    await flush();
    const confirmButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Да, заменить"),
    )!;
    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const error = container.querySelector<HTMLElement>('[data-severity="error"]')!;
    const controls = container.querySelector<HTMLElement>(".account-method-grid")!;
    expect(error.textContent).toContain("активные подписки");
    expect(container.querySelector(".border-orange-400")).toBeNull();
    expect(error.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("offers a safe recheck for an already-partially-linked Telegram", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        data: {
          user: {
            email: "owner@example.com",
            emailVerified: true,
            telegramId: "777",
          },
        },
      }))
      .mockResolvedValueOnce(Response.json({
        data: {
          targetEmail: "owner@example.com",
          sourceEmailMasked: "ol***@example.net",
          telegramId: "777",
        },
      }))
      .mockResolvedValueOnce(Response.json({ data: { credentials: [] } }));

    await act(async () => root.render(createElement(LinkAccountPanel)));
    await flush();

    expect(container.textContent).toContain("Перепроверить связь Telegram");
  });
});
