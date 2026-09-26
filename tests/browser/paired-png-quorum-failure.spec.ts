import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  PAIRED_PNG_QUORUM_FAILURE_DIRECTORY,
  PAIRED_PNG_QUORUM_FAILURE_EVIDENCE_FILENAME,
  persistPairedPngQuorumFailureEvidence,
} from "./paired-png-quorum-failure";
import {
  MAXIMUM_PAIRED_PNG_QUORUM_BYTES,
  PairedPngQuorumError,
  type IndependentProcessCharacterizationPair,
} from "./process-quorum";
import {
  PUBLIC_OVERLAP_ROUTES,
  type PublicOverlapRoute,
  sha256,
} from "./public-overlap-evidence";

const firstPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const secondPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=",
  "base64",
);

test("seals one exact bounded six-PNG paired quorum failure bundle", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "clean-pay-paired-png-quorum-"));
  const outputRoot = path.join(temporary, PAIRED_PNG_QUORUM_FAILURE_DIRECTORY);
  const pairs = quorumFailurePairs();
  const error = new PairedPngQuorumError(pairs);
  try {
    const evidence = await persistPairedPngQuorumFailureEvidence({
      error,
      outputRoot,
      pairs,
      project: "chromium-390x844",
      route: PUBLIC_OVERLAP_ROUTES[8],
    });

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      status: "public_overlap_paired_png_quorum_absent",
      case: { project: "chromium-390x844", route: "protected-referral" },
    });
    expect(evidence.records).toHaveLength(6);
    expect(evidence.tupleDigests).toHaveLength(3);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect((await readdir(outputRoot)).sort()).toEqual([
      PAIRED_PNG_QUORUM_FAILURE_EVIDENCE_FILENAME,
      "process-1.baseline.png",
      "process-1.candidate.png",
      "process-2.baseline.png",
      "process-2.candidate.png",
      "process-3.baseline.png",
      "process-3.candidate.png",
    ]);
    const parsed = JSON.parse(await readFile(
      path.join(outputRoot, PAIRED_PNG_QUORUM_FAILURE_EVIDENCE_FILENAME),
      "utf8",
    ));
    expect(parsed).toEqual(evidence);
    for (const record of evidence.records) {
      const bytes = await readFile(path.join(outputRoot, record.filename));
      expect(bytes).toHaveLength(record.bytes);
      expect(sha256(bytes)).toBe(record.sha256);
    }

    await expect(persistPairedPngQuorumFailureEvidence({
      error,
      outputRoot,
      pairs,
      project: "chromium-390x844",
      route: PUBLIC_OVERLAP_ROUTES[8],
    })).rejects.toThrow(/already exists/);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});

test("fails closed for an unbranded error, unallowlisted case, bad PNG, digest drift, and oversize", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "clean-pay-paired-png-reject-"));
  const pairs = quorumFailurePairs();
  const error = new PairedPngQuorumError(pairs);
  const route = PUBLIC_OVERLAP_ROUTES[8];
  const output = (name: string) => path.join(
    temporary,
    name,
    PAIRED_PNG_QUORUM_FAILURE_DIRECTORY,
  );
  try {
    await expect(persistPairedPngQuorumFailureEvidence({
      error: new Error("near miss") as PairedPngQuorumError,
      outputRoot: output("unbranded"),
      pairs,
      project: "chromium-390x844",
      route,
    })).rejects.toThrow(/exact branded error/);
    await expect(persistPairedPngQuorumFailureEvidence({
      error,
      outputRoot: output("project"),
      pairs,
      project: "chromium-390x845",
      route,
    })).rejects.toThrow(/outside the exact allowlist/);
    await expect(persistPairedPngQuorumFailureEvidence({
      error,
      outputRoot: output("route"),
      pairs,
      project: "chromium-390x844",
      route: { ...route, requestPath: "/near-miss" } as unknown as PublicOverlapRoute,
    })).rejects.toThrow(/outside the exact allowlist/);

    const badPngPairs = quorumFailurePairs();
    badPngPairs[0] = {
      ...badPngPairs[0],
      baseline: { ...badPngPairs[0].baseline, screenshot: Buffer.from("not a PNG") },
    };
    await expect(persistPairedPngQuorumFailureEvidence({
      error: new PairedPngQuorumError(badPngPairs),
      outputRoot: output("bad-png"),
      pairs: badPngPairs,
      project: "chromium-390x844",
      route,
    })).rejects.toThrow(/not a bounded PNG/);

    const driftedPairs = quorumFailurePairs();
    driftedPairs[0] = {
      ...driftedPairs[0],
      baseline: { ...driftedPairs[0].baseline, screenshot: secondPng },
    };
    await expect(persistPairedPngQuorumFailureEvidence({
      error,
      outputRoot: output("digest"),
      pairs: driftedPairs,
      project: "chromium-390x844",
      route,
    })).rejects.toThrow(/digests differ/);

    const oversizedPairs = quorumFailurePairs();
    oversizedPairs[0] = {
      ...oversizedPairs[0],
      baseline: {
        ...oversizedPairs[0].baseline,
        screenshot: Buffer.alloc(MAXIMUM_PAIRED_PNG_QUORUM_BYTES + 1),
      },
    };
    await expect(persistPairedPngQuorumFailureEvidence({
      error,
      outputRoot: output("oversize"),
      pairs: oversizedPairs,
      project: "chromium-390x844",
      route,
    })).rejects.toThrow(/exceed the exact bounded policy/);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});

function quorumFailurePairs(): IndependentProcessCharacterizationPair[] {
  return [
    pair(firstPng, firstPng),
    pair(firstPng, secondPng),
    pair(secondPng, firstPng),
  ];
}

function pair(
  baseline: Uint8Array,
  candidate: Uint8Array,
): IndependentProcessCharacterizationPair {
  return {
    baseline: { manifest: Buffer.from("{}"), screenshot: Buffer.from(baseline) },
    candidate: { manifest: Buffer.from("{}"), screenshot: Buffer.from(candidate) },
  };
}
