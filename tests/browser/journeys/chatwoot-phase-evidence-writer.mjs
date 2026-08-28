import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

import {
  CHATWOOT_PHASE_PROOF_PAIR_COUNT,
  CHATWOOT_PHASE_SCREENSHOT_NAMES,
  assertChatwootPhaseProof,
  sha256,
} from "./chatwoot-phase-proof-contract.mjs";
import { writeJourneySanitizedOutput } from "./journey-owned-stack-orchestrator.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_WIDTH = 1440;
const SCREENSHOT_HEIGHT = 900;
const roles = Object.freeze(["baseline", "candidate"]);
const execFileAsync = promisify(execFile);
const privateEvidenceStates = new WeakMap();

export async function prepareChatwootPhaseEvidenceDirectory({
  outputDirectory,
  repositoryRoot,
}) {
  return prepareEvidenceDirectory({ outputDirectory, repositoryRoot }, Object.freeze({}));
}

export async function prepareChatwootPhaseEvidenceDirectoryForTest(
  { outputDirectory, repositoryRoot },
  hooks,
) {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)
    || JSON.stringify(Object.keys(hooks).sort())
      !== JSON.stringify(["failAfterRawCreate", "failAfterRootCreate"])
    || typeof hooks.failAfterRawCreate !== "boolean"
    || typeof hooks.failAfterRootCreate !== "boolean") {
    throw new Error("Chatwoot evidence test hooks are invalid.");
  }
  return prepareEvidenceDirectory({ outputDirectory, repositoryRoot }, hooks);
}

async function prepareEvidenceDirectory({ outputDirectory, repositoryRoot }, hooks) {
  const repository = await exactDirectory(repositoryRoot, "repository root");
  if (typeof outputDirectory !== "string" || !path.isAbsolute(outputDirectory)) {
    throw new Error("Chatwoot evidence directory must be an absolute path.");
  }
  const target = path.resolve(outputDirectory);
  if (isWithin(repository, target) || normalizePath(target) === normalizePath(path.parse(target).root)) {
    throw new Error("Chatwoot evidence directory must be outside the repository and filesystem root.");
  }
  const parent = await exactDirectory(path.dirname(target), "evidence parent");
  if (isWithin(repository, parent)) {
    throw new Error("Chatwoot evidence parent must stay outside the repository.");
  }
  try {
    await lstat(target);
    throw new Error("Chatwoot evidence directory already exists; evidence is create-only.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let rootIdentity;
  let rawIdentity;
  try {
    await mkdir(target, { mode: 0o700, recursive: false });
    rootIdentity = await capturePathIdentity(target, "new evidence root", "directory");
    if (hooks.failAfterRootCreate) throw new Error("Injected failure after evidence root creation.");
    await setAndAssertPrivatePermissions(target, true);
    const realTarget = await exactDirectory(target, "evidence directory");
    const rawDirectory = path.join(realTarget, "raw");
    await mkdir(rawDirectory, { mode: 0o700, recursive: false });
    rawIdentity = await capturePathIdentity(rawDirectory, "new raw evidence directory", "directory");
    if (hooks.failAfterRawCreate) throw new Error("Injected failure after raw evidence creation.");
    await setAndAssertPrivatePermissions(rawDirectory, true);
    const state = Object.freeze({ directory: realTarget, rawDirectory });
    privateEvidenceStates.set(state, {
      ancestors: await captureAncestorIdentities(parent),
      artifactIdentities: new Map(),
      artifacts: new Map(),
      directory: realTarget,
      aborted: false,
      finalized: false,
      raw: await capturePathIdentity(rawDirectory, "raw evidence directory", "directory"),
      rawDirectory,
      root: await capturePathIdentity(realTarget, "evidence root", "directory"),
    });
    return state;
  } catch (error) {
    const cleanupErrors = await cleanupPartialEvidenceRoot({
      rawIdentity,
      rootIdentity,
      target,
    });
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Chatwoot evidence preparation and exact partial-create cleanup both failed.",
      );
    }
    throw error;
  }
}

