import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  PUBLIC_OVERLAP_CAPTURE_POLICY,
  cleanupPreparedCapturePair,
  prepareExactCapturePair,
} from "../public-overlap-evidence";
import {
  PUBLIC_OVERLAP_OWNERSHIP_DIRECTORY_PATHS,
  derivePublicOverlapOwnershipDirectoryPaths,
} from "../public-overlap-directory-policy.mjs";

import {
  PUBLIC_OVERLAP_PROOF_KIND,
  assertPublicOverlapOwnershipDirectoryPaths,
  assertPublicOverlapPairReceipt,
  createPublicOverlapProof,
  createPublicOverlapStackBinding,
  readPublicOverlapOwnership,
  readPublicOverlapPairOwnership,
} from "./public-overlap-proof-contract.mjs";
import { JOURNEY_FIXTURE_FILENAMES } from "./journey-fixture-manifest.mjs";

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

test("round-trips the canonical ownership ledger and rejects path-set near-misses", async () => {
  const ownershipCaptureId = randomBytes(8).toString("hex");
  const canonicalPaths = [...PUBLIC_OVERLAP_OWNERSHIP_DIRECTORY_PATHS];
  expect(canonicalPaths).toHaveLength(47);
  expect(assertPublicOverlapOwnershipDirectoryPaths(canonicalPaths)).toEqual(canonicalPaths);
  expect(derivePublicOverlapOwnershipDirectoryPaths(
    PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths,
  )).toEqual(canonicalPaths);
  expect(derivePublicOverlapOwnershipDirectoryPaths(
    [...PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths].reverse(),
  )).toEqual(canonicalPaths);
  expect(derivePublicOverlapOwnershipDirectoryPaths([
    "case-b/console.json",
    "case-a/viewport.png",
  ])).toEqual([
    ".",
    "artifacts",
    "artifacts/case-a",
    "artifacts/case-b",
  ]);
  expect(derivePublicOverlapOwnershipDirectoryPaths([
    "case-a/viewport.png",
    "case-b/console.json",
  ])).toEqual(derivePublicOverlapOwnershipDirectoryPaths([
    "case-b/console.json",
    "case-a/viewport.png",
  ]));
  for (const nearMiss of [
    canonicalPaths.slice(0, -1),
    [...canonicalPaths, "artifacts/unexpected"],
    [canonicalPaths[0], canonicalPaths[2], canonicalPaths[1], ...canonicalPaths.slice(3)],
  ]) {
    expect(() => assertPublicOverlapOwnershipDirectoryPaths(nearMiss)).toThrow();
  }

  const prepared = await prepareExactCapturePair({
    baselineBindingSha256,
    candidateBindingSha256,
    captureId: ownershipCaptureId,
  });
  try {
    const pair = await readPublicOverlapPairOwnership({
      captureId: ownershipCaptureId,
      repositoryRoot: process.cwd(),
    });
    expect(pair.pairOwnershipSha256).toBe(prepared.pairReceiptSha256);

    await expect(readPublicOverlapOwnership({
      baselineBindingSha256,
      candidateBindingSha256,
      captureId: ownershipCaptureId,
      expectedPairOwnershipSha256: "0".repeat(64),
      repositoryRoot: process.cwd(),
    })).rejects.toThrow("pair ownership staged digest is invalid");

    const ownership = await readPublicOverlapOwnership({
      baselineBindingSha256,
      candidateBindingSha256,
      captureId: ownershipCaptureId,
      expectedPairOwnershipSha256: pair.pairOwnershipSha256,
      repositoryRoot: process.cwd(),
    });
    expect(ownership.pairOwnershipSha256).toBe(prepared.pairReceiptSha256);
    expect(ownership.roles.baseline.ownershipSha256)
      .toBe(prepared.roles.baseline.receiptSha256);
    expect(ownership.roles.candidate.ownershipSha256)
      .toBe(prepared.roles.candidate.receiptSha256);
  } finally {
    await cleanupPreparedCapturePair({
      captureId: ownershipCaptureId,
      pairReceiptSha256: prepared.pairReceiptSha256,
    });
  }
});

