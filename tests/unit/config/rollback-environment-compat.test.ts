import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_ROLLBACK_COMPATIBILITY,
  projectRollbackCompatibilityEnvironment,
  writeCreateOnlyPrivateFile,
} from "../../../deploy/prod/rollback-env-compat.mjs";

const productionBaseline = "0ede176ad863c7a721a9fbbf43f583e838516d4b";

describe("rollback environment compatibility", () => {
  it("removes only the three additive settings unknown to the production baseline", () => {
    expect(PRODUCTION_ROLLBACK_COMPATIBILITY).toEqual({
      [productionBaseline]: [
        "CLEAN_PAY_CONFIG_VERSION",
        "CLEAN_PAY_UPGRADE_SOURCE_VERSION",
        "PAYMENT_DATA_RETENTION_ENABLED",
      ],
    });
    const input = [
      "# preserved comment",
      "APP_URL=https://pay.clean-pay.dev",
      "CLEAN_PAY_CONFIG_VERSION=0.2.0",
      "CLEAN_PAY_UPGRADE_SOURCE_VERSION=0.1.1",
      "PAYMENT_DATA_RETENTION_ENABLED=false",
      "NEXT_PUBLIC_APP_URL=https://pay.clean-pay.dev",
      "",
    ].join("\n");

    expect(projectRollbackCompatibilityEnvironment(input, productionBaseline)).toBe([
      "# preserved comment",
      "APP_URL=https://pay.clean-pay.dev",
      "NEXT_PUBLIC_APP_URL=https://pay.clean-pay.dev",
      "",
    ].join("\n"));
  });

  it("fails closed for an unreviewed revision or a missing required boundary", () => {
    expect(() => projectRollbackCompatibilityEnvironment(
      "PAYMENT_DATA_RETENTION_ENABLED=true\n",
      "a".repeat(40),
    )).toThrow("does not have a reviewed environment projection");
    expect(() => projectRollbackCompatibilityEnvironment(
      "CLEAN_PAY_CONFIG_VERSION=0.2.0\n",
      productionBaseline,
    )).toThrow("missing the required payment-retention compatibility boundary");
  });

  it("removes a partially created secret output after a write failure", () => {
    let exists = false;
    let closed = false;
    let removed = false;
    const writeFailure = new Error("synthetic write failure");

    expect(() => writeCreateOnlyPrivateFile(
      "/private/rollback.env",
      "SECRET=value\n",
      {
        openSync: () => {
          exists = true;
          return 42;
        },
        writeFileSync: () => {
          throw writeFailure;
        },
        fsyncSync: () => undefined,
        closeSync: () => {
          closed = true;
        },
        unlinkSync: () => {
          exists = false;
          removed = true;
        },
      },
    )).toThrow(writeFailure);
    expect(closed).toBe(true);
    expect(removed).toBe(true);
    expect(exists).toBe(false);
  });

  it("reports a partial-secret cleanup failure without deleting a pre-existing output", () => {
    const existingOperations = {
      openSync: () => {
        throw Object.assign(new Error("already exists"), { code: "EEXIST" });
      },
      writeFileSync: () => undefined,
      fsyncSync: () => undefined,
      closeSync: () => undefined,
      unlinkSync: () => {
        throw new Error("must not unlink a pre-existing output");
      },
    };
    expect(() => writeCreateOnlyPrivateFile(
      "/private/existing.env",
      "SECRET=value\n",
      existingOperations,
    )).toThrow("already exists");

    expect(() => writeCreateOnlyPrivateFile(
      "/private/partial.env",
      "SECRET=value\n",
      {
        ...existingOperations,
        openSync: () => 42,
        writeFileSync: () => {
          throw new Error("synthetic fs failure");
        },
        unlinkSync: () => {
          throw Object.assign(new Error("synthetic cleanup failure"), { code: "EACCES" });
        },
      },
    )).toThrow("partial output could not be removed");
  });

  it("materializes a create-only private projection from a fully valid current env", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-rollback-compat-"));
    const input = path.join(directory, "current.env");
    const output = path.join(directory, "rollback.env");
    chmodSync(directory, 0o700);

    try {
      const fixture = spawnSync(
        process.execPath,
        ["tests/fixtures/write-synthetic-production-env.mjs", input],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(fixture.status, fixture.stderr).toBe(0);

      const materialize = () => spawnSync(
        process.execPath,
        [
          "deploy/prod/rollback-env-compat.mjs",
          "materialize",
          productionBaseline,
          input,
          output,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const result = materialize();
      expect(result.status, result.stderr).toBe(0);
      const projected = readFileSync(output, "utf8");
      expect(projected).not.toMatch(/^CLEAN_PAY_CONFIG_VERSION=/m);
      expect(projected).not.toMatch(/^CLEAN_PAY_UPGRADE_SOURCE_VERSION=/m);
      expect(projected).not.toMatch(/^PAYMENT_DATA_RETENTION_ENABLED=/m);
      expect(projected).toMatch(/^APP_URL=/m);
      expect(readFileSync(input, "utf8")).toMatch(/^PAYMENT_DATA_RETENTION_ENABLED=/m);
      if (process.platform !== "win32") {
        expect(statSync(output).mode & 0o777).toBe(0o600);
      }

      const duplicate = materialize();
      expect(duplicate.status).not.toBe(0);
      expect(readFileSync(output, "utf8")).toBe(projected);
    } finally {
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    }
  });
});
