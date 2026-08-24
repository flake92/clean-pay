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
  if (input.command === "replace") {
    assertHash(
      readFileSync(input.targetPath),
      input.currentHash,
      "authoritative Caddyfile",
    );
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(input.targetPath, constants.O_RDWR | noFollow);
  try {
    const opened = fstatSync(descriptor);
    assertSameFile(targetBefore, opened);
    writeAll(descriptor, source.contents);
    ftruncateSync(descriptor, source.contents.length);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  const targetAfter = inspectRegularFile(
    input.targetPath,
    "authoritative Caddyfile",
  );
  assertSameFile(targetBefore, targetAfter);
  assertHash(
    readFileSync(input.targetPath),
    input.sourceHash,
    "authoritative Caddyfile after write",
  );
  process.stdout.write(
    "Caddyfile bytes were durably written without replacing the bind-mounted inode.\n",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("Caddyfile same-inode guard failed: " + message + "\n");
  process.exitCode = 1;
}

function parseArguments(args) {
  const command = args[0];
  const expectedLength = command === "replace" ? 5 : 4;
  if (!["replace", "restore"].includes(command) || args.length !== expectedLength) {
    throw new Error(
      "usage: caddyfile-same-inode.mjs replace TARGET SOURCE CURRENT_SHA SOURCE_SHA\n" +
        "   or: caddyfile-same-inode.mjs restore TARGET SOURCE SOURCE_SHA",
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
  const hashes = command === "replace" ? [args[3], args[4]] : [args[3]];
  for (const hash of hashes) {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("expected SHA-256 values must be lowercase 64-hex strings");
    }
  }
  return {
    command,
    targetPath,
    sourcePath,
    currentHash: command === "replace" ? args[3] : undefined,
    sourceHash: command === "replace" ? args[4] : args[3],
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

function assertHash(contents, expected, label) {
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== expected) {
    throw new Error(label + " checksum does not match the reviewed value");
  }
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
