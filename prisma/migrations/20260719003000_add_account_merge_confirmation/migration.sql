CREATE TYPE "AccountMergeConfirmationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "AccountMergeConfirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "sourceEmail" TEXT,
    "targetEmail" TEXT NOT NULL,
    "sourceRemnashopUserId" TEXT NOT NULL,
    "targetRemnashopUserId" TEXT NOT NULL,
    "status" "AccountMergeConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountMergeConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountMergeConfirmation_tokenHash_key" ON "AccountMergeConfirmation"("tokenHash");
CREATE INDEX "AccountMergeConfirmation_userId_status_idx" ON "AccountMergeConfirmation"("userId", "status");
CREATE INDEX "AccountMergeConfirmation_expiresAt_idx" ON "AccountMergeConfirmation"("expiresAt");
CREATE INDEX "AccountMergeConfirmation_status_leaseExpiresAt_idx" ON "AccountMergeConfirmation"("status", "leaseExpiresAt");

ALTER TABLE "AccountMergeConfirmation"
ADD CONSTRAINT "AccountMergeConfirmation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "WebUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
