import { describe, expect, it, vi } from "vitest";

import { completeTelegramCallback } from "@/application/auth/complete-telegram-callback";
import type { TelegramCallbackGateway } from "@/application/auth/ports/telegram-callback";

const providerSession = { context: { provider: true } };

function gateway(overrides: Partial<TelegramCallbackGateway> = {}): TelegramCallbackGateway {
  return {
    consume: vi.fn(async () => ({
      authState: { id: "state-1", targetUserId: "target-local", redirectTo: "/cabinet" },
      identity: {
        telegramId: "777",
        telegramUsername: "selected",
        fullName: "Selected User",
        photoUrl: null,
        providerSession,
      },
    })),
    assertIdentityRateLimit: vi.fn(async () => undefined),
    findUserByTelegramId: vi.fn(async () => null),
    findUserById: vi.fn(async () => ({
      id: "target-local",
      upstreamAccountId: "target-account",
      email: "owner@example.com",
      emailVerified: true,
      telegramId: "777",
    })),
    loadProviderMergeIdentity: vi.fn(async () => ({
      accountId: "target-account",
      email: "owner@example.com",
      emailVerified: true,
      pendingEmail: null,
      telegramId: "777",
    })),
    preflightAccountMerge: vi.fn(async () => ({
      conflicts: [],
      dryRun: true,
      sourceAccountId: "source-account",
      targetAccountId: "target-account",
      target: { accountId: "target-account", email: "owner@example.com", emailVerified: true, telegramId: "777" },
      requiresRelogin: true,
    })),
    persistAccountMergeConfirmation: vi.fn(async () => ({ token: "merge-token" })),
    applyTelegramIdentity: vi.fn(async () => ({
      id: "target-local",
      upstreamAccountId: "target-account",
      email: "owner@example.com",
      emailVerified: true,
      telegramId: "777",
    })),
    markAuthStateUser: vi.fn(async () => undefined),
    auditIdentityResolved: vi.fn(async () => undefined),
    clearTemporaryAuth: vi.fn(async () => undefined),
    providerAccountId: vi.fn(() => "source-account"),
    attachTelegramToCurrentAccount: vi.fn(async () => undefined),
    mergeProviderAccounts: vi.fn(async () => true),
    linkProviderSession: vi.fn(async () => ({ userId: "target-local", requiresTelegramRecovery: true })),
    reconcileProviderSession: vi.fn(async () => ({ userId: "target-local", requiresTelegramRecovery: false })),
    withOwnerChangeFence: vi.fn(async ({ work }) => work()),
    logAttachFailure: vi.fn(),
    ...overrides,
  };
}

const input = { kind: "oidc" as const, code: "code", state: "state" };

