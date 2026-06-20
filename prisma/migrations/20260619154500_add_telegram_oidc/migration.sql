-- AlterTable
ALTER TABLE "WebUser" ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "telegramUsername" TEXT,
ALTER COLUMN "remnashopUserId" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
DROP COLUMN "telegramId",
ADD COLUMN     "telegramId" BIGINT;

-- CreateTable
CREATE TABLE "TelegramAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "codeVerifierHash" TEXT NOT NULL,
    "redirectTo" TEXT,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAuthState_stateHash_key" ON "TelegramAuthState"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAuthState_nonceHash_key" ON "TelegramAuthState"("nonceHash");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAuthState_codeVerifierHash_key" ON "TelegramAuthState"("codeVerifierHash");

-- CreateIndex
CREATE INDEX "TelegramAuthState_expiresAt_idx" ON "TelegramAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "TelegramAuthState_consumedAt_idx" ON "TelegramAuthState"("consumedAt");

-- CreateIndex
CREATE INDEX "TelegramAuthState_userId_idx" ON "TelegramAuthState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WebUser_telegramId_key" ON "WebUser"("telegramId");

-- CreateIndex
CREATE INDEX "WebUser_telegramId_idx" ON "WebUser"("telegramId");

-- AddForeignKey
ALTER TABLE "TelegramAuthState" ADD CONSTRAINT "TelegramAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WebUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

