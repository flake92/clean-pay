-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELED', 'REFUNDED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "purchaseType" TEXT NOT NULL,
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'PENDING',
    "finalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "gatewayType" TEXT NOT NULL,
    "planCode" TEXT,
    "planName" TEXT,
    "durationDays" INTEGER,
    "deviceLimit" INTEGER,
    "trafficLimit" INTEGER,
    "paymentUrl" TEXT,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_paymentId_key" ON "PaymentRecord"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentRecord_userId_createdAt_idx" ON "PaymentRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRecord_paymentId_idx" ON "PaymentRecord"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentRecord_status_idx" ON "PaymentRecord"("status");

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WebUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
