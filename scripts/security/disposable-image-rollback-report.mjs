#!/usr/bin/env node

import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const maximumReportBytes = 16 * 1024;
const invalidReportMessage = "disposable image rollback report is invalid";
const rootKeys = Object.freeze([
  "schemaVersion",
  "status",
  "terminalPhase",
  "cleanupProven",
  "authoritativeEnvironmentRestored",
  "canaryRemoved",
  "trafficContinuityProven",
  "disposableTrafficProxyUsed",
  "syntheticReadinessProviderUsed",
  "syntheticReadinessProviderContractProven",
  "verifiedTrafficPhaseCount",
  "trafficPath",
  "syntheticEnvironment",
  "productionDeploymentPerformed",
  "caddyMutationPerformed",
  "externalProviderCredentialsUsed",
  "syntheticProviderCredentialsUsed",
  "baselineBuildContextAllowlistProven",
  "rollbackImagePreflightProven",
  "previousSourceRevision",
  "targetSourceRevision",
  "verifiedImageStateCount",
  "projectContractSha256",
  "imageIdentityEvidence",
]);
const proofBooleanKeys = Object.freeze([
  "cleanupProven",
  "authoritativeEnvironmentRestored",
  "canaryRemoved",
  "trafficContinuityProven",
  "disposableTrafficProxyUsed",
  "syntheticReadinessProviderUsed",
  "syntheticReadinessProviderContractProven",
  "syntheticProviderCredentialsUsed",
  "baselineBuildContextAllowlistProven",
  "rollbackImagePreflightProven",
]);
const imageKeys = Object.freeze([
  "targetApplicationImageId",
  "targetMigrationImageId",
  "previousApplicationImageId",
  "previousMigrationImageId",
]);
const terminalPhasePattern = /^[a-z][a-z0-9-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const imageIdPattern = /^sha256:[a-f0-9]{64}$/;

export function validateDisposableImageRollbackReport(value) {
  if (!isExactPlainObject(value, rootKeys)
    || value.schemaVersion !== "clean-pay.disposable-image-rollback.v3"
    || (value.status !== "passed" && value.status !== "failed")
    || typeof value.terminalPhase !== "string"
    || !terminalPhasePattern.test(value.terminalPhase)
    || value.trafficPath !== "owned-edge-network-aliases"
    || value.syntheticEnvironment !== true
    || value.productionDeploymentPerformed !== false
    || value.caddyMutationPerformed !== false
    || value.externalProviderCredentialsUsed !== false
    || typeof value.previousSourceRevision !== "string"
    || !revisionPattern.test(value.previousSourceRevision)
    || typeof value.targetSourceRevision !== "string"
    || !revisionPattern.test(value.targetSourceRevision)
    || typeof value.projectContractSha256 !== "string"
    || !sha256Pattern.test(value.projectContractSha256)
    || !boundedSafeInteger(value.verifiedTrafficPhaseCount, 4)
    || !boundedSafeInteger(value.verifiedImageStateCount, 3)
    || !isExactPlainObject(value.imageIdentityEvidence, imageKeys)
    || proofBooleanKeys.some((key) => typeof value[key] !== "boolean")) {
    invalidReport();
  }

  const imageIds = imageKeys.map((key) => value.imageIdentityEvidence[key]);
  if (imageIds.some((imageId) => imageId !== null
    && (typeof imageId !== "string" || !imageIdPattern.test(imageId)))) {
    invalidReport();
  }

  if (value.status === "passed"
    && (value.terminalPhase !== "complete"
      || proofBooleanKeys.some((key) => value[key] !== true)
      || value.verifiedTrafficPhaseCount !== 4
      || value.verifiedImageStateCount !== 3
      || imageIds.some((imageId) => typeof imageId !== "string")
      || new Set(imageIds).size !== imageIds.length)) {
    invalidReport();
  }

  return Object.freeze({
    ...value,
    imageIdentityEvidence: Object.freeze({ ...value.imageIdentityEvidence }),
  });
}

function isExactPlainObject(value, expectedKeys) {
  if (!value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function boundedSafeInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function invalidReport() {
  throw new Error(invalidReportMessage);
}

async function readAndValidateReport(file) {
  const beforePath = await lstat(file, { bigint: true });
  if (!beforePath.isFile()
    || beforePath.isSymbolicLink()
    || beforePath.size <= 0n
    || beforePath.size > BigInt(maximumReportBytes)) {
    invalidReport();
  }

  // Windows requires a write-capable handle for fsync even though this gate
  // never mutates the report bytes.
  const handle = await open(file, "r+");
  try {
    const beforeRead = await handle.stat({ bigint: true });
    if (!sameFile(beforePath, beforeRead)) invalidReport();

    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    if (BigInt(bytes.byteLength) !== beforeRead.size
      || !sameFile(beforeRead, afterRead)
      || beforeRead.mtimeNs !== afterRead.mtimeNs
      || beforeRead.ctimeNs !== afterRead.ctimeNs) {
      invalidReport();
    }

    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      invalidReport();
    }
    validateDisposableImageRollbackReport(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sameFile(left, right) {
  return left.isFile()
    && !left.isSymbolicLink()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size;
}

async function main(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== "validate") {
    invalidReport();
  }
  await readAndValidateReport(path.resolve(argumentsList[1]));
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedUrl === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch {
    process.stderr.write("Disposable image rollback report validation failed.\n");
    process.exitCode = 1;
  }
}
