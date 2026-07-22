import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  redisCommand: vi.fn(),
  prisma: {
    paymentRecord: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/backend/cache/redis", () => ({
  redisCommand: mocks.redisCommand,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

import { assertCooldown, assertRateLimit, rateLimitKey, recordRateLimitEvent } from "@/backend/limits/rate-limit";
import {
  applyRemnashopTransaction,
  recordPayment,
  serializePaymentRecord,
} from "@/backend/payments/records";

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
    expect(key).toMatch(/^clean-pay:rate-limit:v3:auth_login:email:[a-f0-9]{64}:tgid:[a-f0-9]{64}:ip:none$/);
    expect(key).not.toContain("user@example.com");
    expect(key).not.toContain(":123");
    expect(rateLimitKey({ action: "Auth_Login", email: " user@example.com ", tgId: "123" })).toBe(key);
    expect(rateLimitKey({ action: "", email: null, tgId: undefined })).toBe(
      "clean-pay:rate-limit:v3:unknown:email:none:tgid:none:ip:none",
    );
    const firstIp = rateLimitKey({ action: "passkey", clientIp: "192.0.2.10" });
    const secondIp = rateLimitKey({ action: "passkey", clientIp: "192.0.2.11" });
    expect(firstIp).toMatch(/^clean-pay:rate-limit:v3:passkey:email:none:tgid:none:ip:[a-f0-9]{64}$/);
    expect(firstIp).not.toBe(secondIp);
    expect(firstIp).not.toContain("192.0.2.10");
  });

  it("increments counter and expires new keys atomically", async () => {
    mocks.redisCommand.mockResolvedValueOnce(1);

    await assertRateLimit({ action: "login", email: "u@e.test", limit: 5, windowSeconds: 60 });

    expect(mocks.redisCommand).toHaveBeenCalledWith([
      "EVAL",
      expect.stringContaining("redis.call('INCR'"),
      1,
      expect.stringMatching(/^clean-pay:rate-limit:v3:login:email:[a-f0-9]{64}:tgid:none:ip:none$/),
      60,
    ]);
  });

  it("throws rate limited error with retry ttl", async () => {
    mocks.redisCommand.mockResolvedValueOnce(6).mockResolvedValueOnce(42);

    await expect(assertRateLimit({ action: "login", email: "u@e.test", limit: 5, windowSeconds: 60 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      debug: { retryAfterSeconds: 42 },
    });
  });

  it("uses rate-limit for cooldown compatibility helpers", async () => {
    mocks.redisCommand.mockResolvedValueOnce(1);

    await assertCooldown({ key: "email:user-1", action: "email_verification", windowSeconds: 60 });
    await expect(recordRateLimitEvent()).resolves.toBeUndefined();

    expect(mocks.redisCommand).toHaveBeenCalledWith([
      "EVAL",
      expect.any(String),
      1,
      expect.stringMatching(/^clean-pay:rate-limit:v3:email_verification:email:[a-f0-9]{64}:tgid:none:ip:none$/),
      60,
    ]);
  });

  it("rejects invalid Redis counter values", async () => {
    mocks.redisCommand.mockResolvedValueOnce("not-a-number");

    await expect(assertRateLimit({ action: "login", limit: 1, windowSeconds: 60 })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });
});

describe("payment records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("corrects migration fallback timestamps and free flag on first authoritative sync", async () => {
    mocks.prisma.paymentRecord.findUnique
      .mockResolvedValueOnce({
        id: "legacy-record",
        userId: "user-1",
        operationId: null,
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
