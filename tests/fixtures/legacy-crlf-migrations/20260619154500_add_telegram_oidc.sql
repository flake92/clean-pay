BEGIN;

-- The previous schema stored Telegram IDs as text. Fail closed on malformed
-- legacy values instead of dropping the column (and therefore user identity).
LOCK TABLE "WebUser" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    invalid_telegram_id_count BIGINT;
BEGIN
    SELECT COUNT(*)
      INTO invalid_telegram_id_count
      FROM "WebUser"
     WHERE "telegramId" IS NOT NULL
       AND CASE
             WHEN "telegramId" ~ '^[1-9][0-9]{0,18}$'
             THEN "telegramId"::numeric > 9223372036854775807
             ELSE TRUE
           END;

    IF invalid_telegram_id_count > 0 THEN
        RAISE EXCEPTION
            'Telegram ID migration blocked: % malformed or out-of-range rows',
            invalid_telegram_id_count;
    END IF;
END
$$;

-- PostgreSQL cannot reuse the existing text indexes after the in-place type
-- conversion. Recreate the same constraints below inside this transaction.
DROP INDEX "WebUser_telegramId_key";
DROP INDEX "WebUser_telegramId_idx";

-- AlterTable
ALTER TABLE "WebUser" ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "telegramUsername" TEXT,
ALTER COLUMN "remnashopUserId" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "telegramId" TYPE BIGINT USING "telegramId"::bigint;

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

COMMIT;

