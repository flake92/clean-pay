import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sessionMigration = readFileSync(
  "prisma/migrations/20260619153000_add_auth_cache_models/migration.sql",
  "utf8",
);
const telegramMigration = readFileSync(
  "prisma/migrations/20260619154500_add_telegram_oidc/migration.sql",
  "utf8",
);
const telegramTextMigration = readFileSync(
  "prisma/migrations/20260623214000_store_telegram_id_as_text/migration.sql",
  "utf8",
);

describe("production migration safety", () => {
  it("backfills replacement WebSession expiries before enforcing NOT NULL", () => {
    const addColumns = sessionMigration.indexOf(
      'ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),',
    );
    const backfill = sessionMigration.indexOf('UPDATE "WebSession"');
    const enforceNotNull = sessionMigration.indexOf(
      'ALTER COLUMN "accessTokenExpiresAt" SET NOT NULL',
    );
    const dropLegacy = sessionMigration.indexOf(
      'ALTER TABLE "WebSession" DROP COLUMN "expiresAt"',
    );

    expect(addColumns).toBeGreaterThan(0);
    expect(backfill).toBeGreaterThan(addColumns);
    expect(enforceNotNull).toBeGreaterThan(backfill);
    expect(dropLegacy).toBeGreaterThan(enforceNotNull);
    expect(sessionMigration).toContain(
      'SET "accessTokenExpiresAt" = "expiresAt",',
    );
    expect(sessionMigration).toContain(
      '"refreshExpiresAt" = "expiresAt"',
    );
  });

  it("serializes legacy writers and makes the WebSession rewrite atomic", () => {
    expect(sessionMigration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sessionMigration).toContain(
      'LOCK TABLE "WebSession" IN ACCESS EXCLUSIVE MODE;',
    );
    expect(sessionMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("converts Telegram IDs in place and fails closed on malformed legacy data", () => {
    expect(telegramMigration).not.toContain('DROP COLUMN "telegramId"');
    expect(telegramMigration).not.toContain(
      'ADD COLUMN     "telegramId" BIGINT',
    );
    expect(telegramMigration).toContain(
      'ALTER COLUMN "telegramId" TYPE BIGINT USING "telegramId"::bigint',
    );
    expect(telegramMigration).toContain(
      "Telegram ID migration blocked: % malformed or out-of-range rows",
    );
    expect(telegramMigration).toContain(
      'LOCK TABLE "WebUser" IN ACCESS EXCLUSIVE MODE;',
    );
    expect(telegramMigration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(telegramMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(telegramTextMigration).toContain(
      'TYPE TEXT USING "telegramId"::text',
    );
  });
});
