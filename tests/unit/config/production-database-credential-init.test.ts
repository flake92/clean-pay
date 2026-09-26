import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeDatabaseCredentials } from "../../../deploy/prod/database-credential-init.mjs";

const temporaryDirectories: string[] = [];

function privateEnvironment(contents: string) {
  const directory = mkdtempSync(join(tmpdir(), "clean-pay-db-credentials-"));
  temporaryDirectories.push(directory);
  const path = join(directory, ".env");
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("production database credential initialization", () => {
  it("upgrades the v0.1.1 single-role database environment without changing its bootstrap credential", () => {
    const bootstrapPassword = "a".repeat(48);
    const path = privateEnvironment([
      "POSTGRES_DB=clean_pay",
      "POSTGRES_USER=clean_pay",
      `POSTGRES_PASSWORD=${bootstrapPassword}`,
      `DATABASE_URL=postgresql://clean_pay:${bootstrapPassword}@postgres:5432/clean_pay?schema=public`,
      "",
    ].join("\n"));

    const result = initializeDatabaseCredentials(path);
    const environment = Object.fromEntries(
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    expect(result.updatedNames).toEqual([
      "DATABASE_URL",
      "HOLD_OPERATOR_DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "RETENTION_DATABASE_URL",
    ]);
    expect(environment.POSTGRES_USER).toBe("clean_pay");
    expect(environment.POSTGRES_PASSWORD).toBe(bootstrapPassword);

    const roleUrls = [
      environment.DATABASE_URL,
      environment.MIGRATION_DATABASE_URL,
      environment.RETENTION_DATABASE_URL,
      environment.HOLD_OPERATOR_DATABASE_URL,
    ].map((value) => new URL(value));
    expect(new Set(roleUrls.map((url) => decodeURIComponent(url.username))).size).toBe(4);
    expect(roleUrls.every((url) => url.hostname === "postgres")).toBe(true);
    expect(roleUrls.every((url) => url.pathname === "/clean_pay")).toBe(true);
    expect(roleUrls.every((url) => decodeURIComponent(url.username) !== "clean_pay")).toBe(true);
    expect(roleUrls.every((url) => decodeURIComponent(url.password) !== bootstrapPassword)).toBe(true);
  });

  it("rejects an ambiguous bootstrap-role URL instead of guessing its password", () => {
    const path = privateEnvironment([
      "POSTGRES_DB=clean_pay",
      "POSTGRES_USER=clean_pay",
      `POSTGRES_PASSWORD=${"a".repeat(64)}`,
      `DATABASE_URL=postgresql://clean_pay:${"b".repeat(64)}@postgres:5432/clean_pay?schema=public`,
      "",
    ].join("\n"));
    const before = readFileSync(path, "utf8");

    expect(() => initializeDatabaseCredentials(path)).toThrow(
      "DATABASE_URL reuses POSTGRES_USER without the exact legacy bootstrap credential",
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("fails without mutating a malformed nonempty deployment target", () => {
    const path = privateEnvironment([
      "POSTGRES_DB=clean_pay",
      "POSTGRES_USER=clean_pay_bootstrap",
      "POSTGRES_PASSWORD=change-me-bootstrap-database-password",
      "DATABASE_URL=https://unexpected.example/clean_pay",
      "MIGRATION_DATABASE_URL=",
      "RETENTION_DATABASE_URL=",
      "HOLD_OPERATOR_DATABASE_URL=",
      "",
    ].join("\n"));
    const before = readFileSync(path, "utf8");
    expect(() => initializeDatabaseCredentials(path)).toThrow(
      "DATABASE_URL is nonempty but is not a valid URL",
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("only replaces explicit examples or missing URLs and canonicalizes spaced assignments", () => {
    const path = privateEnvironment([
      "POSTGRES_DB = clean_pay",
      "POSTGRES_USER = clean_pay_bootstrap",
      "POSTGRES_PASSWORD = change-me-bootstrap-database-password",
      "DATABASE_URL = postgresql://clean_pay_app:change-me-application-database-password@postgres:5432/clean_pay?schema=public",
      "MIGRATION_DATABASE_URL=",
      "RETENTION_DATABASE_URL=",
      "HOLD_OPERATOR_DATABASE_URL=",
      "",
    ].join("\n"));
    const result = initializeDatabaseCredentials(path);
    const contents = readFileSync(path, "utf8");
    expect(result.updatedNames).toEqual([
      "DATABASE_URL",
      "HOLD_OPERATOR_DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "POSTGRES_PASSWORD",
      "RETENTION_DATABASE_URL",
    ]);
    for (const name of result.updatedNames) {
      expect(contents.match(new RegExp(`^\\s*${name}\\s*=`, "gm"))).toHaveLength(1);
    }
    expect(contents).not.toContain("change-me-");
  });

  it("rejects missing identity fields before generating any credentials", () => {
    const path = privateEnvironment([
      "POSTGRES_USER=clean_pay_bootstrap",
      "POSTGRES_PASSWORD=change-me-bootstrap-database-password",
      "",
    ].join("\n"));
    const before = readFileSync(path, "utf8");
    expect(() => initializeDatabaseCredentials(path)).toThrow("POSTGRES_DB is required");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("preserves an externally replaced source instead of publishing stale generated credentials", () => {
    const path = privateEnvironment([
      "POSTGRES_DB=clean_pay",
      "POSTGRES_USER=clean_pay_bootstrap",
      "POSTGRES_PASSWORD=change-me-bootstrap-database-password",
      "DATABASE_URL=",
      "MIGRATION_DATABASE_URL=",
      "RETENTION_DATABASE_URL=",
      "HOLD_OPERATOR_DATABASE_URL=",
      "",
    ].join("\n"));
    const original = `${path}.original`;
    const replacement = "EXTERNAL_EDIT=must-survive\n";

    expect(() => initializeDatabaseCredentials(path, {
      beforePublish() {
        renameSync(path, original);
        writeFileSync(path, replacement, { encoding: "utf8", mode: 0o600 });
        chmodSync(path, 0o600);
      },
    })).toThrow(/changed before publication|refusing to overwrite/);
    expect(readFileSync(path, "utf8")).toBe(replacement);
  });

  it("rejects an in-place source edit made immediately before publication", () => {
    const path = privateEnvironment([
      "POSTGRES_DB=clean_pay",
      "POSTGRES_USER=clean_pay_bootstrap",
      "POSTGRES_PASSWORD=change-me-bootstrap-database-password",
      "DATABASE_URL=",
      "MIGRATION_DATABASE_URL=",
      "RETENTION_DATABASE_URL=",
      "HOLD_OPERATOR_DATABASE_URL=",
      "",
    ].join("\n"));
    const replacement = "EXTERNAL_EDIT=in-place-and-must-survive\n";

    expect(() => initializeDatabaseCredentials(path, {
      beforePublish() {
        writeFileSync(path, replacement, { encoding: "utf8", mode: 0o600 });
        chmodSync(path, 0o600);
      },
    })).toThrow(/changed before publication|refusing to overwrite/);
    expect(readFileSync(path, "utf8")).toBe(replacement);
  });
});
