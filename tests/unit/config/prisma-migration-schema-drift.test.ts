import { describe, expect, it, vi } from "vitest";

import {
  assertPrismaMigrationSchemaDiff,
  verifyPrismaMigrationSchemaDrift,
} from "../../../scripts/security/verify-prisma-migration-schema-drift.mjs";

const expectedDiff = [
  "-- DropTable",
  "DROP TABLE \"_clean_pay_retention_policy\";",
  "",
].join("\n");

describe("Prisma migration/schema drift verifier", () => {
  it("allows only the exact intentionally unmanaged retention-policy table", () => {
    expect(assertPrismaMigrationSchemaDiff(expectedDiff)).toEqual({
      status: "prisma_migration_schema_drift_verified",
      unmanagedTables: ["_clean_pay_retention_policy"],
    });
    for (const nearMiss of [
      "",
      "-- This is an empty migration.",
      expectedDiff.replace("_clean_pay_retention_policy", "PaymentRecord"),
      `${expectedDiff}-- AddColumn\nALTER TABLE \"PaymentRecord\" ADD COLUMN \"drift\" TEXT;\n`,
    ]) {
      expect(() => assertPrismaMigrationSchemaDiff(nearMiss)).toThrow(
        "escaped the exact unmanaged-table allowlist",
      );
    }
  });

  it("uses the repository-local Prisma binary and never exposes command stderr", () => {
    const run = vi.fn(() => ({
      error: undefined,
      signal: null,
      status: 0,
      stderr: "",
      stdout: expectedDiff,
    }));
    expect(verifyPrismaMigrationSchemaDrift({
      environment: { DATABASE_URL: "postgresql://synthetic.invalid/clean_pay" },
      run,
    })).toMatchObject({ status: "prisma_migration_schema_drift_verified" });
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        expect.stringMatching(/node_modules[\\/]prisma[\\/]build[\\/]index\.js$/u),
        "migrate",
        "diff",
        "--script",
      ]),
      expect.objectContaining({
        encoding: "utf8",
        maxBuffer: 256 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );

    const failure = "sensitive command failure";
    expect(() => verifyPrismaMigrationSchemaDrift({
      environment: { DATABASE_URL: "postgresql://synthetic.invalid/clean_pay" },
      run: () => ({
        error: undefined,
        signal: null,
        status: 1,
        stderr: failure,
        stdout: "",
      }),
    })).toThrow(/stderrBytes=25,stderrSha256=[a-f0-9]{64}/u);
    try {
      verifyPrismaMigrationSchemaDrift({
        environment: { DATABASE_URL: "postgresql://synthetic.invalid/clean_pay" },
        run: () => ({
          error: undefined,
          signal: null,
          status: 1,
          stderr: failure,
          stdout: "",
        }),
      });
    } catch (error) {
      expect(String(error)).not.toContain(failure);
    }
  });
});
