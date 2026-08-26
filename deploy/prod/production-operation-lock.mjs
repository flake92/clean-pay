#!/usr/bin/env node

import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPrivateCredentialDirectory,
  assertPrivateCredentialFile,
  readPrivateCredentialFile,
  sameCredentialFileIdentity,
  sameCredentialFileVersion,
} from "./credential-file-guard.mjs";

function fail(message) {
  throw new Error(message);
}

function safeOperation(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    fail("production operation name is invalid");
  }
  return value;
}

function safeToken(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail("production operation lock token is invalid");
  }
  return value;
}

function safeProcessId(value, label) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > 0xffff_ffff
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function commandLineOwnerPid(value) {
  if (value === undefined) return safeProcessId(process.pid, "production operation owner PID");
  if (!/^[1-9][0-9]{0,9}$/.test(value)) {
    fail("production operation owner PID is invalid");
  }
  return safeProcessId(Number(value), "production operation owner PID");
}

function equalToken(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

export function exitCodeAfterProductionOperationLockRelease(
  originalExitCode,
  releaseSucceeded,
) {
  return originalExitCode === 0 && !releaseSucceeded ? 1 : originalExitCode;
}

function guardedParent(path) {
  return assertPrivateCredentialDirectory(
    dirname(path),
    "production operation lock directory",
    { allowedModes: [0o700, 0o750, 0o755] },
  );
}

function openParent(path, expected) {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const directoryOnly = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;
  const descriptor = openSync(
    dirname(path),
    constants.O_RDONLY | noFollow | directoryOnly,
  );
  const opened = fstatSync(descriptor);
  const current = assertPrivateCredentialDirectory(
    dirname(path),
    "production operation lock directory",
    { allowedModes: [0o700, 0o750, 0o755] },
  );
  if (
    opened.dev !== expected.device
    || opened.ino !== expected.inode
    || !opened.isDirectory()
    || !sameCredentialFileIdentity(expected, current)
  ) {
    closeSync(descriptor);
    fail("production operation lock directory changed during validation");
  }
  return descriptor;
}

export function acquireProductionOperationLock(
  path,
  operation,
  ownerPid = process.pid,
) {
  safeOperation(operation);
  const validatedOwnerPid = safeProcessId(
    ownerPid,
    "production operation owner PID",
  );
  const helperPid = safeProcessId(process.pid, "production operation helper PID");
  const parent = guardedParent(path);
  const directoryDescriptor = openParent(path, parent);
  const token = randomBytes(32).toString("hex");
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let lockDescriptor;
  try {
    try {
      lockDescriptor = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        fail(
          "another production operation is active (or a crash left a fail-closed lock); inspect it and remove it only after proving no operation is running",
        );
      }
      throw error;
    }
    const payload = `${JSON.stringify({
      operation,
      pid: validatedOwnerPid,
      ownerPid: validatedOwnerPid,
      helperPid,
      startedAt: new Date().toISOString(),
      token,
    })}\n`;
    writeFileSync(lockDescriptor, payload, "utf8");
    fsyncSync(lockDescriptor);
    closeSync(lockDescriptor);
    lockDescriptor = undefined;
    assertPrivateCredentialFile(path, "production operation lock");
    const parentAfterCreate = guardedParent(path);
    if (!sameCredentialFileIdentity(parent, parentAfterCreate)) {
      fail("production operation lock directory changed while acquiring the lock");
    }
    if (process.platform !== "win32") fsyncSync(directoryDescriptor);
    return token;
  } finally {
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    closeSync(directoryDescriptor);
  }
}

export function releaseProductionOperationLock(path, token) {
  safeToken(token);
  const parent = guardedParent(path);
  const directoryDescriptor = openParent(path, parent);
  try {
    const current = readPrivateCredentialFile(path, "production operation lock");
    let payload;
    try {
      payload = JSON.parse(current.contents);
    } catch {
      fail("production operation lock contents are invalid; refusing unsafe removal");
    }
    if (!equalToken(payload?.token, token)) {
      fail("production operation lock ownership token does not match");
    }
    const beforeUnlink = assertPrivateCredentialFile(path, "production operation lock");
    if (!sameCredentialFileVersion(current.metadata, beforeUnlink)) {
      fail("production operation lock changed before release");
    }
    unlinkSync(path);
    if (existsSync(path)) fail("production operation lock still exists after release");
    const parentAfterUnlink = guardedParent(path);
    if (!sameCredentialFileIdentity(parent, parentAfterUnlink)) {
      fail("production operation lock directory changed while releasing the lock");
    }
    if (process.platform !== "win32") fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

async function main(argv) {
  const [mode, path, value, ownerPid, ...extra] = argv;
  if (
    extra.length > 0
    || !path
    || !value
    || !["acquire", "release"].includes(mode)
    || (mode === "release" && ownerPid !== undefined)
  ) {
    fail(
      "usage: production-operation-lock.mjs acquire PATH OPERATION [OWNER_PID] | release PATH TOKEN",
    );
  }
  if (mode === "acquire") {
    process.stdout.write(`${acquireProductionOperationLock(
      path,
      value,
      commandLineOwnerPid(ownerPid),
    )}\n`);
    return;
  }
  releaseProductionOperationLock(path, value);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `Production operation lock failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
