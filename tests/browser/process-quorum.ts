import { createHash } from "node:crypto";

import {
  EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT,
  selectByteIdenticalMajority,
} from "./screenshot-majority";

export type IndependentProcessCharacterizationSample = {
  manifest: Uint8Array;
  screenshot: Uint8Array;
};

type ProjectedProcessSample = {
  projectedManifest: Buffer;
  rawManifestSha256: string;
  rawPngSha256: string;
};

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
