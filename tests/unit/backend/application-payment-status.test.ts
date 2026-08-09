import { describe, expect, it, vi } from "vitest";

import { loadPaymentStatus } from "@/application/payments/load-payment-status";
import type { PaymentStatusReader } from "@/application/payments/ports/payment-status-reader";
import type { PaymentMaintenanceRunner } from "@/application/payments/ports/payment-maintenance";

function reconciliation(overrides: Partial<PaymentMaintenanceRunner> = {}): PaymentMaintenanceRunner {
  return {
    claimReconciliation: vi.fn(async () => null), recoverPayment: vi.fn(async () => null),
    completeRecoveredPayment: vi.fn(async () => undefined), resetMissingPayment: vi.fn(async () => undefined),
    releaseReconciliation: vi.fn(async () => undefined), markReconciliationManual: vi.fn(async () => undefined),
    failReconciliation: vi.fn(async () => "released" as const), classifyReconciliationError: vi.fn(() => ({ kind: "other" as const })),
    listHistoryCandidates: vi.fn(async () => []), claimHistory: vi.fn(async () => ({ context: {}, cursor: null })),
    authorizeHistory: vi.fn(async () => ({ context: {} })), historyPageSize: vi.fn(async () => 100),
    loadHistoryPage: vi.fn(async () => ({ context: {} })), completeHistoryPage: vi.fn(async () => ({ applied: 0, hasMore: false })),
    failHistory: vi.fn(async () => undefined), now: vi.fn(() => Date.now()),
    ...overrides,
  };
}

function reader(overrides: Partial<PaymentStatusReader> = {}): PaymentStatusReader {
  return {
    loadActor: vi.fn(async () => ({ id: "user-1", emailVerified: true, telegramId: null })),
    findOperation: vi.fn(async () => null), authorize: vi.fn(async () => ({ context: {}, upstreamAccountId: "upstream-1" })),
    assertUpstreamOwner: vi.fn(async () => undefined), loadCapabilities: vi.fn(async () => ({ maxPageSize: 250 })),
    loadExactTransaction: vi.fn(async () => null), persistExactTransaction: vi.fn(async () => undefined),
    loadLegacyTransactions: vi.fn(async () => []), persistLegacyTransactions: vi.fn(async () => undefined),
    loadSubscription: vi.fn(async () => null), findPayment: vi.fn(async () => null),
    findLatestPayment: vi.fn(async () => null), isSubscriptionMissing: vi.fn(() => false),
    ...overrides,
  };
}

describe("payment status application workflow", () => {
  it("validates external identifiers before loading the actor", async () => {
    const subject = reader();
    await expect(loadPaymentStatus(subject, reconciliation(), { paymentId: "invalid", operationId: null })).resolves.toMatchObject({ status: "error" });
    expect(subject.loadActor).not.toHaveBeenCalled();
  });

  it("returns a terminal local operation without touching the provider", async () => {
    const payment = { payment_id: "p", purchase_type: "NEW", status: "SUCCEEDED", final_amount: "100", currency: "RUB", gateway_type: "CARD", plan_name: null, created_at: "2026-01-01" };
    const subject = reader({
      findOperation: vi.fn(async () => ({ id: "op-1", status: "SUCCEEDED", manualRequired: false, paymentId: "p", paymentStatus: "SUCCEEDED", payment })),
    });
    await expect(loadPaymentStatus(subject, reconciliation(), { paymentId: null, operationId: "op-1" })).resolves.toEqual({
      status: "ready", data: { payment, subscription: null, operation: expect.objectContaining({ status: "succeeded" }) },
    });
    expect(subject.authorize).not.toHaveBeenCalled();
  });

  it("owns exact-payment synchronization and reconciliation ordering", async () => {
    const order: string[] = [];
    const transaction = { context: { payment_id: "550e8400-e29b-41d4-a716-446655440000" } };
    const subject = reader({
      authorize: vi.fn(async () => { order.push("authorize"); return { context: {}, upstreamAccountId: "upstream-1" }; }),
      assertUpstreamOwner: vi.fn(async () => { order.push("owner"); }),
      loadCapabilities: vi.fn(async () => { order.push("capabilities"); return { maxPageSize: 100 }; }),
      loadExactTransaction: vi.fn(async () => { order.push("exact"); return transaction; }),
      persistExactTransaction: vi.fn(async () => { order.push("persist"); }),
      loadSubscription: vi.fn(async () => { order.push("subscription"); return null; }),
      findPayment: vi.fn(async () => { order.push("read-local"); return null; }),
    });
    const reconciliationGateway = reconciliation({ claimReconciliation: vi.fn(async () => { order.push("claim"); return { context: {}, operationId: "op", ownerMatches: true, failureCount: 0 }; }), recoverPayment: vi.fn(async () => { order.push("reconcile"); return { context: {}, state: "IN_PROGRESS" as const, retryAfterSeconds: 5 }; }) });
    await loadPaymentStatus(subject, reconciliationGateway, { paymentId: "550e8400-e29b-41d4-a716-446655440000", operationId: null });
    expect(order).toEqual(["authorize", "owner", "capabilities", "exact", "persist", "claim", "reconcile", "subscription", "read-local"]);
  });

  it("uses bounded history synchronization when no exact payment was selected", async () => {
    const subject = reader();
    const reconciliationGateway = reconciliation();
    await loadPaymentStatus(subject, reconciliationGateway, { paymentId: null, operationId: null });
    expect(reconciliationGateway.claimHistory).toHaveBeenCalledWith({ userId: "user-1", upstreamAccountId: "upstream-1" });
    expect(reconciliationGateway.loadHistoryPage).toHaveBeenCalledWith(expect.anything(), null, 100);
    expect(subject.loadExactTransaction).not.toHaveBeenCalled();
  });

  it("falls back to legacy transaction synchronization when capabilities are absent", async () => {
    const transactions = [{ context: {} }];
    const subject = reader({ loadCapabilities: vi.fn(async () => null), loadLegacyTransactions: vi.fn(async () => transactions) });
    const reconciliationGateway = reconciliation();
    await loadPaymentStatus(subject, reconciliationGateway, { paymentId: null, operationId: null });
    expect(subject.persistLegacyTransactions).toHaveBeenCalledWith("user-1", "upstream-1", transactions);
    expect(reconciliationGateway.claimReconciliation).not.toHaveBeenCalled();
  });

  it("keeps an already successful local result when provider refresh fails", async () => {
    const subject = reader({
      findOperation: vi.fn(async () => ({ id: "op-1", status: "SUCCEEDED", manualRequired: false, paymentId: null, paymentStatus: null, payment: null })),
      authorize: vi.fn(async () => { throw new Error("offline"); }),
    });
    await expect(loadPaymentStatus(subject, reconciliation(), { paymentId: null, operationId: "op-1" })).resolves.toMatchObject({
      status: "ready", data: { operation: { status: "succeeded" } },
    });
  });
});
