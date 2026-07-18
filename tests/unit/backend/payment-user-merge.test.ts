import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import {
  preflightPaymentOperationsForUserMerge,
  transferPaymentOperationsForUserMerge,
} from "@/backend/payments/user-merge";

type TransactionOptions = {
  targetOwner?: string | null;
  lockedOperations?: Array<{
    id: string;
    userId: string;
    idempotencyKeyHash: string;
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
  it("locks users, operations and history and rejects a post-merge key collision", async () => {
    const tx = transaction(undefined, {
      lockedOperations: [
        {
          id: "operation-target",
          userId: "target-user",
          idempotencyKeyHash: "same-key",
        },
        {
          id: "operation-source",
          userId: "source-user",
          idempotencyKeyHash: "same-key",
        },
      ],
    }) as unknown as {
      $queryRaw: ReturnType<typeof vi.fn>;
      $executeRaw: ReturnType<typeof vi.fn>;
      paymentOperation: { updateMany: ReturnType<typeof vi.fn> };
    };

    await expect(
      preflightPaymentOperationsForUserMerge(
        tx as unknown as Prisma.TransactionClient,
        "target-user",
        ["source-user"],
      ),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

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
