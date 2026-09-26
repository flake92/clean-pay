import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { LinkAccountViewModel } from "@/application/models/link-account";
import {
  beginLinkAccountAction,
  createInitialLinkAccountControllerState,
  createLinkedTelegramStartUrl,
  finishLinkAccountAction,
  linkAccountControllerReducer,
  readLinkAccountEmailSubmission,
  selectLinkAccountPanelState,
  shouldClearTelegramMergeConfirmation,
} from "@/frontend/components/link-account-transitions";

function readyModel(): Extract<LinkAccountViewModel, { status: "ready" }> {
  return {
    status: "ready",
    profile: {
      email: "user@example.com",
      emailVerified: false,
      telegramId: "777",
    },
    passkeys: [
      {
        id: "key-1",
        name: "Phone",
        createdAt: "2026-08-01T00:00:00.000Z",
        lastUsedAt: null,
      },
      {
        id: "key-2",
        name: "Laptop",
        createdAt: "2026-08-02T00:00:00.000Z",
        lastUsedAt: "2026-08-03T00:00:00.000Z",
      },
    ],
    mergeConfirmation: {
      targetEmail: "user@example.com",
      sourceEmailMasked: null,
      emailWillBeReplaced: false,
      telegramId: "888",
    },
    callbackError: "callback failed",
  };
}

describe("link-account pure transitions", () => {
  it("initializes controller state with the existing model-derived values", () => {
    const model = readyModel();

    expect(createInitialLinkAccountControllerState(model)).toEqual({
      actionLoading: null,
      passkeys: model.passkeys,
      message: null,
      error: "callback failed",
      turnstileToken: null,
      turnstile: null,
      webAuthnSupported: null,
      mergeConfirmation: model.mergeConfirmation,
    });
    expect(
      createInitialLinkAccountControllerState({
        status: "provider-session-recovery-required",
      }).error,
    ).toBeNull();
  });

  it("reduces feedback, capability, merge, and passkey events without mutation", () => {
    const initial = createInitialLinkAccountControllerState(readyModel());
    const reset = vi.fn();
    const withLoading = linkAccountControllerReducer(initial, {
      type: "action-loading-changed",
      action: "email",
    });
    const withFeedback = linkAccountControllerReducer(withLoading, {
      type: "message-changed",
      message: "saved",
    });
    const withError = linkAccountControllerReducer(withFeedback, {
      type: "error-changed",
      error: "failed",
    });
    const withTurnstile = linkAccountControllerReducer(withError, {
      type: "turnstile-changed",
      turnstile: { reset },
    });
    const withToken = linkAccountControllerReducer(withTurnstile, {
      type: "turnstile-token-changed",
      token: "turnstile-token",
    });
    const withWebAuthn = linkAccountControllerReducer(withToken, {
      type: "webauthn-support-changed",
      supported: true,
    });
    const withoutPasskey = linkAccountControllerReducer(withWebAuthn, {
      type: "passkey-removed",
      id: "key-1",
    });
    const withoutMerge = linkAccountControllerReducer(withoutPasskey, {
      type: "merge-confirmation-changed",
      confirmation: null,
    });

    expect(initial.actionLoading).toBeNull();
    expect(initial.passkeys).toHaveLength(2);
    expect(withoutMerge).toMatchObject({
      actionLoading: "email",
      message: "saved",
      error: "failed",
      turnstile: { reset },
      turnstileToken: "turnstile-token",
      webAuthnSupported: true,
      mergeConfirmation: null,
      passkeys: [{ id: "key-2" }],
    });
  });

  it("selects the existing account flags and guided destinations", () => {
    const model = readyModel();
    const state = createInitialLinkAccountControllerState(model);
    const selected = selectLinkAccountPanelState({
      guided: true,
      model,
      passwordRequired: true,
      redirectTo: "/payment?plan=pro",
      state,
    });

    expect(selected).toMatchObject({
      profile: model.profile,
      sessionExpired: false,
      emailVerified: false,
      telegramId: "777",
      hasEmail: true,
      hasTelegram: true,
      hasPasskey: true,
      requiresPasswordReauth: true,
      returnsToPayment: true,
      usesCurrentPassword: true,
      verificationDestination:
        "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro",
      setupDestination:
        "/link-account?reason=email-required&step=password&redirect_to=%2Fpayment%3Fplan%3Dpro",
    });
  });

  it("keeps action admission atomic and clears only the matching action", () => {
    expect(beginLinkAccountAction(null, "email")).toEqual({
      accepted: true,
      action: "email",
    });
    expect(beginLinkAccountAction("email", "telegram")).toEqual({
      accepted: false,
      action: "email",
    });
    expect(finishLinkAccountAction("email", "telegram")).toBe("email");
    expect(finishLinkAccountAction("email", "email")).toBeNull();
  });

  it("preserves merge-conflict decisions and exact Telegram query order", () => {
    expect(
      shouldClearTelegramMergeConfirmation(
        "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
      ),
    ).toBe(true);
    expect(
      shouldClearTelegramMergeConfirmation("ACCOUNT_MERGE_REQUIRED"),
    ).toBe(true);
    expect(shouldClearTelegramMergeConfirmation("EMAIL_REQUIRED")).toBe(false);

    expect(
      createLinkedTelegramStartUrl({
        origin: "https://pay.example.com",
        setupDestination:
          "/link-account?reason=email-required&redirect_to=%2Fpayment",
        turnstileToken: "turnstile-token",
      }).toString(),
    ).toBe(
      "https://pay.example.com/auth/telegram/start?redirect_to=%2Flink-account%3Freason%3Demail-required%26redirect_to%3D%252Fpayment&turnstile_token=turnstile-token&cf-turnstile-response=turnstile-token",
    );
  });

  it("keeps the exact trimmed e-mail and unmodified password submission", () => {
    const formData = new FormData();
    formData.set("email", "  User@Example.com  ");
    formData.set("password", " password with spaces ");
    formData.set("confirmPassword", " password with spaces ");

    expect(readLinkAccountEmailSubmission(formData)).toEqual({
      email: "User@Example.com",
      password: " password with spaces ",
      confirmPassword: " password with spaces ",
    });
  });

  it("keeps LinkAccountPanel as the facade's only runtime export", () => {
    const source = readFileSync(
      "src/frontend/components/link-account-panel.tsx",
      "utf8",
    );
    const runtimeExports = Array.from(
      source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm),
      (match) => match[1],
    );

    expect(runtimeExports).toEqual(["LinkAccountPanel"]);
  });
});
