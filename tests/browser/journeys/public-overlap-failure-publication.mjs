import { createHash } from "node:crypto";
import path from "node:path";

const baseFilenamePattern = /^public-(?:capture-(?:baseline|candidate|pair)|(?:cleanup|compare|prepare|verify)-pair)-failure\.json$/;
const mismatchFilename = "public-comparison-mismatch.json";

export async function publishPublicOverlapFailureOutputs(input) {
  exactKeys(input, [
    "baseBytes",
    "baseFilename",
    "failureOutputRoot",
    "mismatchBytes",
    "writeOutput",
  ]);
  if (typeof input.failureOutputRoot !== "string"
    || !path.isAbsolute(input.failureOutputRoot)
    || path.resolve(input.failureOutputRoot) !== input.failureOutputRoot
    || typeof input.baseFilename !== "string"
    || !baseFilenamePattern.test(input.baseFilename)
    || typeof input.writeOutput !== "function") {
    throw new Error("Public overlap failure publication scope is invalid.");
  }
  const baseBytes = exactBytes(input.baseBytes, 64 * 1024, "base process");
  const mismatchBytes = input.mismatchBytes === null
    ? null
    : exactBytes(input.mismatchBytes, 16 * 1024, "projected mismatch");
  if (mismatchBytes !== null && input.baseFilename !== "public-compare-pair-failure.json") {
    throw new Error("Public overlap mismatch publication escaped compare scope.");
  }
  const outputs = [{
    bytes: baseBytes,
    target: path.join(input.failureOutputRoot, input.baseFilename),
  }];
  if (mismatchBytes !== null) {
    outputs.push({
      bytes: mismatchBytes,
      target: path.join(input.failureOutputRoot, mismatchFilename),
    });
  }

  const settlements = await Promise.allSettled(outputs.map(async ({ bytes, target }) => {
    const receipt = await input.writeOutput(target, bytes);
    if (!receipt
      || receipt.status !== "sanitized-create-only-output-written"
      || receipt.bytes !== bytes.byteLength
      || receipt.sha256 !== sha256(bytes)) {
      throw new Error("Public overlap failure publication receipt is invalid.");
    }
    return Object.freeze({
      bytes: receipt.bytes,
      sha256: receipt.sha256,
      status: receipt.status,
    });
  }));
  const failures = settlements
    .filter((settlement) => settlement.status === "rejected")
    .map((settlement) => settlement.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Public overlap failure outputs did not all settle successfully.",
    );
  }
  return Object.freeze(settlements.map((settlement) => settlement.value));
}

function exactBytes(value, maximum, label) {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximum) {
    throw new Error(`Public overlap ${label} failure output is invalid.`);
  }
  return Buffer.from(value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error("Public overlap failure publication fields are invalid.");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
