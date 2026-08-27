#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MAX_FILES = 512;
const MAX_INVENTORY_ENTRIES = 2_048;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_RELATIVE_PATH_BYTES = 1_024;
const MAX_DIRECTORY_DEPTH = 32;
const READ_CHUNK_BYTES = 64 * 1024;
const CONTROL_CHARACTER = /\p{Cc}/u;
const SHA256 = /^[a-f0-9]{64}$/;

class EvidenceSealError extends Error {}

export const EVIDENCE_DIRECTORY_LIMITS = Object.freeze({
  maxDirectoryDepth: MAX_DIRECTORY_DEPTH,
  maxFileBytes: MAX_FILE_BYTES,
  maxFiles: MAX_FILES,
  maxInventoryEntries: MAX_INVENTORY_ENTRIES,
  maxRelativePathBytes: MAX_RELATIVE_PATH_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
});

export function assertEvidenceInventoryBounds(fileSizes) {
  if (
    !Array.isArray(fileSizes)
    || fileSizes.some((size) => !Number.isSafeInteger(size) || size < 0)
  ) {
    fail("Evidence inventory sizes are invalid.");
  }
  if (fileSizes.length === 0) fail("Evidence directory contains no files.");
  if (fileSizes.length > MAX_FILES) fail("Evidence directory exceeds the file-count limit.");

  let totalBytes = 0;
  for (const size of fileSizes) {
    if (size > MAX_FILE_BYTES) fail("An evidence file exceeds the per-file byte limit.");
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      fail("Evidence directory exceeds the aggregate byte limit.");
    }
  }
  return Object.freeze({ fileCount: fileSizes.length, totalBytes });
}

export async function sealEvidenceDirectory(
  evidenceRootInput,
  manifestPathInput,
  { onReadProgress } = {},
) {
  if (onReadProgress !== undefined && typeof onReadProgress !== "function") {
    fail("Evidence read observer is invalid.");
  }

  try {
    return await sealEvidenceDirectoryInternal({
      evidenceRootInput,
      manifestPathInput,
      onReadProgress,
    });
  } catch (error) {
    if (error instanceof EvidenceSealError) throw error;
    throw new EvidenceSealError("Evidence directory sealing failed safely.");
  }
}

async function sealEvidenceDirectoryInternal({
  evidenceRootInput,
  manifestPathInput,
  onReadProgress,
}) {
  const evidenceRoot = exactAbsolutePath(evidenceRootInput, "Evidence root");
  const manifestPath = exactAbsolutePath(manifestPathInput, "Manifest path");
  const rootState = await checkedDirectory(evidenceRoot, "Evidence root");

  for (const protectedPath of [REPOSITORY_ROOT, process.cwd()]) {
    const canonicalProtectedPath = await exactRealpath(
      path.resolve(protectedPath),
      "Protected workspace path",
    );
    if (samePath(rootState.realPath, canonicalProtectedPath)
      || containsPath(rootState.realPath, canonicalProtectedPath)) {
      fail("Evidence root must not be a repository/workspace root or its ancestor.");
    }
  }

  const manifestRelativePath = containedRelativePath(
    evidenceRoot,
    manifestPath,
    "Manifest path",
  );
  const manifestParent = path.dirname(manifestPath);
  const manifestParentState = await checkedDirectory(
    manifestParent,
    "Manifest parent directory",
  );
  if (!containsPath(rootState.realPath, manifestParentState.realPath, { allowSame: true })) {
    fail("Manifest parent directory escaped the evidence root.");
  }
  await assertMissing(manifestPath);

  const inventoryState = {
    directories: [],
    entriesSeen: 0,
    files: [],
    manifestRelativePath,
  };
  await enumerateDirectory(evidenceRoot, "", 0, inventoryState);
  inventoryState.files.sort((left, right) => compareOrdinal(left.path, right.path));

  const bounds = assertEvidenceInventoryBounds(
    inventoryState.files.map(({ snapshot }) => snapshot.size),
  );
  const sealedFiles = [];
  for (const [index, entry] of inventoryState.files.entries()) {
    const sealed = await hashStableFile(entry, onReadProgress);
    sealedFiles.push(Object.freeze({
      ordinal: index + 1,
      path: entry.path,
      bytes: sealed.bytes,
      sha256: sealed.sha256,
    }));
    entry.snapshot = sealed.snapshot;
  }

  await verifyInventoryStillStable(inventoryState);
  await verifyDirectoryStillStable(evidenceRoot, rootState.snapshot, "Evidence root");
  await verifyDirectoryStillStable(
    manifestParent,
    manifestParentState.snapshot,
    "Manifest parent directory",
  );
  const finalParentRealPath = await exactRealpath(
    manifestParent,
    "Manifest parent directory",
  );
  if (!samePath(finalParentRealPath, manifestParentState.realPath)) {
    fail("Manifest parent directory changed before sealing.");
  }
  await assertMissing(manifestPath);

  const aggregateSha256 = aggregateEvidenceSha256(sealedFiles);
  const manifest = Object.freeze({
    schemaVersion: "clean-pay.sanitized-evidence-directory.v1",
    hashAlgorithm: "sha256",
    pathEncoding: "UTF-8 with / separators; case-preserving UTF-16 ordinal sort",
    aggregateFraming: "UTF8(path) NUL ASCII(bytes-base10) NUL ASCII(sha256-lowerhex) LF",
    fileCount: bounds.fileCount,
    totalBytes: bounds.totalBytes,
    aggregateSha256,
    files: sealedFiles,
  });
  await createPrivateManifest(manifestPath, manifest);
  return manifest;
}

