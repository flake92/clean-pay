import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  redisCommand: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    paymentRecord: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  lockPaymentUpstreamOwner: vi.fn(),
}));

vi.mock("@/backend/cache/redis", () => ({
  redisCommand: mocks.redisCommand,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/integrations/payments/payment-owner-service", () => ({
  lockPaymentUpstreamOwner: mocks.lockPaymentUpstreamOwner,
}));

import {
  assertCooldown,
  assertRateLimit,
  assertRateLimitCapacity,
  assertTargetRateLimit,
  rateLimitCapacityKey,
  rateLimitKey,
  withAuthConcurrency,
} from "@/backend/limits/rate-limit";
import {
  applyRemnashopTransaction,
  recordPayment,
  serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions,
} from "@/backend/integrations/payments/payment-record-service";

const upstreamTransaction = {
  payment_id: "11111111-1111-4111-8111-111111111111",
  purchase_type: "subscription",
  status: "completed",
  gateway_type: "YOOKASSA",
  final_amount: "0.00",
  currency: "RUB",
  plan_name: "Basic",
  duration_days: 30,
  device_limit: 3,
  traffic_limit: null,
  created_at: "2026-07-17T10:00:00.000Z",
  updated_at: "2026-07-17T10:01:00.000Z",
};

describe("rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds normalized Redis keys", () => {
    const key = rateLimitKey({ action: "Auth_Login", email: " USER@Example.COM ", tgId: 123n });
    expect(key).toMatch(/^clean-pay:rate-limit:v4:auth:auth_login:email:[a-f0-9]{64}$/);
    expect(key).not.toContain("user@example.com");
    expect(key).not.toContain(":123");
    expect(rateLimitKey({ action: "Auth_Login", email: " user@example.com ", tgId: "123" })).toBe(key);
    expect(rateLimitKey({ action: "", email: null, tgId: undefined })).toBe(
      "clean-pay:rate-limit:v4:auth:unknown:capacity",
    );
    expect(rateLimitCapacityKey("passkey")).toBe("clean-pay:rate-limit:v4:auth:passkey:capacity");
  });

  it("increments counter and expires new keys atomically", async () => {
    mocks.redisCommand.mockResolvedValueOnce([1, 1]);

    await assertRateLimit({ action: "login", email: "u@e.test", limit: 5, windowSeconds: 60 });

    expect(mocks.redisCommand).toHaveBeenCalledWith([
      "EVAL",
      expect.stringContaining("redis.call('INCR'"),
      2,
      expect.stringMatching(/^clean-pay:rate-limit:v4:auth:login:email:[a-f0-9]{64}$/),
      "clean-pay:rate-limit:v4:auth:login:capacity",
      60,
    ]);
  });

  it("separates the anonymous preflight capacity bucket from the proven target bucket", async () => {
    mocks.redisCommand.mockResolvedValueOnce([1]).mockResolvedValueOnce([1]);

    await assertRateLimitCapacity("auth_command", 60);
    await assertTargetRateLimit({
      action: "auth_login",
      email: "u@example.com",
      limit: 5,
      windowSeconds: 60,
    });

    expect(mocks.redisCommand).toHaveBeenNthCalledWith(1, [
      "EVAL",
      expect.any(String),
      1,
      "clean-pay:rate-limit:v4:auth:auth_command:capacity",
      60,
    ]);
    expect(mocks.redisCommand).toHaveBeenNthCalledWith(2, [
      "EVAL",
      expect.any(String),
      1,
      expect.stringMatching(/^clean-pay:rate-limit:v4:auth:auth_login:email:[a-f0-9]{64}$/),
      60,
    ]);
  });

  it("throws rate limited error with retry ttl", async () => {
    mocks.redisCommand.mockResolvedValueOnce([6, 6]).mockResolvedValueOnce(42);

    await expect(assertRateLimit({ action: "login", email: "u@e.test", limit: 5, windowSeconds: 60 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      debug: { retryAfterSeconds: 42 },
    });
  });

  it("keeps anonymous action limits separate from the shared capacity limit", async () => {
    mocks.redisCommand
      .mockResolvedValueOnce([21])
      .mockResolvedValueOnce([1_001])
      .mockResolvedValueOnce(17);

    await expect(assertRateLimit({
      action: "passkey_login_options",
      limit: 20,
      windowSeconds: 15 * 60,
    })).resolves.toBeUndefined();

    expect(mocks.redisCommand).toHaveBeenNthCalledWith(1, [
      "EVAL",
      expect.any(String),
      1,
      "clean-pay:rate-limit:v4:auth:passkey_login_options:capacity",
      15 * 60,
    ]);

    await expect(assertRateLimit({
      action: "passkey_login_options",
      limit: 20,
      windowSeconds: 15 * 60,
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      debug: { retryAfterSeconds: 17 },
    });
  });

  it("uses rate-limit for cooldown checks", async () => {
    mocks.redisCommand.mockResolvedValueOnce([1, 1]);

    await assertCooldown({ key: "email:user-1", action: "email_verification", windowSeconds: 60 });
    expect(mocks.redisCommand).toHaveBeenCalledWith([
      "EVAL",
      expect.any(String),
      2,
      expect.stringMatching(/^clean-pay:rate-limit:v4:auth:email_verification:email:[a-f0-9]{64}$/),
      "clean-pay:rate-limit:v4:auth:email_verification:capacity",
      60,
    ]);
  });

  it("rejects invalid Redis counter values", async () => {
    mocks.redisCommand.mockResolvedValueOnce("not-a-number");

    await expect(assertRateLimit({ action: "login", limit: 1, windowSeconds: 60 })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("bounds expensive auth work with a leased Redis semaphore", async () => {
    mocks.redisCommand.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const work = vi.fn().mockResolvedValue("done");

    await expect(withAuthConcurrency("login", work)).resolves.toBe("done");

    expect(work).toHaveBeenCalledOnce();
    expect(mocks.redisCommand.mock.calls[0]?.[0]).toEqual([
      "EVAL",
      expect.stringContaining("ZREMRANGEBYSCORE"),
      1,
      "clean-pay:concurrency:v1:auth:login",
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      64,
      30_000,
    ]);
    expect(mocks.redisCommand.mock.calls[1]?.[0]).toEqual([
      "ZREM",
      "clean-pay:concurrency:v1:auth:login",
      expect.any(String),
    ]);
  });

  it("rejects concurrency exhaustion before expensive work", async () => {
    mocks.redisCommand.mockResolvedValueOnce(0);
    const work = vi.fn();

    await expect(withAuthConcurrency("login", work)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
    expect(work).not.toHaveBeenCalled();
  });
});

describe("payment records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockPaymentUpstreamOwner.mockResolvedValue("upstream-1");
    mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
  });

  it("synchronizes transaction pages and exact rows under a locked owner", async () => {
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.paymentRecord.create.mockResolvedValue({ id: "record-1" });

    await syncPaymentRecordsFromRemnashopTransactions({
      userId: "user-1", upstreamAccountId: "upstream-1",
      transactions: [upstreamTransaction, { ...upstreamTransaction, payment_id: "payment-2" }],
    });
    await expect(syncExactPaymentRecordFromRemnashop({
      userId: "user-1", upstreamAccountId: "upstream-1", transaction: upstreamTransaction,
    })).resolves.toEqual({ id: "record-1" });

    expect(mocks.lockPaymentUpstreamOwner).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.paymentRecord.create).toHaveBeenCalledTimes(3);
  });

  it("retries one transaction-level unique race and then succeeds", async () => {
    const unique = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7.9.0" });
    mocks.prisma.$transaction.mockRejectedValueOnce(unique).mockImplementationOnce(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.paymentRecord.create.mockResolvedValue({ id: "record-1" });

    await expect(syncExactPaymentRecordFromRemnashop({
      userId: "user-1", upstreamAccountId: "upstream-1", transaction: upstreamTransaction,
    })).resolves.toEqual({ id: "record-1" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-unique transaction failures or a second unique race", async () => {
    const failure = new TypeError("database offline");
    mocks.prisma.$transaction.mockRejectedValueOnce(failure);
    await expect(syncPaymentRecordsFromRemnashopTransactions({
      userId: "user-1", upstreamAccountId: "upstream-1", transactions: [],
    })).rejects.toBe(failure);

    const unique = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7.9.0" });
    mocks.prisma.$transaction.mockRejectedValue(unique);
    await expect(syncExactPaymentRecordFromRemnashop({
      userId: "user-1", upstreamAccountId: "upstream-1", transaction: upstreamTransaction,
    })).rejects.toBe(unique);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid upstream timestamps before touching a record", async () => {
    await expect(applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1", transaction: { ...upstreamTransaction, created_at: "invalid" },
    })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await expect(applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1", transaction: { ...upstreamTransaction, updated_at: "2026-07-17T09:00:00.000Z" },
    })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(mocks.prisma.paymentRecord.findUnique).not.toHaveBeenCalled();
  });

  it("creates normalized payment records", async () => {
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.paymentRecord.create.mockResolvedValue({ id: "record-1" });

    await recordPayment({
      userId: "user-1",
      gatewayType: "YOOKASSA",
      durationDays: 30,
      plan: {
        public_code: "basic",
        name: "Basic",
        device_limit: 3,
        traffic_limit: 100,
      } as never,
      payment: {
        payment_id: "payment-1",
        purchase_type: "subscription",
        status: "completed",
        final_amount: "100.00",
        currency: "RUB",
        payment_url: "https://pay.test",
        is_free: false,
      } as never,
    });

    expect(mocks.prisma.paymentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        paymentId: "payment-1",
        status: "COMPLETED",
        planCode: "basic",
      }),
    });
  });

  it("preserves non-unique insert failures", async () => {
    const failure = new TypeError("database write failed");
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.paymentRecord.create.mockRejectedValue(failure);

    await expect(recordPayment({
      userId: "user-1",
      gatewayType: "YOOKASSA",
      payment: {
        payment_id: "payment-failed",
        purchase_type: "NEW",
        status: "pending",
        final_amount: "100.00",
        currency: "RUB",
        payment_url: null,
        is_free: false,
      },
    })).rejects.toBe(failure);
  });

  it("fails closed when an insert race has no compatible winner", async () => {
    const unique = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "7.9.0",
    });
    const input = {
      userId: "user-1",
      gatewayType: "YOOKASSA",
      payment: {
        payment_id: "payment-race-owner",
        purchase_type: "NEW",
        status: "pending" as const,
        final_amount: "100.00",
        currency: "RUB",
        payment_url: null,
        is_free: false,
      },
    };
    mocks.prisma.paymentRecord.create.mockRejectedValue(unique);
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "another-user", operationId: null })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "user-1", operationId: "another-operation" });

    await expect(recordPayment(input)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(recordPayment(input)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(recordPayment(input, { operationId: "operation-1" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("bounds repeated compatible insert races", async () => {
    const unique = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "7.9.0",
    });
    mocks.prisma.paymentRecord.create.mockRejectedValue(unique);
    mocks.prisma.paymentRecord.findUnique.mockImplementation(async () => {
      const call = mocks.prisma.paymentRecord.findUnique.mock.calls.length;
      return call % 2 === 1
        ? null
        : { userId: "user-1", operationId: null };
    });

    await expect(recordPayment({
      userId: "user-1",
      gatewayType: "YOOKASSA",
      payment: {
        payment_id: "payment-contended-insert",
        purchase_type: "NEW",
        status: "pending",
        final_amount: "100.00",
        currency: "RUB",
        payment_url: null,
        is_free: false,
      },
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Payment record kept changing during insert",
    });
    expect(mocks.prisma.paymentRecord.create).toHaveBeenCalledTimes(3);
  });

  it("never updates a payment id owned by another user", async () => {
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue({
      id: "record-foreign",
      userId: "user-foreign",
      operationId: null,
    });

    await expect(
      recordPayment({
        userId: "user-1",
        gatewayType: "YOOKASSA",
        payment: {
          payment_id: "payment-shared",
          purchase_type: "subscription",
          status: "pending",
          final_amount: "100.00",
          currency: "RUB",
          payment_url: "https://pay.test",
          is_free: false,
        },
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    expect(mocks.prisma.paymentRecord.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.paymentRecord.create).not.toHaveBeenCalled();
  });

  it("rereads after a CAS loss and never overwrites an authoritative sync with stale foreground PENDING", async () => {
    const base = {
      id: "record-race",
      userId: "user-1",
      operationId: null,
      purchaseType: "NEW",
      status: "PENDING",
      finalAmount: "100.00",
      currency: "\u20BD",
      gatewayType: "YOOKASSA",
      planCode: "basic",
      planName: "Basic",
      durationDays: 30,
      deviceLimit: 3,
      trafficLimit: null,
      paymentUrl: "https://pay.test/pending",
      isFree: false,
      raw: null,
      upstreamCreatedAt: new Date("2026-07-18T10:00:00.000Z"),
      upstreamUpdatedAt: new Date("2026-07-18T10:00:00.000Z"),
      lastSyncedAt: null,
    };
    const authoritative = {
      ...base,
      status: "COMPLETED",
      paymentUrl: null,
      upstreamUpdatedAt: new Date("2026-07-18T10:01:00.000Z"),
      lastSyncedAt: new Date("2026-07-18T10:01:01.000Z"),
      raw: { remnashopTransaction: { status: "completed" } },
    };
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(authoritative)
      .mockResolvedValueOnce(authoritative);
    mocks.prisma.paymentRecord.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await recordPayment({
      userId: "user-1",
      gatewayType: "YOOKASSA",
      payment: {
        payment_id: "payment-race",
        payment_url: "https://pay.test/stale",
        purchase_type: "NEW",
        status: "pending",
        is_free: false,
        final_amount: "100.00",
        currency: "\u20BD",
      },
    });

    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ lastSyncedAt: null }),
      }),
    );
    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          lastSyncedAt: authoritative.lastSyncedAt,
        }),
        data: expect.objectContaining({
          status: "COMPLETED",
          upstreamUpdatedAt: authoritative.upstreamUpdatedAt,
        }),
      }),
    );
  });

  it("bounds foreground payment CAS retries under sustained contention", async () => {
    const stale = {
      id: "record-contended",
      userId: "user-1",
      operationId: null,
      purchaseType: "NEW",
      status: "PENDING",
      finalAmount: "100.00",
      currency: "\u20BD",
      gatewayType: "YOOKASSA",
      planCode: null,
      planName: null,
      durationDays: null,
      deviceLimit: null,
      trafficLimit: null,
      paymentUrl: null,
      isFree: false,
      raw: null,
      upstreamCreatedAt: new Date("2026-07-18T10:00:00.000Z"),
      upstreamUpdatedAt: new Date("2026-07-18T10:00:00.000Z"),
      lastSyncedAt: null,
    };
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue(stale);
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      recordPayment({
        userId: "user-1",
        gatewayType: "YOOKASSA",
        payment: {
          payment_id: "payment-contended",
          payment_url: null,
          purchase_type: "NEW",
          status: "pending",
          is_free: false,
          final_amount: "100.00",
          currency: "\u20BD",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledTimes(3);
  });

  it("creates a missing history record and derives free payment from its strict amount", async () => {
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.paymentRecord.create.mockResolvedValue({ id: "record-history" });

    await applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1",
      transaction: upstreamTransaction,
    });

    expect(mocks.prisma.paymentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        paymentId: upstreamTransaction.payment_id,
        isFree: true,
        upstreamCreatedAt: new Date(upstreamTransaction.created_at),
        upstreamUpdatedAt: new Date(upstreamTransaction.updated_at),
      }),
    });
  });

  it("rejects a foreign history collision before mutating it", async () => {
    mocks.prisma.paymentRecord.findUnique.mockResolvedValue({
      id: "foreign-record",
      userId: "user-2",
    });

    await expect(
      applyRemnashopTransaction(mocks.prisma as never, {
        userId: "user-1",
        transaction: upstreamTransaction,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.prisma.paymentRecord.updateMany).not.toHaveBeenCalled();
  });

  it("does not regress richer data on a stale upstream update", async () => {
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce({
        id: "record-1",
        userId: "user-1",
        operationId: null,
        status: "COMPLETED",
        upstreamCreatedAt: new Date("2026-07-17T09:00:00.000Z"),
        upstreamUpdatedAt: new Date("2026-07-17T11:00:00.000Z"),
        lastSyncedAt: new Date("2026-07-17T11:00:01.000Z"),
        planCode: "premium",
        planName: "Premium",
        durationDays: 365,
        deviceLimit: 10,
        trafficLimit: 1000,
        paymentUrl: "https://pay.test/rich",
        isFree: false,
        raw: { preserved: true },
      })
      .mockResolvedValueOnce({ id: "record-1" });
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });

    await applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1",
      transaction: upstreamTransaction,
    });

    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledWith({
      where: { id: "record-1", userId: "user-1" },
      data: { lastSyncedAt: expect.any(Date) },
    });
  });

  it("links reconciliation to a newer record without regressing authoritative fields", async () => {
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce({
        id: "record-newer",
        userId: "user-1",
        operationId: null,
        status: "COMPLETED",
        upstreamCreatedAt: new Date("2026-07-17T09:00:00.000Z"),
        upstreamUpdatedAt: new Date("2026-07-17T11:00:00.000Z"),
        lastSyncedAt: new Date("2026-07-17T11:00:01.000Z"),
        planCode: null,
        planName: "Premium",
        durationDays: 365,
        deviceLimit: 10,
        trafficLimit: 1000,
        paymentUrl: null,
        isFree: false,
        raw: { preserved: true },
      })
      .mockResolvedValueOnce({
        id: "record-newer",
        operationId: "operation-1",
        status: "COMPLETED",
      });
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });

    await applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1",
      operationId: "operation-1",
      planCode: "basic",
      payment: {
        payment_id: upstreamTransaction.payment_id,
        payment_url: "https://pay.test/recovered",
        purchase_type: upstreamTransaction.purchase_type,
        status: upstreamTransaction.status,
        is_free: true,
        final_amount: upstreamTransaction.final_amount,
        currency: upstreamTransaction.currency,
      },
      transaction: upstreamTransaction,
    });

    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: "record-newer",
        userId: "user-1",
        OR: [
          { operationId: null },
          { operationId: "operation-1" },
        ],
      },
      data: {
        lastSyncedAt: expect.any(Date),
        operationId: "operation-1",
      },
    });
    const staleUpdate = mocks.prisma.paymentRecord.updateMany.mock.calls[0]?.[0];
    expect(staleUpdate?.data).not.toHaveProperty("planCode");
    expect(staleUpdate?.data).not.toHaveProperty("paymentUrl");
  });

  it("does not regress a terminal payment on an equal upstream timestamp", async () => {
    const upstreamUpdatedAt = new Date(upstreamTransaction.updated_at);
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce({
        id: "record-terminal",
        userId: "user-1",
        operationId: null,
        status: "COMPLETED",
        upstreamCreatedAt: new Date(upstreamTransaction.created_at),
        upstreamUpdatedAt,
        lastSyncedAt: new Date("2026-07-17T10:02:00.000Z"),
        planCode: "basic",
        planName: "Basic",
        durationDays: 30,
        deviceLimit: 3,
        trafficLimit: null,
        paymentUrl: "https://pay.test/checkout",
        isFree: false,
        raw: { status: "completed" },
      })
      .mockResolvedValueOnce({ id: "record-terminal", status: "COMPLETED" });
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });

    await applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1",
      transaction: { ...upstreamTransaction, status: "pending" },
    });

    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledWith({
      where: { id: "record-terminal", userId: "user-1" },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(mocks.prisma.paymentRecord.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  it("rejects a newer upstream row that regresses a terminal payment", async () => {
    const currentUpdatedAt = new Date("2026-07-17T10:01:00.000Z");
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce({
        id: "record-terminal-newer",
        userId: "user-1",
        operationId: null,
        status: "REFUNDED",
        upstreamCreatedAt: new Date(upstreamTransaction.created_at),
        upstreamUpdatedAt: currentUpdatedAt,
        lastSyncedAt: new Date("2026-07-17T10:02:00.000Z"),
        planCode: "basic",
        planName: "Basic",
        durationDays: 30,
        deviceLimit: 3,
        trafficLimit: null,
        paymentUrl: "https://pay.test/checkout",
        isFree: false,
        raw: { status: "refunded" },
      })
      .mockResolvedValueOnce({ id: "record-terminal-newer", status: "REFUNDED" });
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });

    await applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1",
      transaction: {
        ...upstreamTransaction,
        status: "completed",
        updated_at: "2026-07-17T10:03:00.000Z",
      },
    });

    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledWith({
      where: { id: "record-terminal-newer", userId: "user-1" },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(mocks.prisma.paymentRecord.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("corrects migration fallback timestamps and free flag on first authoritative sync", async () => {
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce({
        id: "legacy-record",
        userId: "user-1",
        operationId: null,
        status: "PENDING",
        upstreamCreatedAt: new Date("2026-07-18T12:00:00.000Z"),
        upstreamUpdatedAt: new Date("2026-07-18T12:00:00.000Z"),
        lastSyncedAt: null,
        planCode: null,
        planName: null,
        durationDays: null,
        deviceLimit: null,
        trafficLimit: null,
        paymentUrl: null,
        isFree: false,
        raw: null,
      })
      .mockResolvedValueOnce({ id: "legacy-record" });
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });

    await applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1",
      transaction: upstreamTransaction,
    });

    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ upstreamUpdatedAt: expect.anything() }),
        data: expect.objectContaining({
          isFree: true,
          upstreamCreatedAt: new Date(upstreamTransaction.created_at),
          upstreamUpdatedAt: new Date(upstreamTransaction.updated_at),
        }),
      }),
    );
  });

  it("cannot let an older concurrent first sync overwrite the newer winner", async () => {
    const migrated = {
      id: "legacy-race",
      userId: "user-1",
      operationId: null,
      status: "PENDING",
      upstreamCreatedAt: new Date("2026-07-18T12:00:00.000Z"),
      upstreamUpdatedAt: new Date("2026-07-18T12:00:00.000Z"),
      lastSyncedAt: null,
      planCode: null,
      planName: null,
      durationDays: null,
      deviceLimit: null,
      trafficLimit: null,
      paymentUrl: null,
      isFree: false,
      raw: null,
    };
    const newerWinner = {
      ...migrated,
      upstreamCreatedAt: new Date("2026-07-17T09:00:00.000Z"),
      upstreamUpdatedAt: new Date("2026-07-17T11:00:00.000Z"),
      lastSyncedAt: new Date("2026-07-17T11:00:01.000Z"),
      planName: "Newer",
    };
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce(migrated)
      .mockResolvedValueOnce(newerWinner)
      .mockResolvedValueOnce({ id: "legacy-race", planName: "Newer" });
    mocks.prisma.paymentRecord.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await applyRemnashopTransaction(mocks.prisma as never, {
      userId: "user-1",
      transaction: upstreamTransaction,
    });

    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ lastSyncedAt: null }),
      }),
    );
    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "legacy-race", userId: "user-1" },
      data: { lastSyncedAt: expect.any(Date) },
    });
  });

  it("rereads a same-owner P2002 winner and applies the row", async () => {
    const existing = {
      id: "record-winner",
      userId: "user-1",
      operationId: null,
      status: "PENDING",
      upstreamCreatedAt: new Date(upstreamTransaction.created_at),
      upstreamUpdatedAt: new Date(upstreamTransaction.created_at),
      lastSyncedAt: null,
      planCode: null,
      planName: null,
      durationDays: null,
      deviceLimit: null,
      trafficLimit: null,
      paymentUrl: null,
      isFree: false,
      raw: null,
    };
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "user-1" })
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ id: existing.id });
    mocks.prisma.paymentRecord.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "7.8.0",
      }),
    );
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      applyRemnashopTransaction(mocks.prisma as never, {
        userId: "user-1",
        transaction: upstreamTransaction,
      }),
    ).resolves.toEqual({ id: existing.id });
    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledOnce();
  });

  it("serializes DB records back to Remnashop-shaped payloads", () => {
    expect(
      serializePaymentRecord({
        id: "record-1",
        paymentId: "payment-1",
        purchaseType: "subscription",
        status: "UNKNOWN",
        finalAmount: 0,
        currency: "RUB",
        gatewayType: "FREE",
        planCode: null,
        planName: null,
        durationDays: null,
        deviceLimit: null,
        trafficLimit: null,
        isFree: true,
        upstreamCreatedAt: new Date("2026-06-25T00:00:00.000Z"),
        upstreamUpdatedAt: new Date("2026-06-25T01:00:00.000Z"),
      }),
    ).toEqual({
      id: "record-1",
      payment_id: "payment-1",
      purchase_type: "subscription",
      status: "unknown",
      final_amount: "0",
      currency: "RUB",
      gateway_type: "FREE",
      plan_code: null,
      plan_name: null,
      duration_days: null,
      device_limit: null,
      traffic_limit: null,
      is_free: true,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T01:00:00.000Z",
    });
  });
});