export async function writeRawChatwootPhaseScreenshot({
  state,
  pairIndex,
  role,
  phase,
  bytes,
}) {
  const owned = assertWritableState(state);
  assertPairRolePhase(pairIndex, role, phase);
  const buffer = Buffer.from(bytes ?? []);
  assertPng(buffer);
  const relativePath = screenshotRelativePath(pairIndex, role, phase);
  if (owned.artifacts.has(relativePath)) {
    throw new Error("Chatwoot screenshot artifact may be written exactly once.");
  }
  await assertEvidenceFilesystemIdentity(state);
  const target = path.join(owned.directory, ...relativePath.split("/"));
  const observedFile = await writePrivateFile(state, relativePath, target, buffer);
  await refreshOwnedDirectoryIdentity(state, "raw");
  await assertEvidenceFilesystemIdentity(state);
  const observed = observedFile.bytes;
  if (!observed.equals(buffer)) {
    throw new Error("Chatwoot screenshot bytes changed after write.");
  }
  const evidence = Object.freeze({
    kind: "raw-png",
    pairIndex,
    role,
    phase,
    relativePath,
    byteLength: buffer.byteLength,
    sha256: sha256(buffer),
  });
  owned.artifacts.set(relativePath, evidence);
  owned.artifactIdentities.set(relativePath, observedFile.identity);
  return evidence;
}

export async function finalizeChatwootPhaseEvidence({ state, proof }) {
  return finalizeEvidence({ state, proof }, Object.freeze({}));
}

export async function finalizeChatwootPhaseEvidenceForTest(
  { state, proof },
  hooks,
) {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)
    || JSON.stringify(Object.keys(hooks).sort())
      !== JSON.stringify(["failAfterManifestWrite", "failAfterProofWrite"])
    || typeof hooks.failAfterManifestWrite !== "boolean"
    || typeof hooks.failAfterProofWrite !== "boolean") {
    throw new Error("Chatwoot evidence finalization test hooks are invalid.");
  }
  return finalizeEvidence({ state, proof }, hooks);
}

