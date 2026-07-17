-- CreateEnum
CREATE TYPE "PaymentOperationKind" AS ENUM ('PURCHASE', 'EXTEND');

-- CreateEnum
CREATE TYPE "PaymentOperationStatus" AS ENUM ('READY', 'DISPATCHING', 'OUTCOME_UNKNOWN', 'SUCCEEDED', 'FAILED_FINAL');

-- AlterTable
ALTER TABLE "PaymentRecord" ADD COLUMN "operationId" TEXT;

-- CreateTable
CREATE TABLE "PaymentOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PaymentOperationKind" NOT NULL,
    "idempotencyKeyHash" TEXT NOT NULL,
    "upstreamOwnerHash" TEXT,
    "requestFingerprint" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "upstreamKey" TEXT NOT NULL,
    "status" "PaymentOperationStatus" NOT NULL DEFAULT 'READY',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "claimTokenHash" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "outcomeUnknownAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseSnapshot" JSONB,
    "errorSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOperation_upstreamKey_key" ON "PaymentOperation"("upstreamKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOperation_userId_idempotencyKeyHash_key" ON "PaymentOperation"("userId", "idempotencyKeyHash");

-- CreateIndex
CREATE INDEX "PaymentOperation_status_leaseExpiresAt_idx" ON "PaymentOperation"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "PaymentOperation_userId_createdAt_idx" ON "PaymentOperation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_operationId_key" ON "PaymentRecord"("operationId");

-- AddForeignKey
ALTER TABLE "PaymentOperation" ADD CONSTRAINT "PaymentOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WebUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "PaymentOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
