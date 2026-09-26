import { describe, expect, it } from "vitest";

import {
  authMethodStatusLabel,
  authMethodStatusSeverity,
  linkAccountDestinations,
  linkAccountPasskeyDescription,
  telegramMergeConfirmationMessage,
} from "@/frontend/components/link-account-presentation";

describe("link-account presentation selectors", () => {
  it("preserves guided destinations and password reauthentication", () => {
    expect(linkAccountDestinations({
      guided: true,
      passwordRequired: true,
      redirectTo: "/payment?plan=pro",
    })).toEqual({
      requiresPasswordReauth: true,
      returnsToPayment: true,
      verificationDestination: "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro",
      setupDestination: "/link-account?reason=email-required&step=password&redirect_to=%2Fpayment%3Fplan%3Dpro",
      loginDestination: "/login?redirect_to=%2Flink-account%3Freason%3Demail-required%26step%3Dpassword%26redirect_to%3D%252Fpayment%253Fplan%253Dpro",
    });
    expect(linkAccountDestinations({
      guided: false,
      passwordRequired: true,
      redirectTo: "/cabinet",
    })).toMatchObject({
      requiresPasswordReauth: false,
      returnsToPayment: false,
      verificationDestination: "/verify-email",
      setupDestination: "/link-account",
    });
  });

  it("keeps auth method and passkey labels exact", () => {
    expect(authMethodStatusSeverity(true)).toBe("success");
    expect(authMethodStatusSeverity(false, true)).toBe("warning");
    expect(authMethodStatusLabel(false)).toBe("Не подключено");
    expect(linkAccountPasskeyDescription(true, true))
      .toBe("Быстрый вход уже настроен для этого аккаунта.");
    expect(linkAccountPasskeyDescription(false, false))
      .toContain("быстрый вход недоступен");
  });

  it("keeps both Telegram merge disclosures and the rolling payload fallback", () => {
    const base = {
      targetEmail: "target@example.test",
      sourceEmailMasked: null,
      emailWillBeReplaced: false,
      telegramId: "123",
    };
    expect(telegramMergeConfirmationMessage(base)).toContain("останется без изменений");
    expect(telegramMergeConfirmationMessage({
      ...base,
      sourceEmailMasked: "s***@example.test",
      emailWillBeReplaced: true,
    })).toContain("s***@example.test больше нельзя будет использовать");
  });
});
