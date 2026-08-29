import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  PUBLIC_OVERLAP_PROOF_KIND,
  assertPublicOverlapPairReceipt,
  createPublicOverlapProof,
  createPublicOverlapStackBinding,
} from "./public-overlap-proof-contract.mjs";

const captureId = "0123456789abcdef";
const baselineOrigin = "http://127.0.0.1:4201";
const candidateOrigin = "http://127.0.0.1:4202";
const baselineBindingSha256 = "1".repeat(64);
const candidateBindingSha256 = "2".repeat(64);
const baselineOwnershipSha256 = "3".repeat(64);
const candidateOwnershipSha256 = "4".repeat(64);

test("derives role-bound stack digests from owned input/runtime/launch receipts", () => {
  const source = {
    inputReceipt: { contractSha256: "a".repeat(64) },
    runtime: { status: "runtime-attested" },
    launch: { status: "pair-running" },
  };
  const baseline = createPublicOverlapStackBinding({ role: "baseline", ...source });
  const repeated = createPublicOverlapStackBinding({ role: "baseline", ...source });
  const candidate = createPublicOverlapStackBinding({ role: "candidate", ...source });

  expect(baseline).toMatch(/^[a-f0-9]{64}$/);
  expect(repeated).toBe(baseline);
  expect(candidate).not.toBe(baseline);
});

test("accepts only the exact 42-case/126-artifact dual-origin pair receipt", () => {
  const receipt = pairReceipt();
  expect(assertPublicOverlapPairReceipt(receipt, expectedPair())).toBe(receipt);

  const nearMisses = [
    { ...receipt, caseCount: 41 },
    { ...receipt, artifactCountPerSide: 125 },
    { ...receipt, candidate: { ...receipt.candidate, applicationOrigin: baselineOrigin } },
    { ...receipt, baseline: { ...receipt.baseline, bindingSha256: "9".repeat(64) } },
    { ...receipt, leaked: "raw-manifest" },
  ];
  for (const nearMiss of nearMisses) {
    expect(
      () => assertPublicOverlapPairReceipt(nearMiss, expectedPair()),
      JSON.stringify(nearMiss),
    ).toThrow();
  }
});

test("creates a digest-only final proof after exact cleanup receipt binding", () => {
  const proof = createPublicOverlapProof({
    baselineBindingSha256,
    candidateBindingSha256,
    captureId,
    cleanup: { status: "verifier-owned-stack-pair-cleaned" },
    launch: { status: "verifier-owned-stack-pair-running" },
    pairReceiptSha256: "5".repeat(64),
  });

  expect(proof).toEqual({
    schemaVersion: 1,
    kind: PUBLIC_OVERLAP_PROOF_KIND,
    captureId,
    status: "live-public-characterization-overlap-proven-after-exact-cleanup",
    caseCount: 42,
    artifactCountPerSide: 126,
    baselineBindingSha256,
    candidateBindingSha256,
    pairReceiptSha256: "5".repeat(64),
    launchReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    cleanupReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(proof)).not.toContain("runtime-attested");
});

test("pins the local capture tool and publishes proof only after owned-stack cleanup", async () => {
  const source = await readFile(path.join(
    process.cwd(),
    "tests",
    "browser",
    "journeys",
    "prove-public-characterization-overlap.mjs",
  ), "utf8");
  const pairStart = source.indexOf("const session = await withJourneyOwnedStackPair(");
  const postCleanupVerify = source.indexOf(
    "await runPublicOverlapPlaywright(\"verify\", session.value.comparisonEnvironment",
  );
  const proofWrite = source.indexOf("await writeJourneySanitizedOutput(proofPath, proofBytes)");

  expect(pairStart).toBeGreaterThan(-1);
  expect(source).toContain("const captureSettlements = await Promise.allSettled([");
  expect(source).toContain("localPlaywrightCli");
  expect(source).toContain("process.execPath");
  expect(source).not.toContain("npx");
  expect(postCleanupVerify).toBeGreaterThan(pairStart);
  expect(proofWrite).toBeGreaterThan(postCleanupVerify);
  expect(source).toContain("Public overlap proof failed and exact evidence cleanup was not proven.");
});

function expectedPair() {
  return {
    baselineBindingSha256,
    baselineOrigin,
    baselineOwnershipSha256,
    candidateBindingSha256,
    candidateOrigin,
    candidateOwnershipSha256,
    captureId,
  };
}

function pairReceipt() {
  return {
    schemaVersion: 1,
    kind: "clean-pay-public-characterization-overlap-proof",
    suite: "public-characterization-v1",
    captureId,
    status: "baseline-candidate-public-characterization-equal",
    caseCount: 42,
    artifactCountPerSide: 126,
    baseline: {
      applicationOrigin: baselineOrigin,
      bindingSha256: baselineBindingSha256,
      inventorySha256: "6".repeat(64),
      ownershipSha256: baselineOwnershipSha256,
      receiptSha256: "7".repeat(64),
    },
    candidate: {
      applicationOrigin: candidateOrigin,
      bindingSha256: candidateBindingSha256,
      inventorySha256: "8".repeat(64),
      ownershipSha256: candidateOwnershipSha256,
      receiptSha256: "9".repeat(64),
    },
    comparisonSha256: "a".repeat(64),
  };
}
