import { describe, expect, it } from "vitest";

import {
  accountReadinessTransition,
  confirmVerificationTransition,
  initialVerificationTransition,
  missingTurnstileTokenMessage,
  requestVerificationTransition,
  selectVerificationViewState,
} from "@/frontend/components/verify-email-state";

describe("verification presentation transitions", () => {
  it("continues only a ready auto-continue flow", () => {
    expect(initialVerificationTransition({ status: "ready" }, true)).toEqual({
      kind: "present",
      confirmed: true,
      accountSyncPending: false,
      syncProblemUpdate: { kind: "set", value: null },
      severity: "success",
      message: "E-mail подтверждён. Возвращаем вас к прерванному действию.",
      continueToCompletedDestination: true,
    });
    expect(initialVerificationTransition({ status: "ready" }, false))
      .toMatchObject({ continueToCompletedDestination: false });
  });

  it("keeps verified-but-unsynchronized accounts pending", () => {
    expect(initialVerificationTransition(
      { status: "pending", emailVerified: true },
      true,
    )).toMatchObject({
      kind: "present",
      accountSyncPending: true,
      syncProblemUpdate: { kind: "preserve" },
      severity: "warn",
      continueToCompletedDestination: false,
    });
  });

  it.each([
    ["merge-conflict", "merge-conflict"],
    ["unauthorized", "unauthorized"],
    ["unavailable", null],
  ] as const)("projects %s without continuing", (status, syncProblem) => {
    expect(initialVerificationTransition({ status }, true)).toMatchObject({
      kind: "present",
      accountSyncPending: true,
      syncProblemUpdate: { kind: "set", value: syncProblem },
      continueToCompletedDestination: false,
    });
  });

  it("does not invent a transition for untouched pending and recovery states", () => {
    expect(initialVerificationTransition(
      { status: "pending", emailVerified: false },
      true,
    )).toEqual({ kind: "unchanged" });
    expect(initialVerificationTransition(
      { status: "provider-session-recovery-required" },
      true,
    )).toEqual({ kind: "unchanged" });
  });

  it("characterizes the existing silent EMAIL_REQUIRED branch", () => {
    const result = {
      ok: false as const,
      code: "EMAIL_REQUIRED",
      message: "provider detail",
    };

    expect(requestVerificationTransition(result, false)).toEqual({
      kind: "rejected",
      error: null,
      clearTargetEmail: true,
      continueToPasswordRecovery: false,
    });
    expect(confirmVerificationTransition(result, false)).toEqual({
      kind: "rejected",
      error: null,
      continueToPasswordRecovery: false,
    });
    expect(confirmVerificationTransition(result, true)).toMatchObject({
      kind: "rejected",
      continueToPasswordRecovery: true,
      error: "Связь с e-mail нужно восстановить. Возвращаем к вводу e-mail и пароля.",
    });
  });

  it("keeps mismatched successful action kinds observable as no-ops", () => {
    expect(requestVerificationTransition({
      ok: true,
      kind: "confirmed",
      readiness: { status: "ready" },
    }, false)).toEqual({ kind: "unchanged" });
    expect(confirmVerificationTransition({
      ok: true,
      kind: "code-sent",
      targetEmail: "owner@example.com",
    }, false)).toEqual({ kind: "unchanged" });
  });

  it("projects confirmed readiness without changing messages or destinations", () => {
    expect(confirmVerificationTransition({
      ok: true,
      kind: "confirmed",
      readiness: { status: "ready" },
    }, true)).toEqual({
      kind: "confirmed",
      accountSyncPending: false,
      syncProblem: null,
      severity: "success",
      message: "E-mail подтверждён. Возвращаем вас к прерванному действию.",
      continueToCompletedDestination: true,
    });
    expect(confirmVerificationTransition({
      ok: true,
      kind: "confirmed",
      readiness: { status: "merge-conflict" },
    }, false)).toMatchObject({
      kind: "confirmed",
      accountSyncPending: true,
      syncProblem: "merge-conflict",
      severity: "warn",
      continueToCompletedDestination: false,
    });
  });

  it("keeps readiness retries in discriminated states", () => {
    expect(accountReadinessTransition({ status: "ready" })).toEqual({
      kind: "ready",
      message: "Аккаунт готов. Возвращаем вас к прерванному действию.",
    });
    expect(accountReadinessTransition({
      status: "pending",
      emailVerified: false,
    })).toMatchObject({ kind: "email-unverified" });
    expect(accountReadinessTransition({ status: "unauthorized" }))
      .toMatchObject({ kind: "pending", syncProblem: "unauthorized" });
    expect(accountReadinessTransition({
      status: "provider-session-recovery-required",
    })).toMatchObject({ kind: "pending", syncProblem: null });
  });

  it("selects the existing confirmed and entry presentations", () => {
    expect(selectVerificationViewState({
      confirmed: true,
      accountSyncPending: true,
      syncProblem: null,
      error: "ignored in confirmed presentation",
      message: "status",
      messageSeverity: "warn",
    })).toEqual({
      kind: "confirmed",
      accountSyncPending: true,
      syncProblem: null,
      message: "status",
      messageSeverity: "warn",
    });
    expect(selectVerificationViewState({
      confirmed: false,
      accountSyncPending: false,
      syncProblem: null,
      error: "error",
      message: null,
      messageSeverity: "success",
    })).toMatchObject({ kind: "entry", error: "error" });
  });

  it("preserves Turnstile prerequisite copy", () => {
    expect(missingTurnstileTokenMessage(true))
      .toBe("Пройдите проверку Cloudflare Turnstile.");
    expect(missingTurnstileTokenMessage(false))
      .toBe("Ключ сайта Cloudflare Turnstile не настроен.");
  });
});