async function enumerateDirectory(absoluteDirectory, relativeDirectory, depth, state) {
  if (depth > MAX_DIRECTORY_DEPTH) {
    fail("Evidence directory exceeds the nesting-depth limit.");
  }
  const directoryState = await checkedDirectory(
    absoluteDirectory,
    "Evidence inventory directory",
  );
  const trackedDirectory = {
    absolutePath: absoluteDirectory,
    snapshot: directoryState.snapshot,
  };
  state.directories.push(trackedDirectory);

  let directory;
  try {
    directory = await opendir(absoluteDirectory);
  } catch {
    fail("Evidence inventory directory could not be opened.");
  }

  try {
    for await (const entry of directory) {
      validatePathSegment(entry.name);
      state.entriesSeen += 1;
      if (state.entriesSeen > MAX_INVENTORY_ENTRIES) {
        fail("Evidence directory exceeds the inventory-entry limit.");
      }

      const absoluteEntry = path.join(absoluteDirectory, entry.name);
      const relativeEntry = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      validateRelativePath(relativeEntry);
      const stat = await exactLstat(absoluteEntry, "Evidence inventory entry");
      if (stat.isSymbolicLink()) fail("Evidence directory contains a symbolic link.");
      if (stat.isDirectory()) {
        await enumerateDirectory(absoluteEntry, relativeEntry, depth + 1, state);
        continue;
      }
      if (!stat.isFile()) fail("Evidence directory contains a non-regular entry.");
      if (relativeEntry === state.manifestRelativePath) {
        fail("Manifest output already exists.");
      }
      const snapshot = statSnapshot(stat);
      if (snapshot.size > MAX_FILE_BYTES) {
        fail("An evidence file exceeds the per-file byte limit.");
      }
      state.files.push({ absolutePath: absoluteEntry, path: relativeEntry, snapshot });
      if (state.files.length > MAX_FILES) {
        fail("Evidence directory exceeds the file-count limit.");
      }
    }
  } catch (error) {
    if (error instanceof EvidenceSealError) throw error;
    fail("Evidence inventory changed or could not be enumerated.");
  }

  const after = await exactLstat(absoluteDirectory, "Evidence inventory directory");
  if (!after.isDirectory() || after.isSymbolicLink()) {
    fail("Evidence inventory directory changed during enumeration.");
  }
  const afterSnapshot = statSnapshot(after);
  if (!sameStableStat(trackedDirectory.snapshot, afterSnapshot)) {
    fail("Evidence inventory directory changed during enumeration.");
  }
  trackedDirectory.snapshot = afterSnapshot;
}

