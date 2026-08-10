import { describe, expect, it, vi } from "vitest";

import { confirmTelegramAccountMerge } from "@/application/auth/confirm-telegram-account-merge";
import type { AccountMergeConfirmation, TelegramAccountMergeGateway } from "@/application/auth/ports/telegram-account-merge";

const confirmation: AccountMergeConfirmation = {
  context: {}, id: "merge-1", userId: "user-1", status: "PENDING",
  expiresAt: new Date(Date.now() + 60_000), sourceAccountId: "source", targetAccountId: "target",
  sourceEmail: "telegram@example.com", targetEmail: "email@example.com",
  targetTelegramId: null,
  telegramId: "777", telegramUsername: "clean_pay",
};

function gateway(): TelegramAccountMergeGateway {
  const sourceIdentity = {
    context: {}, accountId: "source", telegramId: "777", email: "telegram@example.com",
    emailVerified: true, pendingEmail: null,
  };
  const targetIdentity = {
    context: {}, accountId: "target", telegramId: "777", email: "email@example.com",
    emailVerified: true, pendingEmail: null,
  };
  return {
    loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true })),
    loadConfirmation: vi.fn(async () => confirmation), assertRateLimit: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined), claim: vi.fn(async () => true),
    withOwnerChangeFence: vi.fn(async (_confirmation, work) => work()),
    loadCurrentOwner: vi.fn(async () => ({ email: "email@example.com", emailVerified: true, upstreamAccountId: "target", telegramId: null })),
    authenticateTelegram: vi.fn().mockResolvedValueOnce(sourceIdentity).mockResolvedValueOnce(targetIdentity),
    preflight: vi.fn(async () => ({
      conflicts: [], dryRun: true, sourceAccountId: "source", targetAccountId: "target",
      target: { accountId: "target", email: "email@example.com", emailVerified: true, telegramId: null },
      requiresRelogin: true,
    })),
    mergeProviderAccounts: vi.fn(async () => ({ targetHasSubscription: true })),
    synchronizeSubscriptionIdentity: vi.fn(async () => true), linkCurrentAccount: vi.fn(async () => ({ userId: "user-1" })),
    complete: vi.fn(async () => true), cancel: vi.fn(async () => true), release: vi.fn(async () => undefined),
    refreshLocalSession: vi.fn(async () => undefined),
  };
}

describe("Telegram account merge application workflow", () => {
  it.each([
    [null, "UNAUTHORIZED"],
    [{ userId: "user-1", fullAssurance: false }, "PASSKEY_REQUIRED"],
  ])("authorizes the actor before loading merge state", async (actor, code) => {
    const port = gateway();
    port.loadActor = vi.fn(async () => actor);
    await expect(confirmTelegramAccountMerge(port)).rejects.toMatchObject({ code });
    expect(port.loadConfirmation).not.toHaveBeenCalled();
  });

  it("owns preflight, merge, final verification and commit ordering", async () => {
    const subject = gateway();
    await expect(confirmTelegramAccountMerge(subject)).resolves.toEqual({ merged: true, userId: "user-1" });
    expect(subject.claim).toHaveBeenCalled();
    expect(subject.preflight).toHaveBeenCalledWith(confirmation);
    expect(subject.mergeProviderAccounts).toHaveBeenCalledWith(confirmation);
    expect(subject.complete).toHaveBeenCalledWith(confirmation);
    expect(subject.release).not.toHaveBeenCalled();
  });

  it("replaces the target Telegram while fencing the owner captured at staging", async () => {
    const subject = gateway();
    const staged = { ...confirmation, targetTelegramId: "888" };
    vi.mocked(subject.loadConfirmation).mockResolvedValueOnce(staged);
    vi.mocked(subject.loadCurrentOwner).mockResolvedValueOnce({
      email: "email@example.com", emailVerified: true, upstreamAccountId: "target", telegramId: "888",
    });
    vi.mocked(subject.preflight).mockResolvedValueOnce({
      conflicts: [], dryRun: true, sourceAccountId: "source", targetAccountId: "target",
      target: { accountId: "target", email: "email@example.com", emailVerified: true, telegramId: "888" },
      requiresRelogin: true,
    });

    await expect(confirmTelegramAccountMerge(subject)).resolves.toEqual({ merged: true, userId: "user-1" });
    expect(subject.mergeProviderAccounts).toHaveBeenCalledWith(staged);
    expect(subject.synchronizeSubscriptionIdentity).toHaveBeenCalled();
  });

  it("blocks only the two-subscription business conflict before mutation", async () => {
    const subject = gateway();
    vi.mocked(subject.preflight).mockResolvedValueOnce({
      conflicts: ["Both users have current subscriptions"], dryRun: true,
      sourceAccountId: "source", targetAccountId: "target",
      target: { accountId: "target", email: "email@example.com", emailVerified: true, telegramId: null },
      requiresRelogin: true,
    });

    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
    });
    expect(subject.mergeProviderAccounts).not.toHaveBeenCalled();
    expect(subject.linkCurrentAccount).not.toHaveBeenCalled();
  });

  it("returns a claimed workflow to a retryable state after an infrastructure failure", async () => {
    const subject = gateway();
    vi.mocked(subject.synchronizeSubscriptionIdentity).mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(confirmTelegramAccountMerge(subject)).rejects.toThrow("provider unavailable");
    expect(subject.release).toHaveBeenCalledWith(confirmation, {
      terminal: false,
      errorCode: "INTERNAL_ERROR",
    });
  });
});
