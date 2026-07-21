import { AccountMergeConfirmationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountCreate: vi.fn(),
  accountFindFirst: vi.fn(),
  accountUpdateMany: vi.fn(),
  auditLog: vi.fn(),
  findUser: vi.fn(),
  getCurrentSession: vi.fn(),
  getRemnashopMe: vi.fn(),
  getRemnashopUserId: vi.fn(),
  linkCurrentUser: vi.fn(),
  refreshCurrentAccessCookie: vi.fn(),
  remnashopAuthTelegram: vi.fn(),
  remnashopMergeUsers: vi.fn(),
  remnashopRequest: vi.fn(),
  assertRateLimit: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => {
  const prisma = {
    $queryRaw: mocks.queryRaw,
    webUser: { findUnique: mocks.findUser },
    accountMergeConfirmation: {
      create: mocks.accountCreate,
      findFirst: mocks.accountFindFirst,
      updateMany: mocks.accountUpdateMany,
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  };
  return { prisma };
});

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getRemnashopMe: mocks.getRemnashopMe,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserId,
  remnashopAuthTelegramIdentity: mocks.remnashopAuthTelegram,
  remnashopMergeUsers: mocks.remnashopMergeUsers,
  remnashopRequest: mocks.remnashopRequest,
}));

vi.mock("@/backend/integrations/remnashop/session", () => ({
  linkCurrentUserToRemnashopAuth: mocks.linkCurrentUser,
}));

vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
}));

vi.mock("@/backend/sessions/web-session", () => ({
  getCurrentSession: mocks.getCurrentSession,
  refreshCurrentAccessCookie: mocks.refreshCurrentAccessCookie,
}));

import {
  cancelTelegramAccountMerge,
  confirmTelegramAccountMerge,
  getTelegramAccountMergeConfirmation,
  stageTelegramAccountMerge,
} from "@/backend/auth/telegram-account-merge";
import { BffError } from "@/backend/integrations/remnashop/errors";

const targetUser = {
  id: "target-local",
  email: "owner@example.com",
  emailVerified: true,
  telegramId: null,
  remnashopUserId: "22",
};

const sourceProfile = {
  telegram_id: 777,
  email: "old@example.com",
  is_email_verified: true,
  pending_email: null,
};

const finalTargetProfile = {
  telegram_id: 777,
  email: "owner@example.com",
  is_email_verified: true,
  pending_email: null,
};

const confirmation = {
  id: "confirmation-1",
  userId: "target-local",
  telegramId: "777",
  telegramUsername: "owner",
  sourceEmail: "old@example.com",
  targetEmail: "owner@example.com",
  sourceRemnashopUserId: "11",
  targetRemnashopUserId: "22",
  status: AccountMergeConfirmationStatus.PENDING,
  expiresAt: new Date("2099-07-19T02:00:00.000Z"),
};

function auth(accessToken: string) {
  return {
    data: {
      expires_at: "2026-07-19T03:00:00.000Z",
      refresh_expires_at: "2026-08-19T03:00:00.000Z",
    },
    cookies: { accessToken, refreshToken: `${accessToken}-refresh` },
  };
}

function mergeResult(
  conflicts: string[] = [],
  subscriptionId: number | null = 101,
  targetEmail = "owner@example.com",
  targetTelegramId: number | null = null,
) {
  return {
    dry_run: true,
    source_user_id: 11,
    target_user_id: 22,
    target: {
      id: 22,
      email: targetEmail,
      telegram_id: targetTelegramId,
      is_email_verified: true,
      current_subscription_id: subscriptionId,
    },
    moved: { subscriptions: 1, transactions: 2, payment_operations: 1 },
    conflicts,
    requires_relogin: true,
  };
}

