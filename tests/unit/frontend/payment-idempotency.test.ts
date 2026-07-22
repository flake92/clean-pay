/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalPaymentPayload,
  clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey,
  paymentIdempotencyStorageKey,
  parsePaymentOperationStatusEnvelope,
  shouldPollPaymentOperation,
  shouldRetainPaymentIdempotencyKey,
} from "@/frontend/lib/payment-idempotency";

describe("payment idempotency keys", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("canonicalizes payload keys independently of insertion order", () => {
    expect(
      canonicalPaymentPayload({
        plan_code: "pro",
        duration_days: 30,
        gateway_type: "card",
      }),
    ).toBe(
      canonicalPaymentPayload({
        gateway_type: "card",
        duration_days: 30,
        plan_code: "pro",
      }),
    );
  });

  it("reuses one key for retries and reloads of the same operation payload", () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const payload = {
      plan_code: "pro",
      duration_days: 30,
      gateway_type: "card",
    };

    const first = getOrCreatePaymentIdempotencyKey("purchase", payload, {
      randomUUID,
    });
    const retry = getOrCreatePaymentIdempotencyKey(
      "purchase",
      {
        gateway_type: "card",
        duration_days: 30,
        plan_code: "pro",
      },
      { randomUUID },
    );

    expect(first).toBe("11111111-1111-4111-8111-111111111111");
    expect(retry).toBe(first);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(
        paymentIdempotencyStorageKey("purchase", payload),
      ),
    ).toBe(first);
  });

  it("uses separate slots when the payload or operation changes", () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333");
    const payload = { duration_days: 30, gateway_type: "card" };

    const purchase = getOrCreatePaymentIdempotencyKey("purchase", payload, {
      randomUUID,
    });
    const changedPayload = getOrCreatePaymentIdempotencyKey(
      "purchase",
      { duration_days: 90, gateway_type: "card" },
      { randomUUID },
    );
    const extend = getOrCreatePaymentIdempotencyKey("extend", payload, {
      randomUUID,
    });

    expect(new Set([purchase, changedPayload, extend]).size).toBe(3);
  });

  it("retains a key for processing, throttled and ambiguous server outcomes", () => {
    expect(shouldRetainPaymentIdempotencyKey(202)).toBe(true);
    expect(shouldRetainPaymentIdempotencyKey(408)).toBe(true);
    expect(shouldRetainPaymentIdempotencyKey(429)).toBe(true);
    expect(shouldRetainPaymentIdempotencyKey(500)).toBe(true);
    expect(shouldRetainPaymentIdempotencyKey(409)).toBe(false);
    expect(shouldRetainPaymentIdempotencyKey(409, "manual_required")).toBe(true);
  });

  it("accepts only bounded operation status envelopes used by the payment UI", () => {
    expect(
      parsePaymentOperationStatusEnvelope({
        data: {
          operation_id: "operation-1",
          status: "manual_required",
        },
      }),
    ).toEqual({
      operationId: "operation-1",
      status: "manual_required",
    });
    expect(
      parsePaymentOperationStatusEnvelope({
        data: { operation_id: "operation-1", status: "ready" },
      }),
    ).toBeNull();
    expect(
      parsePaymentOperationStatusEnvelope({
        data: { operation_id: "x".repeat(192), status: "processing" },
      }),
    ).toBeNull();
    expect(shouldPollPaymentOperation("processing")).toBe(true);
    expect(shouldPollPaymentOperation("outcome_unknown")).toBe(true);
    expect(shouldPollPaymentOperation("manual_required")).toBe(false);
    expect(shouldPollPaymentOperation("succeeded")).toBe(false);
  });

  it("clears only the matching key after a terminal outcome", () => {
    const payload = { duration_days: 30, gateway_type: "card" };
    const first = getOrCreatePaymentIdempotencyKey("extend", payload, {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });
    const storageKey = paymentIdempotencyStorageKey("extend", payload);

    window.sessionStorage.setItem(
      storageKey,
      "22222222-2222-4222-8222-222222222222",
    );
    clearPaymentIdempotencyKey("extend", payload, first);
    expect(window.sessionStorage.getItem(storageKey)).toBe(
      "22222222-2222-4222-8222-222222222222",
    );

    clearPaymentIdempotencyKey(
      "extend",
      payload,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("still returns a key when session storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    const first = getOrCreatePaymentIdempotencyKey(
      "purchase",
      { duration_days: 31 },
      { randomUUID, storage },
    );
    const retry = getOrCreatePaymentIdempotencyKey(
      "purchase",
      { duration_days: 31 },
      { randomUUID, storage },
    );

    expect(first).toBe("11111111-1111-4111-8111-111111111111");
    expect(retry).toBe(first);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("keeps the same in-memory key if storage becomes unavailable between retries", () => {
    const values = new Map<string, string>();
    let blocked = false;
    const storage = {
      getItem: vi.fn((key: string) => {
        if (blocked) {
          throw new Error("blocked");
        }

        return values.get(key) ?? null;
      }),
      removeItem: vi.fn((key: string) => values.delete(key)),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    const randomUUID = vi.fn(() => "77777777-7777-4777-8777-777777777777");
    const payload = { duration_days: 32, gateway_type: "card" };

    const first = getOrCreatePaymentIdempotencyKey("purchase", payload, {
      randomUUID,
      storage,
    });
    blocked = true;
    const retry = getOrCreatePaymentIdempotencyKey("purchase", payload, {
      randomUUID,
      storage,
    });

    expect(retry).toBe(first);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});
