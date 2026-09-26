import { createHash } from "node:crypto";

import {
  EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT,
  selectByteIdenticalMajority,
} from "./screenshot-majority";

export type IndependentProcessCharacterizationSample = {
  manifest: Uint8Array;
  screenshot: Uint8Array;
};

export type IndependentProcessCharacterizationPair = Readonly<{
  baseline: IndependentProcessCharacterizationSample;
  candidate: IndependentProcessCharacterizationSample;
}>;

type ProjectedProcessSample = {
  projectedManifest: Buffer;
  rawManifestSha256: string;
  rawPngSha256: string;
};

export type PairedPngQuorumRecord = Readonly<{
  bytes: number;
  processIndex: number;
  role: "baseline" | "candidate";
  sha256: string;
}>;

export type PairedPngQuorumTupleDigest = Readonly<{
  processIndex: number;
  sha256: string;
}>;

export type PairedPngQuorumDigestEvidence = Readonly<{
  records: readonly PairedPngQuorumRecord[];
  tupleDigests: readonly PairedPngQuorumTupleDigest[];
}>;

export const MAXIMUM_PAIRED_PNG_QUORUM_BYTES = 4 * 1024 * 1024;

export class PairedPngQuorumError extends Error {
  readonly records: readonly PairedPngQuorumRecord[];
  readonly tupleDigests: readonly PairedPngQuorumTupleDigest[];

  constructor(pairs: readonly IndependentProcessCharacterizationPair[]) {
    const evidence = createPairedPngQuorumDigestEvidence(pairs);
    super("Independent Chromium processes produced no exact byte-identical paired PNG quorum.");
    this.name = "PairedPngQuorumError";
    this.records = evidence.records;
    this.tupleDigests = evidence.tupleDigests;
    Object.freeze(this);
  }
}

const SCREENSHOT_QUORUM_SHA256_SENTINEL =
  "<selected-only-by-exact-independent-process-png-quorum>";

/**
 * Selects a candidate only from a full-byte PNG quorum, without accepting a
 * baseline path or baseline bytes. The manifest belonging to every process
 * must self-attest its raw PNG and all projected non-PNG evidence must agree.
 */
export function selectIndependentProcessCharacterizationQuorum(
  samples: readonly IndependentProcessCharacterizationSample[],
  projectManifest: (value: Uint8Array) => Uint8Array,
) {
  const selectedScreenshot = selectByteIdenticalMajority(
    samples.map((sample) => sample.screenshot),
  );
  const projected = samples.map((sample) => projectProcessSample(sample, projectManifest));
  requireExactProcessBytesAgreement(
    projected.map((sample) => sample.projectedManifest),
    "projected non-PNG characterization manifests",
  );

  const selectedProcessIndexes = samples
    .map((sample, index) => (
      selectedScreenshot.equals(Buffer.from(sample.screenshot)) ? index : -1
    ))
    .filter((index) => index >= 0);
  if (selectedProcessIndexes.length < 2) {
    throw new Error(
      "Independent-process PNG selection did not retain an exact byte quorum.",
    );
  }
  const selectedProcessIndex = selectedProcessIndexes[0] as number;

  return {
    selectedManifest: Buffer.from(samples[selectedProcessIndex]?.manifest as Uint8Array),
    selectedProcessIndex,
    selectedProcessIndexes,
    selectedScreenshot,
    projectedManifestSha256: sha256(projected[0]?.projectedManifest as Uint8Array),
    processes: projected.map((sample, processIndex) => ({
      processIndex,
      rawManifestSha256: sample.rawManifestSha256,
      rawPngSha256: sample.rawPngSha256,
    })),
  };
}

/**
 * Selects one shared browser-process index for both roles. The quorum key is
 * the exact `(baseline PNG, candidate PNG)` byte tuple, so a genuine A/B pixel
 * difference remains intact for the later exact comparison instead of being
 * normalized or rejected before its sanitized mismatch evidence is produced.
 */
export function selectIndependentProcessCharacterizationPairQuorum(
  pairs: readonly IndependentProcessCharacterizationPair[],
  projectManifest: (value: Uint8Array) => Uint8Array,
) {
  if (pairs.length !== EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT) {
    throw new Error(
      "Paired screenshot quorum requires exactly 3 independent Chromium process pairs.",
    );
  }
  const baselineSamples = pairs.map((pair) => pair.baseline);
  const candidateSamples = pairs.map((pair) => pair.candidate);
  const baselineProjected = baselineSamples.map((sample) => (
    projectProcessSample(sample, projectManifest)
  ));
  const candidateProjected = candidateSamples.map((sample) => (
    projectProcessSample(sample, projectManifest)
  ));
  requireExactProcessBytesAgreement(
    baselineProjected.map((sample) => sample.projectedManifest),
    "baseline projected non-PNG characterization manifests",
  );
  requireExactProcessBytesAgreement(
    candidateProjected.map((sample) => sample.projectedManifest),
    "candidate projected non-PNG characterization manifests",
  );

  for (let selectedProcessIndex = 0; selectedProcessIndex < pairs.length;
    selectedProcessIndex += 1) {
    const selectedPair = pairs[selectedProcessIndex] as IndependentProcessCharacterizationPair;
    const selectedProcessIndexes = pairs.flatMap((pair, processIndex) => (
      exactScreenshotPairEquals(pair, selectedPair) ? [processIndex] : []
    ));
    if (selectedProcessIndexes.length < 2) continue;
    return Object.freeze({
      baseline: selectedRoleQuorum(
        baselineSamples,
        baselineProjected,
        selectedProcessIndex,
        selectedProcessIndexes,
      ),
      candidate: selectedRoleQuorum(
        candidateSamples,
        candidateProjected,
        selectedProcessIndex,
        selectedProcessIndexes,
      ),
      selectedProcessIndex,
      selectedProcessIndexes: Object.freeze([...selectedProcessIndexes]),
    });
  }
  throw new PairedPngQuorumError(pairs);
}