async function hashStableFile(entry, onReadProgress) {
  const readFlags = constants.O_RDONLY
    | (Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0);
  let handle;
  try {
    handle = await open(entry.absolutePath, readFlags);
  } catch {
    fail("Evidence file could not be opened without following links.");
  }

  let result;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameStableStat(entry.snapshot, statSnapshot(opened))) {
      fail("Evidence file changed before it was read.");
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let bytes = 0;
    let chunkIndex = 0;
    while (true) {
      const read = await handle.read(buffer, 0, buffer.byteLength, bytes);
      if (read.bytesRead === 0) break;
      bytes += read.bytesRead;
      chunkIndex += 1;
      if (bytes > entry.snapshot.size || bytes > MAX_FILE_BYTES) {
        fail("Evidence file changed size while it was read.");
      }
      hash.update(buffer.subarray(0, read.bytesRead));
      if (onReadProgress) {
        try {
          await onReadProgress(Object.freeze({
            bytesRead: bytes,
            chunkIndex,
            path: entry.path,
          }));
        } catch {
          fail("Evidence read observer failed.");
        }
      }
    }

    const after = await handle.stat({ bigint: true });
    const snapshot = statSnapshot(after);
    if (
      bytes !== entry.snapshot.size
      || !after.isFile()
      || !sameStableStat(entry.snapshot, snapshot)
    ) {
      fail("Evidence file changed while it was read.");
    }
    result = Object.freeze({ bytes, sha256: hash.digest("hex"), snapshot });
  } finally {
    try {
      await handle.close();
    } catch {
      fail("Evidence file handle could not be closed safely.");
    }
  }

  const afterPath = await exactLstat(entry.absolutePath, "Evidence file");
  if (
    afterPath.isSymbolicLink()
    || !afterPath.isFile()
    || !sameStableStat(result.snapshot, statSnapshot(afterPath))
  ) {
    fail("Evidence file changed after it was read.");
  }
  if (!SHA256.test(result.sha256)) fail("Evidence file digest is invalid.");
  return result;
}

async function verifyInventoryStillStable(state) {
  for (const entry of state.files) {
    const stat = await exactLstat(entry.absolutePath, "Evidence file");
    if (
      stat.isSymbolicLink()
      || !stat.isFile()
      || !sameStableStat(entry.snapshot, statSnapshot(stat))
    ) {
      fail("Evidence inventory changed before the manifest was created.");
    }
  }
  for (const directory of state.directories) {
    await verifyDirectoryStillStable(
      directory.absolutePath,
      directory.snapshot,
      "Evidence inventory directory",
    );
  }
}

async function verifyDirectoryStillStable(absolutePath, expected, label) {
  const stat = await exactLstat(absolutePath, label);
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || !sameStableStat(expected, statSnapshot(stat))
  ) {
    fail(`${label} changed before the manifest was created.`);
  }
}

function aggregateEvidenceSha256(files) {
  const aggregate = createHash("sha256");
  for (const file of files) {
    aggregate.update(file.path, "utf8");
    aggregate.update(Buffer.from([0]));
    aggregate.update(String(file.bytes), "ascii");
    aggregate.update(Buffer.from([0]));
    aggregate.update(file.sha256, "ascii");
    aggregate.update("\n", "ascii");
  }
  return aggregate.digest("hex");
}

async function createPrivateManifest(manifestPath, manifest) {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  let handle;
  let writtenSnapshot;
  try {
    handle = await open(manifestPath, "wx", 0o600);
  } catch {
    fail("Manifest output could not be created exclusively.");
  }
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) fail("Manifest output is not a regular file.");
    await handle.writeFile(bytes);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (!written.isFile() || Number(written.size) !== bytes.byteLength) {
      fail("Manifest output was not written completely.");
    }
    if (process.platform !== "win32" && (Number(written.mode) & 0o077) !== 0) {
      fail("Manifest output permissions are not private.");
    }
    writtenSnapshot = statSnapshot(written);
  } finally {
    try {
      await handle.close();
    } catch {
      fail("Manifest output could not be closed safely.");
    }
  }

  const output = await exactLstat(manifestPath, "Manifest output");
  if (
    output.isSymbolicLink()
    || !output.isFile()
    || !sameStableStat(writtenSnapshot, statSnapshot(output))
  ) {
    fail("Manifest output changed before sealing completed.");
  }
}

