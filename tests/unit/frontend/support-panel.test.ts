// @vitest-environment jsdom

import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupportPanel } from "@/frontend/components/support-panel";

const unavailable = {
  enabled: false,
  email: null,
  telegramUsername: null,
  faqUrl: null,
  liveChatEnabled: false,
};

describe("SupportPanel", () => {
  afterEach(() => {
    delete window.$chatwoot;
    delete window.cleanPayChatwootAuthorized;
    delete window.cleanPayChatwootIdentity;
    delete window.cleanPayChatwootOwnership;
    delete window.cleanPayChatwootPendingIdentity;
    delete window.cleanPayChatwootFailedIdentity;
  });

  it("points to the configured live chat instead of claiming support is unpublished", () => {
    render(createElement(SupportPanel, {
      support: { ...unavailable, liveChatEnabled: true },
    }));

    expect(screen.getByText(/Чат доступен после входа в аккаунт/i)).toBeTruthy();
    expect(screen.queryByText(/Контакты поддержки пока не опубликованы/i)).toBeNull();
  });

  it("opens the verified Chatwoot conversation from an explicit support button", async () => {
    const toggle = vi.fn();
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootIdentity = { core: "actor", customAttributes: "context" };
    window.$chatwoot = {
      baseUrl: "https://chat.example.com",
      websiteToken: "token",
      hasLoaded: true,
      setUser: vi.fn(),
      toggle,
      toggleBubbleVisibility: vi.fn(),
      reset: vi.fn(),
    };

    render(createElement(SupportPanel, {
      support: { ...unavailable, liveChatEnabled: true },
    }));

    const button = await screen.findByRole("button", { name: /Открыть чат поддержки/i });
    fireEvent.click(button);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith("open"));
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
