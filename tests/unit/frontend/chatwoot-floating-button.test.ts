// @vitest-environment jsdom

import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import { SupportChatFloatingButton } from "@/frontend/components/chatwoot-open-button";
import { SupportChatSessionBoundary } from "@/frontend/components/chatwoot-session-context";
import { projectChatwootIdentity } from "@/frontend/lib/chatwoot-transitions";

const chatwootConfig: ChatwootWidgetConfig = {
  baseUrl: "https://chat.example.com",
  identityFingerprint: "1111111111111111111111111111111111111111111111111111111111111111",
  websiteToken: "token",
  user: {
    identifier: "user-123",
    identifierHash: "signed-user-123",
    name: "Clean Pay User",
    email: "user@example.com",
    customAttributes: { clean_pay_user_id: "user-123" },
  },
};
const expectedCore = projectChatwootIdentity(chatwootConfig, {}).identity.core;

function renderFloatingButton(
  authenticated: boolean,
  config: ChatwootWidgetConfig | null = authenticated ? chatwootConfig : null,
) {
  return render(createElement(
    SupportChatSessionBoundary,
    { authenticated, chatwootConfig: config },
    createElement(SupportChatFloatingButton),
  ));
}

function installChatwoot(toggle = vi.fn()) {
  window.$chatwoot = {
    baseUrl: chatwootConfig.baseUrl,
    websiteToken: chatwootConfig.websiteToken,
    hasLoaded: true,
    setUser: vi.fn(),
    toggle,
    toggleBubbleVisibility: vi.fn(),
    reset: vi.fn(),
  };
  return toggle;
}

function confirmCurrentIdentity() {
  window.cleanPayChatwootAuthorized = true;
  window.cleanPayChatwootIdentity = {
    core: expectedCore,
    customAttributes: "context",
  };
  document.cookie = "cw_conversation=conversation-1; Path=/";
  document.cookie = `cw_user_${chatwootConfig.websiteToken}=identified; Path=/`;
}

describe("SupportChatFloatingButton", () => {
  afterEach(() => {
    delete window.$chatwoot;
    delete window.cleanPayChatwootAuthorized;
    delete window.cleanPayChatwootIdentity;
    delete window.cleanPayChatwootOwnership;
    delete window.cleanPayChatwootPendingIdentity;
    delete window.cleanPayChatwootFailedIdentity;
    document.cookie = "cw_conversation=; Path=/; Max-Age=0";
    document.cookie = `cw_user_${chatwootConfig.websiteToken}=; Path=/; Max-Age=0`;
  });

  it("opens and closes only the verified current user's conversation", async () => {
    const toggle = installChatwoot();
    confirmCurrentIdentity();
    renderFloatingButton(true);

    const openButton = await screen.findByRole("button", {
      name: "Открыть чат поддержки",
    });
    expect(openButton.classList.contains("clean-pay-chatwoot-launcher")).toBe(true);
    expect(openButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(openButton);
    expect(toggle).toHaveBeenCalledWith("open");

    act(() => window.dispatchEvent(new CustomEvent("chatwoot:opened")));
    const closeButton = await screen.findByRole("button", {
      name: "Закрыть чат поддержки",
    });
    expect(closeButton.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(closeButton);
    expect(toggle).toHaveBeenLastCalledWith("close");

    act(() => window.dispatchEvent(new CustomEvent("chatwoot:closed")));
    const reopenedButton = await screen.findByRole("button", {
      name: "Открыть чат поддержки",
    });
    expect(reopenedButton.getAttribute("aria-expanded")).toBe("false");
    expect(reopenedButton.querySelector(".pi-comments")).not.toBeNull();
    expect(toggle.mock.calls).toEqual([["open"], ["close"]]);
  });

  it("shows a disabled connection state until identity ownership is verified", () => {
    const toggle = installChatwoot();
    window.cleanPayChatwootAuthorized = true;
    renderFloatingButton(true);

    const button = screen.getByRole("button", {
      name: "Подключаем чат поддержки",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("never opens a stale account while the current identity is pending", () => {
    const toggle = installChatwoot();
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootIdentity = {
      core: "stale-account-core",
      customAttributes: "stale-context",
    };
    window.cleanPayChatwootPendingIdentity = {
      core: expectedCore,
      customAttributes: "current-context",
      attemptId: "current-attempt",
      startedAt: Date.now(),
      retryCount: 0,
      phase: "sent",
    };
    document.cookie = "cw_conversation=stale-conversation; Path=/";
    document.cookie = `cw_user_${chatwootConfig.websiteToken}=stale; Path=/`;
    renderFloatingButton(true);

    const button = screen.getByRole("button", {
      name: "Подключаем чат поддержки",
    });
    fireEvent.click(button);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("rechecks ownership at click time even without a state-change event", async () => {
    const toggle = installChatwoot();
    confirmCurrentIdentity();
    renderFloatingButton(true);

    const button = await screen.findByRole("button", {
      name: "Открыть чат поддержки",
    });
    window.cleanPayChatwootIdentity = {
      core: "another-account-core",
      customAttributes: "another-context",
    };

    fireEvent.click(button);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("accepts server-confirmed ownership of the exact current conversation", async () => {
    const toggle = installChatwoot();
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootOwnership = {
      core: expectedCore,
      customAttributes: "context",
      conversation: "conversation-1",
    };
    document.cookie = "cw_conversation=conversation-1; Path=/";
    renderFloatingButton(true);

    fireEvent.click(await screen.findByRole("button", {
      name: "Открыть чат поддержки",
    }));
    expect(toggle).toHaveBeenCalledWith("open");
  });

  it("renders nothing for guests, missing configuration, and failed identity", async () => {
    const guest = renderFloatingButton(false);
    expect(guest.queryByRole("button")).toBeNull();
    guest.unmount();

    const withoutConfig = renderFloatingButton(true, null);
    expect(withoutConfig.queryByRole("button")).toBeNull();
    withoutConfig.unmount();

    window.cleanPayChatwootFailedIdentity = {
      core: expectedCore,
      customAttributes: "context",
    };
    const failed = renderFloatingButton(true);
    await waitFor(() => expect(failed.queryByRole("button")).toBeNull());
  });
});
