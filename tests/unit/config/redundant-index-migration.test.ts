import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260718141000_drop_redundant_indexes/migration.sql",
  "utf8",
);
const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("redundant index cleanup migration", () => {
  it.each([
    "WebUser_email_idx",
    "WebUser_telegramId_idx",
    "PaymentRecord_paymentId_idx",
  ])("drops %s retry-safely", (indexName) => {
    expect(migration).toContain(`DROP INDEX IF EXISTS "${indexName}"`);
  });

  it("fails fast instead of waiting indefinitely for a table lock", () => {
    expect(migration).toContain("SET lock_timeout = '5s'");
    expect(migration).not.toContain("CONCURRENTLY");
  });

  it("keeps unique fields without recreating non-unique copies", () => {
    expect(schema).toMatch(/^\s*email\s+String\?\s+@unique\s*$/m);
    expect(schema).toMatch(/^\s*telegramId\s+String\?\s+@unique\s*$/m);
    expect(schema).toMatch(/^\s*paymentId\s+String\s+@unique\s*$/m);
    expect(schema).not.toContain("@@index([email])");
    expect(schema).not.toContain("@@index([telegramId])");
    expect(schema).not.toContain("@@index([paymentId])");
  });
});
