import { describe, expect, it } from "vitest";

import {
  clearedPaymentOwnerChangeFence,
  findInFlightPaymentMergeOperation,
  mergedPaymentOperationIdempotencyHash,
  normalizedPaymentMergeUserIds,
  normalizedPaymentOwnerChangeSelectors,
  normalizedPaymentSourceUserIds,
  paymentOwnerLocalFinalizeCommitted,
} from "@/backend/integrations/payments/payment-user-merge-transitions";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";

describe("payment user merge pure transitions", () => {
  it("normalizes every owner selector without changing its ordering policy", () => {
    expect(normalizedPaymentOwnerChangeSelectors({
      userIds: ["user-b", "", "user-a", "user-b"],
      upstreamAccountIds: ["owner-b", "", "owner-a", "owner-b"],
      emails: [" User@Example.COM ", null, "", "user@example.com"],
      telegramIds: [123, null, "456", undefined, 123],
    })).toEqual({
      normalizedUpstreamIds: ["owner-b", "owner-a"],
      normalizedEmails: ["user@example.com"],
      normalizedTelegramIds: ["123", "456"],
      explicitUserIds: ["user-a", "user-b"],
    });
  });

  it("sorts locked merge users while preserving source insertion order", () => {
    const sourceUserIds = ["source-b", "target", "source-a", "source-b"];

    expect(normalizedPaymentMergeUserIds("target", sourceUserIds)).toEqual([
      "source-a",
      "source-b",
      "target",
    ]);
    expect(normalizedPaymentSourceUserIds("target", sourceUserIds)).toEqual([
      "source-b",
      "source-a",
    ]);
  });

  it("clears exactly the complete owner-change fence state", () => {
    expect(clearedPaymentOwnerChangeFence()).toEqual({
      paymentOwnerChangeTokenHash: null,
      paymentOwnerChangeLeaseExpiresAt: null,
      paymentOwnerChangeStartedAt: null,
      paymentOwnerChangeMutationStartedAt: null,
      paymentOwnerChangeLocalFinalizedAt: null,
      paymentOwnerChangeOperationHash: null,
      paymentOwnerChangeExpectedOwnerHash: null,
    });
  });

  it("recognizes only a fully committed local owner finalization", () => {
    const remnashopUserId = "target-owner";
    const committed = {
      remnashopUserId,
      paymentOwnerChangeMutationStartedAt: new Date("2026-08-27T00:00:00.000Z"),
      paymentOwnerChangeLocalFinalizedAt: new Date("2026-08-27T00:00:01.000Z"),
      paymentOwnerChangeExpectedOwnerHash: paymentUpstreamOwnerHash(remnashopUserId),
    };

    expect(paymentOwnerLocalFinalizeCommitted(committed)).toBe(true);
    expect(paymentOwnerLocalFinalizeCommitted({
      ...committed,
      paymentOwnerChangeMutationStartedAt: null,
    })).toBe(false);
    expect(paymentOwnerLocalFinalizeCommitted({
      ...committed,
      paymentOwnerChangeLocalFinalizedAt: null,
    })).toBe(false);
    expect(paymentOwnerLocalFinalizeCommitted({
      ...committed,
      paymentOwnerChangeExpectedOwnerHash: "different-owner-hash",
    })).toBe(false);
  });

  it("finds only dispatching or unexpired ready operations", () => {
    const now = new Date("2026-08-27T00:00:00.000Z");
    const operation = {
      id: "operation-1",
      userId: "user-1",
      idempotencyKeyHash: "idempotency-hash",
      upstreamKey: "upstream-key",
      leaseExpiresAt: null,
    };

    expect(findInFlightPaymentMergeOperation([
      { ...operation, status: "READY", leaseExpiresAt: now },
      {
        ...operation,
        id: "operation-2",
        status: "READY",
        leaseExpiresAt: new Date(now.getTime() + 1),
      },
    ], now)?.id).toBe("operation-2");
    expect(findInFlightPaymentMergeOperation([
      { ...operation, status: "DISPATCHING" },
    ], now)?.id).toBe("operation-1");
    expect(findInFlightPaymentMergeOperation([
      { ...operation, status: "READY", leaseExpiresAt: now },
      { ...operation, status: "FAILED" },
    ], now)).toBeUndefined();
  });

  it("keeps collision rekeying deterministic and byte-stable", () => {
    expect(mergedPaymentOperationIdempotencyHash({
      id: "operation-1",
      upstreamKey: "upstream-key",
    }, 2)).toBe("z4gMBQ7ib5_SaiY3nJOBRZa4Dund5kBef1aYgJil4Ys");
  });
});
