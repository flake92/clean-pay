ALTER TABLE "WebSession"
ADD COLUMN "refreshRotatedAt" TIMESTAMP(3);

CREATE TABLE "WebRefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "successorTokenEncrypted" TEXT NOT NULL,
    "graceExpiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebRefreshToken_tokenHash_key"
ON "WebRefreshToken"("tokenHash");

CREATE INDEX "WebRefreshToken_sessionId_consumedAt_idx"
ON "WebRefreshToken"("sessionId", "consumedAt");

CREATE INDEX "WebRefreshToken_graceExpiresAt_idx"
ON "WebRefreshToken"("graceExpiresAt");

ALTER TABLE "WebRefreshToken"
ADD CONSTRAINT "WebRefreshToken_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "WebSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
