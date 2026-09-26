import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { selectProfilePresentation } from "@/frontend/components/profile-presentation";
import {
  beginProfilePendingAction,
  createInitialProfileControllerState,
  createProfileEmailPayload,
  createProfileVerificationPayload,
  finishProfilePendingAction,
  profileControllerReducer,
} from "@/frontend/components/profile-transitions";

const readyModel = {
  status: "ready" as const,
  user: {
    authType: "passkey",
    email: "old@example.com",
    emailVerified: true,
    pendingEmail: "pending@example.com",
    telegramId: "777",
  },
  emailReminders: {
    status: "ready" as const,
    enabled: false,
    emailEligible: true,
    senderEmail: "no-reply@example.com",
    daysBefore: [7, 3, 1],
  },
};

describe("profile pure transitions", () => {
  it("initializes every local value from the exact presentation snapshot", () => {
    const presentation = selectProfilePresentation(readyModel);

    expect(createInitialProfileControllerState(presentation)).toEqual({
      email: "pending@example.com",
      currentPassword: "",
      newPassword: "",
      message: null,
      messageSeverity: "info",
      passwordMessage: null,
      passwordMessageSeverity: "success",
      pendingAction: null,
      emailReminders: readyModel.emailReminders,
      emailReminderMessage: null,
      emailReminderSeverity: "success",
      turnstileToken: null,
      turnstile: null,
    });
  });

  it("reduces form values, feedback, pending action, and Turnstile state", () => {
    const initial = createInitialProfileControllerState(
      selectProfilePresentation(readyModel),
    );
    const reset = vi.fn();
    const events = [
      { type: "email-changed", email: "next@example.com" },
      { type: "current-password-changed", password: "old-password" },
      { type: "new-password-changed", password: "new-password" },
      {
        type: "message-shown",
        message: "email failed",
        severity: "error",
      },
      {
        type: "password-message-shown",
        message: "password failed",
        severity: "warn",
      },
      { type: "pending-action-changed", action: "email" },
      { type: "turnstile-changed", turnstile: { reset } },
      { type: "turnstile-token-changed", token: "token" },
    ] as const;
    const changed = events.reduce(profileControllerReducer, initial);

    expect(initial.email).toBe("pending@example.com");
    expect(changed).toMatchObject({
      email: "next@example.com",
      currentPassword: "old-password",
      newPassword: "new-password",
      message: "email failed",
      messageSeverity: "error",
      passwordMessage: "password failed",
      passwordMessageSeverity: "warn",
      pendingAction: "email",
      turnstile: { reset },
      turnstileToken: "token",
    });
  });

  it("preserves clear and reminder success transitions independently", () => {
    const initial = createInitialProfileControllerState(
      selectProfilePresentation(readyModel),
    );
    const withMessage = profileControllerReducer(initial, {
      type: "message-shown",
      message: "message",
      severity: "warn",
    });
    const cleared = profileControllerReducer(withMessage, {
      type: "message-cleared",
    });
    const withPassword = profileControllerReducer(cleared, {
      type: "password-message-shown",
      message: "password",
      severity: "warn",
    });
    const passwordCleared = profileControllerReducer(withPassword, {
      type: "password-message-cleared",
    });
    const reminderCleared = profileControllerReducer(passwordCleared, {
      type: "email-reminder-message-cleared",
    });
    const preference = {
      enabled: true,
      emailEligible: true,
      senderEmail: "sender@example.com",
      daysBefore: [3, 1],
    };
    const withPreference = profileControllerReducer(reminderCleared, {
      type: "email-reminders-changed",
      preference,
    });
    const withReminder = profileControllerReducer(withPreference, {
      type: "email-reminder-message-shown",
      message: "enabled",
      severity: "success",
    });
    const passwordsCleared = profileControllerReducer(withReminder, {
      type: "passwords-cleared",
    });

    expect(passwordsCleared).toMatchObject({
      message: null,
      messageSeverity: "warn",
      passwordMessage: null,
      passwordMessageSeverity: "warn",
      emailReminders: preference,
      emailReminderMessage: "enabled",
      emailReminderSeverity: "success",
      currentPassword: "",
      newPassword: "",
    });
  });

  it("keeps pending operations atomic and finishes only the matching action", () => {
    expect(beginProfilePendingAction(null, "email")).toEqual({
      accepted: true,
      action: "email",
    });
    expect(beginProfilePendingAction("email", "password")).toEqual({
      accepted: false,
      action: "email",
    });
    expect(finishProfilePendingAction("email", "password")).toBe("email");
    expect(finishProfilePendingAction("email", "email")).toBeNull();
  });

  it("builds byte-equivalent optional Turnstile payload shapes", () => {
    expect(createProfileEmailPayload("next@example.com", null)).toEqual({
      email: "next@example.com",
    });
    expect(createProfileEmailPayload("next@example.com", "token")).toEqual({
      email: "next@example.com",
      turnstileToken: "token",
    });
    expect(createProfileVerificationPayload("", null)).toEqual({});
    expect(
      createProfileVerificationPayload("old@example.com", "token"),
    ).toEqual({
      email: "old@example.com",
      turnstileToken: "token",
    });
  });

  it("keeps ProfilePanel as the facade's only runtime export", () => {
    const source = readFileSync(
      "src/frontend/components/profile-panel.tsx",
      "utf8",
    );
    const runtimeExports = Array.from(
      source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm),
      (match) => match[1],
    );

    expect(runtimeExports).toEqual(["ProfilePanel"]);
  });
});