export function createPairedPngQuorumDigestEvidence(
  pairs: readonly IndependentProcessCharacterizationPair[],
): PairedPngQuorumDigestEvidence {
  if (pairs.length !== EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT) {
    throw new Error(
      "Paired PNG quorum diagnostics require exactly 3 independent Chromium process pairs.",
    );
  }
  const records: PairedPngQuorumRecord[] = [];
  const tupleDigests: PairedPngQuorumTupleDigest[] = [];
  for (const [processIndex, pair] of pairs.entries()) {
    const screenshots = [pair.baseline.screenshot, pair.candidate.screenshot] as const;
    for (const [roleIndex, role] of (["baseline", "candidate"] as const).entries()) {
      const screenshot = screenshots[roleIndex];
      if (!(screenshot instanceof Uint8Array)
        || screenshot.byteLength < 1
        || screenshot.byteLength > MAXIMUM_PAIRED_PNG_QUORUM_BYTES) {
        throw new Error("Paired PNG quorum diagnostic bytes exceed the exact bounded policy.");
      }
      records.push(Object.freeze({
        bytes: screenshot.byteLength,
        processIndex,
        role,
        sha256: sha256(screenshot),
      }));
    }
    tupleDigests.push(Object.freeze({
      processIndex,
      sha256: pairedPngTupleSha256(pair.baseline.screenshot, pair.candidate.screenshot),
    }));
  }
  if (records.length !== 6 || tupleDigests.length !== 3) {
    throw new Error("Paired PNG quorum diagnostics are incomplete.");
  }
  return Object.freeze({
    records: Object.freeze(records),
    tupleDigests: Object.freeze(tupleDigests),
  });
}

function pairedPngTupleSha256(baseline: Uint8Array, candidate: Uint8Array) {
  const domain = Buffer.from("clean-pay-public-overlap-paired-png-quorum-v1", "utf8");
  const baselineBytes = Buffer.from(baseline);
  const candidateBytes = Buffer.from(candidate);
  const lengths = [baselineBytes.byteLength, candidateBytes.byteLength].map((length) => {
    const encoded = Buffer.alloc(8);
    encoded.writeBigUInt64BE(BigInt(length));
    return encoded;
  });
  return sha256(Buffer.concat([
    domain,
    lengths[0] as Buffer,
    baselineBytes,
    lengths[1] as Buffer,
    candidateBytes,
  ]));
}

function exactScreenshotPairEquals(
  left: IndependentProcessCharacterizationPair,
  right: IndependentProcessCharacterizationPair,
) {
  return Buffer.from(left.baseline.screenshot).equals(Buffer.from(right.baseline.screenshot))
    && Buffer.from(left.candidate.screenshot).equals(Buffer.from(right.candidate.screenshot));
}

function selectedRoleQuorum(
  samples: readonly IndependentProcessCharacterizationSample[],
  projected: readonly ProjectedProcessSample[],
  selectedProcessIndex: number,
  selectedProcessIndexes: readonly number[],
) {
  const selected = samples[selectedProcessIndex] as IndependentProcessCharacterizationSample;
  return Object.freeze({
    selectedManifest: Buffer.from(selected.manifest),
    selectedProcessIndex,
    selectedProcessIndexes: Object.freeze([...selectedProcessIndexes]),
    selectedScreenshot: Buffer.from(selected.screenshot),
    projectedManifestSha256: sha256(
      projected[0]?.projectedManifest as Uint8Array,
    ),
    processes: Object.freeze(projected.map((sample, processIndex) => Object.freeze({
      processIndex,
      rawManifestSha256: sample.rawManifestSha256,
      rawPngSha256: sample.rawPngSha256,
    }))),
  });
}

export function requireExactProcessBytesAgreement(
  values: readonly Uint8Array[],
  evidenceName: string,
) {
  if (values.length !== EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT) {
    throw new Error(
      `${evidenceName} requires exactly `
      + `${EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT} independent process values.`,
    );
  }
  const expected = Buffer.from(values[0] as Uint8Array);
  if (values.slice(1).some((value) => !expected.equals(Buffer.from(value)))) {
    throw new Error(
      `${evidenceName} disagree across independent Chromium processes.`,
    );
  }
  return expected;
}

function projectProcessSample(
  sample: IndependentProcessCharacterizationSample,
  projectManifest: (value: Uint8Array) => Uint8Array,
): ProjectedProcessSample {
  const rawPngSha256 = sha256(sample.screenshot);
  const rawManifest = Buffer.from(sample.manifest);
  const parsed: unknown = JSON.parse(rawManifest.toString("utf8"));
  if (
    !isRecord(parsed)
    || !isRecord(parsed.screenshot)
    || parsed.screenshot.sha256 !== rawPngSha256
  ) {
    throw new Error(
      "Independent-process characterization manifest does not self-attest its raw PNG.",
    );
  }
  const withoutPngSelection = structuredClone(parsed);
  if (!isRecord(withoutPngSelection.screenshot)) {
    throw new Error("Characterization screenshot evidence is malformed.");
  }
  withoutPngSelection.screenshot.sha256 = SCREENSHOT_QUORUM_SHA256_SENTINEL;
  const projectedManifest = Buffer.from(projectManifest(
    Buffer.from(`${JSON.stringify(withoutPngSelection, null, 2)}\n`),
  ));
  return {
    projectedManifest,
    rawManifestSha256: sha256(rawManifest),
    rawPngSha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
