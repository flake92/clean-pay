-- AlterTable
ALTER TABLE "WebSession" ADD COLUMN     "remnashopAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN     "remnashopAccessTokenEncrypted" TEXT,
ADD COLUMN     "remnashopRefreshExpiresAt" TIMESTAMP(3),
ADD COLUMN     "remnashopRefreshTokenEncrypted" TEXT;

-- CreateIndex
CREATE INDEX "WebSession_remnashopAccessExpiresAt_idx" ON "WebSession"("remnashopAccessExpiresAt");

-- CreateIndex
CREATE INDEX "WebSession_remnashopRefreshExpiresAt_idx" ON "WebSession"("remnashopRefreshExpiresAt");

