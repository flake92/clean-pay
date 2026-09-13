// @vitest-environment jsdom

import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import { SupportChatSessionBoundary } from "@/frontend/components/chatwoot-session-context";
import { SupportPanel } from "@/frontend/components/support-panel";
import {
  confirmChatwootIdentity,
  getChatwootPendingIdentityAttempt,
  identifyChatwootUser,
} from "@/frontend/lib/chatwoot";
import { notifyChatwootStateChanged } from "@/frontend/lib/chatwoot-state-events";
import { projectChatwootIdentity } from "@/frontend/lib/chatwoot-transitions";

const unavailable = {
  enabled: false,
  email: null,
  telegramUsername: null,
  faqUrl: null,
  liveChatEnabled: false,
};

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

function renderSupport(authenticated: boolean) {
  return render(createElement(
    SupportChatSessionBoundary,
    {
      authenticated,
      chatwootConfig: authenticated ? chatwootConfig : null,
    },
    createElement(SupportPanel, {
      support: { ...unavailable, liveChatEnabled: true },
    }),
  ));
}

describe("SupportPanel", () => {
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

  it("points to the configured live chat instead of claiming support is unpublished", () => {
    renderSupport(false);

    expect(screen.getByText(/Чат доступен после входа в аккаунт/i)).toBeTruthy();
    expect(screen.queryByText(/Контакты поддержки пока не опубликованы/i)).toBeNull();
  });

  it("opens the verified Chatwoot conversation from an explicit support button", async () => {
    const toggle = vi.fn();
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootIdentity = {
      core: expectedCore,
      customAttributes: "context",
    };
    document.cookie = "cw_conversation=conversation-1; Path=/";
    document.cookie = `cw_user_${chatwootConfig.websiteToken}=identified; Path=/`;
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: chatwootConfig.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      toggle,
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };

    renderSupport(true);

    const button = await screen.findByRole("button", { name: /Открыть чат поддержки/i });
    fireEvent.click(button);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith("open"));
  });

  it("opens an ownership-confirmed conversation while its metadata update is still pending", async () => {
    const toggle = vi.fn();
    window.cleanPayChatwootAuthorized = true;
    document.cookie = "cw_conversation=conversation-1; Path=/";
    window.cleanPayChatwootOwnership = {
      core: expectedCore,
      customAttributes: "context",
      conversation: "conversation-1",
    };
    window.cleanPayChatwootPendingIdentity = {
      core: expectedCore,
      customAttributes: "context",
      attemptId: "attempt-1",
      startedAt: Date.now(),
      retryCount: 0,
      phase: "ownership_confirmed",
    };
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: chatwootConfig.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      toggle,
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };

    renderSupport(true);

    const button = await screen.findByRole("button", { name: /Открыть чат поддержки/i });
    expect(screen.queryByText(/Чат доступен после входа/i)).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith("open"));
  });

  it("does not tell an authorized user to sign in while Chatwoot is connecting", async () => {
    renderSupport(true);

    expect(screen.getByText(/Подключаем чат поддержки/i)).toBeTruthy();
    expect(screen.queryByText(/Чат доступен после входа/i)).toBeNull();
  });

  it("publishes the support button from lifecycle events without polling", async () => {
    const toggle = vi.fn();
    renderSupport(true);

    act(() => {
      window.cleanPayChatwootAuthorized = true;
      window.cleanPayChatwootIdentity = {
        core: expectedCore,
        customAttributes: "context",
      };
      document.cookie = "cw_conversation=conversation-1; Path=/";
      document.cookie = `cw_user_${chatwootConfig.websiteToken}=identified; Path=/`;
      window.$chatwoot = {
        baseUrl: chatwootConfig.baseUrl,
        websiteToken: chatwootConfig.websiteToken,
        hasLoaded: true,
        setUser: vi.fn(),
        toggle,
        toggleBubbleVisibility: vi.fn(),
        reset: vi.fn(),
      };
      notifyChatwootStateChanged();
    });

    const button = await screen.findByRole("button", { name: /Открыть чат поддержки/i });
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledWith("open");
  });

  it("publishes the button after a new user is identified without a prior conversation", async () => {
    const toggle = vi.fn();
    window.cleanPayChatwootAuthorized = true;
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: chatwootConfig.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      toggle,
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };
    renderSupport(true);

    expect(document.cookie).not.toContain("cw_conversation=");
    expect(screen.getByText(/Подключаем чат поддержки/i)).toBeTruthy();

    act(() => {
      expect(identifyChatwootUser(chatwootConfig)).toBe("pending");
      const attemptId = getChatwootPendingIdentityAttempt()?.attemptId;
      expect(attemptId).toBeTruthy();

      // The SDK persists both transport cookies before Clean Pay confirms the
      // correlated setUser response delivered by setAuthCookie.
      document.cookie = "cw_conversation=new-conversation; Path=/";
      document.cookie = `cw_user_${chatwootConfig.websiteToken}=identified; Path=/`;
      expect(confirmChatwootIdentity(attemptId)).toBe(true);
    });

    const button = await screen.findByRole("button", { name: /Открыть чат поддержки/i });
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledWith("open");
  });

  it("shows a stable neutral error when the support service cannot connect", () => {
    window.cleanPayChatwootFailedIdentity = {
      core: expectedCore,
      customAttributes: "context",
    };

    renderSupport(true);

    expect(screen.getByText(/Чат временно недоступен/i)).toBeTruthy();
    expect(screen.queryByText(/Подключаем чат поддержки/i)).toBeNull();
    expect(screen.queryByText(/Чат доступен после входа/i)).toBeNull();
  });

  it("never opens a stale account while the current identity is pending", () => {
    const toggle = vi.fn();
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
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: chatwootConfig.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      toggle,
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };

    renderSupport(true);

    expect(screen.getByText(/Подключаем чат поддержки/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Открыть чат поддержки/i })).toBeNull();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("never opens an SDK instance for another configured inbox", () => {
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootIdentity = {
      core: expectedCore,
      customAttributes: "context",
    };
    document.cookie = "cw_conversation=conversation-1; Path=/";
    document.cookie = `cw_user_${chatwootConfig.websiteToken}=identified; Path=/`;
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: "another-inbox-token",
      hasLoaded: true,
      setUser: vi.fn(),
      toggle: vi.fn(),
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };

    renderSupport(true);

    expect(screen.getByText(/Подключаем чат поддержки/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Открыть чат поддержки/i })).toBeNull();
  });

  it("never trusts current ownership while another account update is pending", () => {
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootOwnership = {
      core: expectedCore,
      customAttributes: "context",
      conversation: "conversation-1",
    };
    window.cleanPayChatwootPendingIdentity = {
      core: "another-account-core",
      customAttributes: "another-context",
      attemptId: "another-account-attempt",
      startedAt: Date.now(),
      retryCount: 0,
      phase: "sent",
    };
    document.cookie = "cw_conversation=conversation-1; Path=/";
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: chatwootConfig.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      toggle: vi.fn(),
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };

    renderSupport(true);

    expect(screen.getByText(/Подключаем чат поддержки/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Открыть чат поддержки/i })).toBeNull();
  });

  it("rejects an ownership-confirmed phase without ownership of the current cookie", () => {
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootPendingIdentity = {
      core: expectedCore,
      customAttributes: "context",
      attemptId: "attempt-without-proof",
      startedAt: Date.now(),
      retryCount: 0,
      phase: "ownership_confirmed",
    };
    window.cleanPayChatwootOwnership = {
      core: expectedCore,
      customAttributes: "context",
      conversation: "different-conversation",
    };
    document.cookie = "cw_conversation=current-conversation; Path=/";
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: chatwootConfig.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      toggle: vi.fn(),
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };

    renderSupport(true);

    expect(screen.getByText(/Подключаем чат поддержки/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Открыть чат поддержки/i })).toBeNull();
  });

  it("fails closed when the identity cookie disappears without ownership proof", async () => {
    const toggle = vi.fn();
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootIdentity = {
      core: expectedCore,
      customAttributes: "context",
    };
    document.cookie = "cw_conversation=conversation-1; Path=/";
    document.cookie = `cw_user_${chatwootConfig.websiteToken}=identified; Path=/`;
    window.$chatwoot = {
      baseUrl: chatwootConfig.baseUrl,
      websiteToken: chatwootConfig.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      toggle,
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };
    renderSupport(true);
    expect(await screen.findByRole("button", { name: /Открыть чат поддержки/i }))
      .toBeTruthy();

    act(() => {
      document.cookie = `cw_user_${chatwootConfig.websiteToken}=; Path=/; Max-Age=0`;
      notifyChatwootStateChanged();
    });

    await waitFor(() => {
      expect(screen.getByText(/Подключаем чат поддержки/i)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Открыть чат поддержки/i })).toBeNull();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("publishes configured contact actions only when the contact feature is enabled", () => {
    render(createElement(SupportPanel, {
      support: {
        ...unavailable,
        enabled: true,
        email: "help@example.com",
        telegramUsername: "cleanpay_support",
        faqUrl: "https://help.example.com/faq",
      },
    }));

    expect(screen.getByRole("link", { name: /Написать на почту/i }).getAttribute("href"))
      .toBe("mailto:help@example.com");
    expect(screen.getByRole("link", { name: /Telegram/i }).getAttribute("href"))
      .toBe("https://t.me/cleanpay_support");
    expect(screen.getByRole("link", { name: /FAQ и инструкции/i }).getAttribute("href"))
      .toBe("https://help.example.com/faq");
  });
});
