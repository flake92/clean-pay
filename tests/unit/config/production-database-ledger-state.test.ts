import { describe, expect, it } from "vitest";

import { inspectReviewedLedgerRows } from "../../../deploy/prod/database-role-provision.mjs";

const checksum = "a".repeat(64);
const migrationPlan = [{ checksum, name: "20260826000000_reviewed" }];
const observedAt = "2026-08-26T10:00:00.000000Z";
const deployedProductionChecksums = [
  [
    "20260619145932_init",
    "1c95123450bb01cc241328005c23ad5f7ede1342b7193822010829f3c2414293",
  ],
  [
    "20260619153000_add_auth_cache_models",
    "51bd33df188c6434ab7d57f0de9b050fe2da22424b6b3180b350af85d0b40625",
  ],
  [
    "20260619154500_add_telegram_oidc",
    "63e11f0d035511b1fb738f8ceba4615df364c4c525105b20b62405afb539d599",
  ],
  [
    "20260619161000_add_remnashop_session_tokens",
    "7b95bddb17aaf5215f69fc36a97432071fe537d553e766676fb22cf33c2686ca",
  ],
  [
    "20260619202616_add_payment_records",
    "d481337a411e7fab09d7d701bfcc19fd06c29442c11d317674f87cea6344db35",
  ],
  [
    "20260623214000_store_telegram_id_as_text",
    "c85148348e1c6bdd089a9139b83eb7d96343cdec6925aa12fa7d8a43d2300a99",
  ],
  [
    "20260623222500_add_web_session_auth_method",
    "6fd854f94d97de82dd7448485ccb9c281a8ba1a4df34aa75a03b48d3c22e1b8d",
  ],
  [
    "20260719003000_add_account_merge_confirmation",
    "b6a7ed53e3c95d0e0ca4e03ecb43ab1f06c3a7fd5eb0fa1443144afa624af2be",
  ],
] as const;

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
  it.each(deployedProductionChecksums)(
    "accepts the exact deployed checksum for %s",
    (name, deployedChecksum) => {
      const reviewedPlan = [{ checksum: "f".repeat(64), name }];
      const state = inspectReviewedLedgerRows([
        success({
          checksum: deployedChecksum,
          migration_name: name,
        }),
      ], reviewedPlan);

      expect(state.nextMigrationIndex).toBe(1);
      expect(state.lastSuccess).toBe(name);
    },
  );

  it("rejects an unknown checksum even for a migration with a deployed alternate", () => {
    const name = deployedProductionChecksums[0][0];
    expect(() => inspectReviewedLedgerRows([
      success({
        checksum: "e".repeat(64),
        migration_name: name,
      }),
    ], [{ checksum: "f".repeat(64), name }])).toThrow(
      "out-of-order or unreviewed row",
    );
  });

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