describe("confirmed Telegram account merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRemnashopMe.mockReset();
    mocks.remnashopAuthTelegram.mockReset();
    mocks.remnashopMergeUsers.mockReset();
    mocks.remnashopRequest.mockReset();
    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findUser.mockResolvedValue(targetUser);
    mocks.getCurrentSession.mockResolvedValue({
      id: "session-1",
      userId: "target-local",
    });
    mocks.getRemnashopUserId.mockImplementation((token: string) =>
      token.startsWith("source") ? "11" : "22",
    );
    mocks.getRemnashopMe.mockImplementation((accessToken: string) =>
      accessToken.startsWith("source") ? sourceProfile : finalTargetProfile,
    );
    mocks.remnashopMergeUsers.mockResolvedValue(mergeResult());
    mocks.accountCreate.mockResolvedValue({ id: "confirmation-1" });
    mocks.accountFindFirst.mockResolvedValue(confirmation);
    mocks.accountUpdateMany.mockResolvedValue({ count: 1 });
    mocks.remnashopAuthTelegram
      .mockResolvedValueOnce(auth("source-access"))
      .mockResolvedValueOnce(auth("target-access"));
    mocks.remnashopRequest.mockResolvedValue({ user_remna_id: "remna-user-1" });
    mocks.linkCurrentUser.mockResolvedValue({ user: { id: "target-local" } });
  });

  it("stages a replacement without mutating either account", async () => {
    const staged = await stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    });

    expect(staged).toMatchObject({
      required: true,
      targetEmail: "owner@example.com",
      sourceEmailMasked: "ol***@example.com",
      emailWillBeReplaced: true,
    });
    expect(mocks.remnashopMergeUsers).toHaveBeenCalledOnce();
    expect(mocks.remnashopMergeUsers).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
      emailResolution: "KEEP_TARGET",
      telegramResolution: "KEEP_SOURCE",
      paymentResolution: "REKEY_SOURCE",
    }));
    expect(mocks.accountCreate).toHaveBeenCalledOnce();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("stages a separate Telegram account without claiming an e-mail replacement", async () => {
    mocks.getRemnashopMe.mockImplementation((accessToken: string) =>
      accessToken.startsWith("source")
        ? { ...sourceProfile, email: null }
        : finalTargetProfile,
    );

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).resolves.toMatchObject({
      required: true,
      sourceEmailMasked: null,
      targetEmail: "owner@example.com",
      emailWillBeReplaced: false,
    });
    expect(mocks.accountCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceEmail: null }),
    }));
  });

  it("returns the persisted e-mail consequence from the confirmation endpoint", async () => {
    mocks.accountFindFirst.mockResolvedValueOnce({
      ...confirmation,
      sourceEmail: null,
    });

    await expect(getTelegramAccountMergeConfirmation("raw-confirmation-token"))
      .resolves.toMatchObject({
        sourceEmailMasked: null,
        emailWillBeReplaced: false,
      });
  });

  it("does not stage while the source account has a pending e-mail change", async () => {
    mocks.getRemnashopMe.mockResolvedValueOnce({
      ...sourceProfile,
      pending_email: "next@example.com",
    });

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });

  it("does not replace a different Telegram already linked to the target", async () => {
    mocks.findUser.mockResolvedValueOnce({
      ...targetUser,
      telegramId: "888",
    });

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });

  it("does not stage when the upstream target has a different Telegram", async () => {
    mocks.remnashopMergeUsers.mockResolvedValueOnce(
      mergeResult([], null, "owner@example.com", 888),
    );

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });

  it("blocks two subscriptions before creating a confirmation", async () => {
    mocks.remnashopMergeUsers.mockResolvedValueOnce(mergeResult([
      "Both users have current subscriptions",
    ]));

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
      status: 409,
    });

    expect(mocks.accountCreate).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("does not stage a destructive merge when the upstream target e-mail is stale", async () => {
    mocks.remnashopMergeUsers.mockResolvedValueOnce(
      mergeResult([], null, "another-owner@example.com"),
    );

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(mocks.accountCreate).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("allows confirmation to be staged while payment work is settling", async () => {
    mocks.remnashopMergeUsers.mockResolvedValueOnce(mergeResult([
      "Source user has active payment operations (1)",
      "Source user has payment fulfillment in progress (1)",
    ]));

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).resolves.toMatchObject({ required: true });
    expect(mocks.accountCreate).toHaveBeenCalledOnce();
  });

  it("does not stage a second merge while one is actively processing", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "target-local" }])
      .mockResolvedValueOnce([{ id: "active-confirmation" }]);

    await expect(stageTelegramAccountMerge({
      userId: "target-local",
      telegramId: "777",
      telegramUsername: "owner",
      telegramAuth: auth("source-access"),
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });

  it("does not report cancellation after a concurrent confirmation claim", async () => {
    mocks.accountUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(cancelTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("merges once, verifies the shared identity and subscription, then links locally", async () => {
    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .resolves.toEqual({ merged: true, userId: "target-local" });

    expect(mocks.remnashopMergeUsers).toHaveBeenNthCalledWith(1, expect.objectContaining({
      dryRun: true,
      paymentResolution: "REKEY_SOURCE",
    }));
    expect(mocks.remnashopMergeUsers).toHaveBeenNthCalledWith(2, expect.objectContaining({
      dryRun: false,
      sourceUserId: "11",
      targetUserId: "22",
      emailResolution: "KEEP_TARGET",
      telegramResolution: "KEEP_SOURCE",
      paymentResolution: "REKEY_SOURCE",
    }));
    expect(mocks.remnashopRequest).toHaveBeenCalledWith(
      "/subscription/current",
      { accessToken: "target-access" },
    );
    expect(mocks.linkCurrentUser).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "target-access",
    }));
    expect(mocks.refreshCurrentAccessCookie).toHaveBeenCalledOnce();
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "telegram_account_merge_succeeded",
    }));
  });

  it("keeps confirmation retryable and avoids local mutation while payment work is active", async () => {
    mocks.remnashopMergeUsers.mockResolvedValueOnce(mergeResult([
      "Source user has active payment operations (1)",
    ]));

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_IN_PROGRESS", status: 409 });

    expect(mocks.remnashopMergeUsers).toHaveBeenCalledOnce();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
    expect(mocks.accountUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AccountMergeConfirmationStatus.PENDING }),
    }));
  });

  it("fails before preflight when the source e-mail changed after confirmation", async () => {
    mocks.getRemnashopMe.mockImplementation((accessToken: string) =>
      accessToken.startsWith("source")
        ? { ...sourceProfile, email: "changed@example.com" }
        : finalTargetProfile,
    );

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("fails before preflight when a source e-mail change started after confirmation", async () => {
    mocks.getRemnashopMe.mockResolvedValueOnce({
      ...sourceProfile,
      pending_email: "next@example.com",
    });

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("fails if the target linked a different Telegram after confirmation", async () => {
    mocks.findUser.mockResolvedValueOnce({
      ...targetUser,
      telegramId: "888",
    });

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.remnashopAuthTelegram).not.toHaveBeenCalled();
    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("fails before the real merge when upstream target ownership changed after staging", async () => {
    mocks.remnashopMergeUsers.mockResolvedValueOnce(
      mergeResult([], null, "another-owner@example.com"),
    );

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });

    expect(mocks.remnashopMergeUsers).toHaveBeenCalledOnce();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
    expect(mocks.accountUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AccountMergeConfirmationStatus.FAILED,
        }),
      }),
    );
  });

  it("fails before the real merge when the upstream target Telegram changed", async () => {
    mocks.remnashopMergeUsers.mockResolvedValueOnce(
      mergeResult([], null, "owner@example.com", 888),
    );

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.remnashopMergeUsers).toHaveBeenCalledOnce();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("lets only one concurrent request claim the confirmation", async () => {
    mocks.accountUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });

  it("retries safely after a lost upstream response and mutates local state only after proof", async () => {
    mocks.remnashopMergeUsers
      .mockResolvedValueOnce(mergeResult())
      .mockRejectedValueOnce(new BffError("UPSTREAM_UNAVAILABLE", 503, "lost response"));

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
    expect(mocks.accountUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AccountMergeConfirmationStatus.PENDING }),
    }));

    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({ id: "session-1", userId: "target-local" });
    mocks.accountFindFirst.mockResolvedValue(confirmation);
    mocks.accountUpdateMany.mockResolvedValue({ count: 1 });
    mocks.findUser.mockResolvedValue(targetUser);
    mocks.getRemnashopUserId.mockImplementation((token: string) =>
      token.startsWith("source") ? "11" : "22",
    );
    mocks.remnashopAuthTelegram.mockReset();
    mocks.remnashopAuthTelegram
      .mockResolvedValueOnce(auth("source-access"))
      .mockResolvedValueOnce(auth("target-access"));
    mocks.remnashopMergeUsers.mockResolvedValue(mergeResult());
    mocks.getRemnashopMe.mockImplementation((accessToken: string) =>
      accessToken.startsWith("source") ? sourceProfile : finalTargetProfile,
    );
    mocks.remnashopRequest.mockResolvedValue({ user_remna_id: "remna-user-1" });
    mocks.linkCurrentUser.mockResolvedValue({ user: { id: "target-local" } });

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .resolves.toEqual({ merged: true, userId: "target-local" });
    expect(mocks.linkCurrentUser).toHaveBeenCalledOnce();
  });

  it("recovers when the upstream merge committed but its response was lost", async () => {
    mocks.remnashopAuthTelegram.mockReset();
    mocks.remnashopAuthTelegram
      .mockResolvedValueOnce(auth("target-access"))
      .mockResolvedValueOnce(auth("target-access"));

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .resolves.toEqual({ merged: true, userId: "target-local" });

    expect(mocks.remnashopMergeUsers).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).toHaveBeenCalledWith(
      "/subscription/current",
      { accessToken: "target-access" },
    );
    expect(mocks.linkCurrentUser).toHaveBeenCalledOnce();
  });

  it("fails closed when the final subscription visibility disagrees", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(null);

    await expect(confirmTelegramAccountMerge("raw-confirmation-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
    expect(mocks.linkCurrentUser).not.toHaveBeenCalled();
  });
});
