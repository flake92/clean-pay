-- CreateEnum
CREATE TYPE "WebSessionAssuranceLevel" AS ENUM ('BOOTSTRAP', 'FULL');

-- CreateEnum
CREATE TYPE "WebAuthnChallengeType" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

-- AlterEnum
ALTER TYPE "WebSessionAuthMethod" ADD VALUE 'PASSKEY';

-- AlterTable
ALTER TABLE "WebSession" ADD COLUMN     "assuranceLevel" "WebSessionAssuranceLevel" NOT NULL DEFAULT 'FULL';

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "aaguid" TEXT,
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "type" "WebAuthnChallengeType" NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_lastUsedAt_idx" ON "WebAuthnCredential"("lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_userId_idx" ON "WebAuthnChallenge"("userId");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_type_idx" ON "WebAuthnChallenge"("type");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_consumedAt_idx" ON "WebAuthnChallenge"("consumedAt");

-- CreateIndex
CREATE INDEX "WebSession_assuranceLevel_idx" ON "WebSession"("assuranceLevel");

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WebUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WebUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
