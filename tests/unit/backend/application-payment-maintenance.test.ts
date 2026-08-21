import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  paymentMaintenanceBatchIsHealthy,
  processPaymentHistoryPage,
  processPaymentReconciliation,
  runPaymentMaintenance,
} from "@/application/payments/run-payment-maintenance";
import type { PaymentMaintenanceRunner } from "@/application/payments/ports/payment-maintenance";

function runner(overrides: Partial<PaymentMaintenanceRunner> = {}): PaymentMaintenanceRunner {
  return {
    claimReconciliation: vi.fn(async () => null), recoverPayment: vi.fn(async () => null),
    completeRecoveredPayment: vi.fn(async () => undefined), resetMissingPayment: vi.fn(async () => undefined),
    releaseReconciliation: vi.fn(async () => undefined), markReconciliationManual: vi.fn(async () => undefined),
    failReconciliation: vi.fn(async () => "released" as const), classifyReconciliationError: vi.fn(() => ({ kind: "other" as const })),
    listHistoryCandidates: vi.fn(async () => []), claimHistory: vi.fn(async () => null),
    authorizeHistory: vi.fn(async () => ({ context: {} })), historyPageSize: vi.fn(async () => 100),
    findPendingHistoryPaymentIds: vi.fn(async () => []), loadExactHistoryPayment: vi.fn(async () => null),
    persistExactHistoryPayment: vi.fn(async () => undefined),
    loadLegacyHistory: vi.fn(async () => ({ context: {} })),
    loadHistoryPage: vi.fn(async () => ({ context: {} })), completeHistoryPage: vi.fn(async () => ({ applied: 0, hasMore: false })),
    classifyHistoryError: vi.fn(() => ({ kind: "unexpected" as const })),
    deferHistory: vi.fn(async () => undefined), failHistory: vi.fn(async () => undefined), now: vi.fn(() => 1_000), ...overrides,
  };
}

const claim = (overrides: Record<string, unknown> = {}) => ({
  context: {}, operationId: "operation-1", ownerMatches: true, failureCount: 0, ...overrides,
}) as never;

