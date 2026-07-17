import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { BffError } from "@/backend/integrations/remnashop/errors";
import { recordPayment, serializePaymentRecord } from "@/backend/payments/records";

describe("rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds normalized Redis keys", () => {
    expect(rateLimitKey({ action: "Auth_Login", email: " USER@Example.COM ", tgId: 123n })).toBe(
      "clean-pay:rate-limit:action:auth_login:email:user@example.com:tgid:123",
    );
    expect(rateLimitKey({ action: "", email: null, tgId: undefined })).toBe(
      "clean-pay:rate-limit:action:unknown:email:none:tgid:none",
    );
  });

  it("increments counter and expires new keys", async () => {
    mocks.redisCommand.mockResolvedValueOnce(1).mockResolvedValueOnce("OK");

    await assertRateLimit({ action: "login", email: "u@e.test", limit: 5, windowSeconds: 60 });

    expect(mocks.redisCommand).toHaveBeenNthCalledWith(1, [
      "INCR",
      "clean-pay:rate-limit:action:login:email:u@e.test:tgid:none",
    ]);
    expect(mocks.redisCommand).toHaveBeenNthCalledWith(2, [
      "EXPIRE",
      "clean-pay:rate-limit:action:login:email:u@e.test:tgid:none",
      60,
    ]);
  });

  it("throws rate limited error with retry ttl", async () => {
    mocks.redisCommand.mockResolvedValueOnce(6).mockResolvedValueOnce(42);

    await expect(assertRateLimit({ action: "login", email: "u@e.test", limit: 5, windowSeconds: 60 })).rejects.toMatchObject<BffError>({
      code: "RATE_LIMITED",
      status: 429,
      debug: { retryAfterSeconds: 42 },
    });
  });

  it("uses rate-limit for cooldown compatibility helpers", async () => {
    mocks.redisCommand.mockResolvedValueOnce(1).mockResolvedValueOnce("OK");

    await assertCooldown({ key: "email:user-1", action: "email_verification", windowSeconds: 60 });
    await expect(recordRateLimitEvent()).resolves.toBeUndefined();

    expect(mocks.redisCommand).toHaveBeenCalledWith([
      "INCR",
      "clean-pay:rate-limit:action:email_verification:email:email:user-1:tgid:none",
    ]);
  });

  it("rejects invalid Redis counter values", async () => {
    mocks.redisCommand.mockResolvedValueOnce("not-a-number");

    await expect(assertRateLimit({ action: "login", limit: 1, windowSeconds: 60 })).rejects.toMatchObject<BffError>({
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
        createdAt: new Date("2026-06-25T00:00:00.000Z"),
        updatedAt: new Date("2026-06-25T01:00:00.000Z"),
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
