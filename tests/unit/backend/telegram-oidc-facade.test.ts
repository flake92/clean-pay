import { describe, expect, it } from "vitest";

import {
  decodeTelegramTokenResponse,
  getTelegramFullName,
  getTelegramId,
  normalizeTelegramOidcClientSecret,
  telegramWidgetReplayTtlSeconds,
} from "@/backend/integrations/telegram/oidc-codec";

describe("Telegram OIDC façade and pure decoding boundaries", () => {
  it("preserves the exact runtime façade", async () => {
    const oidcFacade = await import("@/backend/integrations/telegram/oidc");
    expect(Object.keys(oidcFacade).sort()).toEqual([
      "TelegramAuthStateAlreadyConsumedError",
      "clearTelegramAuthCookies",
      "clearTelegramAuthCookiesOnResponse",
      "createTelegramAuthorizationResponse",
      "createTelegramPopupStartResponse",
      "readTelegramCallbackCookieProof",
      "resetTelegramOidcJwksForTests",
      "resumeTelegramOidcCodeExchange",
      "resumeTelegramProviderAuthentication",
      "verifyTelegramCallback",
      "verifyTelegramPopupToken",
      "verifyTelegramWidgetCallbackPayload",
    ]);
  });

  it("projects token responses from unknown and rejects malformed fields", () => {
    expect(decodeTelegramTokenResponse({
      id_token: "token",
      error_description: "description",
      browser_only_secret: "must-not-cross",
    })).toEqual({
      id_token: "token",
      error_description: "description",
    });
    expect(() => decodeTelegramTokenResponse([])).toThrow(/must be an object/);
    expect(() => decodeTelegramTokenResponse({ id_token: 42 }))
      .toThrow(/id_token must be a string/);
  });

  it("keeps identity and replay calculations deterministic", () => {
    expect(normalizeTelegramOidcClientSecret("42", "42:secret")).toBe("secret");
    expect(normalizeTelegramOidcClientSecret("42", "secret")).toBe("secret");
    expect(getTelegramId({ telegram_id: 42 })).toBe("42");
    expect(getTelegramFullName({ given_name: "Clean", family_name: "User" }))
      .toBe("Clean User");
    expect(telegramWidgetReplayTtlSeconds(1_000, 1_010)).toBe(290);
    expect(telegramWidgetReplayTtlSeconds(1_000, 2_000)).toBe(1);
  });
});
