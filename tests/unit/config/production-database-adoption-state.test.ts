import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeDatabaseAdoption,
  clearDatabaseAdoptionAuthorization,
} from "../../../deploy/prod/database-adoption-state.mjs";

const temporaryDirectories: string[] = [];

function privateEnvironment(contents: string) {
  const directory = mkdtempSync(join(tmpdir(), "clean-pay-db-adoption-"));
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

describe("production database adoption state", () => {
  it("atomically authorizes both one-time adoption flags after an explicit backup confirmation", () => {
    const path = privateEnvironment([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=false",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=false",
      "LOG_LEVEL=info",
      "",
    ].join("\n"));

    expect(authorizeDatabaseAdoption(path, "--confirm-verified-backup")).toEqual({
      updated: true,
    });
    expect(readFileSync(path, "utf8")).toBe([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=true",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=true",
      "LOG_LEVEL=info",
      "",
    ].join("\n"));
  });

  it("requires the exact backup confirmation without modifying the file", () => {
    const path = privateEnvironment([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=false",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=false",
      "",
    ].join("\n"));
    const before = readFileSync(path, "utf8");

    expect(() => authorizeDatabaseAdoption(path, "confirmed")).toThrow(
      "--confirm-verified-backup",
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("requires a prepared environment with both explicit flags", () => {
    const path = privateEnvironment("LOG_LEVEL=info\n");

    expect(() => authorizeDatabaseAdoption(
      path,
      "--confirm-verified-backup",
    )).toThrow("database adoption flags are missing");
    expect(readFileSync(path, "utf8")).toBe("LOG_LEVEL=info\n");
  });

  it("fails closed on a partial authorization without modifying the file", () => {
    const path = privateEnvironment([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=true",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=false",
      "",
    ].join("\n"));
    const before = readFileSync(path, "utf8");

    expect(() => authorizeDatabaseAdoption(
      path,
      "--confirm-verified-backup",
    )).toThrow("database adoption flags disagree");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("does not rewrite an already authorized environment", () => {
    const path = privateEnvironment([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=true",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=true",
      "",
    ].join("\n"));

    expect(authorizeDatabaseAdoption(path, "--confirm-verified-backup")).toEqual({
      updated: false,
    });
  });

  it("detects a concurrent edit before publishing an authorization", () => {
    const initial = [
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=false",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=false",
      "",
    ].join("\n");
    const path = privateEnvironment(initial);

    expect(() => authorizeDatabaseAdoption(
      path,
      "--confirm-verified-backup",
      {
        beforePublish() {
          writeFileSync(path, `${initial}LOG_LEVEL=warn\n`, { encoding: "utf8" });
        },
      },
    )).toThrow("changed before publication");
    expect(readFileSync(path, "utf8")).toBe(`${initial}LOG_LEVEL=warn\n`);
  });

  it("atomically clears both one-time adoption flags", () => {
    const path = privateEnvironment([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=true",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=true",
      "LOG_LEVEL=info",
      "",
    ].join("\n"));

    expect(clearDatabaseAdoptionAuthorization(path)).toEqual({ updated: true });
    expect(readFileSync(path, "utf8")).toBe([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=false",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=false",
      "LOG_LEVEL=info",
      "",
    ].join("\n"));
  });

  it("fails closed on a partial authorization without modifying the file", () => {
    const path = privateEnvironment([
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING=true",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=false",
      "",
    ].join("\n"));
    const before = readFileSync(path, "utf8");

    expect(() => clearDatabaseAdoptionAuthorization(path)).toThrow(
      "database adoption flags disagree",
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("does not rewrite an already disabled or pre-contract environment", () => {
    const path = privateEnvironment("LOG_LEVEL=info\n");
    expect(clearDatabaseAdoptionAuthorization(path)).toEqual({ updated: false });
    expect(readFileSync(path, "utf8")).toBe("LOG_LEVEL=info\n");
  });
});
