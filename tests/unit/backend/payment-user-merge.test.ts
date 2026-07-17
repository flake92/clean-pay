import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { transferPaymentOperationsForUserMerge } from "@/backend/payments/user-merge";

function transaction(updateMany: ReturnType<typeof vi.fn>) {
  return {
    paymentOperation: { updateMany },
  } as unknown as Prisma.TransactionClient;
}

describe("payment operations during user merge", () => {
  it("moves every source operation before the source users are deleted", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });

    await transferPaymentOperationsForUserMerge(
      transaction(updateMany),
      "target-user",
      ["source-a", "source-b"],
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: { in: ["source-a", "source-b"] } },
      data: { userId: "target-user" },
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
        ["source-user"],
      ),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
  });
});
