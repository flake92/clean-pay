import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: databaseMocks.prisma,
}));

import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import {
  assertNoActivePaymentDispatches,
  lockPaymentOwnerFence,
  preflightPaymentOperationsForUserMerge,
  transferPaymentOperationsForUserMerge,
  withPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-service";

type TransactionOptions = {
  targetOwner?: string | null;
  lockedOperations?: Array<{
    id: string;
    userId: string;
    idempotencyKeyHash: string;
    upstreamKey: string;
    status?: string;
    leaseExpiresAt?: Date | null;
  }>;
};

function sqlText(query: unknown) {
  return (query as { strings?: string[] }).strings?.join(" ") ?? "";
}

function transaction(
  updateMany: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ count: 1 }),
  options: TransactionOptions = {},
) {
  const users = ["source-a", "source-b", "source-user", "target-user"].map(
    (id) => ({
      id,
      remnashopUserId:
        id === "target-user"
          ? options.targetOwner === undefined
            ? "target-owner"
            : options.targetOwner
          : "target-owner",
    }),
  );
  const tx = {
    paymentOperation: {
      updateMany,
      count: vi.fn().mockResolvedValue(0),
    },
    paymentHistorySyncState: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn().mockImplementation(async (query: unknown) => {
      const sql = sqlText(query);

      if (sql.includes('FROM "WebUser"')) {
        const values = (query as { values?: unknown[] }).values ?? [];
        return users.filter(({ id }) => values.includes(id));
      }

      if (sql.includes('FROM "PaymentOperation"')) {
        return options.lockedOperations ?? [];
      }

      return [];
    }),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };

  return tx as unknown as Prisma.TransactionClient;
}