test("keeps the staged pair digest authoritative when full ownership validation fails", async () => {
  const ownershipCaptureId = randomBytes(8).toString("hex");
  const prepared = await prepareExactCapturePair({
    baselineBindingSha256,
    candidateBindingSha256,
    captureId: ownershipCaptureId,
  });
  let cleaned = false;
  try {
    const pair = await readPublicOverlapPairOwnership({
      captureId: ownershipCaptureId,
      repositoryRoot: process.cwd(),
    });
    await expect(readPublicOverlapOwnership({
      baselineBindingSha256: "3".repeat(64),
      candidateBindingSha256,
      captureId: ownershipCaptureId,
      expectedPairOwnershipSha256: pair.pairOwnershipSha256,
      repositoryRoot: process.cwd(),
    })).rejects.toThrow("baseline owned-stack binding digest is invalid");
    await cleanupPreparedCapturePair({
      captureId: ownershipCaptureId,
      pairReceiptSha256: pair.pairOwnershipSha256,
    });
    cleaned = true;
  } finally {
    if (!cleaned) {
      await cleanupPreparedCapturePair({
        captureId: ownershipCaptureId,
        pairReceiptSha256: prepared.pairReceiptSha256,
      });
    }
  }
});

test("pins the local capture tool and publishes proof only after owned-stack cleanup", async () => {
  const [source, captureSource, teardownSource, fixturesSource] = await Promise.all([
    readFile(path.join(
      process.cwd(),
      "tests",
      "browser",
      "journeys",
      "prove-public-characterization-overlap.mjs",
    ), "utf8"),
    readFile(path.join(
      process.cwd(),
      "tests",
      "browser",
      "public-overlap-capture.ts",
    ), "utf8"),
    readFile(path.join(
      process.cwd(),
      "tests",
      "browser",
      "public-overlap-global-teardown.ts",
    ), "utf8"),
    readFile(path.join(
      process.cwd(),
      "tests",
      "browser",
      "fixtures.ts",
    ), "utf8"),
  ]);
  const pairStart = source.indexOf("const session = await withJourneyOwnedStackPair(");
  const pairOwnershipRead = source.indexOf(
    "preparedPairOwnership = await readPublicOverlapPairOwnership(",
  );
  const ownershipRead = source.indexOf(
    "const ownership = await readPublicOverlapOwnership(",
  );
  const postCleanupVerify = source.indexOf(
    "await runPublicOverlapPlaywright(\"verify\", session.value.comparisonEnvironment",
  );
  const proofWrite = source.indexOf("await writeJourneySanitizedOutput(proofPath, proofBytes)");

  expect(pairStart).toBeGreaterThan(-1);
  expect(pairOwnershipRead).toBeGreaterThan(pairStart);
  expect(ownershipRead).toBeGreaterThan(pairOwnershipRead);
  expect(source).toContain("const captureSettlements = await Promise.allSettled([");
  expect(source).toContain("runCapturePair(comparisonEnvironment)");
  expect(source).toContain('CLEAN_PAY_PUBLIC_OVERLAP_ROLE: "pair"');
  for (const field of [
    "CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_ORIGIN",
    "CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_ORIGIN",
    "CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_BINDING_SHA256",
    "CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_BINDING_SHA256",
    "CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_OWNERSHIP_SHA256",
    "CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_OWNERSHIP_SHA256",
  ]) {
    expect(source).toContain(field);
  }
  expect(source).not.toContain('runCapture("baseline"');
  expect(source).not.toContain('runCapture("candidate"');
  expect(captureSource).toContain("const settlements = await Promise.allSettled(");
  expect(captureSource).toContain('(["baseline", "candidate"] as const).map');
  expect(captureSource).toContain("selectIndependentProcessCharacterizationPairQuorum(");
  expect(fixturesSource).toContain(
    "for (const [processIndex, browser] of independentChromiumBrowsers.entries())",
  );
  expect(fixturesSource).toContain('for (const role of ["baseline", "candidate"] as const)');
  expect(fixturesSource).toContain("const context = await browser.newContext({");
  expect(fixturesSource).toContain("const replayGuard = await installCharacterizationReplayGuard({");
  expect(fixturesSource).toContain("reconcileRegisteredBaselineArtifacts(primary.baseline.page)");
  expect(fixturesSource).toContain("reconcileRegisteredBaselineArtifacts(primary.candidate.page)");
  expect(JOURNEY_FIXTURE_FILENAMES).toContain("../public-overlap-pair-capture.live.ts");
  expect(teardownSource).toContain("const settlements = await Promise.allSettled(");
  expect(teardownSource).toContain('(["baseline", "candidate"] as const).map');
  expect(source).toContain("localPlaywrightCli");
  expect(source).toContain("process.execPath");
  expect(source).not.toContain("npx");
  expect(postCleanupVerify).toBeGreaterThan(pairStart);
  expect(proofWrite).toBeGreaterThan(postCleanupVerify);
  expect(source).toContain("Public overlap proof failed and exact evidence cleanup was not proven.");
  expect(source).toContain("cleanupPairOwnershipSha256");
  expect(source).toContain("preparedPairOwnership?.pairOwnershipSha256");
  expect(source).not.toContain("preparedOwnership?.pairOwnershipSha256");
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
