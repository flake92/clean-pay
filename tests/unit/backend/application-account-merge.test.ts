import { describe, expect, it, vi } from "vitest";

import { cancelTelegramAccountMerge, confirmTelegramAccountMerge } from "@/application/auth/confirm-telegram-account-merge";
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

  it("treats a completed confirmation as an idempotent replay", async () => {
    const subject = gateway();
    vi.mocked(subject.loadConfirmation).mockResolvedValueOnce({ ...confirmation, status: "COMPLETED" });
    await expect(confirmTelegramAccountMerge(subject)).resolves.toEqual({ merged: true, userId: "user-1" });
    expect(subject.claim).not.toHaveBeenCalled();
    expect(subject.audit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "telegram_account_merge_succeeded", metadata: expect.objectContaining({ replay: true }),
    }));
  });

  it.each([
    [{ ...confirmation, status: "FAILED" as const }, "failed"],
    [{ ...confirmation, expiresAt: new Date(0) }, "expired"],
  ])("rejects a %s confirmation before claiming it", async (stored) => {
    const subject = gateway();
    vi.mocked(subject.loadConfirmation).mockResolvedValueOnce(stored);
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(subject.claim).not.toHaveBeenCalled();
  });

  it("reports a retryable conflict when another worker owns the claim", async () => {
    const subject = gateway();
    vi.mocked(subject.claim).mockResolvedValueOnce(false);
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(subject.release).not.toHaveBeenCalled();
    expect(subject.audit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "telegram_account_merge_failed", metadata: expect.objectContaining({ retryable: true }),
    }));
  });

  it.each([
    [null],
    [{ email: "other@example.com", emailVerified: true, upstreamAccountId: "target", telegramId: null }],
    [{ email: "email@example.com", emailVerified: false, upstreamAccountId: "target", telegramId: null }],
    [{ email: "email@example.com", emailVerified: true, upstreamAccountId: "other", telegramId: null }],
    [{ email: "email@example.com", emailVerified: true, upstreamAccountId: "target", telegramId: "other" }],
  ])("fails closed when the staged local owner no longer matches: %j", async (owner) => {
    const subject = gateway();
    vi.mocked(subject.loadCurrentOwner).mockResolvedValueOnce(owner);
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(subject.release).toHaveBeenCalledWith(confirmation, { terminal: true, errorCode: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("rejects a Telegram identity that moved to an unrelated provider account", async () => {
    const subject = gateway();
    vi.mocked(subject.authenticateTelegram).mockReset().mockResolvedValue({
      context: {}, accountId: "other", telegramId: "777", email: "other@example.com", emailVerified: true, pendingEmail: null,
    });
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("skips provider merge when an earlier attempt already moved Telegram to the target", async () => {
    const subject = gateway();
    const targetIdentity = { context: {}, accountId: "target", telegramId: "777", email: "email@example.com", emailVerified: true, pendingEmail: null };
    vi.mocked(subject.authenticateTelegram).mockReset().mockResolvedValue(targetIdentity);
    vi.mocked(subject.synchronizeSubscriptionIdentity).mockResolvedValueOnce(false);
    await expect(confirmTelegramAccountMerge(subject)).resolves.toEqual({ merged: true, userId: "user-1" });
    expect(subject.preflight).not.toHaveBeenCalled();
    expect(subject.mergeProviderAccounts).not.toHaveBeenCalled();
  });

  it.each([
    { telegramId: "other" },
    { email: "other@example.com" },
  ])("rejects a changed source %s", async (change) => {
    const subject = gateway();
    vi.mocked(subject.authenticateTelegram).mockReset().mockResolvedValue({
      context: {}, accountId: "source", telegramId: "777", email: "telegram@example.com", emailVerified: true, pendingEmail: null,
      ...change,
    });
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(subject.preflight).not.toHaveBeenCalled();
  });

  it.each([
    [["active payment operations"], "ACCOUNT_MERGE_IN_PROGRESS"],
    [["payment fulfillment in progress"], "ACCOUNT_MERGE_IN_PROGRESS"],
    [["unknown ownership conflict"], "ACCOUNT_MERGE_REQUIRED"],
  ])("classifies provider preflight conflicts %j", async (conflicts, code) => {
    const subject = gateway();
    vi.mocked(subject.preflight).mockResolvedValueOnce({
      conflicts, dryRun: true, sourceAccountId: "source", targetAccountId: "target",
      target: { accountId: "target", email: "email@example.com", emailVerified: true, telegramId: null }, requiresRelogin: true,
    });
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code });
    expect(subject.mergeProviderAccounts).not.toHaveBeenCalled();
  });

  it.each([
    [{ dryRun: false }],
    [{ sourceAccountId: "other" }],
    [{ targetAccountId: "other" }],
    [{ target: { accountId: "other", email: "email@example.com", emailVerified: true, telegramId: null } }],
    [{ target: { accountId: "target", email: "other@example.com", emailVerified: true, telegramId: null } }],
    [{ target: { accountId: "target", email: "email@example.com", emailVerified: false, telegramId: null } }],
    [{ target: { accountId: "target", email: "email@example.com", emailVerified: true, telegramId: "other" } }],
    [{ requiresRelogin: false }],
  ])("rejects an inconsistent provider preflight: %j", async (change) => {
    const subject = gateway();
    vi.mocked(subject.preflight).mockResolvedValueOnce({
      conflicts: [], dryRun: true, sourceAccountId: "source", targetAccountId: "target",
      target: { accountId: "target", email: "email@example.com", emailVerified: true, telegramId: null }, requiresRelogin: true,
      ...change,
    });
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it.each([
    [{ accountId: "source" }],
    [{ telegramId: "other" }],
    [{ email: "other@example.com" }],
    [{ emailVerified: false }],
    [{ pendingEmail: "pending@example.com" }],
  ])("rejects an inconsistent final provider identity: %j", async (change) => {
    const subject = gateway();
    const source = { context: {}, accountId: "source", telegramId: "777", email: "telegram@example.com", emailVerified: true, pendingEmail: null };
    const target = { context: {}, accountId: "target", telegramId: "777", email: "email@example.com", emailVerified: true, pendingEmail: null, ...change };
    vi.mocked(subject.authenticateTelegram).mockReset().mockResolvedValueOnce(source).mockResolvedValueOnce(target);
    await expect(confirmTelegramAccountMerge(subject)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(subject.linkCurrentAccount).not.toHaveBeenCalled();
  });

  it("rejects a changed subscription result and an unsuccessful local commit", async () => {
    const subscriptionChanged = gateway();
    vi.mocked(subscriptionChanged.synchronizeSubscriptionIdentity).mockResolvedValueOnce(false);
    await expect(confirmTelegramAccountMerge(subscriptionChanged)).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    const commitFailed = gateway();
    vi.mocked(commitFailed.complete).mockResolvedValueOnce(false);
    await expect(confirmTelegramAccountMerge(commitFailed)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("keeps a committed merge successful when refresh or success audit fails", async () => {
    const subject = gateway();
    vi.mocked(subject.refreshLocalSession).mockRejectedValueOnce(new Error("cookie unavailable"));
    vi.mocked(subject.audit).mockImplementation(async ({ action }) => {
      if (action === "telegram_account_merge_succeeded") throw new Error("audit unavailable");
    });
    await expect(confirmTelegramAccountMerge(subject)).resolves.toEqual({ merged: true, userId: "user-1" });
  });

  it("cancels only a pending, still-owned confirmation", async () => {
    const subject = gateway();
    await expect(cancelTelegramAccountMerge(subject)).resolves.toBeUndefined();
    const completed = gateway();
    vi.mocked(completed.loadConfirmation).mockResolvedValueOnce({ ...confirmation, status: "COMPLETED" });
    await expect(cancelTelegramAccountMerge(completed)).rejects.toMatchObject({ code: "CONFLICT" });
    const raced = gateway();
    vi.mocked(raced.cancel).mockResolvedValueOnce(false);
    await expect(cancelTelegramAccountMerge(raced)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
