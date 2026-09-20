#!/usr/bin/env node

import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPrivateCredentialDirectory,
  readPrivateCredentialFile,
} from "./credential-file-guard.mjs";
import {
  parseProductionEnvironmentFile,
  validateProductionEnvironment,
} from "./production-env-rules.mjs";

export const PRODUCTION_ROLLBACK_COMPATIBILITY = Object.freeze({
  "0ede176ad863c7a721a9fbbf43f583e838516d4b": Object.freeze([
    "CLEAN_PAY_CONFIG_VERSION",
    "CLEAN_PAY_UPGRADE_SOURCE_VERSION",
    "PAYMENT_DATA_RETENTION_ENABLED",
  ]),
});

const PRIVATE_FILE_OPERATIONS = Object.freeze({
  closeSync,
  fsyncSync,
  openSync,
  unlinkSync,
  writeFileSync,
});

export function projectRollbackCompatibilityEnvironment(contents, revision) {
  if (!Object.hasOwn(PRODUCTION_ROLLBACK_COMPATIBILITY, revision)) {
    throw new Error("rollback revision does not have a reviewed environment projection");
  }
  const omittedNames = PRODUCTION_ROLLBACK_COMPATIBILITY[revision];

  const environment = parseProductionEnvironmentFile(
    contents,
    "rollback authoritative environment",
  );
  const omitted = new Set(omittedNames);
  const observed = new Set();
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  const projected = lines.filter((line) => {
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!name || !omitted.has(name)) return true;
    observed.add(name);
    return false;
  });

  if (!observed.has("PAYMENT_DATA_RETENTION_ENABLED")) {
    throw new Error(
      "rollback environment is missing the required payment-retention compatibility boundary",
    );
  }

  const projectedEnvironment = parseProductionEnvironmentFile(
    `${projected.join("\n").replace(/\n*$/, "")}\n`,
    "rollback compatibility environment",
  );
  const expectedNames = Object.keys(environment)
    .filter((name) => !omitted.has(name))
    .sort();
  const projectedNames = Object.keys(projectedEnvironment).sort();
  if (
    expectedNames.length !== projectedNames.length
    || expectedNames.some((name, index) => name !== projectedNames[index])
  ) {
    throw new Error("rollback compatibility projection changed an unreviewed variable");
  }

  return `${projected.join("\n").replace(/\n*$/, "")}\n`;
}

export function writeCreateOnlyPrivateFile(
  outputPath,
  contents,
  operations = PRIVATE_FILE_OPERATIONS,
) {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let descriptor;
  let created = false;
  try {
    descriptor = operations.openSync(
      outputPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    created = true;
    operations.writeFileSync(descriptor, contents, "utf8");
    operations.fsyncSync(descriptor);
    operations.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        operations.closeSync(descriptor);
      } catch {
        // The original write/fsync/close failure remains authoritative. The
        // create-only output is removed below even if closing already failed.
      }
    }
    if (created) {
      try {
        operations.unlinkSync(outputPath);
      } catch (cleanupError) {
        const cleanupCode = cleanupError && typeof cleanupError === "object"
          && "code" in cleanupError
          ? cleanupError.code
          : undefined;
        if (cleanupCode !== "ENOENT") {
          throw new AggregateError(
            [error, cleanupError],
            "rollback compatibility environment failed and its partial output could not be removed",
          );
        }
      }
    }
    throw error;
  }
}

export function materializeRollbackCompatibilityEnvironment(
  revision,
  inputPath,
  outputPath,
) {
  const outputDirectory = dirname(outputPath);
  assertPrivateCredentialDirectory(
    outputDirectory,
    "rollback compatibility environment directory",
    { allowedModes: [0o700] },
  );
  const { contents } = readPrivateCredentialFile(
    inputPath,
    "rollback authoritative environment",
  );
  const environment = parseProductionEnvironmentFile(contents, inputPath);
  validateProductionEnvironment(environment);
  const projected = projectRollbackCompatibilityEnvironment(contents, revision);

  writeCreateOnlyPrivateFile(outputPath, projected);
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    if (
      process.argv.length !== 6
      || process.argv[2] !== "materialize"
    ) {
      throw new Error(
        "usage: rollback-env-compat.mjs materialize REVISION INPUT_ENV OUTPUT_ENV",
      );
    }
    materializeRollbackCompatibilityEnvironment(
      process.argv[3],
      process.argv[4],
      process.argv[5],
    );
    process.stdout.write("Rollback compatibility environment materialized.\n");
  } catch (error) {
    process.stderr.write(
      `Rollback compatibility environment failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
