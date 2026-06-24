CREATE TYPE "WebSessionAuthMethod" AS ENUM ('EMAIL', 'TELEGRAM');

ALTER TABLE "WebSession"
ADD COLUMN "authMethod" "WebSessionAuthMethod" NOT NULL DEFAULT 'EMAIL';
