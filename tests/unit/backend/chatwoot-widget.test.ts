import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportWidgetIdentity } from "@/application/models/navigation";

const mockedEnv = vi.hoisted(() => ({
  chatwoot: {
    baseUrl: "https://chat.example.com",
    websiteToken: "website_token_123456789",
    hmacToken: "chatwoot-hmac-secret-0123456789",
  } as {
    baseUrl: string;
    websiteToken: string;
    hmacToken: string;
  } | null,
}));

vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({ chatwoot: mockedEnv.chatwoot }),
}));

import { createChatwootWidgetConfig } from "@/backend/integrations/support/chatwoot-widget";

const identity: SupportWidgetIdentity = {
  userId: "user-123",
  email: "verified@example.com",
  emailVerified: true,
  telegramId: "7654321",
  telegramUsername: "clean_pay_user",
  fullName: "Clean Pay User",
  displayName: "Support Customer",
};

describe("Chatwoot widget server configuration", () => {
  beforeEach(() => {
    mockedEnv.chatwoot = {
      baseUrl: "https://chat.example.com",
      websiteToken: "website_token_123456789",
      hmacToken: "chatwoot-hmac-secret-0123456789",
    };
  });

  it("signs the immutable internal identifier without exposing the HMAC token", () => {
    const config = createChatwootWidgetConfig(identity);

    expect(config).toEqual({
      baseUrl: "https://chat.example.com",
      websiteToken: "website_token_123456789",
      user: {
        identifier: "user-123",
        identifierHash: "44cf663bd861e3d5608e8dad24cdd634b473b25e4c3aed0441d91576971e74c1",
        name: "Support Customer",
        email: "verified@example.com",
        customAttributes: {
          clean_pay_user_id: "user-123",
          telegram_id: "7654321",
          telegram_username: "clean_pay_user",
        },
      },
    });
    expect(JSON.stringify(config)).not.toContain(mockedEnv.chatwoot!.hmacToken);
  });

  it("never sends an unverified e-mail and clears missing Telegram attributes", () => {
    const config = createChatwootWidgetConfig({
      ...identity,
      emailVerified: false,
      telegramId: null,
      telegramUsername: "@telegram_name",
      displayName: null,
      fullName: null,
    });

    expect(config?.user).toMatchObject({
      name: "@telegram_name",
      email: null,
      customAttributes: {
        clean_pay_user_id: "user-123",
        telegram_id: "",
        telegram_username: "telegram_name",
      },
    });
  });

  it("stays disabled for guests or when the three server settings are absent", () => {
    expect(createChatwootWidgetConfig(null)).toBeNull();

    mockedEnv.chatwoot = null;
    expect(createChatwootWidgetConfig(identity)).toBeNull();
  });
});
