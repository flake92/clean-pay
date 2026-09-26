import { describe, expect, it, vi } from "vitest";

import { recoverTelegramSession } from "@/application/auth/recover-telegram-session";
import type {
  TelegramRecoveryProviderSession,
  TelegramRecoverySession,
  TelegramSessionRecoveryGateway,
} from "@/application/auth/ports/telegram-session-recovery";

const session: TelegramRecoverySession = {
  context: {},
  sessionId: "session-1",
  userId: "user-1",
  upstreamAccountId: "101",
  email: "source@example.com",
  emailVerified: true,
  telegramId: "777",
  telegramUsername: "clean",
  authPending: true,
  pendingUpstreamAccountId: "202",
  pendingEmail: "target@example.com",
};

const source: TelegramRecoveryProviderSession = {
  context: { token: "source" },
  accountId: "101",
  email: "source@example.com",
  emailVerified: true,
  pendingEmail: null,
  telegramId: "777",
};

const target: TelegramRecoveryProviderSession = {
  context: { token: "target" },
  accountId: "202",
  email: "target@example.com",
  emailVerified: true,
  pendingEmail: null,
  telegramId: "777",
};

function gateway(): TelegramSessionRecoveryGateway<{ recovered: true }> {
  return {
    configurationAvailable: vi.fn(() => true),
    recoverySkipped: vi.fn(),
    recoveryStarted: vi.fn(),
    authenticateTelegram: vi.fn().mockResolvedValueOnce(source).mockResolvedValue(target),
    withOwnerChangeFence: vi.fn(async ({ work }) => work()),
    captureLocalSnapshot: vi.fn(async () => ({ context: { locked: true } })),
    mergeProviderAccounts: vi.fn(async () => ({
      dryRun: false,
      sourceAccountId: "101",
      targetAccountId: "202",
      targetAccountMatches: true,
      conflicts: [],
      requiresRelogin: true,
    })),
    synchronizeProviderIdentity: vi.fn(async ({ provider }) => provider),
    commitLocalRecovery: vi.fn(async () => ({ recovered: true as const })),
    recoverySucceeded: vi.fn(),
  };
}

describe("Telegram session recovery application workflow", () => {
  it("owns deterministic merge direction and syncs identity before local commit", async () => {
    const subject = gateway();
    const order: string[] = [];
    vi.mocked(subject.mergeProviderAccounts).mockImplementation(async (input) => {
      order.push("merge");
      expect(input).toMatchObject({
        sourceAccountId: "101",
        targetAccountId: "202",
        emailResolution: "KEEP_TARGET",
        telegramResolution: "KEEP_SOURCE",
        paymentResolution: "REKEY_SOURCE",
      });
      return {
        dryRun: false,
        sourceAccountId: "101",
        targetAccountId: "202",
        targetAccountMatches: true,
        conflicts: [],
        requiresRelogin: true,
      };
    });
    vi.mocked(subject.synchronizeProviderIdentity).mockImplementation(async ({ provider, expected }) => {
      order.push("sync");
      expect(expected).toEqual({
        accountId: "202",
        email: "target@example.com",
        emailVerified: true,
        pendingEmail: null,
        telegramId: "777",
      });
      return provider;
    });
    vi.mocked(subject.commitLocalRecovery).mockImplementation(async () => {
      order.push("commit");
      return { recovered: true };
    });

    await expect(recoverTelegramSession(subject, session)).resolves.toEqual({ recovered: true });
    expect(order).toEqual(["merge", "sync", "commit"]);
  });

  it("retries downstream identity sync when the provider merge already completed", async () => {
    const subject = gateway();
    vi.mocked(subject.authenticateTelegram).mockReset().mockResolvedValue(target);

    await expect(recoverTelegramSession(subject, session)).resolves.toEqual({ recovered: true });
    expect(subject.mergeProviderAccounts).not.toHaveBeenCalled();
    expect(subject.synchronizeProviderIdentity).toHaveBeenCalledOnce();
    expect(subject.commitLocalRecovery).toHaveBeenCalledOnce();
  });

  it("keeps the local transition pending when Remnawave identity sync fails", async () => {
    const subject = gateway();
    vi.mocked(subject.synchronizeProviderIdentity).mockRejectedValueOnce(new Error("remnawave unavailable"));

    await expect(recoverTelegramSession(subject, session)).rejects.toThrow("remnawave unavailable");
    expect(subject.commitLocalRecovery).not.toHaveBeenCalled();
    expect(subject.recoverySucceeded).not.toHaveBeenCalled();
  });

  it("rejects an unrelated Telegram provider owner before claiming local state", async () => {
    const subject = gateway();
    vi.mocked(subject.authenticateTelegram).mockReset().mockResolvedValue({
      ...source,
      accountId: "303",
      email: "other@example.com",
    });

    await expect(recoverTelegramSession(subject, session)).rejects.toMatchObject({
      reason: "pending_merge_telegram_owner_is_unrelated",
    });
    expect(subject.withOwnerChangeFence).not.toHaveBeenCalled();
  });
});
