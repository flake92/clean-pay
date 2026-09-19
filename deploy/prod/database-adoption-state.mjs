#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readPrivateCredentialFile,
  writePrivateCredentialFileCas,
} from "./credential-file-guard.mjs";
import { parseProductionEnvironmentFile } from "./production-env-rules.mjs";

const ADOPTION_FLAGS = Object.freeze([
  "CLEAN_PAY_DATABASE_ADOPT_EXISTING",
  "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED",
]);

function replaceAssignments(contents, updates) {
  const pending = new Map(Object.entries(updates));
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
  const output = lines.map((line) => {
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!name || !pending.has(name)) return line;
    const value = pending.get(name);
    pending.delete(name);
    return `${name}=${value}`;
  });
  if (output.at(-1) === "") output.pop();
  for (const [name, value] of pending) output.push(`${name}=${value}`);
  return `${output.join("\n")}\n`;
}

export function clearDatabaseAdoptionAuthorization(path, options = {}) {
  const { contents, metadata } = readPrivateCredentialFile(path, "production env");
  const environment = parseProductionEnvironmentFile(contents, path);
  const values = ADOPTION_FLAGS.map((name) => environment[name] ?? "false");
  if (values.some((value) => !["true", "false"].includes(value))) {
    throw new Error("database adoption flags must be literal true or false");
  }
  if (values.every((value) => value === "false")) {
    return Object.freeze({ updated: false });
  }
  if (!values.every((value) => value === "true")) {
    throw new Error("database adoption flags disagree; refusing a partial reset");
  }

  writePrivateCredentialFileCas(
    path,
    "production env",
    replaceAssignments(contents, Object.fromEntries(
      ADOPTION_FLAGS.map((name) => [name, "false"]),
    )),
    metadata,
    options,
  );
  return Object.freeze({ updated: true });
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "clear") {
      throw new Error("usage: database-adoption-state.mjs clear PRODUCTION_ENV");
    }
    const result = clearDatabaseAdoptionAuthorization(process.argv[3]);
    process.stdout.write(result.updated
      ? "Database adoption authorization was cleared after successful verification.\n"
      : "Database adoption authorization is already disabled.\n");
  } catch (error) {
    process.stderr.write(
      `Database adoption state update failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
