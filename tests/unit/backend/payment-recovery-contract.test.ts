import { describe, expect, it } from "vitest";

import {
  parsePaymentCapabilities,
  parsePaymentInit,
  parsePaymentRecovery,
  parsePaymentTransaction,
  parseTransactionPage,
} from "@/backend/integrations/remnashop/payment-recovery";

const transaction = {
  payment_id: "11111111-1111-4111-8111-111111111111",
  purchase_type: "NEW",
  status: "completed",
  gateway_type: "YOOKASSA",
  final_amount: "100.00",
  currency: "\u20BD",
  plan_name: "Basic",
  duration_days: 30,
  device_limit: 3,
  traffic_limit: null,
  created_at: "2026-07-17T10:00:00.000Z",
  updated_at: "2026-07-17T10:01:00.000Z",
};

const payment = {
  payment_id: transaction.payment_id,
  payment_url: "https://pay.example.test/checkout",
  purchase_type: "NEW",
  status: "completed",
  is_free: false,
  final_amount: "100.00",
  currency: "\u20BD",
};

describe("Remnashop payment recovery v1 contract", () => {
  it("validates foreground payment URLs and preserves the echoed return URL", () => {
    const returnUrl =
      "https://pay.example.test/payment/pending?operation_id=operation-1";

    expect(parsePaymentInit({ ...payment, return_url: returnUrl }, "/purchase"))
      .toEqual({ ...payment, return_url: returnUrl });
    expect(() =>
      parsePaymentInit(
        { ...payment, payment_url: "javascript:alert(1)" },
        "/purchase",
      ),
    ).toThrow(/http\(s\) URL/i);
    expect(() =>
      parsePaymentInit(
        { ...payment, payment_id: "not-a-uuid" },
        "/purchase",
      ),
    ).toThrow(/UUID/i);
    expect(() =>
      parsePaymentInit(
        { ...payment, return_url: { unexpected: true } },
        "/purchase",
      ),
    ).toThrow(/return_url/i);
  });

  it("accepts the canonical capabilities and rejects unknown state extensions", () => {
    const capabilities = {
      contract_version: 1,
      transactions: {
        keyset_pagination: true,
        exact_lookup: true,
        max_page_size: 100,
      },
      payment_reconciliation: {
        operation_lookup: true,
        user_reconcile: true,
        admin_reconcile: true,
        states: ["SUCCEEDED", "IN_PROGRESS", "UNKNOWN", "MANUAL_REQUIRED"],
        auto_replay_gateways: ["YOOKASSA"],
      },
    };

    expect(parsePaymentCapabilities(capabilities)).toEqual(capabilities);
    expect(() =>
      parsePaymentCapabilities({
        ...capabilities,
        payment_reconciliation: {
          ...capabilities.payment_reconciliation,
          states: [...capabilities.payment_reconciliation.states, "MAGIC"],
        },
      }),
    ).toThrow(/capabilities/i);
  });

  it("strictly validates transaction values and page cursors", () => {
    expect(parsePaymentTransaction(transaction)).toEqual(transaction);
    expect(
      parsePaymentTransaction({ ...transaction, currency: "₽" }).currency,
    ).toBe("₽");
    expect(() =>
      parsePaymentTransaction({ ...transaction, final_amount: "-1.00" }),
    ).toThrow(/non-negative/i);
    expect(() =>
      parsePaymentTransaction({ ...transaction, status: "mystery" }),
    ).toThrow(/status/i);
    expect(() =>
      parsePaymentTransaction({ ...transaction, created_at: "1" }),
    ).toThrow(/RFC3339/i);
    expect(() =>
      parsePaymentTransaction({
        ...transaction,
        created_at: "2026-02-30T10:00:00Z",
      }),
    ).toThrow(/valid RFC3339/i);
    expect(
      parsePaymentTransaction({
        ...transaction,
        created_at: "2026-07-17T13:00:00+03:00",
        updated_at: "2026-07-17T13:01:00+03:00",
      }).created_at,
    ).toBe("2026-07-17T13:00:00+03:00");
    expect(() =>
      parseTransactionPage({ items: [transaction], next_cursor: "x".repeat(9_000) }),
    ).toThrow(/cursor/i);
  });

  it("requires internally consistent successful recovery data", () => {
    expect(
      parsePaymentRecovery(
        {
          operation: "PURCHASE",
          state: "SUCCEEDED",
          payment,
          transaction,
          retry_after_seconds: null,
        },
        "PURCHASE",
      ),
    ).toMatchObject({ state: "SUCCEEDED", payment });

    expect(() =>
      parsePaymentRecovery(
        {
          operation: "PURCHASE",
          state: "SUCCEEDED",
          payment: { ...payment, payment_id: "22222222-2222-4222-8222-222222222222" },
          transaction,
          retry_after_seconds: null,
        },
        "PURCHASE",
      ),
    ).toThrow(/ids differ/i);

    expect(() =>
      parsePaymentRecovery(
        {
          operation: "PURCHASE",
          state: "SUCCEEDED",
          payment: { ...payment, status: "pending" },
          transaction,
          retry_after_seconds: null,
        },
        "PURCHASE",
      ),
    ).toThrow(/status/i);

    expect(() =>
      parsePaymentRecovery(
        {
          operation: "PURCHASE",
          state: "SUCCEEDED",
          payment: { ...payment, is_free: true },
          transaction,
          retry_after_seconds: null,
        },
        "PURCHASE",
      ),
    ).toThrow(/is_free/i);
  });

  it("enforces canonical retry semantics and fail-closed unsettled payloads", () => {
    expect(
      parsePaymentRecovery(
        {
          operation: "EXTEND",
          state: "IN_PROGRESS",
          payment: null,
          transaction: null,
          retry_after_seconds: 5,
        },
        "EXTEND",
      ),
    ).toMatchObject({ state: "IN_PROGRESS", retry_after_seconds: 5 });

    expect(() =>
      parsePaymentRecovery(
        {
          operation: "EXTEND",
          state: "IN_PROGRESS",
          payment: null,
          transaction: null,
          retry_after_seconds: null,
        },
        "EXTEND",
      ),
    ).toThrow(/must include/i);
    expect(() =>
      parsePaymentRecovery(
        {
          operation: "EXTEND",
          state: "UNKNOWN",
          payment,
          transaction,
          retry_after_seconds: null,
        },
        "EXTEND",
      ),
    ).toThrow(/must not contain/i);

    expect(
      parsePaymentRecovery(
        {
          operation: "EXTEND",
          state: "UNKNOWN",
          payment: null,
          transaction: null,
          retry_after_seconds: 30,
        },
        "EXTEND",
      ),
    ).toMatchObject({ state: "UNKNOWN", retry_after_seconds: 30 });
  });
});
