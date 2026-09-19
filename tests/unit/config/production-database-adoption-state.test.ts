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

import { clearDatabaseAdoptionAuthorization } from "../../../deploy/prod/database-adoption-state.mjs";

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