async function checkedDirectory(absolutePath, label) {
  const stat = await exactLstat(absolutePath, label);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} must be a non-symlink directory.`);
  }
  const resolved = path.resolve(absolutePath);
  const realPath = await exactRealpath(resolved, label);
  if (!samePath(resolved, realPath)) {
    fail(`${label} must not traverse a symbolic link.`);
  }
  return Object.freeze({ realPath, snapshot: statSnapshot(stat) });
}

async function exactLstat(target, label) {
  try {
    return await lstat(target, { bigint: true });
  } catch {
    fail(`${label} is missing or inaccessible.`);
  }
}

async function exactRealpath(target, label) {
  try {
    return await realpath(target);
  } catch {
    fail(`${label} could not be resolved safely.`);
  }
}

async function assertMissing(target) {
  try {
    await lstat(target);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    fail("Manifest output could not be checked safely.");
  }
  fail("Manifest output already exists.");
}

function exactAbsolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARACTER.test(value)) {
    fail(`${label} must be an explicit absolute path without control characters.`);
  }
  if (!path.isAbsolute(value)) fail(`${label} must be an explicit absolute path.`);
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail(`${label} must not contain relative path segments.`);
  }
  return path.resolve(value);
}

function containedRelativePath(root, target, label) {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relativeEscapes(relative)) {
    fail(`${label} must be a new file strictly within the evidence root.`);
  }
  const normalized = relative.split(path.sep).join("/");
  validateRelativePath(normalized);
  return normalized;
}

function validateRelativePath(relative) {
  if (
    typeof relative !== "string"
    || relative.length === 0
    || relative.startsWith("/")
    || Buffer.byteLength(relative, "utf8") > MAX_RELATIVE_PATH_BYTES
  ) {
    fail("Evidence relative path is invalid or too long.");
  }
  const segments = relative.split("/");
  for (const segment of segments) validatePathSegment(segment);
}

function validatePathSegment(segment) {
  if (
    !segment
    || segment === "."
    || segment === ".."
    || segment.includes("/")
    || segment.includes("\\")
    || segment.includes(":")
    || CONTROL_CHARACTER.test(segment)
  ) {
    fail("Evidence path contains an unsafe segment.");
  }
}

function statSnapshot(stat) {
  const size = Number(stat.size);
  if (!Number.isSafeInteger(size) || size < 0) fail("Filesystem metadata is invalid.");
  return Object.freeze({
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    mtimeNs: stat.mtimeNs,
    nlink: stat.nlink,
    size,
  });
}

function sameStableStat(left, right) {
  return left.ctimeNs === right.ctimeNs
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.nlink === right.nlink
    && left.size === right.size;
}

function containsPath(parent, candidate, { allowSame = false } = {}) {
  const relative = path.relative(parent, candidate);
  if (!relative) return allowSame;
  return !path.isAbsolute(relative) && !relativeEscapes(relative);
}

function samePath(left, right) {
  return path.relative(left, right) === "" && path.relative(right, left) === "";
}

function relativeEscapes(relative) {
  return relative === ".." || relative.startsWith(`..${path.sep}`);
}

function compareOrdinal(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) fail("Expected exactly --evidence-root and --manifest.");
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      !new Set(["--evidence-root", "--manifest"]).has(name)
      || value === undefined
      || values.has(name)
    ) {
      fail("Evidence sealer arguments are invalid or duplicated.");
    }
    values.set(name, value);
  }
  if (!values.has("--evidence-root") || !values.has("--manifest")) {
    fail("Evidence sealer arguments are incomplete.");
  }
  return values;
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const manifest = await sealEvidenceDirectory(
    values.get("--evidence-root"),
    values.get("--manifest"),
  );
  process.stdout.write(`${JSON.stringify({
    status: "sealed",
    manifest: path.relative(values.get("--evidence-root"), values.get("--manifest"))
      .split(path.sep).join("/"),
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    aggregateSha256: manifest.aggregateSha256,
  })}\n`);
}

function fail(message) {
  throw new EvidenceSealError(message);
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedUrl === import.meta.url) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof EvidenceSealError
      ? error.message
      : "Evidence directory sealing failed safely.";
    process.stderr.write(`Evidence directory sealing failed: ${message}\n`);
    process.exitCode = 1;
  }
}
