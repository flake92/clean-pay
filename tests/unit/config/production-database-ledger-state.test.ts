import { describe, expect, it } from "vitest";

import { inspectReviewedLedgerRows } from "../../../deploy/prod/database-role-provision.mjs";

const checksum = "a".repeat(64);
const migrationPlan = [{ checksum, name: "20260826000000_reviewed" }];
const observedAt = "2026-08-26T10:00:00.000000Z";

function success(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    checksum,
    migration_name: migrationPlan[0]!.name,
    logs: null,
    started_at: "2026-08-26T09:59:59.000100Z",
    finished_at: "2026-08-26T09:59:59.000900Z",
    rolled_back_at: null,
    observed_at: observedAt,
    applied_steps_count: 1,
    ...overrides,
  };
}

function unresolved(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    checksum,
    migration_name: migrationPlan[0]!.name,
    logs: "reviewed zero-step failure",
    started_at: "2026-08-26T09:59:59.999999Z",
    finished_at: null,
    rolled_back_at: null,
    observed_at: observedAt,
    applied_steps_count: 0,
    ...overrides,
  };
}

describe("exact reviewed Prisma ledger chronology", () => {
  it("uses six-microsecond UTC values instead of millisecond-truncated Date objects", () => {
    expect(() => inspectReviewedLedgerRows([
      success({
        started_at: "2026-08-26T09:59:59.000900Z",
        finished_at: "2026-08-26T09:59:59.000100Z",
      }),
    ], migrationPlan)).toThrow("invalid success");
  });

  it("rejects an unresolved attempt whose start time is in the future", () => {
    expect(() => inspectReviewedLedgerRows([
      unresolved({ started_at: "2026-08-26T10:00:00.000001Z" }),
    ], migrationPlan, {
      unresolvedMigration: migrationPlan[0]!.name,
    })).toThrow("out-of-order or unreviewed row");
  });

  it("accepts the exact current migration as the only final unresolved row", () => {
    const state = inspectReviewedLedgerRows([unresolved()], migrationPlan, {
      unresolvedMigration: migrationPlan[0]!.name,
    });
    expect(state.nextMigrationIndex).toBe(0);
    expect(state.unresolved?.id).toBe("22222222-2222-4222-8222-222222222222");
  });
});