describe("completeTelegramCallback", () => {
  it("links directly when Telegram already resolves to the target provider account", async () => {
    const subject = gateway();

    await expect(completeTelegramCallback(subject, input)).resolves.toMatchObject({
      redirectTo: "/cabinet",
      session: { userId: "target-local", requiresTelegramRecovery: false },
    });
    expect(subject.preflightAccountMerge).not.toHaveBeenCalled();
    expect(subject.attachTelegramToCurrentAccount).toHaveBeenCalledWith({
      telegramId: "777",
      telegramUsername: "selected",
      ownerFenceHeld: true,
    });
  });

  it("requires the upstream provider when linking into an existing local user", async () => {
    const subject = gateway({
      consume: vi.fn(async () => ({
        authState: { id: "state-1", targetUserId: "target-local", redirectTo: null },
        identity: { telegramId: "777", telegramUsername: null, fullName: null, photoUrl: null, providerSession: null },
      })),
    });

    await expect(completeTelegramCallback(subject, input)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(subject.applyTelegramIdentity).not.toHaveBeenCalled();
  });

  it("does not stage a merge for an unverified target account", async () => {
    const subject = gateway({
      findUserById: vi.fn(async () => ({
        id: "target-local", upstreamAccountId: "target-account", email: "owner@example.com",
        emailVerified: false, telegramId: "777",
      })),
    });

    await expect(completeTelegramCallback(subject, input)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(subject.loadProviderMergeIdentity).not.toHaveBeenCalled();
  });

  it("keeps the local link when attachment fails without a provider session", async () => {
    const subject = gateway({
      consume: vi.fn(async () => ({
        authState: { id: "state-1", targetUserId: "missing-target", redirectTo: null },
        identity: { telegramId: "777", telegramUsername: null, fullName: null, photoUrl: null, providerSession: null },
      })),
      findUserById: vi.fn(async () => null),
      attachTelegramToCurrentAccount: vi.fn(async () => { throw new Error("upstream unavailable"); }),
    });

    await expect(completeTelegramCallback(subject, input)).resolves.toMatchObject({
      redirectTo: "/cabinet",
      session: { userId: "target-local", requiresTelegramRecovery: false },
    });
    expect(subject.logAttachFailure).toHaveBeenCalledWith(expect.any(Error), "777");
    expect(subject.mergeProviderAccounts).not.toHaveBeenCalled();
  });

  it("merges provider accounts after a direct attachment failure", async () => {
    const subject = gateway({
      attachTelegramToCurrentAccount: vi.fn(async () => { throw new Error("already owned"); }),
    });

    await expect(completeTelegramCallback(subject, input)).resolves.toMatchObject({
      session: { userId: "target-local", requiresTelegramRecovery: true },
    });
    expect(subject.mergeProviderAccounts).toHaveBeenCalledWith({
      sourceAccountId: "target-account",
      targetAccountId: "source-account",
    });
    expect(subject.linkProviderSession).toHaveBeenCalledWith({
      session: providerSession,
      ownerFenceHeld: true,
      invalidateSiblingTokens: true,
    });
  });

  it("does not merge without a known current provider account", async () => {
    const subject = gateway({
      findUserById: vi.fn(async () => null),
      applyTelegramIdentity: vi.fn(async () => ({
        id: "target-local", upstreamAccountId: null, email: null, emailVerified: false, telegramId: "777",
      })),
      attachTelegramToCurrentAccount: vi.fn(async () => { throw new Error("already owned"); }),
    });

    await expect(completeTelegramCallback(subject, input)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(subject.mergeProviderAccounts).not.toHaveBeenCalled();
  });

  it("blocks the only business conflict: subscriptions on both accounts", async () => {
    const subject = gateway({
      loadProviderMergeIdentity: vi.fn(async () => ({
        accountId: "source-account", email: "source@example.com", emailVerified: true, pendingEmail: null, telegramId: "777",
      })),
      preflightAccountMerge: vi.fn(async () => ({
        conflicts: ["Both users have current subscriptions"], dryRun: true,
        sourceAccountId: "source-account", targetAccountId: "target-account",
        target: { accountId: "target-account", email: "owner@example.com", emailVerified: true, telegramId: "777" },
        requiresRelogin: true,
      })),
    });

    await expect(completeTelegramCallback(subject, input)).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
    });
    expect(subject.persistAccountMergeConfirmation).not.toHaveBeenCalled();
  });

  it("rejects a preflight snapshot that does not match the selected target", async () => {
    const subject = gateway({
      loadProviderMergeIdentity: vi.fn(async () => ({
        accountId: "source-account", email: "source@example.com", emailVerified: true, pendingEmail: null, telegramId: "777",
      })),
      preflightAccountMerge: vi.fn(async () => ({
        conflicts: ["active payment operations"], dryRun: true,
        sourceAccountId: "source-account", targetAccountId: "target-account",
        target: { accountId: "target-account", email: "different@example.com", emailVerified: true, telegramId: "777" },
        requiresRelogin: true,
      })),
    });

    await expect(completeTelegramCallback(subject, input)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });
});
