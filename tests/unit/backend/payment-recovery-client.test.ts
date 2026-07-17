import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopRequest: vi.fn(),
  remnashopAdminRequest: vi.fn(),
  remnashopRequestResult: vi.fn(),
  remnashopAdminRequestResult: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopRequest: mocks.remnashopRequest,
  remnashopAdminRequest: mocks.remnashopAdminRequest,
  remnashopRequestResult: mocks.remnashopRequestResult,
  remnashopAdminRequestResult: mocks.remnashopAdminRequestResult,
}));

import {
  getExactTransaction,
  reconcilePaymentOperation,
} from "@/backend/integrations/remnashop/payment-recovery";

describe("Remnashop exact payment lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a valid row returned for a different requested id", async () => {
    mocks.remnashopRequest.mockResolvedValue({
      payment_id: "22222222-2222-4222-8222-222222222222",
      purchase_type: "NEW",
      status: "completed",
      gateway_type: "YOOKASSA",
      final_amount: "100.00",
      currency: "₽",
      plan_name: null,
      duration_days: 30,
      device_limit: 3,
      traffic_limit: null,
      created_at: "2026-07-17T10:00:00.000Z",
      updated_at: "2026-07-17T10:01:00.000Z",
    });

    await expect(
      getExactTransaction({
        accessToken: "access",
        paymentId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });

  it("rejects a recovery state returned with the wrong HTTP status", async () => {
    mocks.remnashopRequestResult.mockResolvedValue({
      status: 200,
      data: {
        operation: "PURCHASE",
        state: "IN_PROGRESS",
        payment: null,
        transaction: null,
        retry_after_seconds: 5,
      },
    });

    await expect(
      reconcilePaymentOperation({
        accessToken: "access",
        operation: "PURCHASE",
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        trigger: true,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });
});
