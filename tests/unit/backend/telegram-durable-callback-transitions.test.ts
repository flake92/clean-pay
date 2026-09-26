import { describe, expect, it } from "vitest";

import {
  durableTelegramCallbackStatus,
} from "@/backend/integrations/telegram/durable-callback-contract";
import {
  committedDurableTelegramRecoveryReplay,
  durableTelegramCallbackProofMatches,
  durableTelegramCallbackReplayDeadline,
  durableTelegramCallbackResultExpiry,
  durableTelegramCallbackTransitions,
  durableTelegramCallbackWorkDeadline,
  replayFromDurableTelegramOutcome,
} from "@/backend/integrations/telegram/durable-callback-transitions";

describe("durable Telegram callback pure transitions", () => {
  it("preserves the exact ordered state transition matrix", () => {
    expect(durableTelegramCallbackTransitions).toEqual({
      providerDispatching: {
        from: "PROVIDER_READY",
        to: "PROVIDER_DISPATCHING",
      },
      identityVerified: {
        from: "PROVIDER_DISPATCHING",
        to: "IDENTITY_VERIFIED",
      },
      remnashopDispatching: {
        from: "IDENTITY_VERIFIED",
        to: "REMNASHOP_DISPATCHING",
      },
      providerAuthenticated: {
        from: "REMNASHOP_DISPATCHING",
        to: "PROVIDER_AUTHENTICATED",
      },
      identityResolved: {
        from: "PROVIDER_AUTHENTICATED",
        to: "IDENTITY_RESOLVED",
      },
      outcomeReady: {
        from: "IDENTITY_RESOLVED",
        to: "OUTCOME_READY",
      },
      recoveryDispatching: {
        from: "SESSION_CREATED",
        to: "RECOVERY_DISPATCHING",
      },
      recoveryCommitted: {
        from: "RECOVERY_DISPATCHING",
        to: "SESSION_CREATED",
      },
    });
    expect(Object.isFrozen(durableTelegramCallbackTransitions)).toBe(true);
    expect(Object.values(durableTelegramCallbackStatus)).toEqual([
      "READY",
      "PROVIDER_READY",
      "PROVIDER_DISPATCHING",
      "IDENTITY_VERIFIED",
      "REMNASHOP_DISPATCHING",
      "PROVIDER_AUTHENTICATED",
      "IDENTITY_RESOLVED",
      "OUTCOME_READY",
      "SESSION_CREATED",
      "RECOVERY_DISPATCHING",
      "COMPLETED",
      "FAILED",
    ]);
  });

  it("projects session and merge outcomes into byte-stable replay shapes", () => {
    expect(replayFromDurableTelegramOutcome({
      redirectTo: "/cabinet?tab=devices",
      session: {
        userId: "user-1",
        requiresTelegramRecovery: true,
      },
      audit: { userId: "user-1", remnashopLinked: true },
    }, "web-session-1", "bootstrap-refresh-token")).toEqual({
      redirectTo: "/cabinet?tab=devices",
      session: {
        webSessionId: "web-session-1",
        userId: "user-1",
        bootstrapRefreshToken: "bootstrap-refresh-token",
        requiresTelegramRecovery: true,
      },
      audit: { userId: "user-1", remnashopLinked: true },
    });
    expect(replayFromDurableTelegramOutcome({
      redirectTo: "/tariffs",
      mergeConfirmation: { token: "merge-token" },
      audit: { userId: "user-2", remnashopLinked: false },
    })).toEqual({
      redirectTo: "/tariffs",
      mergeConfirmation: { token: "merge-token" },
      audit: { userId: "user-2", remnashopLinked: false },
    });
  });

  it("fails before projecting a session outcome without exact bootstrap credentials", () => {
    const outcome = {
      redirectTo: "/cabinet",
      session: { userId: "user-1", requiresTelegramRecovery: false },
      audit: { userId: "user-1", remnashopLinked: true },
    };

    expect(() => replayFromDurableTelegramOutcome(outcome))
      .toThrow("Durable Telegram callback is missing session bootstrap credentials");
    expect(() => replayFromDurableTelegramOutcome(outcome, "session-only"))
      .toThrow("Durable Telegram callback is missing session bootstrap credentials");
  });

  it("commits only the recovery flag while preserving the prior replay", () => {
    const replay = {
      redirectTo: "/cabinet",
      session: {
        webSessionId: "web-session-1",
        userId: "user-1",
        bootstrapRefreshToken: "bootstrap-refresh-token",
        requiresTelegramRecovery: true,
      },
      audit: { userId: "user-1", remnashopLinked: true },
    };

    expect(committedDurableTelegramRecoveryReplay(replay)).toEqual({
      ...replay,
      session: { ...replay.session, requiresTelegramRecovery: false },
    });
    expect(replay.session.requiresTelegramRecovery).toBe(true);
    expect(() => committedDurableTelegramRecoveryReplay({
      redirectTo: "/tariffs",
      mergeConfirmation: { token: "merge-token" },
      audit: { userId: "user-2", remnashopLinked: false },
    })).toThrow("Durable Telegram recovery commit has no exact session");
  });

  it("keeps work, replay, and relative result deadlines exactly bounded", () => {
    const authStateExpiresAt = new Date("2026-08-25T12:00:00.000Z");
    const withinWindow = new Date("2026-08-25T12:05:00.000Z");
    const afterWindow = new Date("2026-08-25T12:15:00.000Z");

    expect(durableTelegramCallbackWorkDeadline(authStateExpiresAt).toISOString())
      .toBe("2026-08-25T12:10:00.000Z");
    expect(durableTelegramCallbackReplayDeadline(authStateExpiresAt).toISOString())
      .toBe("2026-08-25T12:20:00.000Z");
    expect(durableTelegramCallbackResultExpiry(authStateExpiresAt, withinWindow).toISOString())
      .toBe("2026-08-25T12:15:00.000Z");
    expect(durableTelegramCallbackResultExpiry(authStateExpiresAt, afterWindow).toISOString())
      .toBe("2026-08-25T12:20:00.000Z");
  });

  it("requires all three browser proof hashes to match", () => {
    const record = {
      stateHash: "state-hash",
      nonceHash: "nonce-hash",
      codeVerifierHash: "verifier-hash",
    };

    expect(durableTelegramCallbackProofMatches(record, record)).toBe(true);
    for (const key of ["stateHash", "nonceHash", "codeVerifierHash"] as const) {
      expect(durableTelegramCallbackProofMatches(record, {
        ...record,
        [key]: `wrong-${key}`,
      })).toBe(false);
    }
  });
});
