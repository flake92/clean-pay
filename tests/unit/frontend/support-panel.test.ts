// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SupportPanel } from "@/frontend/components/support-panel";

const unavailable = {
  enabled: false,
  email: null,
  telegramUsername: null,
  faqUrl: null,
  liveChatEnabled: false,
};

describe("SupportPanel", () => {
  it("points to the configured live chat instead of claiming support is unpublished", () => {
    render(createElement(SupportPanel, {
      support: { ...unavailable, liveChatEnabled: true },
    }));

    expect(screen.getByText(/Войдите в аккаунт, чтобы написать нам в чате/i)).toBeTruthy();
    expect(screen.queryByText(/Контакты поддержки пока не опубликованы/i)).toBeNull();
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
