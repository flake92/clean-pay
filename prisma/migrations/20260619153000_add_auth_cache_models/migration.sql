BEGIN;

-- Keep legacy writers from inserting a row between the backfill and SET NOT NULL.
LOCK TABLE "WebSession" IN ACCESS EXCLUSIVE MODE;

-- Add the replacement fields as nullable first so this migration works on a
-- non-empty production table. The legacy expiry represented the only session
-- lifetime available, so copying it to both fields preserves existing sessions.
ALTER TABLE "WebSession"
ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshExpiresAt" TIMESTAMP(3);

UPDATE "WebSession"
SET "accessTokenExpiresAt" = "expiresAt",
    "refreshExpiresAt" = "expiresAt";

ALTER TABLE "WebSession"
ALTER COLUMN "accessTokenExpiresAt" SET NOT NULL,
ALTER COLUMN "refreshExpiresAt" SET NOT NULL;

-- Remove the legacy field only after every row has a durable replacement.
DROP INDEX "WebSession_expiresAt_idx";
ALTER TABLE "WebSession" DROP COLUMN "expiresAt";

-- AlterTable
ALTER TABLE "WebUser" ADD COLUMN     "telegramId" TEXT;

-- CreateTable
CREATE TABLE "EmailVerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailVerificationCode_userId_idx" ON "EmailVerificationCode"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_expiresAt_idx" ON "EmailVerificationCode"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_sentAt_idx" ON "EmailVerificationCode"("sentAt");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_consumedAt_idx" ON "EmailVerificationCode"("consumedAt");

-- CreateIndex
CREATE INDEX "WebSession_accessTokenExpiresAt_idx" ON "WebSession"("accessTokenExpiresAt");

-- CreateIndex
CREATE INDEX "WebSession_refreshExpiresAt_idx" ON "WebSession"("refreshExpiresAt");

-- CreateIndex
CREATE INDEX "WebSession_revokedAt_idx" ON "WebSession"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebUser_telegramId_key" ON "WebUser"("telegramId");

-- CreateIndex
CREATE INDEX "WebUser_telegramId_idx" ON "WebUser"("telegramId");

-- AddForeignKey
ALTER TABLE "EmailVerificationCode" ADD CONSTRAINT "EmailVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WebUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

