BEGIN;

-- DDL must fail cleanly instead of waiting forever behind an abandoned
-- transaction. The statement budget still leaves ample time for the bounded
-- auth-state indexes on a maintenance deployment.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TYPE "TelegramCallbackStatus" AS ENUM (
  'READY',
  'PROVIDER_READY',
  'PROVIDER_DISPATCHING',
  'IDENTITY_VERIFIED',
  'REMNASHOP_DISPATCHING',
  'PROVIDER_AUTHENTICATED',
  'IDENTITY_RESOLVED',
  'OUTCOME_READY',
  'SESSION_CREATED',
  'RECOVERY_DISPATCHING',
  'COMPLETED',
  'FAILED'
);

ALTER TABLE "TelegramAuthState"
  ADD COLUMN "callbackStatus" "TelegramCallbackStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "callbackCodeHash" TEXT,
  ADD COLUMN "callbackClaimTokenHash" TEXT,
  ADD COLUMN "callbackLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "callbackAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "callbackResultEncrypted" TEXT,
  ADD COLUMN "callbackResultExpiresAt" TIMESTAMP(3),
  ADD COLUMN "callbackWebSessionId" TEXT,
  ADD COLUMN "callbackCompletedAt" TIMESTAMP(3),
  ADD COLUMN "callbackFailureCode" TEXT;

CREATE INDEX "TelegramAuthState_callbackStatus_callbackLeaseExpiresAt_idx"
  ON "TelegramAuthState"("callbackStatus", "callbackLeaseExpiresAt");

CREATE INDEX "TelegramAuthState_callbackResultExpiresAt_idx"
  ON "TelegramAuthState"("callbackResultExpiresAt");

CREATE INDEX "TelegramAuthState_callbackWebSessionId_idx"
  ON "TelegramAuthState"("callbackWebSessionId");

COMMIT;
