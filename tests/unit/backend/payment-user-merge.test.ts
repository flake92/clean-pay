import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { transferPaymentOperationsForUserMerge } from "@/backend/payments/user-merge";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";

function transaction(updateMany: ReturnType<typeof vi.fn>) {
  return {
    paymentOperation: {
      updateMany,
      count: vi.fn().mockResolvedValue(0),
    },
    paymentHistorySyncState: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "target-user" }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as unknown as Prisma.TransactionClient;
}

describe("payment operations during user merge", () => {
  it("moves every source operation before the source users are deleted", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });

    await transferPaymentOperationsForUserMerge(
      transaction(updateMany),
      "target-user",
      "target-owner",
      ["source-a", "source-b"],
    );

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: { in: ["source-a", "source-b"] } },
      data: {
        userId: "target-user",
        upstreamOwnerHash: paymentUpstreamOwnerHash("target-owner"),
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
      },
    });
  });

  it("fails the whole merge safely when idempotency keys collide", async () => {
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

  it("drops source cursors and increments the target generation to fence workers", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = transaction(updateMany) as unknown as {
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
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.paymentHistorySyncState.deleteMany.mock.invocationCallOrder[0],
    );
    expect(tx.paymentHistorySyncState.updateMany).toHaveBeenCalledWith({
      where: { userId: "target-user" },
      data: expect.objectContaining({
        cursor: null,
        generation: { increment: 1 },
        claimTokenHash: null,
        leaseExpiresAt: null,
      }),
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const sameOwnerSql = tx.$executeRaw.mock.calls[0]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    const changedOwnerSql = tx.$executeRaw.mock.calls[1]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    expect(sameOwnerSql.strings?.join(" ")).toContain(
      '"upstreamOwnerHash" =',
    );
    expect(sameOwnerSql.strings?.join(" ")).toContain(
      '"reconciledAt" = NULL',
    );
    expect(changedOwnerSql.strings?.join(" ")).toContain(
      '"upstreamOwnerHash" IS DISTINCT FROM',
    );
    expect(changedOwnerSql.strings?.join(" ")).toContain(
      "'code', 'MANUAL_REQUIRED'",
    );
    expect(changedOwnerSql.values).toContain(
      paymentUpstreamOwnerHash("target-owner"),
    );
  });

  it("rejects a merge with payment operations when no target owner was proven", async () => {
    const tx = transaction(vi.fn()) as unknown as {
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
