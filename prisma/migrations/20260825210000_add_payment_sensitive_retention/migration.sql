BEGIN;

-- The backfill and candidate indexes form one schema contract. Bound lock
-- acquisition so a forgotten writer cannot hang the maintenance deployment;
-- permit a longer statement budget for populated payment tables.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Preserve the financial ledger while making sensitive provider material
-- eligible for status-aware scrubbing. A non-null retentionHoldAt is an
-- explicit legal/investigation hold and prevents automated scrubbing.
ALTER TABLE "PaymentRecord"
  ADD COLUMN "retentionHoldAt" TIMESTAMP(3),
  ADD COLUMN "terminalObservedAt" TIMESTAMP(3),
  ADD COLUMN "sensitiveDataScrubbedAt" TIMESTAMP(3);

-- Existing terminal rows start their local retention clock from the best
-- available local observation time. Later provider syncs never advance it.
UPDATE "PaymentRecord"
SET "terminalObservedAt" = "updatedAt"
WHERE "status" IN ('COMPLETED', 'FAILED', 'CANCELED', 'REFUNDED')
  AND "terminalObservedAt" IS NULL;

ALTER TABLE "PaymentOperation"
  ADD COLUMN "retentionHoldAt" TIMESTAMP(3),
  ADD COLUMN "snapshotScrubbedAt" TIMESTAMP(3);

CREATE INDEX "PaymentRecord_retention_scrub_candidates_idx"
  ON "PaymentRecord"("status", "sensitiveDataScrubbedAt", "terminalObservedAt", "id");
CREATE INDEX "PaymentRecord_retentionHoldAt_idx"
  ON "PaymentRecord"("retentionHoldAt");
CREATE INDEX "PaymentOperation_status_snapshotScrubbedAt_completedAt_idx"
  ON "PaymentOperation"("status", "snapshotScrubbedAt", "completedAt", "id");
CREATE INDEX "PaymentOperation_retentionHoldAt_idx"
  ON "PaymentOperation"("retentionHoldAt");

-- Generic retention scans filter only by age, while the enforcement path uses
-- the existing key/action/time index. Keep both access patterns bounded.
CREATE INDEX "RateLimitEvent_occurredAt_idx"
  ON "RateLimitEvent"("occurredAt");

COMMIT;