describe("payment operations during user merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes advisory locks and skips dispatch lookup for an empty owner set", async () => {
    const tx = transaction() as unknown as {
      $queryRaw: ReturnType<typeof vi.fn>;
      paymentOperation: { findFirst: ReturnType<typeof vi.fn> };
    };
    tx.paymentOperation.findFirst = vi.fn();

    await expect(lockPaymentOwnerFence(
      tx as unknown as Prisma.TransactionClient,
      ["user-b", "", "user-a", "user-b"],
    )).resolves.toEqual(["user-a", "user-b"]);
    await expect(assertNoActivePaymentDispatches(
      tx as unknown as Prisma.TransactionClient,
      ["", ""],
    )).resolves.toBeUndefined();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.paymentOperation.findFirst).not.toHaveBeenCalled();
  });

  it("blocks owner changes while a payment dispatch is active", async () => {
    const tx = transaction() as unknown as {
      paymentOperation: { findFirst: ReturnType<typeof vi.fn> };
    };
    tx.paymentOperation.findFirst = vi.fn().mockResolvedValue({ id: "operation-active" });

    await expect(assertNoActivePaymentDispatches(
      tx as unknown as Prisma.TransactionClient,
      ["user-1"],
    )).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });
  });

  it("fences every normalized identity and revalidates the mapping", async () => {
    const work = vi.fn().mockResolvedValue("done");
    const tx = {
      webUser: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "mapped-user" }])
          .mockResolvedValueOnce([{ id: "mapped-user" }]),
      },
      paymentOperation: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    };
    databaseMocks.prisma.$transaction.mockImplementation(
      async (callback: (value: typeof tx) => unknown) => callback(tx),
    );

    await expect(withPaymentOwnerChangeFence({
      userIds: ["explicit-user", "explicit-user"],
      upstreamAccountIds: ["upstream-1", "upstream-1"],
      emails: [null, " User@Example.COM ", "user@example.com"],
      telegramIds: [undefined, 42, "42"],
      work,
    })).resolves.toBe("done");

    expect(tx.webUser.findMany).toHaveBeenCalledWith({
      where: { OR: [
        { id: { in: ["explicit-user"] } },
        { remnashopUserId: { in: ["upstream-1"] } },
        { email: { in: ["user@example.com"] } },
        { telegramId: { in: ["42"] } },
      ] },
      select: { id: true },
    });
    expect(tx.paymentOperation.findFirst).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
  });

  it("fails closed when no owner can be fenced or the mapping changes under the lock", async () => {
    const noOwnerTx = {
      webUser: { findMany: vi.fn() },
      paymentOperation: { findFirst: vi.fn() },
      $queryRaw: vi.fn(),
    };
    databaseMocks.prisma.$transaction.mockImplementationOnce(
      async (callback: (value: typeof noOwnerTx) => unknown) => callback(noOwnerTx),
    );
    await expect(withPaymentOwnerChangeFence({
      work: vi.fn(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    const changedTx = {
      webUser: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "user-before" }])
          .mockResolvedValueOnce([{ id: "user-after" }]),
      },
      paymentOperation: { findFirst: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    };
    databaseMocks.prisma.$transaction.mockImplementationOnce(
      async (callback: (value: typeof changedTx) => unknown) => callback(changedTx),
    );
    await expect(withPaymentOwnerChangeFence({
      emails: ["owner@example.com"],
      work: vi.fn(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(changedTx.paymentOperation.findFirst).not.toHaveBeenCalled();
  });

  it("locks users, operations and history while preserving a colliding source operation", async () => {
    const tx = transaction(undefined, {
      lockedOperations: [
        {
          id: "operation-target",
          userId: "target-user",
          idempotencyKeyHash: "same-key",
          upstreamKey: "target-upstream-key",
        },
        {
          id: "operation-source",
          userId: "source-user",
          idempotencyKeyHash: "same-key",
          upstreamKey: "source-upstream-key",
        },
      ],
    }) as unknown as {
      $queryRaw: ReturnType<typeof vi.fn>;
      $executeRaw: ReturnType<typeof vi.fn>;
      paymentOperation: { updateMany: ReturnType<typeof vi.fn> };
    };

    await expect(preflightPaymentOperationsForUserMerge(
      tx as unknown as Prisma.TransactionClient,
      "target-user",
      ["source-user"],
    )).resolves.toMatchObject({ lockedOperations: expect.arrayContaining([
      expect.objectContaining({ id: "operation-source" }),
    ]) });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(sqlText(tx.$queryRaw.mock.calls[0]?.[0])).toContain(
      'FROM "WebUser"',
    );
    expect(sqlText(tx.$queryRaw.mock.calls[1]?.[0])).toContain(
      'FROM "PaymentOperation"',
    );
    expect(sqlText(tx.$queryRaw.mock.calls[2]?.[0])).toContain(
      'FROM "PaymentHistorySyncState"',
    );
    expect(
      tx.$queryRaw.mock.calls.every(([query]) =>
        sqlText(query).includes("FOR UPDATE"),
      ),
    ).toBe(true);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("deterministically rekeys a collision before moving every operation", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = transaction(updateMany, {
      lockedOperations: [
        {
          id: "operation-target",
          userId: "target-user",
          idempotencyKeyHash: "same-key",
          upstreamKey: "target-upstream-key",
        },
        {
          id: "operation-source",
          userId: "source-user",
          idempotencyKeyHash: "same-key",
          upstreamKey: "source-upstream-key",
        },
      ],
    }) as unknown as {
      paymentOperation: { updateMany: ReturnType<typeof vi.fn> };
    };

    await transferPaymentOperationsForUserMerge(
      tx as unknown as Prisma.TransactionClient,
      "target-user",
      "target-owner",
      ["source-user"],
    );

    expect(tx.paymentOperation.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "operation-source",
        userId: "source-user",
        idempotencyKeyHash: "same-key",
      },
      data: { idempotencyKeyHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) },
    });
    expect(tx.paymentOperation.updateMany).toHaveBeenLastCalledWith({
      where: { userId: { in: ["source-user"] } },
      data: expect.objectContaining({ userId: "target-user" }),
    });
  });

  it("moves every source operation and clears stale foreground and reconciliation claims", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });

    await transferPaymentOperationsForUserMerge(
      transaction(updateMany),
      "target-user",
      "target-owner",
      ["source-a", "source-b"],
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-a", "source-b"] } },
      data: {
        userId: "target-user",
        upstreamOwnerHash: paymentUpstreamOwnerHash("target-owner"),
        claimTokenHash: null,
        leaseExpiresAt: null,
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
      },
    });
  });

  it("rebinds existing target operations when its upstream owner changes", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = transaction(updateMany, { targetOwner: "old-owner" }) as unknown as {
      paymentHistorySyncState: {
        deleteMany: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
      };
      $executeRaw: ReturnType<typeof vi.fn>;
    };

    await transferPaymentOperationsForUserMerge(
      tx as unknown as Prisma.TransactionClient,
      "target-user",
      "new-owner",
      [],
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: { in: ["target-user"] } },
      data: expect.objectContaining({
        userId: "target-user",
        upstreamOwnerHash: paymentUpstreamOwnerHash("new-owner"),
        claimTokenHash: null,
        leaseExpiresAt: null,
      }),
    });
    expect(tx.paymentHistorySyncState.deleteMany).not.toHaveBeenCalled();
    expect(tx.paymentHistorySyncState.updateMany).toHaveBeenCalledWith({
      where: { userId: "target-user" },
      data: expect.objectContaining({
        upstreamOwnerHash: paymentUpstreamOwnerHash("new-owner"),
        cursor: null,
        generation: { increment: 1 },
        claimTokenHash: null,
        leaseExpiresAt: null,
      }),
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const changedOwnerSql = tx.$executeRaw.mock.calls[1]?.[0];
    expect(sqlText(changedOwnerSql)).toContain(
      '"upstreamOwnerHash" IS DISTINCT FROM',
    );
    expect(sqlText(changedOwnerSql)).toContain(
      "'reason', 'UPSTREAM_OWNER_REBOUND'",
    );
  });

  it("drops source cursors and resets the target owner and generation after locking both", async () => {
    const tx = transaction() as unknown as {
      paymentHistorySyncState: {
        deleteMany: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
      };
      $executeRaw: ReturnType<typeof vi.fn>;
      $queryRaw: ReturnType<typeof vi.fn>;
    };

    await transferPaymentOperationsForUserMerge(
      tx as unknown as Prisma.TransactionClient,
      "target-user",
      "target-owner",
      ["source-user"],
    );

    expect(tx.paymentHistorySyncState.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-user"] } },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      tx.paymentHistorySyncState.deleteMany.mock.invocationCallOrder[0],
    );
    expect(tx.paymentHistorySyncState.updateMany).toHaveBeenCalledWith({
      where: { userId: "target-user" },
      data: expect.objectContaining({
        upstreamOwnerHash: paymentUpstreamOwnerHash("target-owner"),
        cursor: null,
        generation: { increment: 1 },
        claimTokenHash: null,
        leaseExpiresAt: null,
      }),
    });
    const sameOwnerSql = tx.$executeRaw.mock.calls[0]?.[0];
    expect(sqlText(sameOwnerSql)).toContain('"reconciledAt" = NULL');
    expect(sqlText(sameOwnerSql)).toContain(
      "IS DISTINCT FROM 'MANUAL_REQUIRED'",
    );
  });

  it("maps a defensive database uniqueness failure to a merge-required conflict", async () => {
    const updateMany = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "7.8.0",
      }),
    );

    await expect(
      transferPaymentOperationsForUserMerge(
        transaction(updateMany),
        "target-user",
        "target-owner",
        ["source-user"],
      ),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
  });

  it("rejects a disappearing preflight owner and a colliding operation changed under lock", async () => {
    const missingOwnerTx = transaction() as unknown as {
      $queryRaw: ReturnType<typeof vi.fn>;
    };
    missingOwnerTx.$queryRaw.mockResolvedValueOnce([{ id: "target-user", remnashopUserId: "owner" }]);

    await expect(preflightPaymentOperationsForUserMerge(
      missingOwnerTx as unknown as Prisma.TransactionClient,
      "target-user",
      ["source-user"],
    )).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    const changedOperationTx = transaction(vi.fn().mockResolvedValue({ count: 0 }), {
      lockedOperations: [
        { id: "target", userId: "target-user", idempotencyKeyHash: "same", upstreamKey: "target-key" },
        { id: "source", userId: "source-user", idempotencyKeyHash: "same", upstreamKey: "source-key" },
      ],
    });
    await expect(transferPaymentOperationsForUserMerge(
      changedOperationTx,
      "target-user",
      "target-owner",
      ["source-user"],
    )).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("blocks in-flight merges and clears derived history when no upstream owner remains", async () => {
    const activeTx = transaction(undefined, {
      lockedOperations: [{
        id: "active",
        userId: "source-user",
        idempotencyKeyHash: "key",
        upstreamKey: "upstream-key",
        status: "DISPATCHING",
        leaseExpiresAt: null,
      }],
    });
    await expect(transferPaymentOperationsForUserMerge(
      activeTx,
      "target-user",
      "target-owner",
      ["source-user"],
    )).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    const ownerlessTx = transaction(undefined, { targetOwner: null }) as unknown as {
      paymentOperation: { count: ReturnType<typeof vi.fn> };
      paymentHistorySyncState: { deleteMany: ReturnType<typeof vi.fn> };
      $executeRaw: ReturnType<typeof vi.fn>;
    };
    ownerlessTx.paymentOperation.count.mockResolvedValue(0);
    await expect(transferPaymentOperationsForUserMerge(
      ownerlessTx as unknown as Prisma.TransactionClient,
      "target-user",
      null,
      ["source-user"],
    )).resolves.toBeUndefined();
    expect(ownerlessTx.paymentHistorySyncState.deleteMany).toHaveBeenCalledOnce();
    expect(ownerlessTx.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns without writes when an unchanged owner has no operations to move", async () => {
    const tx = transaction() as unknown as {
      paymentOperation: { updateMany: ReturnType<typeof vi.fn> };
      paymentHistorySyncState: {
        deleteMany: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
      };
      $executeRaw: ReturnType<typeof vi.fn>;
    };

    await expect(transferPaymentOperationsForUserMerge(
      tx as unknown as Prisma.TransactionClient,
      "target-user",
      "target-owner",
      [],
    )).resolves.toBeUndefined();
    expect(tx.paymentOperation.updateMany).not.toHaveBeenCalled();
    expect(tx.paymentHistorySyncState.deleteMany).not.toHaveBeenCalled();
    expect(tx.paymentHistorySyncState.updateMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("rejects affected operations when no target owner was proven", async () => {
    const tx = transaction(undefined, { targetOwner: null }) as unknown as {
      paymentOperation: { count: ReturnType<typeof vi.fn> };
    };
    tx.paymentOperation.count.mockResolvedValueOnce(1);

    await expect(
      transferPaymentOperationsForUserMerge(
        tx as unknown as Prisma.TransactionClient,
        "target-user",
        null,
        ["source-user"],
      ),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
  });
});
