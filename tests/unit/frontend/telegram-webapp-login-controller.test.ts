/** @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  expand: vi.fn(),
  getWebApp: vi.fn(),
  loadScript: vi.fn(),
  markSession: vi.fn(),
  ready: vi.fn(),
}));

vi.mock("@/app/actions/telegram", () => ({
  authenticateTelegramWebAppAction: mocks.authenticate,
}));
vi.mock("@/frontend/lib/telegram-webapp", () => ({
  getTelegramWebApp: mocks.getWebApp,
  loadTelegramWebAppScript: mocks.loadScript,
  markTelegramWebAppSession: mocks.markSession,
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ label }: { label: string }) =>
    createElement("a", null, label),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text: string }) => createElement("span", null, text),
}));
vi.mock("primereact/progressspinner", () => ({
  ProgressSpinner: () => createElement("span", null, "loading"),
}));

import { TelegramWebAppLogin } from "@/frontend/components/telegram-webapp-login";

describe("TelegramWebAppLogin controller", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps SDK readiness, session marking and authentication order", async () => {
    mocks.loadScript.mockResolvedValue(undefined);
    mocks.getWebApp.mockReturnValue({
      expand: mocks.expand,
      initData: "  signed-init-data  ",
      ready: mocks.ready,
    });
    mocks.authenticate.mockResolvedValue({
      ok: false,
      message: "provider rejected",
    });

    const view = render(createElement(TelegramWebAppLogin));

    await view.findByText("provider rejected");
    expect(mocks.authenticate).toHaveBeenCalledWith("signed-init-data");
    expect(mocks.loadScript.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.getWebApp.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getWebApp.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.ready.mock.invocationCallOrder[0]!,
    );
    expect(mocks.ready.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.expand.mock.invocationCallOrder[0]!,
    );
    expect(mocks.expand.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.markSession.mock.invocationCallOrder[0]!,
    );
    expect(mocks.markSession.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.authenticate.mock.invocationCallOrder[0]!,
    );
  });
});
