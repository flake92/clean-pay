import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const JOURNEY_GENERATED_ENVIRONMENT_FILENAMES = Object.freeze([
  ".env",
  ".env.app",
  ".env.browser-observer",
  ".env.browser-observer-provision",
  ".env.hold-operator",
  ".env.migration",
  ".env.postgres",
  ".env.provision",
  ".env.reconciliation",
  ".env.retention",
  "browser-journey-contract.json",
]);

const OWNER_FILENAME = ".clean-pay-browser-journey-generated-owner.json";
const PROJECT_PATTERN = /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_OWNER_BYTES = 4_096;
const MAX_CONTRACT_BYTES = 64 * 1_024;

export async function prepareGeneratedEnvironmentDirectory({ directory, project }) {
  const resolvedDirectory = validateDirectory(directory);
  validateProject(project);
  const projectSha256 = sha256(project);
  let directoryCreatedByRun = false;

  try {
    const stat = await lstat(resolvedDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Journey environment destination must be a real directory.");
    }
    const entries = await readdir(resolvedDirectory);
    if (entries.length !== 0) {
      throw new Error("Journey environment destination must be empty before generation.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(resolvedDirectory, { mode: 0o700, recursive: false });
    directoryCreatedByRun = true;
  }

  await chmod(resolvedDirectory, 0o700).catch(() => undefined);
  const realDirectory = await exactRealDirectory(resolvedDirectory);
  const nonce = randomBytes(32).toString("hex");
  const owner = {
    schemaVersion: 1,
    kind: "clean-pay-browser-journey-generated-environment-owner",
    projectSha256,
    directorySha256: sha256(normalizePath(realDirectory)),
    nonceSha256: sha256(nonce),
  };
  const ownerPath = path.join(realDirectory, OWNER_FILENAME);
  try {
    await writePrivateJson(ownerPath, owner);
  } catch (error) {
    await unlink(ownerPath).catch((cleanupError) => {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    });
    if (directoryCreatedByRun && (await readdir(realDirectory)).length === 0) {
      await rmdir(realDirectory);
    }
    throw error;
  }

  return Object.freeze({
    directory: resolvedDirectory,
    realDirectory,
    projectSha256,
    directorySha256: owner.directorySha256,
    nonce,
    directoryCreatedByRun,
  });
}

export async function cleanupGeneratedEnvironment(state) {
  assertState(state);
  const realDirectory = await exactRealDirectory(state.directory);
  if (normalizePath(realDirectory) !== normalizePath(state.realDirectory)) {
    throw new Error("Journey environment destination changed after preparation.");
  }
  const expectedOwner = {
    schemaVersion: 1,
    kind: "clean-pay-browser-journey-generated-environment-owner",
    projectSha256: state.projectSha256,
    directorySha256: state.directorySha256,
    nonceSha256: sha256(state.nonce),
  };
  await assertOwner(realDirectory, expectedOwner);
  await removeExactGeneratedFiles(realDirectory, true);
  await unlink(path.join(realDirectory, OWNER_FILENAME));
  await assertDirectoryEmpty(realDirectory);
  if (state.directoryCreatedByRun) await rmdir(realDirectory);

  return Object.freeze({
    status: "generated_environment_cleaned",
    projectSha256: state.projectSha256,
    directorySha256: state.directorySha256,
    directoryRemoved: state.directoryCreatedByRun,
  });
}

export async function cleanupRetainedGeneratedEnvironment({ directory, project }) {
  const resolvedDirectory = validateDirectory(directory);
  validateProject(project);
  const realDirectory = await exactRealDirectory(resolvedDirectory);
  const projectSha256 = sha256(project);
  const directorySha256 = sha256(normalizePath(realDirectory));
  const entries = await readdir(realDirectory);
  if (entries.length === 0) {
    return Object.freeze({
      status: "retained_generated_environment_already_clean",
      projectSha256,
      directorySha256,
      directoryRemoved: false,
    });
  }
  const hasOwner = entries.includes(OWNER_FILENAME);

  if (hasOwner) {
    const owner = await readBoundedJson(
      path.join(realDirectory, OWNER_FILENAME),
      MAX_OWNER_BYTES,
      "Journey environment owner",
    );
    assertExactKeys(owner, [
      "directorySha256",
      "kind",
      "nonceSha256",
      "projectSha256",
      "schemaVersion",
    ], "Journey environment owner");
    if (
      owner.schemaVersion !== 1
      || owner.kind !== "clean-pay-browser-journey-generated-environment-owner"
      || owner.projectSha256 !== projectSha256
      || owner.directorySha256 !== directorySha256
      || !SHA256_PATTERN.test(owner.nonceSha256 ?? "")
    ) {
      throw new Error("Journey environment owner does not match the cleanup request.");
    }
  } else {
    await assertLegacyContractOwnership(realDirectory, project);
  }

  await removeExactGeneratedFiles(realDirectory, hasOwner);
  if (hasOwner) await unlink(path.join(realDirectory, OWNER_FILENAME));
  await assertDirectoryEmpty(realDirectory);

  return Object.freeze({
    status: "retained_generated_environment_cleaned",
    projectSha256,
    directorySha256,
    directoryRemoved: false,
  });
}

export function sanitizedJourneyContractEvidence(contract) {
  assertSyntheticJourneyContract(contract);
  return {
    schemaVersion: 1,
    kind: "clean-pay-production-image-journey-sanitized-contract",
    projectSha256: sha256(contract.project),
    revision: contract.revision,
    applicationImageReferenceSha256: sha256(contract.images.application),
    migrationImageReferenceSha256: sha256(contract.images.migration),
    publicBuildContract: structuredClone(contract.publicBuildContract),
    fixtureContract: structuredClone(contract.fixtureContract),
    publicationsSha256: sha256(stableJson(contract.publications)),
    ownedStateResetSha256: sha256(stableJson(contract.ownedStateReset)),
  };
}

export async function writeSanitizedJourneyContractEvidence({ contract, repositoryRoot }) {
  const evidence = sanitizedJourneyContractEvidence(contract);
  const evidenceDirectory = path.join(
    path.resolve(repositoryRoot),
    "test-results",
    "browser-journey-contract-evidence",
  );
  await mkdir(evidenceDirectory, { mode: 0o700, recursive: true });
  await chmod(evidenceDirectory, 0o700).catch(() => undefined);
  const target = path.join(evidenceDirectory, `${evidence.projectSha256}.json`);
  await writePrivateJson(target, evidence);
  return Object.freeze({ target, evidence });
}

async function assertLegacyContractOwnership(directory, project) {
  const entries = (await readdir(directory)).sort();
  if (
    JSON.stringify(entries)
    !== JSON.stringify([...JOURNEY_GENERATED_ENVIRONMENT_FILENAMES].sort())
  ) {
    throw new Error("Unmarked journey environment does not match the exact legacy file set.");
  }
  const contract = await readBoundedJson(
    path.join(directory, "browser-journey-contract.json"),
    MAX_CONTRACT_BYTES,
    "Legacy journey contract",
  );
  if (
    contract?.schemaVersion !== 1
    || contract?.kind !== "self-contained-synthetic-browser-journey"
    || contract?.project !== project
  ) {
    throw new Error("Legacy journey contract does not prove exact project ownership.");
  }
}

async function removeExactGeneratedFiles(directory, ownerExpected) {
  const entries = (await readdir(directory)).sort();
  const allowed = new Set([
    ...JOURNEY_GENERATED_ENVIRONMENT_FILENAMES,
    ...(ownerExpected ? [OWNER_FILENAME] : []),
  ]);
  const unexpected = entries.filter((entry) => !allowed.has(entry));
  for (const filename of JOURNEY_GENERATED_ENVIRONMENT_FILENAMES) {
    if (!entries.includes(filename)) continue;
    const target = path.join(directory, filename);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Journey generated entry is not a regular file: ${filename}`);
    }
  }
  for (const filename of JOURNEY_GENERATED_ENVIRONMENT_FILENAMES) {
    if (entries.includes(filename)) await unlink(path.join(directory, filename));
  }
  if (unexpected.length > 0) {
    throw new Error("Journey environment contains an unexpected entry; exact files were cleaned only.");
  }
}

function assertSyntheticJourneyContract(contract) {
  assertExactKeys(contract, [
    "fixtureContract",
    "images",
    "kind",
    "ownedStateReset",
    "project",
    "publicBuildContract",
    "publications",
    "revision",
    "schemaVersion",
    "secretSource",
  ], "Synthetic journey contract");
  validateProject(contract.project);
  assertExactKeys(contract.images, ["application", "migration"], "Synthetic journey images");
  assertExactKeys(
    contract.publicBuildContract,
    ["sha256", "version"],
    "Synthetic journey public build contract",
  );
  assertExactKeys(
    contract.fixtureContract,
    ["domain", "sha256"],
    "Synthetic journey fixture contract",
  );
  assertExactKeys(
    contract.publications,
    ["app", "browserTls", "connectProxy", "providerControl"],
    "Synthetic journey publications",
  );
  assertExactKeys(
    contract.ownedStateReset,
    ["postgres", "redis", "scope"],
    "Synthetic journey reset contract",
  );
  if (
    contract.schemaVersion !== 1
    || contract.kind !== "self-contained-synthetic-browser-journey"
    || !/^[a-f0-9]{40}$/.test(contract.revision ?? "")
    || typeof contract.images.application !== "string"
    || typeof contract.images.migration !== "string"
    || contract.images.application.length === 0
    || contract.images.migration.length === 0
    || contract.publicBuildContract.version !== "1"
    || !SHA256_PATTERN.test(contract.publicBuildContract.sha256 ?? "")
    || contract.fixtureContract.domain !== "clean-pay-browser-journey-fixture-v5"
    || !SHA256_PATTERN.test(contract.fixtureContract.sha256 ?? "")
    || contract.secretSource
      !== "deterministic synthetic fixture labels; no external env or credential file"
    || !Object.values(contract.publications).every((value) => typeof value === "string")
    || !Object.values(contract.ownedStateReset).every((value) => typeof value === "string")
  ) {
    throw new Error("Synthetic journey contract cannot be sanitized safely.");
  }
}

async function assertOwner(directory, expected) {
  const owner = await readBoundedJson(
    path.join(directory, OWNER_FILENAME),
    MAX_OWNER_BYTES,
    "Journey environment owner",
  );
  assertExactKeys(owner, [
    "directorySha256",
    "kind",
    "nonceSha256",
    "projectSha256",
    "schemaVersion",
  ], "Journey environment owner");
  if (JSON.stringify(owner) !== JSON.stringify(expected)) {
    throw new Error("Journey environment owner changed after preparation.");
  }
}

async function readBoundedJson(filename, limit, label) {
  const metadata = await lstat(filename);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size <= 0
    || metadata.size > limit
  ) {
    throw new Error(`${label} exceeds its bounded regular-file contract.`);
  }
  const bytes = await readFile(filename);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > limit) {
    throw new Error(`${label} exceeds its bounded contract.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function writePrivateJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(target, 0o600).catch(() => undefined);
}

async function exactRealDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Journey environment destination must remain a real directory.");
  }
  return realpath(directory);
}

async function assertDirectoryEmpty(directory) {
  if ((await readdir(directory)).length !== 0) {
    throw new Error("Journey environment destination is not empty after exact cleanup.");
  }
}

function validateDirectory(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new Error("Journey environment destination must be an absolute path.");
  }
  const resolved = path.resolve(directory);
  if (normalizePath(resolved) === normalizePath(path.parse(resolved).root)) {
    throw new Error("Journey environment destination cannot be a filesystem root.");
  }
  return resolved;
}

function validateProject(project) {
  if (typeof project !== "string" || !PROJECT_PATTERN.test(project)) {
    throw new Error("Journey Compose project is invalid.");
  }
}

function assertState(value) {
  if (
    !value
    || typeof value !== "object"
    || !path.isAbsolute(value.directory ?? "")
    || !path.isAbsolute(value.realDirectory ?? "")
    || !SHA256_PATTERN.test(value.projectSha256 ?? "")
    || !SHA256_PATTERN.test(value.directorySha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(value.nonce ?? "")
    || typeof value.directoryCreatedByRun !== "boolean"
  ) {
    throw new Error("Journey generated-environment state is invalid.");
  }
}

function assertExactKeys(value, keys, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function normalizePath(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Synthetic contract object is invalid.");
  }
  return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ));
}
