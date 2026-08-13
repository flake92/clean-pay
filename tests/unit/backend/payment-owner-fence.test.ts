import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    remnashopUserId: "target-owner" as string | null,
    tokenHash: null as string | null,
    leaseExpiresAt: null as Date | null,
    mutationStartedAt: null as Date | null,
    localFinalizedAt: null as Date | null,
    operationHash: null as string | null,
    expectedOwnerHash: null as string | null,
  };
  const tx = {
    $queryRaw: vi.fn(),
    webUser: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentOperation: { findFirst: vi.fn() },
  };
  return {
    state,
    tx,
    prisma: {
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));

import {
  lockPaymentOwnerFence,
  assertPaymentOwnerChangeFenceHeld,
  markPaymentOwnerChangeLocalFinalized,
  markPaymentOwnerChangeUpstreamMutationStarted,
  reconcileCompletedPaymentOwnerChange,
  withPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-service";
import { sha256 } from "@/backend/security/crypto";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";

const ownerIds = ["source-user", "target-user"];

describe("payment owner change fence", () => {
  let insideTransaction = false;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    insideTransaction = false;
    mocks.state.tokenHash = null;
    mocks.state.remnashopUserId = "target-owner";
    mocks.state.leaseExpiresAt = null;
    mocks.state.mutationStartedAt = null;
    mocks.state.localFinalizedAt = null;
    mocks.state.operationHash = null;
    mocks.state.expectedOwnerHash = null;
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => {
        insideTransaction = true;
        try {
          return await callback(mocks.tx);
        } finally {
          insideTransaction = false;
        }
      },
    );
    mocks.tx.$queryRaw.mockResolvedValue([{ locked: 1 }]);
    mocks.tx.webUser.findFirst.mockImplementation(async () =>
      mocks.state.tokenHash ? { id: "target-user" } : null,
    );
    mocks.tx.webUser.findMany.mockImplementation(async (input: {
      select?: { paymentOwnerChangeTokenHash?: boolean };
    }) => input.select?.paymentOwnerChangeTokenHash
      ? ownerIds.map((id) => ({
          id,
          remnashopUserId: mocks.state.remnashopUserId,
          paymentOwnerChangeTokenHash: mocks.state.tokenHash,
          paymentOwnerChangeLeaseExpiresAt: mocks.state.leaseExpiresAt,
          paymentOwnerChangeMutationStartedAt: mocks.state.mutationStartedAt,
          paymentOwnerChangeLocalFinalizedAt: mocks.state.localFinalizedAt,
          paymentOwnerChangeOperationHash: mocks.state.operationHash,
          paymentOwnerChangeExpectedOwnerHash: mocks.state.expectedOwnerHash,
        }))
      : ownerIds.map((id) => ({ id })),
    );
    mocks.tx.webUser.updateMany.mockImplementation(async (input: {
      data: {
        paymentOwnerChangeTokenHash?: string | null;
        paymentOwnerChangeLeaseExpiresAt?: Date | null;
        paymentOwnerChangeMutationStartedAt?: Date | null;
        paymentOwnerChangeLocalFinalizedAt?: Date | null;
        paymentOwnerChangeOperationHash?: string | null;
        paymentOwnerChangeExpectedOwnerHash?: string | null;
      };
    }) => {
      if ("paymentOwnerChangeTokenHash" in input.data) {
        mocks.state.tokenHash = input.data.paymentOwnerChangeTokenHash ?? null;
      }
      if ("paymentOwnerChangeLeaseExpiresAt" in input.data) {
        mocks.state.leaseExpiresAt =
          input.data.paymentOwnerChangeLeaseExpiresAt ?? null;
      }
      if ("paymentOwnerChangeMutationStartedAt" in input.data) {
        mocks.state.mutationStartedAt =
          input.data.paymentOwnerChangeMutationStartedAt ?? null;
      }
      if ("paymentOwnerChangeLocalFinalizedAt" in input.data) {
        mocks.state.localFinalizedAt =
          input.data.paymentOwnerChangeLocalFinalizedAt ?? null;
      }
      if ("paymentOwnerChangeOperationHash" in input.data) {
        mocks.state.operationHash =
          input.data.paymentOwnerChangeOperationHash ?? null;
      }
      if ("paymentOwnerChangeExpectedOwnerHash" in input.data) {
        mocks.state.expectedOwnerHash =
          input.data.paymentOwnerChangeExpectedOwnerHash ?? null;
      }
      return { count: ownerIds.length };
    });
    mocks.tx.paymentOperation.findFirst.mockResolvedValue(null);
  });

  it("commits a durable barrier before external work and finalizes it afterward", async () => {
    const work = vi.fn().mockImplementation(async () => {
      expect(insideTransaction).toBe(false);
      expect(mocks.state.tokenHash).toEqual(expect.any(String));
      expect(mocks.state.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
      return "merged";
    });

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      upstreamAccountIds: ["upstream-source"],
      operationKey: "test-owner-change",
      targetUpstreamAccountId: "target-owner",
      work,
    })).resolves.toBe("merged");

    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(5);
    expect(mocks.tx.paymentOperation.findFirst).toHaveBeenCalledWith({
      where: {
        userId: { in: ownerIds },
        OR: [
          { status: "DISPATCHING" },
          { status: "READY", leaseExpiresAt: { gt: expect.any(Date) } },
        ],
      },
      select: { id: true },
    });
    expect(work).toHaveBeenCalledOnce();
    expect(mocks.state.tokenHash).toBeNull();
    expect(mocks.state.leaseExpiresAt).toBeNull();
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.$transaction).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      { maxWait: 5_000, timeout: 10_000 },
    );
  });

  it("releases the durable barrier when external work fails before a mutation", async () => {
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "test-owner-change",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn().mockRejectedValue(new Error("upstream failed")),
    })).rejects.toThrow("upstream failed");

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.state.tokenHash).toBeNull();
    expect(mocks.state.leaseExpiresAt).toBeNull();

    await expect(lockPaymentOwnerFence(
      mocks.tx as never,
      ["target-user"],
    )).resolves.toEqual(["target-user"]);
  });

  it("keeps the barrier after an upstream mutation may have started", async () => {
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "merge-1",
      targetUpstreamAccountId: "target-owner",
      work: async () => {
        await markPaymentOwnerChangeUpstreamMutationStarted();
        throw new Error("post-dispatch failure");
      },
    })).rejects.toThrow("post-dispatch failure");

    expect(mocks.state.tokenHash).toEqual(expect.any(String));
    expect(mocks.state.leaseExpiresAt).toEqual(expect.any(Date));
  });

  it("rejects mutation, ownership assertion and local finalize outside a fence context", async () => {
    await expect(markPaymentOwnerChangeUpstreamMutationStarted()).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
    });
    await expect(assertPaymentOwnerChangeFenceHeld(mocks.tx as never, ownerIds)).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
    });
    await expect(markPaymentOwnerChangeLocalFinalized(mocks.tx as never, ownerIds)).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
    });
  });

  it("renews an active fence and validates the local finalize before clearing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    let finishWork!: () => void;
    const workReady = new Promise<void>((resolve) => {
      finishWork = resolve;
    });
    const work = vi.fn().mockImplementation(async () => {
      await markPaymentOwnerChangeUpstreamMutationStarted();
      await assertPaymentOwnerChangeFenceHeld(mocks.tx as never, ownerIds);
      await markPaymentOwnerChangeLocalFinalized(mocks.tx as never, ownerIds);
      await workReady;
      return "finalized";
    });

    const result = withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      upstreamAccountIds: ["upstream-source"],
      operationKey: "renewed-owner-change",
      targetUpstreamAccountId: "target-owner",
      work,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.state.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    finishWork();

    await expect(result).resolves.toBe("finalized");
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(mocks.state.tokenHash).toBeNull();
  });

  it("reconciles only the expired barrier for the exact completed operation", async () => {
    mocks.state.tokenHash = "stale-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);
    mocks.state.mutationStartedAt = new Date(Date.now() - 2_000);
    mocks.state.operationHash = sha256("merge-1");
    mocks.state.expectedOwnerHash = paymentUpstreamOwnerHash("target-owner");

    await reconcileCompletedPaymentOwnerChange(ownerIds, "merge-1");

    expect(mocks.tx.webUser.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        paymentOwnerChangeOperationHash: sha256("merge-1"),
        paymentOwnerChangeMutationStartedAt: { not: null },
        paymentOwnerChangeLeaseExpiresAt: { lte: expect.any(Date) },
      }),
      data: expect.objectContaining({
        paymentOwnerChangeTokenHash: null,
        paymentOwnerChangeOperationHash: null,
      }),
    });
  });

  it("validates every reconciliation precondition and tolerates an already-clear fence", async () => {
    await expect(reconcileCompletedPaymentOwnerChange(["", ""], "merge-1"))
      .resolves.toBeUndefined();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();

    mocks.tx.webUser.findMany.mockResolvedValueOnce([{ id: "target-user" }]);
    await expect(reconcileCompletedPaymentOwnerChange(ownerIds, "merge-1"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    await expect(reconcileCompletedPaymentOwnerChange(ownerIds, "merge-1"))
      .resolves.toBeUndefined();

    mocks.state.tokenHash = "stale-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);
    mocks.state.mutationStartedAt = new Date(Date.now() - 2_000);
    mocks.state.operationHash = sha256("another-merge");
    await expect(reconcileCompletedPaymentOwnerChange(ownerIds, "merge-1"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    mocks.state.operationHash = sha256("merge-1");
    mocks.state.leaseExpiresAt = new Date(Date.now() + 60_000);
    await expect(reconcileCompletedPaymentOwnerChange(ownerIds, "merge-1"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);
    mocks.tx.webUser.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(reconcileCompletedPaymentOwnerChange(ownerIds, "merge-1"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("never treats an already-matching owner as proof that local finalize committed", async () => {
    mocks.state.tokenHash = "ambiguous-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);
    mocks.state.mutationStartedAt = new Date(Date.now() - 2_000);
    mocks.state.expectedOwnerHash = paymentUpstreamOwnerHash("target-owner");

    await expect(lockPaymentOwnerFence(
      mocks.tx as never,
      ["target-user"],
    )).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    mocks.state.localFinalizedAt = new Date(Date.now() - 1_500);
    await expect(lockPaymentOwnerFence(
      mocks.tx as never,
      ["target-user"],
    )).resolves.toEqual(["target-user"]);
    expect(mocks.state.tokenHash).toBeNull();
  });

  it("rejects before upstream work when a dispatch or claimed READY exists", async () => {
    mocks.tx.paymentOperation.findFirst.mockResolvedValue({
      id: "operation-active",
    });
    const work = vi.fn();

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "test-owner-change",
      targetUpstreamAccountId: "target-owner",
      work,
    })).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
    expect(work).not.toHaveBeenCalled();
    expect(mocks.state.tokenHash).toBeNull();
  });

  it("allows an owner-change retry to take over only after the lease expires", async () => {
    mocks.state.tokenHash = "stale-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "test-owner-change",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn().mockResolvedValue("recovered"),
    })).resolves.toBe("recovered");
    expect(mocks.state.tokenHash).toBeNull();

    mocks.state.tokenHash = "active-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() + 60_000);
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "test-owner-change",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("clears a durably finalized stale fence before starting a new attempt", async () => {
    mocks.state.tokenHash = "completed-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);
    mocks.state.mutationStartedAt = new Date(Date.now() - 2_000);
    mocks.state.localFinalizedAt = new Date(Date.now() - 1_500);
    mocks.state.operationHash = sha256("previous-merge");
    mocks.state.expectedOwnerHash = paymentUpstreamOwnerHash("target-owner");
    mocks.tx.webUser.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "next-merge",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn().mockResolvedValue("started"),
    })).resolves.toBe("started");
    expect(mocks.state.tokenHash).toBeNull();
  });

  it("resumes only the exact expired post-mutation attempt", async () => {
    mocks.state.tokenHash = "retry-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);
    mocks.state.mutationStartedAt = new Date(Date.now() - 2_000);
    mocks.state.operationHash = sha256("merge-retry");
    mocks.state.expectedOwnerHash = paymentUpstreamOwnerHash("target-owner");

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "merge-retry",
      targetUpstreamAccountId: "target-owner",
      work: async () => {
        await markPaymentOwnerChangeLocalFinalized(mocks.tx as never, ownerIds);
        return "resumed";
      },
    })).resolves.toBe("resumed");

    mocks.state.tokenHash = "retry-token";
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1_000);
    mocks.state.mutationStartedAt = new Date(Date.now() - 2_000);
    mocks.state.operationHash = sha256("different-operation");
    mocks.state.expectedOwnerHash = paymentUpstreamOwnerHash("target-owner");
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "merge-retry",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("rejects invalid claims, missing owners and concurrently changed claim rows", async () => {
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: " ",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    mocks.tx.webUser.findMany
      .mockResolvedValueOnce([{ id: "target-user" }])
      .mockResolvedValueOnce([{ id: "target-user" }])
      .mockResolvedValueOnce([]);
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "merge-1",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    mocks.tx.webUser.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "merge-1",
      targetUpstreamAccountId: "target-owner",
      work: vi.fn(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("returns early for an empty payment fence and an unmutated local finalize", async () => {
    await expect(lockPaymentOwnerFence(mocks.tx as never, ["", ""]))
      .resolves.toEqual([]);
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "merge-1",
      targetUpstreamAccountId: "target-owner",
      work: async () => {
        await markPaymentOwnerChangeLocalFinalized(mocks.tx as never, ownerIds);
        return "unchanged";
      },
    })).resolves.toBe("unchanged");
  });

  it("fails closed when lease validation or local finalize ownership is lost", async () => {
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "lease-lost",
      targetUpstreamAccountId: "target-owner",
      work: async () => {
        mocks.state.leaseExpiresAt = new Date(Date.now() - 1);
        await assertPaymentOwnerChangeFenceHeld(mocks.tx as never, ownerIds);
      },
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "owner-lost",
      targetUpstreamAccountId: "target-owner",
      work: async () => {
        await markPaymentOwnerChangeUpstreamMutationStarted();
        mocks.state.remnashopUserId = null;
        await markPaymentOwnerChangeLocalFinalized(mocks.tx as never, ownerIds);
      },
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("surfaces mutation, finalize and claim update races", async () => {
    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "mutation-race",
      targetUpstreamAccountId: "target-owner",
      work: async () => {
        mocks.tx.webUser.updateMany.mockResolvedValueOnce({ count: 0 });
        await markPaymentOwnerChangeUpstreamMutationStarted();
      },
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    await expect(withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "finalize-race",
      targetUpstreamAccountId: "target-owner",
      work: async () => {
        mocks.tx.webUser.updateMany.mockResolvedValueOnce({ count: 0 });
        return "done";
      },
    })).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("records a renewal failure and returns it after external work finishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    let finishWork!: () => void;
    const workReady = new Promise<void>((resolve) => {
      finishWork = resolve;
    });
    const work = vi.fn().mockImplementation(async () => {
      await workReady;
      return "done";
    });
    const result = withPaymentOwnerChangeFence({
      userIds: ["target-user"],
      operationKey: "renewal-failure",
      targetUpstreamAccountId: "target-owner",
      work,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(work).toHaveBeenCalledOnce();
    mocks.state.leaseExpiresAt = new Date(Date.now() - 1);
    await vi.advanceTimersByTimeAsync(30_000);
    finishWork();

    await expect(result).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.state.tokenHash).not.toBeNull();
  });
});
