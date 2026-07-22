-- Persist upstream chronology independently from local ingestion time.
ALTER TABLE "PaymentRecord"
    ADD COLUMN "upstreamCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "upstreamUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

UPDATE "PaymentRecord"
SET "upstreamCreatedAt" = "createdAt",
    "upstreamUpdatedAt" = "updatedAt";

-- Reconciliation uses an independent fenced lease. It must never reuse the
-- foreground execution claim because a late request and a background worker
-- may be alive at the same time.
ALTER TABLE "PaymentOperation"
    ADD COLUMN "reconcileAttemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "reconcileFailureCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "reconcileClaimTokenHash" TEXT,
    ADD COLUMN "reconcileLeaseExpiresAt" TIMESTAMP(3),
    ADD COLUMN "reconcileNextAttemptAt" TIMESTAMP(3),
    ADD COLUMN "reconcileLastAttemptAt" TIMESTAMP(3),
    ADD COLUMN "reconcileErrorSnapshot" JSONB,
    ADD COLUMN "reconciledAt" TIMESTAMP(3);

UPDATE "PaymentOperation"
SET "reconcileNextAttemptAt" = CURRENT_TIMESTAMP
WHERE "status" = 'OUTCOME_UNKNOWN'
  AND "reconcileNextAttemptAt" IS NULL;

CREATE TABLE "PaymentHistorySyncState" (
    "userId" TEXT NOT NULL,
    "upstreamOwnerHash" TEXT NOT NULL,
    "cursor" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "claimTokenHash" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "backfillCompletedAt" TIMESTAMP(3),
    "errorSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentHistorySyncState_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "PaymentRecord_userId_upstreamCreatedAt_paymentId_idx"
    ON "PaymentRecord"("userId", "upstreamCreatedAt", "paymentId");

CREATE INDEX "PaymentOperation_status_reconcileNextAttemptAt_reconcileLeaseExpiresAt_idx"
    ON "PaymentOperation"("status", "reconcileNextAttemptAt", "reconcileLeaseExpiresAt");

CREATE INDEX "PaymentHistorySyncState_nextAttemptAt_leaseExpiresAt_idx"
    ON "PaymentHistorySyncState"("nextAttemptAt", "leaseExpiresAt");

ALTER TABLE "PaymentHistorySyncState"
    ADD CONSTRAINT "PaymentHistorySyncState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "WebUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentOperation"
    ADD CONSTRAINT "PaymentOperation_reconcile_claim_lease_pair_check"
    CHECK (("reconcileClaimTokenHash" IS NULL) = ("reconcileLeaseExpiresAt" IS NULL)),
    ADD CONSTRAINT "PaymentOperation_reconcile_counters_nonnegative_check"
    CHECK ("reconcileAttemptCount" >= 0 AND "reconcileFailureCount" >= 0);

ALTER TABLE "PaymentHistorySyncState"
    ADD CONSTRAINT "PaymentHistorySyncState_claim_lease_pair_check"
    CHECK (("claimTokenHash" IS NULL) = ("leaseExpiresAt" IS NULL)),
    ADD CONSTRAINT "PaymentHistorySyncState_counters_nonnegative_check"
    CHECK ("generation" >= 0 AND "attemptCount" >= 0 AND "failureCount" >= 0);
