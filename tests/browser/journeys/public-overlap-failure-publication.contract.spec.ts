import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { writeJourneySanitizedOutput } from "./journey-owned-stack-orchestrator.mjs";
import { publishPublicOverlapFailureOutputs } from "./public-overlap-failure-publication.mjs";

test("seals both compare failure outputs before returning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clean-pay-public-failure-output-"));
  const baseBytes = Buffer.from('{"status":"base"}\n', "utf8");
  const mismatchBytes = Buffer.from('{"status":"mismatch"}\n', "utf8");
  try {
    const receipts = await publishPublicOverlapFailureOutputs({
      baseBytes,
      baseFilename: "public-compare-pair-failure.json",
      failureOutputRoot: root,
      mismatchBytes,
      writeOutput: writeJourneySanitizedOutput,
    });
    expect(receipts).toHaveLength(2);
    expect(await readFile(path.join(root, "public-compare-pair-failure.json")))
      .toEqual(baseBytes);
    expect(await readFile(path.join(root, "public-comparison-mismatch.json")))
      .toEqual(mismatchBytes);
    expect(Object.isFrozen(receipts)).toBe(true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("waits for every attempted output when one sibling rejects", async () => {
  const settledTargets: string[] = [];
  const writeOutput = async (target: string, bytes: Uint8Array) => {
    if (target.endsWith("public-compare-pair-failure.json")) {
      throw new Error("synthetic base write failure");
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    settledTargets.push(path.basename(target));
    return {
      status: "sanitized-create-only-output-written",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
  };

  await expect(publishPublicOverlapFailureOutputs({
    baseBytes: Buffer.from("base"),
    baseFilename: "public-compare-pair-failure.json",
    failureOutputRoot: path.resolve(os.tmpdir()),
    mismatchBytes: Buffer.from("mismatch"),
    writeOutput,
  })).rejects.toThrow("did not all settle successfully");
  expect(settledTargets).toEqual(["public-comparison-mismatch.json"]);
});

test("rejects mismatch publication outside the exact compare failure scope", async () => {
  await expect(publishPublicOverlapFailureOutputs({
    baseBytes: Buffer.from("base"),
    baseFilename: "public-capture-baseline-failure.json",
    failureOutputRoot: path.resolve(os.tmpdir()),
    mismatchBytes: Buffer.from("mismatch"),
    writeOutput: async () => {
      throw new Error("writer must not be reached");
    },
  })).rejects.toThrow("escaped compare scope");
});

test("accepts the exact paired capture failure scope without mismatch projection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clean-pay-paired-capture-failure-"));
  const bytes = Buffer.from('{"status":"paired-capture"}\n', "utf8");
  try {
    await expect(publishPublicOverlapFailureOutputs({
      baseBytes: bytes,
      baseFilename: "public-capture-pair-failure.json",
      failureOutputRoot: root,
      mismatchBytes: null,
      writeOutput: writeJourneySanitizedOutput,
    })).resolves.toHaveLength(1);
    await expect(readFile(path.join(root, "public-capture-pair-failure.json")))
      .resolves.toEqual(bytes);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
