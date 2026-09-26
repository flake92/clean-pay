-- Keep payment ownership stable while upstream account changes run outside
-- database transactions. A non-null token is a fail-closed payment barrier;
-- only a fenced owner-change attempt may replace an expired lease.
ALTER TABLE "WebUser"
ADD COLUMN "paymentOwnerChangeTokenHash" TEXT,
ADD COLUMN "paymentOwnerChangeLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "paymentOwnerChangeStartedAt" TIMESTAMP(3),
ADD COLUMN "paymentOwnerChangeMutationStartedAt" TIMESTAMP(3),
ADD COLUMN "paymentOwnerChangeLocalFinalizedAt" TIMESTAMP(3),
ADD COLUMN "paymentOwnerChangeOperationHash" TEXT,
ADD COLUMN "paymentOwnerChangeExpectedOwnerHash" TEXT,
ADD COLUMN "paymentOwnerChangeAttemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "WebUser_paymentOwnerChangeTokenHash_idx"
ON "WebUser"("paymentOwnerChangeTokenHash");

CREATE INDEX "WebUser_paymentOwnerChangeLeaseExpiresAt_idx"
ON "WebUser"("paymentOwnerChangeLeaseExpiresAt");

CREATE INDEX "WebUser_paymentOwnerChangeOperationHash_idx"
ON "WebUser"("paymentOwnerChangeOperationHash");
