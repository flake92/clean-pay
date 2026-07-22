import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260718000000_add_payment_reconciliation/migration.sql",
  "utf8",
);

describe("payment recovery rolling migration", () => {
  it("keeps inserts from the previous Prisma client valid during rollout", () => {
    expect(schema).toMatch(
      /upstreamCreatedAt\s+DateTime\s+@default\(now\(\)\)/,
    );
    expect(schema).toMatch(
      /upstreamUpdatedAt\s+DateTime\s+@default\(now\(\)\)/,
    );
    expect(migration).toContain(
      'ADD COLUMN "upstreamCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(migration).toContain(
      'ADD COLUMN "upstreamUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
  });

  it("lets derived history state disappear with its owning user", () => {
    expect(schema).toMatch(
      /PaymentHistorySyncState[\s\S]*onDelete: Cascade/,
    );
    expect(migration).toContain("ON DELETE CASCADE ON UPDATE CASCADE");
  });
});
