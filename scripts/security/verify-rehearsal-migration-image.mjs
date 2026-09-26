#!/usr/bin/env node

import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateDeploymentImageReferences } from "../../runtime/production-env-rules.mjs";

const MAXIMUM_INSPECTION_BYTES = 1024 * 1024;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTRACT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EXPECTED_KEYS = Object.freeze([
  "imageId",
  "imageReference",
  "publicBuildContractSha256",
  "publicBuildContractVersion",
  "release",
  "revision",
]);

export function verifyRehearsalMigrationImageInspection(inspection, expected) {
  exactKeys(expected, EXPECTED_KEYS, "expected migration image contract");
  const imageId = exactString(expected.imageId, IMAGE_ID, "expected migration image ID");
  const revision = exactString(expected.revision, REVISION, "expected migration revision");
  const release = exactString(expected.release, RELEASE, "expected migration release");
  const publicBuildContractVersion = exactString(
    expected.publicBuildContractVersion,
    CONTRACT_VERSION,
    "expected public build contract version",
  );
  const publicBuildContractSha256 = exactString(
    expected.publicBuildContractSha256,
    SHA256,
    "expected public build contract SHA-256",
  );
  const imageReference = exactImmutableMigrationReference(expected.imageReference);

  if (!Array.isArray(inspection) || inspection.length !== 1) {
    fail("Docker inspection must contain exactly one migration image");
  }
  const image = record(inspection[0], "Docker migration image inspection");
  if (image.Id !== imageId) fail("local migration image ID differs from the expected ID");
  if (
    !Array.isArray(image.RepoDigests)
    || !image.RepoDigests.every((value) => typeof value === "string")
    || !image.RepoDigests.includes(imageReference)
  ) {
    fail("local migration image is not bound to the expected immutable reference");
  }

  const config = record(image.Config, "Docker migration image config");
  const labels = record(config.Labels, "Docker migration image labels");
  const requiredLabels = {
    "io.clean-pay.public-build-contract-sha256": publicBuildContractSha256,
    "io.clean-pay.public-build-contract-version": publicBuildContractVersion,
    "io.clean-pay.release": release,
    "io.clean-pay.role": "migration",
    "org.opencontainers.image.revision": revision,
    "org.opencontainers.image.version": release,
  };
  for (const [name, value] of Object.entries(requiredLabels)) {
    if (labels[name] !== value) fail(`migration image label ${name} differs from the expected value`);
  }

  return Object.freeze({
    imageId,
    imageReference,
    publicBuildContractSha256,
    publicBuildContractVersion,
    release,
    revision,
  });
}

function exactImmutableMigrationReference(value) {
  if (typeof value !== "string") fail("expected migration image reference must be a string");
  const digest = /@sha256:([a-f0-9]{64})$/.exec(value)?.[1];
  if (!digest) fail("expected migration image reference must be digest-pinned");
  const alternateDigest = (digest === "0".repeat(64) ? "1" : "0").repeat(64);
  const references = validateDeploymentImageReferences({
    CLEAN_PAY_DEPLOY_SOURCE: "pull",
    CLEAN_PAY_IMAGE: `clean-pay-rehearsal-app@sha256:${alternateDigest}`,
    CLEAN_PAY_MIGRATION_IMAGE: value,
  });
  if (references.migrationImage !== value) {
    fail("expected migration image reference was not preserved by validation");
  }
  return value;
}

function exactKeys(value, keys, label) {
  const object = record(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has missing or unexpected fields`);
  }
}

function exactString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function fail(message) {
  throw new Error(message);
}

async function readBoundedInspection(file) {
  const before = await lstat(file);
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.size <= 0
    || before.size > MAXIMUM_INSPECTION_BYTES
  ) {
    fail("Docker migration image inspection is not an exact bounded regular file");
  }
  const bytes = await readFile(file);
  const after = await stat(file);
  if (
    bytes.byteLength !== before.size
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
  ) {
    fail("Docker migration image inspection changed while being read");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Docker migration image inspection is not valid JSON");
  }
}

function parseArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) fail("migration image verifier arguments are incomplete");
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name?.startsWith("--") || value === undefined || values.has(name)) {
      fail("migration image verifier arguments are invalid or duplicated");
    }
    values.set(name, value);
  }
  const expectedNames = [
    "--expected-image-id",
    "--expected-public-build-contract-sha256",
    "--expected-public-build-contract-version",
    "--expected-release",
    "--expected-revision",
    "--image-reference",
    "--inspection",
  ];
  if (
    values.size !== expectedNames.length
    || expectedNames.some((name) => !values.has(name))
  ) {
    fail("migration image verifier arguments have missing or unexpected fields");
  }
  return values;
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const result = verifyRehearsalMigrationImageInspection(
    await readBoundedInspection(path.resolve(values.get("--inspection"))),
    {
      imageId: values.get("--expected-image-id"),
      imageReference: values.get("--image-reference"),
      publicBuildContractSha256: values.get("--expected-public-build-contract-sha256"),
      publicBuildContractVersion: values.get("--expected-public-build-contract-version"),
      release: values.get("--expected-release"),
      revision: values.get("--expected-revision"),
    },
  );
  process.stdout.write(`${result.imageId}\n`);
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedUrl === import.meta.url) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown verifier failure";
    process.stderr.write(`Migration rehearsal image verification failed: ${message}\n`);
    process.exitCode = 1;
  }
}
