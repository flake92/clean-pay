import { type Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transferPaymentOperationsForUserMerge: vi.fn(),
}));

vi.mock("@/backend/payments/user-merge", () => ({
  transferPaymentOperationsForUserMerge:
    mocks.transferPaymentOperationsForUserMerge,
}));

import {
  assertUserMergeFinalOwner,
  mergeLocalUsersIntoTarget,
} from "@/backend/auth/user-merge";

function mergeTransaction() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([
      { id: "source-a" },
      { id: "source-b" },
      { id: "target-user" },
    ]),
    webUser: {
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    webSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
      updateMany: vi.fn(),
    },
    webAuthnCredential: {
      updateMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
    webAuthnChallenge: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    emailVerificationCode: {
      deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
    },
    telegramAuthState: {
      deleteMany: vi.fn().mockResolvedValue({ count: 6 }),
    },
    auditLog: {
      updateMany: vi.fn().mockResolvedValue({ count: 7 }),
    },
    paymentRecord: {
      updateMany: vi.fn().mockResolvedValue({ count: 8 }),
    },
  };
}

describe("local user merge policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transferPaymentOperationsForUserMerge.mockResolvedValue(undefined);
  });

  it("revokes source sessions, preserves passkeys and invalidates temporary auth state", async () => {
    const tx = mergeTransaction();

    await expect(
      mergeLocalUsersIntoTarget(tx as unknown as Prisma.TransactionClient, {
        targetUserId: "target-user",
        targetUpstreamAccountId: "remna-target",
        sourceUserIds: ["source-b", "source-a", "source-b", "target-user"],
      }),
    ).resolves.toEqual({
      revokedSessionCount: 4,
      transferredPasskeyCount: 3,
      invalidatedWebAuthnChallengeCount: 2,
      invalidatedEmailCodeCount: 5,
      invalidatedTelegramStateCount: 6,
    });

    expect(tx.webUser.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["source-b", "source-a"] } },
      data: { remnashopUserId: null, email: null, telegramId: null },
    });
    expect(tx.webSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-b", "source-a"] } },
    });
    expect(tx.webSession.updateMany).not.toHaveBeenCalled();
    expect(tx.webAuthnCredential.updateMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-b", "source-a"] } },
      data: { userId: "target-user" },
    });
    expect(tx.webAuthnChallenge.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-b", "source-a"] } },
    });
    expect(tx.emailVerificationCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-b", "source-a"] } },
    });
    expect(tx.telegramAuthState.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-b", "source-a"] } },
    });
    expect(mocks.transferPaymentOperationsForUserMerge).toHaveBeenCalledWith(
      tx,
      "target-user",
      "remna-target",
      ["source-b", "source-a"],
    );
    expect(tx.webUser.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["source-b", "source-a"] } },
    });
  });

  it("fails closed before changing data when every owner row was not locked", async () => {
    const tx = mergeTransaction();
    tx.$queryRaw.mockResolvedValueOnce([{ id: "target-user" }]);

    await expect(
      mergeLocalUsersIntoTarget(tx as unknown as Prisma.TransactionClient, {
        targetUserId: "target-user",
        targetUpstreamAccountId: "remna-target",
        sourceUserIds: ["source-a"],
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });

    expect(tx.webUser.updateMany).not.toHaveBeenCalled();
    expect(tx.webSession.deleteMany).not.toHaveBeenCalled();
  });

  it("rolls the transaction back when a locked source no longer releases exactly once", async () => {
    const tx = mergeTransaction();
    tx.$queryRaw.mockResolvedValueOnce([
      { id: "source-a" },
      { id: "target-user" },
    ]);
    tx.webUser.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      mergeLocalUsersIntoTarget(tx as unknown as Prisma.TransactionClient, {
        targetUserId: "target-user",
        targetUpstreamAccountId: "remna-target",
        sourceUserIds: ["source-a"],
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });

    expect(tx.webSession.deleteMany).not.toHaveBeenCalled();
    expect(mocks.transferPaymentOperationsForUserMerge).not.toHaveBeenCalled();
  });

  it("accepts only the requested final identity owner with no remaining sources", async () => {
    const tx = mergeTransaction();
    tx.webUser.findUnique.mockResolvedValueOnce({
      id: "target-user",
      remnashopUserId: "remna-target",
      email: "user@example.com",
      telegramId: "123",
    });
    tx.webUser.count.mockResolvedValueOnce(0);

    await expect(
      assertUserMergeFinalOwner(tx as unknown as Prisma.TransactionClient, {
        targetUserId: "target-user",
        sourceUserIds: ["source-a"],
        expected: {
          remnashopUserId: "remna-target",
          email: "user@example.com",
          telegramId: "123",
        },
      }),
    ).resolves.toMatchObject({ id: "target-user", telegramId: "123" });
  });

  it.each([
    {
      target: {
        id: "target-user",
        remnashopUserId: "wrong-owner",
        email: "user@example.com",
        telegramId: "123",
      },
      sourceCount: 0,
    },
    {
      target: {
        id: "target-user",
        remnashopUserId: "remna-target",
        email: "user@example.com",
        telegramId: "123",
      },
      sourceCount: 1,
    },
  ])("rejects stale final ownership after a merge", async ({ target, sourceCount }) => {
    const tx = mergeTransaction();
    tx.webUser.findUnique.mockResolvedValueOnce(target);
    tx.webUser.count.mockResolvedValueOnce(sourceCount);

    await expect(
      assertUserMergeFinalOwner(tx as unknown as Prisma.TransactionClient, {
        targetUserId: "target-user",
        sourceUserIds: ["source-a"],
        expected: { remnashopUserId: "remna-target" },
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
  });
});
