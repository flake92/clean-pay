import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopRequest: vi.fn(),
  remnashopRequestResult: vi.fn(),
  remnashopAdminRequestResult: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopRequest: mocks.remnashopRequest,
  remnashopRequestResult: mocks.remnashopRequestResult,
  remnashopAdminRequestResult: mocks.remnashopAdminRequestResult,
}));

import {
  getLegacyTransactions,
  getPaymentCapabilities,
  getExactTransaction,
  getTransactionPage,
  reconcilePaymentOperation,
  reconcilePaymentOperationAsAdmin,
} from "@/backend/integrations/remnashop/payment-recovery";

const transaction = {
  payment_id: "11111111-1111-4111-8111-111111111111", purchase_type: "NEW", status: "completed",
  gateway_type: "YOOKASSA", final_amount: "100.00", currency: "RUB", plan_name: null,
  duration_days: 30, device_limit: 3, traffic_limit: null,
  created_at: "2026-07-17T10:00:00.000Z", updated_at: "2026-07-17T10:01:00.000Z",
};
const payment = {
  payment_id: transaction.payment_id, payment_url: "https://pay.example/checkout", purchase_type: "NEW",
  status: "completed", is_free: false, final_amount: "100.00", currency: "RUB",
};
const capabilities = {
  contract_version: 1,
  transactions: { keyset_pagination: true, exact_lookup: true, max_page_size: 100 },
  payment_reconciliation: {
    operation_lookup: true, user_reconcile: true, admin_reconcile: true,
    states: ["SUCCEEDED", "IN_PROGRESS", "UNKNOWN", "MANUAL_REQUIRED"], auto_replay_gateways: ["YOOKASSA"],
  },
};

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

  it("loads optional capabilities and bounded cursor pages", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(null).mockResolvedValueOnce(capabilities).mockResolvedValueOnce({
      items: [transaction], next_cursor: "cursor-2",
    });
    await expect(getPaymentCapabilities("access")).resolves.toBeNull();
    await expect(getPaymentCapabilities("access")).resolves.toEqual(capabilities);
    await expect(getTransactionPage({ accessToken: "access", cursor: "cursor-1", limit: 50 })).resolves.toEqual({
      items: [transaction], next_cursor: "cursor-2",
    });
    expect(mocks.remnashopRequest).toHaveBeenLastCalledWith(
      "/subscription/transactions/page?limit=50&cursor=cursor-1",
      { accessToken: "access", timeoutMs: 10_000 },
    );
    await expect(getTransactionPage({ accessToken: "access", cursor: null, limit: 0 })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(getTransactionPage({ accessToken: "access", cursor: null, limit: 101 })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("loads exact and legacy transactions including a missing exact row", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(null).mockResolvedValueOnce(transaction).mockResolvedValueOnce([transaction]);
    await expect(getExactTransaction({ accessToken: "access", paymentId: transaction.payment_id })).resolves.toBeNull();
    await expect(getExactTransaction({ accessToken: "access", paymentId: transaction.payment_id })).resolves.toEqual(transaction);
    await expect(getLegacyTransactions("access")).resolves.toEqual([transaction]);
  });

  it("maps user reconciliation 404, pending and succeeded responses", async () => {
    mocks.remnashopRequestResult
      .mockResolvedValueOnce({ status: 404, data: null })
      .mockResolvedValueOnce({ status: 202, data: { operation: "PURCHASE", state: "UNKNOWN", payment: null, transaction: null, retry_after_seconds: 30 } })
      .mockResolvedValueOnce({ status: 200, data: { operation: "PURCHASE", state: "SUCCEEDED", payment, transaction, retry_after_seconds: null } });
    await expect(reconcilePaymentOperation({ accessToken: "access", operation: "PURCHASE", idempotencyKey: "key", trigger: false })).resolves.toBeNull();
    await expect(reconcilePaymentOperation({ accessToken: "access", operation: "PURCHASE", idempotencyKey: "key", trigger: true })).resolves.toMatchObject({ state: "UNKNOWN" });
    await expect(reconcilePaymentOperation({ accessToken: "access", operation: "PURCHASE", idempotencyKey: "key", trigger: true })).resolves.toMatchObject({ state: "SUCCEEDED" });
  });

  it("maps admin reconciliation and validates its HTTP status", async () => {
    mocks.remnashopAdminRequestResult
      .mockResolvedValueOnce({ status: 404, data: null })
      .mockResolvedValueOnce({ status: 202, data: { operation: "EXTEND", state: "IN_PROGRESS", payment: null, transaction: null, retry_after_seconds: 5 } })
      .mockResolvedValueOnce({ status: 200, data: { operation: "EXTEND", state: "IN_PROGRESS", payment: null, transaction: null, retry_after_seconds: 5 } });
    const input = { remnashopUserId: "owner / 1", operation: "EXTEND" as const, idempotencyKey: "key", trigger: true };
    await expect(reconcilePaymentOperationAsAdmin(input)).resolves.toBeNull();
    await expect(reconcilePaymentOperationAsAdmin(input)).resolves.toMatchObject({ state: "IN_PROGRESS" });
    await expect(reconcilePaymentOperationAsAdmin(input)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(mocks.remnashopAdminRequestResult).toHaveBeenCalledWith(
      "/payment-operations/EXTEND?user_id=owner+%2F+1",
      expect.objectContaining({ method: "POST", allowNotFound: true }),
    );
  });
});
