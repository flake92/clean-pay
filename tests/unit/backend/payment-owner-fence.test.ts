import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    webUser: { findMany: vi.fn() },
    paymentOperation: { findFirst: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));

import {
  withPaymentOwnerChangeFence,
} from "@/backend/payments/user-merge";

describe("payment owner change fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.tx.$queryRaw.mockResolvedValue([{ locked: 1 }]);
    mocks.tx.webUser.findMany.mockResolvedValue([
      { id: "source-user" },
      { id: "target-user" },
    ]);
    mocks.tx.paymentOperation.findFirst.mockResolvedValue(null);
  });

  it("holds sorted owner locks across the external and local merge work", async () => {
    const work = vi.fn().mockResolvedValue("merged");

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      upstreamAccountIds: ["upstream-source"],
      work,
    })).resolves.toBe("merged");

    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.tx.paymentOperation.findFirst).toHaveBeenCalledWith({
      where: {
        userId: { in: ["source-user", "target-user"] },
        OR: [
          { status: "DISPATCHING" },
          { status: "READY", leaseExpiresAt: { gt: expect.any(Date) } },
        ],
      },
      select: { id: true },
    });
    expect(work).toHaveBeenCalledOnce();
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 5_000, timeout: 180_000 },
    );
  });

  it("rejects before upstream work when a dispatch or claimed READY exists", async () => {
    mocks.tx.paymentOperation.findFirst.mockResolvedValue({
      id: "operation-active",
    });
    const work = vi.fn();

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      work,
    })).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
    expect(work).not.toHaveBeenCalled();
  });
});
