import path from "node:path";

import { BEHAVIORAL_BASELINE_COMMIT } from "./baseline-policy";
import { projectCharacterizationManifestPairBytesForComparison } from "./comparison-projection";
import { createPublicOverlapProjectedMismatchMarker } from "./public-overlap-mismatch-evidence.mjs";
import {
  PUBLIC_OVERLAP_ARTIFACT_NAMES,
  PUBLIC_OVERLAP_CAPTURE_POLICY,
  PUBLIC_OVERLAP_PROJECTS,
  PUBLIC_OVERLAP_ROUTES,
  assertExactLoopbackApplicationOrigin,
  readAndValidateExactCapture,
  readExactCaptureArtifact,
  readExactPairEvidenceFile,
  readPreparedCaptureOwnership,
  resolveExactPairRoot,
  sha256,
  writeCreateOnlyFile,
} from "./public-overlap-evidence";

const digestPattern = /^[a-f0-9]{64}$/;

export async function provePublicCharacterizationOverlap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return evaluatePublicCharacterizationOverlap(environment, true);
}

export async function verifyPublicCharacterizationOverlap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return evaluatePublicCharacterizationOverlap(environment, false);
}

async function evaluatePublicCharacterizationOverlap(
  environment: Readonly<Record<string, string | undefined>>,
  publish: boolean,
) {
  const captureId = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID,
    /^[a-f0-9]{16}$/,
    "capture ID",
  );
  const expectedBaselineOrigin = assertExactLoopbackApplicationOrigin(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_ORIGIN,
    "expected baseline origin",
  );
  const expectedCandidateOrigin = assertExactLoopbackApplicationOrigin(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_ORIGIN,
    "expected candidate origin",
  );
  if (expectedBaselineOrigin === expectedCandidateOrigin) {
    throw new Error("Public overlap proof requires two distinct loopback origins.");
  }
  const expectedBaselineBinding = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_BINDING_SHA256,
    digestPattern,
    "expected baseline binding digest",
  );
  const expectedCandidateBinding = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_BINDING_SHA256,
    digestPattern,
    "expected candidate binding digest",
  );
  if (expectedBaselineBinding === expectedCandidateBinding) {
    throw new Error("Public overlap proof requires distinct stack binding digests.");
  }
  const expectedBaselineOwnership = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_OWNERSHIP_SHA256,
    digestPattern,
    "expected baseline ownership digest",
  );
  const expectedCandidateOwnership = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_OWNERSHIP_SHA256,
    digestPattern,
    "expected candidate ownership digest",
  );
  if (expectedBaselineOwnership === expectedCandidateOwnership) {
    throw new Error("Public overlap proof requires distinct role ownership digests.");
  }

  const [baseline, candidate] = await Promise.all([
    readAndValidateExactCapture({
      bindingSha256: expectedBaselineBinding,
      captureId,
      ownershipSha256: expectedBaselineOwnership,
      role: "baseline",
    }),
    readAndValidateExactCapture({
      bindingSha256: expectedCandidateBinding,
      captureId,
      ownershipSha256: expectedCandidateOwnership,
      role: "candidate",
    }),
  ]);
  if (
    baseline.receipt.applicationOrigin !== expectedBaselineOrigin
    || candidate.receipt.applicationOrigin !== expectedCandidateOrigin
    || baseline.receipt.bindingSha256 !== expectedBaselineBinding
    || candidate.receipt.bindingSha256 !== expectedCandidateBinding
  ) {
    throw new Error("Public overlap capture receipts are not bound to the owned stack pair.");
  }

  const comparisons: Array<Readonly<{
    case: string;
    consoleSha256: string;
    pngSha256: string;
    projectedManifestSha256: string;
  }>> = [];
  for (const project of PUBLIC_OVERLAP_PROJECTS) {
    for (const route of PUBLIC_OVERLAP_ROUTES) {
      const directory = `${project}/${route.id}`;
      const [baselineManifest, candidateManifest, baselinePng, candidatePng, baselineConsole,
        candidateConsole] = await Promise.all([
        readExactCaptureArtifact(baseline.root, `${directory}/characterization.json`),
        readExactCaptureArtifact(candidate.root, `${directory}/characterization.json`),
        readExactCaptureArtifact(baseline.root, `${directory}/viewport.png`),
        readExactCaptureArtifact(candidate.root, `${directory}/viewport.png`),
        readExactCaptureArtifact(baseline.root, `${directory}/console.json`),
        readExactCaptureArtifact(candidate.root, `${directory}/console.json`),
      ]);
      const projected = projectCharacterizationManifestPairBytesForComparison(
        baselineManifest,
        candidateManifest,
        {
          expectedApplicationOrigin: expectedBaselineOrigin,
          actualApplicationOrigin: expectedCandidateOrigin,
        },
      );
      if (!projected.expected.equals(projected.actual)) {
        const marker = createPublicOverlapProjectedMismatchMarker(
          directory,
          projected.expected,
          projected.actual,
        );
        throw new Error(`Projected public characterization JSON differs. ${marker}`);
      }
      if (!baselinePng.equals(candidatePng)) {
        throw new Error(`Public characterization PNG bytes differ for ${directory}.`);
      }
      if (!baselineConsole.equals(candidateConsole)) {
        throw new Error(`Public characterization console bytes differ for ${directory}.`);
      }
      assertManifestArtifactBinding(baselineManifest, baselinePng, project, route);
      assertManifestArtifactBinding(candidateManifest, candidatePng, project, route);
      assertConsoleArtifact(baselineConsole, project, route);
      assertConsoleArtifact(candidateConsole, project, route);
      comparisons.push(Object.freeze({
        case: directory,
        consoleSha256: sha256(baselineConsole),
        pngSha256: sha256(baselinePng),
        projectedManifestSha256: sha256(projected.expected),
      }));
    }
  }

  if (
    comparisons.length !== 42
    || PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths.length !== 126
    || PUBLIC_OVERLAP_ARTIFACT_NAMES.length !== 3
  ) {
    throw new Error("Public overlap proof did not consume the exact 42-case/126-artifact ledger.");
  }
  const comparisonBytes = Buffer.from(`${JSON.stringify(comparisons)}\n`, "utf8");
  const receipt = Object.freeze({
    schemaVersion: 1,
    kind: "clean-pay-public-characterization-overlap-proof",
    suite: PUBLIC_OVERLAP_CAPTURE_POLICY.suite,
    captureId,
    status: "baseline-candidate-public-characterization-equal",
    caseCount: comparisons.length,
    artifactCountPerSide: PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths.length,
    baseline: Object.freeze({
      applicationOrigin: baseline.receipt.applicationOrigin,
      bindingSha256: baseline.receipt.bindingSha256,
      inventorySha256: baseline.receipt.inventorySha256,
      ownershipSha256: baseline.ownership.receiptSha256,
      receiptSha256: sha256(baseline.receiptBytes),
    }),
    candidate: Object.freeze({
      applicationOrigin: candidate.receipt.applicationOrigin,
      bindingSha256: candidate.receipt.bindingSha256,
      inventorySha256: candidate.receipt.inventorySha256,
      ownershipSha256: candidate.ownership.receiptSha256,
      receiptSha256: sha256(candidate.receiptBytes),
    }),
    comparisonSha256: sha256(comparisonBytes),
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const receiptPath = path.join(resolveExactPairRoot(captureId), "pair-receipt.json");
  const recheckOwnership = () => Promise.all([
    readPreparedCaptureOwnership({
      bindingSha256: expectedBaselineBinding,
      captureId,
      ownershipSha256: expectedBaselineOwnership,
      role: "baseline",
    }),
    readPreparedCaptureOwnership({
      bindingSha256: expectedCandidateBinding,
      captureId,
      ownershipSha256: expectedCandidateOwnership,
      role: "candidate",
    }),
  ]);
  await recheckOwnership();
  if (publish) {
    await writeCreateOnlyFile(receiptPath, receiptBytes);
  } else {
    const existing = await readExactPairEvidenceFile(captureId, "pair-receipt.json");
    if (!existing.equals(receiptBytes)) {
      throw new Error("Public overlap pair receipt changed after comparison.");
    }
  }
  await recheckOwnership();
  return Object.freeze({ receipt, receiptBytes, receiptPath });
}

function assertManifestArtifactBinding(
  bytes: Uint8Array,
  png: Uint8Array,
  project: string,
  route: (typeof PUBLIC_OVERLAP_ROUTES)[number],
) {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("Public overlap characterization manifest is not valid JSON.");
  }
  if (!isRecord(value) || !isRecord(value.route) || !isRecord(value.screenshot)) {
    throw new Error("Public overlap characterization manifest shape is invalid.");
  }
  const dimensions = pngDimensions(png);
  if (
    value.schemaVersion !== 1
    || value.baselineCommit !== BEHAVIORAL_BASELINE_COMMIT
    || value.project !== project
    || value.route.id !== route.id
    || value.route.kind !== route.kind
    || value.screenshot.sha256 !== sha256(png)
    || value.screenshot.width !== dimensions.width
    || value.screenshot.height !== dimensions.height
  ) {
    throw new Error("Public overlap characterization manifest is not bound to its PNG/case.");
  }
}

function assertConsoleArtifact(
  bytes: Uint8Array,
  project: string,
  route: (typeof PUBLIC_OVERLAP_ROUTES)[number],
) {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("Public overlap console sidecar is not valid JSON.");
  }
  if (
    !isRecord(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
      "baselineCommit",
      "normalizedStaticCspViolations",
      "project",
      "route",
      "schemaVersion",
    ])
    || value.schemaVersion !== 1
    || value.baselineCommit !== BEHAVIORAL_BASELINE_COMMIT
    || value.project !== project
    || !isRecord(value.route)
    || JSON.stringify(Object.keys(value.route).sort()) !== JSON.stringify(["id", "kind"])
    || value.route.id !== route.id
    || value.route.kind !== route.kind
    || !Array.isArray(value.normalizedStaticCspViolations)
  ) {
    throw new Error("Public overlap console sidecar is not bound to its exact case.");
  }
}

function pngDimensions(value: Uint8Array) {
  const png = Buffer.from(value);
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Public overlap proof received an invalid PNG.");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function exactEnvironmentValue(value: unknown, pattern: RegExp, label: string) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`Public overlap ${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
