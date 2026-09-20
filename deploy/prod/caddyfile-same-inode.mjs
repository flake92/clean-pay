#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

try {
  const input = parseArguments(process.argv.slice(2));
  const source = readRegularFile(input.sourcePath, "source");
  if (source.contents.length === 0) {
    throw new Error("source Caddyfile must not be empty");
  }
  assertHash(source.contents, input.sourceHash, "source");
  const targetBefore = inspectRegularFile(input.targetPath, "authoritative Caddyfile");
  writeSameInode(input, source.contents, targetBefore);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("Caddyfile same-inode guard failed: " + message + "\n");
  process.exitCode = 1;
}

function writeSameInode(input, sourceContents, targetBefore) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(input.targetPath, constants.O_RDWR | noFollow);
  let alreadyDesired = false;
  try {
    const opened = fstatSync(descriptor);
    assertSameFile(targetBefore, opened);
    const targetContents = readDescriptor(descriptor, opened.size);
    const afterRead = fstatSync(descriptor);
    assertSameFileVersion(opened, afterRead);
    const targetHash = sha256(targetContents);
    if (input.command === "restore" && targetHash === input.sourceHash) {
      alreadyDesired = true;
    } else {
      assertHash(targetContents, input.currentHash, "authoritative Caddyfile");
      writeAll(descriptor, sourceContents);
      ftruncateSync(descriptor, sourceContents.length);
      fsyncSync(descriptor);
    }

    const afterOperation = fstatSync(descriptor);
    assertSameFile(targetBefore, afterOperation);
    const verifiedContents = readDescriptor(descriptor, afterOperation.size);
    const afterVerification = fstatSync(descriptor);
    assertSameFileVersion(afterOperation, afterVerification);
    assertHash(
      verifiedContents,
      input.sourceHash,
      "authoritative Caddyfile after guarded operation",
    );

    const targetAfter = inspectRegularFile(
      input.targetPath,
      "authoritative Caddyfile",
    );
    assertSameFile(afterVerification, targetAfter);
  } finally {
    closeSync(descriptor);
  }
  if (alreadyDesired) {
    process.stdout.write(
      "Caddyfile already contains the reviewed recovery bytes; no write was needed.\n",
    );
  } else {
    process.stdout.write(
      "Caddyfile bytes were durably written without replacing the bind-mounted inode.\n",
    );
  }
}

function parseArguments(args) {
  const command = args[0];
  if (!["replace", "restore"].includes(command) || args.length !== 5) {
    throw new Error(
      "usage: caddyfile-same-inode.mjs replace TARGET SOURCE CURRENT_SHA SOURCE_SHA\n" +
        "   or: caddyfile-same-inode.mjs restore TARGET SOURCE CURRENT_SHA SOURCE_SHA",
    );
  }
  const targetPath = args[1];
  const sourcePath = args[2];
  for (const [label, path] of [
    ["target", targetPath],
    ["source", sourcePath],
  ]) {
    if (!isAbsolute(path) || /[\x00\r\n]/.test(path)) {
      throw new Error(label + " must be an absolute path without control characters");
    }
  }
  if (resolve(targetPath) === resolve(sourcePath)) {
    throw new Error("target and source must be different files");
  }
  const hashes = [args[3], args[4]];
  for (const hash of hashes) {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("expected SHA-256 values must be lowercase 64-hex strings");
    }
  }
  if (args[3] === args[4]) {
    throw new Error("current and source SHA-256 values must differ");
  }
  return {
    command,
    targetPath,
    sourcePath,
    currentHash: args[3],
    sourceHash: args[4],
  };
}

function inspectRegularFile(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(label + " must be a regular non-symlink file");
  }
  return stat;
}

function readRegularFile(path, label) {
  const stat = inspectRegularFile(path, label);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    assertSameFile(stat, opened);
    return { contents: readFileSync(descriptor) };
  } finally {
    closeSync(descriptor);
  }
}

function assertSameFile(expected, actual) {
  if (expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new Error("file identity changed during guarded write");
  }
}

function assertSameFileVersion(expected, actual) {
  assertSameFile(expected, actual);
  if (
    expected.size !== actual.size
    || expected.mtimeMs !== actual.mtimeMs
    || expected.ctimeMs !== actual.ctimeMs
  ) {
    throw new Error("authoritative Caddyfile changed during guarded read");
  }
}

function assertHash(contents, expected, label) {
  const actual = sha256(contents);
  if (actual !== expected) {
    throw new Error(label + " checksum does not match the reviewed value");
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function readDescriptor(descriptor, size) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("authoritative Caddyfile size is invalid");
  }
  const contents = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const read = readSync(descriptor, contents, offset, size - offset, offset);
    if (read <= 0) {
      throw new Error("authoritative Caddyfile changed during guarded read");
    }
    offset += read;
  }
  return contents;
}

function writeAll(descriptor, contents) {
  let offset = 0;
  while (offset < contents.length) {
    const written = writeSync(
      descriptor,
      contents,
      offset,
      contents.length - offset,
      offset,
    );
    if (written <= 0) {
      throw new Error("same-inode write made no progress");
    }
    offset += written;
  }
}
