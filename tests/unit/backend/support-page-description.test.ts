import { describe, expect, it } from "vitest";

import { supportPageDescription } from "@/application/support/load-support";

const unavailable = {
  enabled: false,
  email: null,
  telegramUsername: null,
  faqUrl: null,
  liveChatEnabled: false,
};

describe("support page description", () => {
  it("does not claim that support is unavailable when live chat is configured", () => {
    expect(supportPageDescription({
      ...unavailable,
      liveChatEnabled: true,
    })).toBe("Авторизованным пользователям доступен чат поддержки.");
  });

  it("describes published contacts and combined contact options accurately", () => {
    expect(supportPageDescription({
      ...unavailable,
      enabled: true,
      email: "help@example.com",
    })).toBe("Выберите удобный способ связи.");
    expect(supportPageDescription({
      ...unavailable,
      enabled: true,
      email: "help@example.com",
      liveChatEnabled: true,
    })).toBe("После входа доступен чат; также можно выбрать удобный способ связи.");
  });

  it("uses neutral help copy when no contact channel is configured", () => {
    expect(supportPageDescription(unavailable)).toBe(
      "Инструкции по подключению, оплате и восстановлению доступа.",
    );
  });
});