describe("payment maintenance application policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends owner mismatches directly to manual review", async () => {
    const subject = runner();
    await expect(processPaymentReconciliation(subject, claim({ ownerMatches: false }))).resolves.toBe("MANUAL_REQUIRED");
    expect(subject.recoverPayment).not.toHaveBeenCalled();
    expect(subject.markReconciliationManual).toHaveBeenCalledWith(expect.anything(), "UPSTREAM_OWNER_MISMATCH", true);
  });

  it("classifies owner changes during the recovery request", async () => {
    const failure = new Error("owner changed");
    const changed = runner({
      recoverPayment: vi.fn(async () => { throw failure; }), failReconciliation: vi.fn(async () => "owner_changed" as const),
    });
    await expect(processPaymentReconciliation(changed, claim())).resolves.toBe("MANUAL_REQUIRED");
    expect(changed.markReconciliationManual).toHaveBeenCalledWith(expect.anything(), "UPSTREAM_OWNER_CHANGED_DURING_REQUEST", true);

    const transient = runner({ recoverPayment: vi.fn(async () => { throw failure; }) });
    await expect(processPaymentReconciliation(transient, claim())).rejects.toBe(failure);
  });

  it.each([
    [{ context: {}, state: "SUCCEEDED", retryAfterSeconds: null }, "SUCCEEDED"],
    [null, "RETRY_READY"],
    [{ context: {}, state: "IN_PROGRESS", retryAfterSeconds: 7 }, "IN_PROGRESS"],
    [{ context: {}, state: "UNKNOWN", retryAfterSeconds: 30 }, "UNKNOWN"],
    [{ context: {}, state: "UNKNOWN", retryAfterSeconds: null }, "UNKNOWN"],
    [{ context: {}, state: "MANUAL_REQUIRED", retryAfterSeconds: null }, "MANUAL_REQUIRED"],
  ])("maps recovery result %# to %s", async (recovery, expected) => {
    const subject = runner({ recoverPayment: vi.fn(async () => recovery as never) });
    await expect(processPaymentReconciliation(subject, claim({ failureCount: 2 }))).resolves.toBe(expected);
    if (expected === "SUCCEEDED") expect(subject.completeRecoveredPayment).toHaveBeenCalled();
    if (expected === "RETRY_READY") expect(subject.resetMissingPayment).toHaveBeenCalled();
    if (expected === "IN_PROGRESS") expect(subject.releaseReconciliation).toHaveBeenCalledWith(expect.anything(), { delayMs: 7_000, failure: false });
    if (expected === "UNKNOWN") expect(subject.releaseReconciliation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failure: true }));
    if (expected === "MANUAL_REQUIRED") expect(subject.markReconciliationManual).toHaveBeenCalledWith(expect.anything(), "UPSTREAM_MANUAL_REQUIRED");
  });

  it.each([
    [{ kind: "manual", reason: "BAD_SETTLEMENT" }, "BAD_SETTLEMENT", false],
    [{ kind: "owner_changed" }, "UPSTREAM_OWNER_CHANGED_DURING_SETTLEMENT", true],
  ])("classifies settlement failure %#", async (classified, reason, ownershipChanged) => {
    const error = new Error("settlement failed");
    const subject = runner({
      recoverPayment: vi.fn(async () => ({ context: {}, state: "SUCCEEDED", retryAfterSeconds: null } as never)),
      completeRecoveredPayment: vi.fn(async () => { throw error; }),
      classifyReconciliationError: vi.fn(() => classified as never),
    });
    await expect(processPaymentReconciliation(subject, claim())).resolves.toBe("MANUAL_REQUIRED");
    expect(subject.markReconciliationManual).toHaveBeenCalledWith(expect.anything(), reason, ...(ownershipChanged ? [true] : []));
  });

  it("handles an owner change after an unclassified settlement failure", async () => {
    const error = new Error("settlement failed");
    const subject = runner({
      recoverPayment: vi.fn(async () => ({ context: {}, state: "SUCCEEDED", retryAfterSeconds: null } as never)),
      completeRecoveredPayment: vi.fn(async () => { throw error; }), failReconciliation: vi.fn(async () => "owner_changed" as const),
    });
    await expect(processPaymentReconciliation(subject, claim())).resolves.toBe("MANUAL_REQUIRED");
    expect(subject.markReconciliationManual).toHaveBeenCalledWith(expect.anything(), "UPSTREAM_OWNER_CHANGED_AFTER_SETTLEMENT_FAILURE", true);
  });

  it("rethrows an unclassified settlement failure after releasing its claim", async () => {
    const error = new Error("settlement failed");
    const subject = runner({
      recoverPayment: vi.fn(async () => ({ context: {}, state: "SUCCEEDED", retryAfterSeconds: null } as never)),
      completeRecoveredPayment: vi.fn(async () => { throw error; }),
    });
    await expect(processPaymentReconciliation(subject, claim())).rejects.toBe(error);
  });

  it("claims and applies one bounded history page", async () => {
    const subject = runner({
      claimHistory: vi.fn(async () => ({ context: {}, cursor: "cursor" } as never)),
      completeHistoryPage: vi.fn(async () => ({ applied: 10, hasMore: true })),
    });
    await expect(processPaymentHistoryPage(subject, { userId: "user-1", upstreamAccountId: "owner-1" }, { access: true }, 500))
      .resolves.toEqual({ claimed: true, applied: 10, hasMore: true });
    expect(subject.loadHistoryPage).toHaveBeenCalledWith({ context: { access: true } }, "cursor", 100);
  });

  it("returns an unclaimed history result and records page failures", async () => {
    const absent = runner();
    await expect(processPaymentHistoryPage(absent, { userId: "user-1", upstreamAccountId: "owner-1" }, {}, 10))
      .resolves.toEqual({ claimed: false, applied: 0, hasMore: false });
    const failure = new Error("history unavailable");
    const broken = runner({
      claimHistory: vi.fn(async () => ({ context: {}, cursor: null } as never)), loadHistoryPage: vi.fn(async () => { throw failure; }),
    });
    await expect(processPaymentHistoryPage(broken, { userId: "user-1", upstreamAccountId: "owner-1" }, {}, 10)).rejects.toBe(failure);
    expect(broken.failHistory).toHaveBeenCalledWith(expect.anything(), failure);
  });

  it.each([
    [{ paymentLimit: 0, deadlineMs: 1_000 }],
    [{ paymentLimit: 101, deadlineMs: 1_000 }],
    [{ paymentLimit: 1, deadlineMs: 999 }],
    [{ paymentLimit: 1, deadlineMs: 30_001 }],
    [{ paymentLimit: 1.5, deadlineMs: 1_000 }],
  ])("rejects unsafe maintenance bounds %#", async (input) => {
    await expect(runPaymentMaintenance(runner(), input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("counts payment outcomes and isolates failed operations", async () => {
    let time = 1_000;
    const claims = [
      claim({ operationId: "success" }), claim({ operationId: "progress" }), claim({ operationId: "unknown" }),
      claim({ operationId: "missing" }), claim({ operationId: "manual", ownerMatches: false }), claim({ operationId: "failed" }), null,
    ];
    const subject = runner({
      now: vi.fn(() => time++), claimReconciliation: vi.fn(async () => claims.shift() as never),
      recoverPayment: vi.fn(async (value: { operationId: string }) => {
        if (value.operationId === "success") return { context: {}, state: "SUCCEEDED", retryAfterSeconds: null } as never;
        if (value.operationId === "progress") return { context: {}, state: "IN_PROGRESS", retryAfterSeconds: 1 } as never;
        if (value.operationId === "unknown") return { context: {}, state: "UNKNOWN", retryAfterSeconds: 1 } as never;
        if (value.operationId === "missing") return null;
        throw new Error("failed");
      }),
    });
    await expect(runPaymentMaintenance(subject, { paymentLimit: 10, deadlineMs: 10_000 })).resolves.toMatchObject({
      claimed: 6, succeeded: 1, inProgress: 1, unknown: 1, retryReady: 1, manualRequired: 1, failed: 1,
      manualRequiredOperationIds: ["manual"],
    });
  });

  it("processes history candidates and falls back to legacy history when capabilities are absent", async () => {
    let time = 1_000;
    const subject = runner({
      now: vi.fn(() => time++), listHistoryCandidates: vi.fn(async () => [
        { userId: "user-1", upstreamAccountId: "owner-1" }, { userId: "user-2", upstreamAccountId: "owner-2" },
      ]),
      claimHistory: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ context: {}, cursor: null }),
      historyPageSize: vi.fn(async () => 0),
    });
    await expect(runPaymentMaintenance(subject, { paymentLimit: 1, deadlineMs: 10_000 })).resolves.toMatchObject({
      history: { attempted: 1, applied: 0, completed: 1, failed: 0 },
    });
    expect(subject.loadLegacyHistory).toHaveBeenCalled();
    expect(subject.failHistory).not.toHaveBeenCalled();
    expect(subject.listHistoryCandidates).toHaveBeenCalledWith(20);
  });

  it("isolates exact pending-payment failures before applying the bounded page", async () => {
    const failure = new Error("exact unavailable");
    const subject = runner({
      listHistoryCandidates: vi.fn(async () => [
        { userId: "user-1", upstreamAccountId: "owner-1" },
      ]),
      claimHistory: vi.fn(async () => ({ context: {}, cursor: null })),
      findPendingHistoryPaymentIds: vi.fn(async () => ["payment-1", "payment-2"]),
      loadExactHistoryPayment: vi.fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ context: { payment_id: "payment-2" } }),
      completeHistoryPage: vi.fn(async () => ({ applied: 1, hasMore: false })),
      logHistoryExactFailure: vi.fn(),
    });

    await expect(runPaymentMaintenance(subject, {
      paymentLimit: 1,
      deadlineMs: 10_000,
    })).resolves.toMatchObject({
      history: { attempted: 1, applied: 1, completed: 1, failed: 0 },
    });
    expect(subject.persistExactHistoryPayment).toHaveBeenCalledOnce();
    expect(subject.logHistoryExactFailure).toHaveBeenCalledWith(failure, 0);
    expect(subject.loadHistoryPage).toHaveBeenCalledOnce();
  });

  it("passes one shrinking budget through history stages and stops after it expires", async () => {
    let time = 1_000;
    const authorizeHistory = vi.fn(async () => ({ context: {} }));
    const subject = runner({
      now: vi.fn(() => time),
      listHistoryCandidates: vi.fn(async () => [
        { userId: "user-1", upstreamAccountId: "owner-1" },
      ]),
      claimHistory: vi.fn(async () => ({ context: {}, cursor: null })),
      authorizeHistory,
      historyPageSize: vi.fn(async () => {
        time = 2_001;
        return 100;
      }),
      findPendingHistoryPaymentIds: vi.fn(async () => ["payment-1"]),
      logHistoryExactFailure: vi.fn(),
    });

    await expect(runPaymentMaintenance(subject, {
      paymentLimit: 1,
      deadlineMs: 1_000,
    })).resolves.toMatchObject({
      history: { attempted: 1, failed: 1 },
    });
    expect(authorizeHistory).toHaveBeenCalledWith(expect.anything(), 1_000);
    expect(subject.loadExactHistoryPayment).not.toHaveBeenCalled();
    expect(subject.loadHistoryPage).not.toHaveBeenCalled();
    expect(subject.failHistory).toHaveBeenCalledOnce();
  });

  it("defers expected stale history credentials without recording a hard failure", async () => {
    const staleCredential = Object.assign(new Error("expired"), {
      code: "UNAUTHORIZED",
    });
    const subject = runner({
      listHistoryCandidates: vi.fn(async () => [
        { userId: "user-1", upstreamAccountId: "owner-1" },
      ]),
      claimHistory: vi.fn(async () => ({ context: {}, cursor: null })),
      authorizeHistory: vi.fn(async () => { throw staleCredential; }),
      classifyHistoryError: vi.fn(() => ({ kind: "deferred" as const })),
    });

    await expect(runPaymentMaintenance(subject, {
      paymentLimit: 1,
      deadlineMs: 10_000,
    })).resolves.toMatchObject({
      history: { attempted: 1, failed: 1, deferred: 1 },
    });
    expect(subject.deferHistory).toHaveBeenCalledWith(
      expect.anything(),
      staleCredential,
    );
    expect(subject.failHistory).not.toHaveBeenCalled();
  });

  it("keeps opportunistic history degradation out of core reconciliation health", () => {
    const result = (overrides: Record<string, unknown>) => ({
      claimed: 0, succeeded: 0, inProgress: 0, unknown: 0, manualRequired: 0,
      retryReady: 0, failed: 0, manualRequiredOperationIds: [],
      history: { attempted: 0, applied: 0, completed: 0, failed: 0, deferred: 0 },
      backlog: { pending: 0, due: 0, manualRequired: 0, oldestAgeSeconds: 0, maximumAttemptCount: 0, totalFailureCount: 0 },
      ...overrides,
    }) as Awaited<ReturnType<typeof runPaymentMaintenance>>;

    expect(paymentMaintenanceBatchIsHealthy(result({}))).toBe(true);
    expect(paymentMaintenanceBatchIsHealthy(result({ claimed: 1, succeeded: 1 }))).toBe(true);
    expect(paymentMaintenanceBatchIsHealthy(result({ claimed: 1, failed: 1 }))).toBe(false);
    expect(paymentMaintenanceBatchIsHealthy(result({
      history: { attempted: 3, applied: 0, completed: 0, failed: 3, deferred: 3 },
    }))).toBe(true);
    expect(paymentMaintenanceBatchIsHealthy(result({
      history: { attempted: 1, applied: 0, completed: 0, failed: 1, deferred: 0 },
    }))).toBe(false);
    expect(paymentMaintenanceBatchIsHealthy(result({
      claimed: 1,
      failed: 1,
      history: { attempted: 1, applied: 10, completed: 1, failed: 0, deferred: 0 },
    }))).toBe(false);
    expect(paymentMaintenanceBatchIsHealthy(result({
      backlog: { pending: 1, due: 1, manualRequired: 0, oldestAgeSeconds: 1, maximumAttemptCount: 0, totalFailureCount: 0 },
      history: { attempted: 1, applied: 10, completed: 1, failed: 0, deferred: 0 },
    }))).toBe(false);
  });
});