async function finalizeEvidence({ state, proof }, hooks) {
  const owned = assertWritableState(state);
  await assertEvidenceFilesystemIdentity(state);
  const exactProof = assertChatwootPhaseProof(structuredClone(proof));
  const expectedPaths = expectedChatwootScreenshotPaths();
  if (
    owned.artifacts.size !== expectedPaths.length
    || expectedPaths.some((entry) => !owned.artifacts.has(entry))
  ) {
    throw new Error("Chatwoot proof requires all eighteen raw screenshot artifacts.");
  }
  await assertExactInventory(owned.directory, ["raw"], "pre-finalization evidence root");
  await assertExactInventory(
    owned.rawDirectory,
    expectedPaths.map((entry) => path.basename(entry)),
    "raw screenshot inventory",
  );
  const rereadArtifacts = new Map();
  for (const relativePath of expectedPaths) {
    const target = path.join(owned.directory, ...relativePath.split("/"));
    await assertPrivatePermissions(target, false);
    const observedFile = await readStablePrivateFile(target, "raw Chatwoot PNG");
    const bytes = observedFile.bytes;
    assertPng(bytes);
    const artifact = Object.freeze({
      relativePath,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
    const prior = owned.artifacts.get(relativePath);
    const priorIdentity = owned.artifactIdentities.get(relativePath);
    if (
      !prior
      || !priorIdentity
      || !sameIdentity(priorIdentity, observedFile.identity)
      || prior.byteLength !== artifact.byteLength
      || prior.sha256 !== artifact.sha256
    ) {
      throw new Error("Raw Chatwoot PNG changed after its create-only write.");
    }
    rereadArtifacts.set(relativePath, artifact);
  }
  for (const pair of exactProof.pairs) {
    for (const role of roles) {
      for (const phase of CHATWOOT_PHASE_SCREENSHOT_NAMES) {
        const relativePath = screenshotRelativePath(pair.pairIndex, role, phase);
        const artifact = rereadArtifacts.get(relativePath);
        const screenshot = pair.stacks[role].phases[phase].screenshot;
        if (
          artifact.byteLength !== screenshot.byteLength
          || artifact.sha256 !== screenshot.sha256
        ) {
          throw new Error("Raw Chatwoot PNG does not match its proof screenshot digest.");
        }
      }
    }
  }
  const proofBytes = Buffer.from(`${JSON.stringify(exactProof, null, 2)}\n`, "utf8");
  const proofPath = path.join(owned.directory, "proof.json");
  await assertEvidenceFilesystemIdentity(state);
  const writtenProof = await writePrivateFile(state, "proof.json", proofPath, proofBytes);
  owned.artifactIdentities.set("proof.json", writtenProof.identity);
  await refreshOwnedDirectoryIdentity(state, "root");
  if (hooks.failAfterProofWrite) {
    throw new Error("Injected failure after Chatwoot proof write.");
  }
  await assertExactInventory(
    owned.directory,
    ["proof.json", "raw"],
    "pre-manifest evidence root",
  );
  const entries = [
    {
      path: "proof.json",
      byteLength: proofBytes.byteLength,
      sha256: sha256(proofBytes),
    },
    ...[...rereadArtifacts.values()].map((artifact) => ({
      path: artifact.relativePath,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const aggregateSha256 = sha256(Buffer.from(entries.map((entry) => (
    `${entry.path}\0${entry.byteLength}\0${entry.sha256}\n`
  )).join(""), "utf8"));
  const manifest = {
    schemaVersion: 1,
    kind: "clean-pay-chatwoot-phase-proof-artifact-manifest",
    artifactCount: entries.length,
    aggregateSha256,
    entries,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestPath = path.join(owned.directory, "artifact-manifest.json");
  await assertEvidenceFilesystemIdentity(state);
  const writtenManifest = await writePrivateFile(
    state,
    "artifact-manifest.json",
    manifestPath,
    manifestBytes,
  );
  owned.artifactIdentities.set("artifact-manifest.json", writtenManifest.identity);
  await refreshOwnedDirectoryIdentity(state, "root");
  if (hooks.failAfterManifestWrite) {
    throw new Error("Injected failure after Chatwoot manifest write.");
  }
  await assertExactInventory(
    owned.directory,
    ["artifact-manifest.json", "proof.json", "raw"],
    "final evidence root",
  );
  const [observedProofFile, observedManifestFile] = await Promise.all([
    readStablePrivateFile(proofPath, "Chatwoot proof"),
    readStablePrivateFile(manifestPath, "Chatwoot artifact manifest"),
  ]);
  const observedProof = observedProofFile.bytes;
  const observedManifest = observedManifestFile.bytes;
  if (!observedProof.equals(proofBytes) || !observedManifest.equals(manifestBytes)) {
    throw new Error("Chatwoot proof or manifest bytes changed after final write.");
  }
  if (!sameIdentity(writtenProof.identity, observedProofFile.identity)
    || !sameIdentity(writtenManifest.identity, observedManifestFile.identity)) {
    throw new Error("Chatwoot proof or manifest file identity changed after create-only write.");
  }
  await assertExactInventory(
    owned.rawDirectory,
    expectedPaths.map((entry) => path.basename(entry)),
    "final raw screenshot inventory",
  );
  for (const relativePath of expectedPaths) {
    const finalFile = await readStablePrivateFile(
      path.join(owned.directory, ...relativePath.split("/")),
      "final raw Chatwoot PNG",
    );
    assertPng(finalFile.bytes);
    const artifact = rereadArtifacts.get(relativePath);
    const identity = owned.artifactIdentities.get(relativePath);
    if (!artifact || !identity || !sameIdentity(identity, finalFile.identity)
      || artifact.byteLength !== finalFile.bytes.byteLength
      || artifact.sha256 !== finalFile.contentSha256) {
      throw new Error("Raw Chatwoot PNG changed before final manifest seal.");
    }
  }
  await assertEvidenceFilesystemIdentity(state);
  owned.finalized = true;
  return Object.freeze({
    proofSha256: sha256(proofBytes),
    manifestSha256: sha256(manifestBytes),
    artifactCount: entries.length,
    aggregateSha256,
  });
}

export async function abortChatwootPhaseEvidence({ state }) {
  const owned = assertWritableState(state);
  const expectedScreenshotNames = expectedChatwootScreenshotPaths().map((relativePath) => (
    path.basename(relativePath)
  )).sort();
  const rawEntries = await readdir(owned.rawDirectory, { withFileTypes: true });
  if (rawEntries.some((entry) => !entry.isFile())
    || rawEntries.some((entry) => !expectedScreenshotNames.includes(entry.name))) {
    throw new Error("Chatwoot abort refused an unowned raw evidence entry.");
  }
  const rootEntries = await readdir(owned.directory, { withFileTypes: true });
  const allowedRootFiles = new Set(["artifact-manifest.json", "proof.json"]);
  if (rootEntries.some((entry) => (
    entry.name === "raw" ? !entry.isDirectory()
      : !entry.isFile() || !allowedRootFiles.has(entry.name)
  ))) {
    throw new Error("Chatwoot abort refused an unowned evidence-root entry.");
  }
  const rawFiles = [];
  for (const entry of rawEntries) {
    const relativePath = `raw/${entry.name}`;
    const target = path.join(owned.rawDirectory, entry.name);
    const observed = await capturePathIdentity(target, "abort raw evidence", "file");
    const expected = owned.artifactIdentities.get(relativePath);
    if (!expected || !sameIdentity(expected, observed)) {
      throw new Error("Chatwoot abort raw evidence identity changed.");
    }
    rawFiles.push(target);
  }
  const rootFiles = [];
  for (const entry of rootEntries) {
    if (entry.name === "raw") continue;
    const target = path.join(owned.directory, entry.name);
    const observed = await capturePathIdentity(target, "abort evidence artifact", "file");
    const expected = owned.artifactIdentities.get(entry.name);
    if (!expected || !sameIdentity(expected, observed)) {
      throw new Error("Chatwoot abort evidence artifact identity changed.");
    }
    rootFiles.push(target);
  }
  for (const target of [...rawFiles, ...rootFiles]) await unlink(target);
  await refreshOwnedDirectoryIdentity(state, "raw");
  await refreshOwnedDirectoryIdentity(state, "root");
  await assertEvidenceFilesystemIdentity(state);
  const rawIdentity = await capturePathIdentity(
    owned.rawDirectory,
    "abort raw evidence directory",
    "directory",
  );
  const rootIdentity = await capturePathIdentity(
    owned.directory,
    "abort evidence root",
    "directory",
  );
  if (!sameObjectIdentity(owned.raw, rawIdentity)
    || !sameObjectIdentity(owned.root, rootIdentity)) {
    throw new Error("Chatwoot abort evidence directory identity changed.");
  }
  await rmdir(owned.rawDirectory);
  await rmdir(owned.directory);
  owned.aborted = true;
  owned.finalized = true;
  return Object.freeze({ status: "exact-owned-evidence-root-aborted" });
}

export function expectedChatwootScreenshotPaths() {
  return Array.from({ length: CHATWOOT_PHASE_PROOF_PAIR_COUNT }, (_, index) => index + 1)
    .flatMap((pairIndex) => roles.flatMap((role) => (
      CHATWOOT_PHASE_SCREENSHOT_NAMES.map((phase) => (
        screenshotRelativePath(pairIndex, role, phase)
      ))
    )));
}

function screenshotRelativePath(pairIndex, role, phase) {
  return `raw/pair-${pairIndex}-${role}-${phase}.png`;
}

function assertPairRolePhase(pairIndex, role, phase) {
  if (
    !Number.isSafeInteger(pairIndex)
    || pairIndex < 1
    || pairIndex > CHATWOOT_PHASE_PROOF_PAIR_COUNT
    || !roles.includes(role)
    || !CHATWOOT_PHASE_SCREENSHOT_NAMES.includes(phase)
  ) {
    throw new Error("Chatwoot screenshot role/pair/phase is invalid.");
  }
}

function assertWritableState(state) {
  const owned = state && typeof state === "object"
    ? privateEvidenceStates.get(state)
    : undefined;
  if (!owned || !Object.isFrozen(state) || owned.finalized !== false || owned.aborted !== false
    || !(owned.artifacts instanceof Map) || !(owned.artifactIdentities instanceof Map)
    || typeof owned.directory !== "string" || typeof owned.rawDirectory !== "string"
    || state.directory !== owned.directory || state.rawDirectory !== owned.rawDirectory
    || JSON.stringify(Object.keys(state).sort())
      !== JSON.stringify(["directory", "rawDirectory"])) {
    throw new Error("Chatwoot evidence writer state is invalid or finalized.");
  }
  return owned;
}

async function cleanupPartialEvidenceRoot({ rawIdentity, rootIdentity, target }) {
  const errors = [];
  if (rawIdentity) {
    try {
      const observed = await capturePathIdentity(
        rawIdentity.realpath,
        "partial raw evidence directory",
        "directory",
      );
      if (!sameObjectIdentity(rawIdentity, observed)) {
        throw new Error("Partial raw evidence directory identity changed before cleanup.");
      }
      await rmdir(rawIdentity.realpath);
    } catch (error) {
      errors.push(error);
    }
  }
  if (rootIdentity && errors.length === 0) {
    try {
      const observed = await capturePathIdentity(
        rootIdentity.realpath,
        "partial evidence root",
        "directory",
      );
      if (!sameObjectIdentity(rootIdentity, observed)
        || normalizePath(rootIdentity.realpath) !== normalizePath(path.resolve(target))) {
        throw new Error("Partial evidence root identity changed before cleanup.");
      }
      await rmdir(rootIdentity.realpath);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function writePrivateFile(state, relativePath, target, bytes) {
  const owned = assertWritableState(state);
  if (typeof relativePath !== "string" || relativePath.length < 1
    || owned.artifactIdentities.has(relativePath)) {
    throw new Error("Chatwoot evidence output identity is duplicated or invalid.");
  }
  const receipt = await writeJourneySanitizedOutput(target, bytes);
  const createdIdentity = await capturePathIdentity(
    target,
    "new Chatwoot evidence file",
    "file",
  );
  owned.artifactIdentities.set(relativePath, createdIdentity);
  await setAndAssertPrivatePermissions(target, false);
  const identity = await capturePathIdentity(
    target,
    "private Chatwoot evidence file",
    "file",
  );
  if (!sameObjectIdentity(createdIdentity, identity)
    || createdIdentity.size !== identity.size) {
    throw new Error("Chatwoot evidence identity changed while enforcing private permissions.");
  }
  owned.artifactIdentities.set(relativePath, identity);
  const observed = await readStablePrivateFile(target, "new Chatwoot evidence file");
  if (!observed.bytes.equals(bytes)
    || observed.contentSha256 !== receipt.sha256
    || observed.bytes.byteLength !== receipt.bytes
    || !sameIdentity(identity, observed.identity)) {
    throw new Error("Chatwoot evidence bytes changed during create-only write.");
  }
  return observed;
}

async function assertExactInventory(directory, expected, label) {
  const entries = await readdir(directory, { withFileTypes: true });
  const actual = entries.map((entry) => entry.name).sort();
  const exact = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(exact)) {
    throw new Error(`${label} is not exact.`);
  }
}

async function captureAncestorIdentities(directory) {
  const identities = [];
  let current = path.resolve(directory);
  while (true) {
    identities.push(await capturePathIdentity(
      current,
      "evidence ancestor",
      "directory",
      false,
    ));
    const parent = path.dirname(current);
    if (normalizePath(parent) === normalizePath(current)) break;
    current = parent;
  }
  return identities;
}

async function assertEvidenceFilesystemIdentity(state) {
  const expected = privateEvidenceStates.get(state);
  if (!expected) throw new Error("Chatwoot evidence filesystem identity is absent.");
  for (const [index, identity] of expected.ancestors.entries()) {
    const observed = await capturePathIdentity(
      identity.realpath,
      "evidence ancestor",
      "directory",
      false,
    );
    // Broad OS ancestors are shared and their ctime legitimately changes when
    // unrelated processes create siblings. Their live FileHandle/dev/inode/
    // realpath identity is exact; the proof-owned immediate parent additionally
    // keeps an exact ctime boundary.
    if (!sameObjectIdentity(identity, observed)
      || (index === 0 && identity.ctimeMs !== observed.ctimeMs)) {
      throw new Error(`Chatwoot evidence ancestor ${index} identity changed.`);
    }
  }
  for (const name of ["root", "raw"]) {
    const identity = expected[name];
    const observed = await capturePathIdentity(
      identity.realpath,
      `Chatwoot evidence ${name}`,
      "directory",
    );
    if (!sameIdentity(identity, observed)) {
      throw new Error(`Chatwoot evidence ${name} identity changed.`);
    }
  }
}

async function refreshOwnedDirectoryIdentity(state, name) {
  const expected = privateEvidenceStates.get(state);
  if (!expected || !["root", "raw"].includes(name)) {
    throw new Error("Chatwoot owned evidence directory identity is invalid.");
  }
  const prior = expected[name];
  const observed = await capturePathIdentity(
    prior.realpath,
    `Chatwoot evidence ${name}`,
    "directory",
  );
  if (!sameObjectIdentity(prior, observed) || observed.ctimeMs < prior.ctimeMs) {
    throw new Error(`Chatwoot evidence ${name} was replaced during an owned mutation.`);
  }
  expected[name] = observed;
}

async function readStablePrivateFile(target, label) {
  const before = await capturePathIdentity(target, label, "file");
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(target, fsConstants.O_RDONLY | noFollow);
  let bytes;
  let handleBefore;
  let handleAfter;
  try {
    handleBefore = identityFromMetadata(await handle.stat(), before.realpath, "file");
    if (!sameIdentity(before, handleBefore)) {
      throw new Error(`${label} path and FileHandle identity differ.`);
    }
    bytes = await handle.readFile();
    const repeated = await readFileHandleAtPosition(handle, bytes.byteLength, label);
    if (!bytes.equals(repeated)) {
      throw new Error(`${label} content changed between exact FileHandle reads.`);
    }
    handleAfter = identityFromMetadata(await handle.stat(), before.realpath, "file");
  } finally {
    await handle.close();
  }
  const after = await capturePathIdentity(target, label, "file");
  if (!sameIdentity(before, handleAfter) || !sameIdentity(before, after)
    || bytes.byteLength !== before.size) {
    throw new Error(`${label} changed during its stable FileHandle read.`);
  }
  return Object.freeze({
    bytes,
    contentSha256: sha256(bytes),
    identity: before,
  });
}

async function readFileHandleAtPosition(handle, size, label) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (bytesRead < 1) throw new Error(`${label} FileHandle ended before its exact size.`);
    offset += bytesRead;
  }
  return bytes;
}

async function capturePathIdentity(target, label, kind, requireStableMetadata = true) {
  const requested = path.resolve(target);
  const beforeMetadata = await lstat(requested);
  if (beforeMetadata.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link or junction.`);
  }
  const resolved = await realpath(requested);
  if (normalizePath(resolved) !== normalizePath(requested)) {
    throw new Error(`${label} realpath changed or traversed a link.`);
  }
  const before = identityFromMetadata(beforeMetadata, resolved, kind);
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(requested, fsConstants.O_RDONLY | noFollow);
  let handleIdentity;
  try {
    handleIdentity = identityFromMetadata(await handle.stat(), resolved, kind);
  } finally {
    await handle.close();
  }
  const afterMetadata = await lstat(requested);
  if (afterMetadata.isSymbolicLink()) {
    throw new Error(`${label} changed into a symbolic link or junction.`);
  }
  const afterResolved = await realpath(requested);
  const after = identityFromMetadata(afterMetadata, afterResolved, kind);
  const sameAttestedIdentity = requireStableMetadata ? sameIdentity : sameObjectIdentity;
  if (!sameAttestedIdentity(before, handleIdentity)
    || !sameAttestedIdentity(before, after)) {
    throw new Error(`${label} path/FileHandle identity changed during attestation.`);
  }
  // Shared operating-system ancestors can acquire a new ctime/size while an
  // unrelated process creates a sibling. Their returned ctime is still bound
  // to the exact post-FileHandle object; owned roots/files use the strict path.
  return requireStableMetadata ? before : after;
}

function identityFromMetadata(metadata, resolved, kind) {
  if ((kind === "directory" && !metadata.isDirectory())
    || (kind === "file" && !metadata.isFile())
    || !Number.isFinite(metadata.ctimeMs) || metadata.ctimeMs < 0
    || !Number.isFinite(metadata.size) || metadata.size < 0) {
    throw new Error("Chatwoot evidence path identity has an invalid filesystem type.");
  }
  return Object.freeze({
    ctimeMs: metadata.ctimeMs,
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    kind,
    realpath: path.resolve(resolved),
    size: metadata.size,
  });
}

function sameIdentity(left, right) {
  return sameObjectIdentity(left, right)
    && left.ctimeMs === right.ctimeMs
    && left.size === right.size;
}

function sameObjectIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.kind === right.kind
    && normalizePath(left.realpath) === normalizePath(right.realpath);
}

function assertPng(buffer) {
  if (
    buffer.byteLength <= PNG_SIGNATURE.byteLength
    || buffer.byteLength > MAX_SCREENSHOT_BYTES
    || !buffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
  ) {
    throw new Error("Chatwoot screenshot violates its bounded PNG byte contract.");
  }
  let offset = PNG_SIGNATURE.byteLength;
  let chunkIndex = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  let imageDataEnded = false;
  let width;
  let height;
  let channelCount;
  const imageData = [];
  while (offset < buffer.byteLength) {
    if (offset + 12 > buffer.byteLength) {
      throw new Error("Chatwoot PNG has a truncated chunk header.");
    }
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buffer.byteLength) throw new Error("Chatwoot PNG chunk exceeds its file bound.");
    const type = buffer.subarray(typeStart, dataStart).toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("Chatwoot PNG chunk type is invalid.");
    if (!["IHDR", "IDAT", "IEND"].includes(type)) {
      throw new Error("Chatwoot PNG contains a non-whitelisted or metadata chunk.");
    }
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(typeStart, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error("Chatwoot PNG chunk CRC is invalid.");
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) throw new Error("Chatwoot PNG lacks an exact IHDR.");
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      if (width !== SCREENSHOT_WIDTH || height !== SCREENSHOT_HEIGHT) {
        throw new Error("Chatwoot PNG dimensions do not match the exact 1440x900 viewport.");
      }
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      const compression = buffer[dataStart + 10];
      const filter = buffer[dataStart + 11];
      const interlace = buffer[dataStart + 12];
      if (
        bitDepth !== 8
        || ![2, 6].includes(colorType)
        || compression !== 0
        || filter !== 0
        || interlace !== 0
      ) {
        throw new Error("Chatwoot PNG raster encoding is outside the exact screenshot contract.");
      }
      channelCount = colorType === 2 ? 3 : 4;
      sawHeader = true;
    } else if (type === "IHDR") {
      throw new Error("Chatwoot PNG contains a duplicate IHDR.");
    }
    if (type === "IDAT") {
      if (!sawHeader || sawEnd || imageDataEnded || length === 0) {
        throw new Error("Chatwoot PNG IDAT sequence is not exact and contiguous.");
      }
      sawImageData = true;
      imageData.push(buffer.subarray(dataStart, dataEnd));
    } else if (sawImageData && type !== "IEND") {
      imageDataEnded = true;
    }
    if (type === "IEND") {
      if (!sawImageData || sawEnd || length !== 0 || crcEnd !== buffer.byteLength) {
        throw new Error("Chatwoot PNG has an invalid terminal IEND.");
      }
      sawEnd = true;
    }
    offset = crcEnd;
    chunkIndex += 1;
  }
  if (!sawHeader || !sawImageData || !sawEnd) {
    throw new Error("Chatwoot PNG is missing required chunks.");
  }
  let raster;
  try {
    raster = inflateSync(Buffer.concat(imageData), {
      maxOutputLength: height * ((width * channelCount) + 1),
    });
  } catch {
    throw new Error("Chatwoot PNG image data is not a decodable bounded raster.");
  }
  const rowBytes = (width * channelCount) + 1;
  if (
    raster.byteLength !== height * rowBytes
    || Array.from({ length: height }, (_, index) => raster[index * rowBytes])
      .some((filterType) => filterType > 4)
  ) {
    throw new Error("Chatwoot PNG raster rows do not match its IHDR.");
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function setAndAssertPrivatePermissions(target, directory) {
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$targetPath = $env:CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET",
      "$kind = $env:CLEAN_PAY_CHATWOOT_EVIDENCE_KIND",
      "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
      "if ($kind -eq 'directory') {",
      "  $acl = New-Object System.Security.AccessControl.DirectorySecurity",
      "  $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'",
      "} else {",
      "  $acl = New-Object System.Security.AccessControl.FileSecurity",
      "  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None",
      "}",
      "$acl.SetOwner($sid)",
      "$acl.SetAccessRuleProtection($true, $false)",
      "$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)",
      "$acl.AddAccessRule($rule)",
      "Set-Acl -LiteralPath $targetPath -AclObject $acl",
    ].join("\n");
    await execFileAsync(
      windowsPowerShellExecutable(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 16 * 1024,
        env: windowsPowerShellEnvironment({
          CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET: target,
          CLEAN_PAY_CHATWOOT_EVIDENCE_KIND: directory ? "directory" : "file",
        }),
      },
    );
  } else {
    await chmod(target, directory ? 0o700 : 0o600);
  }
  await assertPrivatePermissions(target, directory);
}

async function assertPrivatePermissions(target, directory) {
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$acl = Get-Acl -LiteralPath $env:CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET",
      "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      "$kind = $env:CLEAN_PAY_CHATWOOT_EVIDENCE_KIND",
      "$rules = @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))",
      "if (-not $acl.AreAccessRulesProtected) { exit 11 }",
      "if ($rules.Count -ne 1) { exit 12 }",
      "if ($rules[0].IdentityReference.Value -ne $sid) { exit 13 }",
      "if ($rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { exit 14 }",
      "if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid) { exit 15 }",
      "$full = [System.Security.AccessControl.FileSystemRights]::FullControl",
      "if (($rules[0].FileSystemRights -band $full) -ne $full) { exit 16 }",
      "if ($rules[0].IsInherited) { exit 17 }",
      "if ($rules[0].PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None) { exit 18 }",
      "if ($kind -eq 'directory') {",
      "  $expectedInheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'",
      "} else {",
      "  $expectedInheritance = [System.Security.AccessControl.InheritanceFlags]::None",
      "}",
      "if ($rules[0].InheritanceFlags -ne $expectedInheritance) { exit 19 }",
    ].join("\n");
    await execFileAsync(
      windowsPowerShellExecutable(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 16 * 1024,
        env: windowsPowerShellEnvironment({
          CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET: target,
          CLEAN_PAY_CHATWOOT_EVIDENCE_KIND: directory ? "directory" : "file",
        }),
      },
    );
    return;
  }
  const metadata = await stat(target);
  const expected = directory ? 0o700 : 0o600;
  if ((metadata.mode & 0o777) !== expected) {
    throw new Error("Chatwoot evidence permissions are not owner-only.");
  }
}

function windowsPowerShellExecutable() {
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot)) {
    throw new Error("Windows SystemRoot is unavailable for private ACL verification.");
  }
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function chatwootWindowsPowerShellEnvironmentForTest(extra) {
  return windowsPowerShellEnvironment(extra);
}

function windowsPowerShellEnvironment(extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)
    || JSON.stringify(Object.keys(extra).sort()) !== JSON.stringify([
      "CLEAN_PAY_CHATWOOT_EVIDENCE_KIND",
      "CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET",
    ])
    || !["directory", "file"].includes(extra.CLEAN_PAY_CHATWOOT_EVIDENCE_KIND)
    || typeof extra.CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET !== "string"
    || !path.isAbsolute(extra.CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET)) {
    throw new Error("Chatwoot PowerShell environment input is invalid.");
  }
  const environment = {};
  for (const name of ["ComSpec", "SystemDrive", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (typeof process.env[name] === "string" && process.env[name].length > 0) {
      environment[name] = process.env[name];
    }
  }
  return { ...environment, ...extra };
}

async function exactDirectory(directory, label) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new Error(`${label} must be an absolute directory.`);
  }
  const requested = path.resolve(directory);
  const metadata = await lstat(requested);
  const resolved = await realpath(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || normalizePath(resolved) !== normalizePath(requested)) {
    throw new Error(`${label} must be a real directory.`);
  }
  await capturePathIdentity(requested, label, "directory");
  return resolved;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizePath(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
