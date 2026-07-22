ALTER TABLE "WebUser"
ADD COLUMN "pendingRemnashopUserId" TEXT,
ADD COLUMN "pendingRemnashopEmail" TEXT;

CREATE INDEX "WebUser_pendingRemnashopUserId_idx"
ON "WebUser"("pendingRemnashopUserId");
