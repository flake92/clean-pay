import { describe, expect, it } from "vitest";

import {
  profileAuthTypeLabel,
  profileEmailTurnstileAction,
  profileReminderDaysLabel,
  selectProfilePresentation,
} from "@/frontend/components/profile-presentation";

describe("profile presentation selectors", () => {
  it("projects account capabilities without changing provider state", () => {
    const model = {
      status: "ready" as const,
      user: {
        authType: "telegram",
        email: "user@example.test",
        emailVerified: true,
        pendingEmail: "next@example.test",
        telegramId: "123",
      },
      emailReminders: {
        status: "ready" as const,
        enabled: true,
        emailEligible: true,
        senderEmail: "sender@example.test",
        daysBefore: [7, 1],
      },
    };

    expect(selectProfilePresentation(model)).toEqual({
      kind: "ready",
      user: model.user,
      initialEmailReminders: model.emailReminders,
      currentEmailTarget: "next@example.test",
      hasEmail: true,
      isEmailVerified: true,
      isTelegramOnly: false,
      canManageRemnashopEmail: true,
      canChangePassword: true,
    });
  });

  it("keeps non-ready profile states presentation-only", () => {
    expect(selectProfilePresentation({ status: "unauthorized" }))
      .toEqual({ kind: "empty" });
    expect(selectProfilePresentation({ status: "error", message: "failed" }))
      .toEqual({ kind: "error", message: "failed" });
  });

  it("preserves labels and case-insensitive Turnstile action selection", () => {
    expect(profileAuthTypeLabel("passkey")).toBe("Ключ доступа");
    expect(profileAuthTypeLabel("future")).toBe("future");
    expect(profileReminderDaysLabel([])).toBe("заранее");
    expect(profileReminderDaysLabel([7, 3, 1])).toBe("за 7, 3 и 1 день");
    expect(profileEmailTurnstileAction(" USER@example.test ", "user@example.test"))
      .toBe("email_verification");
    expect(profileEmailTurnstileAction("next@example.test", "user@example.test"))
      .toBe("email_change");
  });
});
