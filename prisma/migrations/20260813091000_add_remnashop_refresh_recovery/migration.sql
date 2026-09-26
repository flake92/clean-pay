ALTER TABLE "WebSession"
ADD COLUMN "remnashopRefreshClaimTokenHash" TEXT,
ADD COLUMN "remnashopRefreshLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "remnashopRefreshDispatchedAt" TIMESTAMP(3),
ADD COLUMN "remnashopRefreshRecoveryEncrypted" TEXT,
ADD COLUMN "remnashopRefreshAttemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "WebSession_remnashopRefreshLeaseExpiresAt_idx"
ON "WebSession"("remnashopRefreshLeaseExpiresAt");
