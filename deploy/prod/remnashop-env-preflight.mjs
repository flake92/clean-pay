#!/usr/bin/env node

import { dirname, isAbsolute } from "node:path";

import {
  assertPrivateCredentialDirectory,
  assertPrivateCredentialFile,
} from "./credential-file-guard.mjs";

function numericIdentity(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a numeric id`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the safe integer range`);
  return parsed;
}

export function assertRemnashopEnvironmentFile(
  path,
  {
    expectedUid = 0,
    expectedGid = 0,
  } = {},
) {
  if (!isAbsolute(path)) throw new Error("Remnashop env path must be absolute");
  assertPrivateCredentialDirectory(dirname(path), "Remnashop env directory", {
    expectedUid,
    expectedGid,
    allowedModes: [0o700, 0o750],
  });
  return assertPrivateCredentialFile(path, "Remnashop env file", {
    expectedUid,
    expectedGid,
    allowedModes: [0o400, 0o600],
  });
}

function main(args) {
  if (args.length < 1 || args.length > 3) {
    throw new Error(
      "usage: remnashop-env-preflight.mjs ABSOLUTE_ENV_PATH [EXPECTED_UID [EXPECTED_GID]]",
    );
  }
  const [path, rawUid = "0", rawGid = "0"] = args;
  assertRemnashopEnvironmentFile(path, {
    expectedUid: numericIdentity(rawUid, "expected uid"),
    expectedGid: numericIdentity(rawGid, "expected gid"),
  });
  process.stdout.write("Remnashop environment-file metadata passed.\n");
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/");
if (invokedPath?.endsWith("/remnashop-env-preflight.mjs")) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Remnashop environment-file preflight failed: ${message}\n`);
    process.exitCode = 1;
  }
}
