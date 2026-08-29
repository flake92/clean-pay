import path from "node:path";

import {
  projectJourneyEvidencePairBytes,
  projectJourneyHarEvidencePairBytes,
} from "./journey-baseline-policy";
import {
  JOURNEY_LIVE_PAIR_ARTIFACT_PATHS,
  readJourneyLivePairArtifact,
  readJourneyLivePairCapture,
  readJourneyLivePairPairOwnership,
  resolveJourneyLivePairRoot,
  sha256,
  writeJourneyLivePairCompletionFile,
} from "./journey-live-pair-evidence";
import { PINNED_JOURNEY_V5_FIXTURE_SHA256 } from "./journey-fixture-contract";
import { assertExactJourneyKeyboardSkipLinkScreenshot } from "./journey-skip-link-policy";
import { createSanitizedHarContract } from "./sanitized-har";

type CaptureIdentity = Readonly<{
  bindingSha256: string;
  ownershipSha256: string;
}>;

export type JourneyLivePairCleanupEvidence = Readonly<{
  status: "authenticated-journey-live-pair-cleaned";
  stacks: readonly [
    Readonly<{
      role: "baseline";
      status: "verifier-owned-stack-cleaned";
      projectSha256: string;
      generatedEnvironmentDirectorySha256: string;
    }>,
    Readonly<{
      role: "candidate";
      status: "verifier-owned-stack-cleaned";
      projectSha256: string;
      generatedEnvironmentDirectorySha256: string;
    }>,
  ];
  connectProxies: readonly [
    Readonly<{
      role: "baseline";
      status: "stopped-and-verified-absent";
      summarySha256: string;
    }>,
    Readonly<{
      role: "candidate";
      status: "stopped-and-verified-absent";
      summarySha256: string;
    }>,
  ];
}>;

export async function proveJourneyLivePair(options: {
  captureId: string;
  pairOwnershipSha256: string;
  baseline: CaptureIdentity;
  candidate: CaptureIdentity;
  cleanup: JourneyLivePairCleanupEvidence;
}) {
  const pairOwnership = await readJourneyLivePairPairOwnership(options.captureId);
  if (pairOwnership.sha256 !== exactDigest(options.pairOwnershipSha256, "pair ownership")) {
    throw new Error("Journey live-pair pair ownership digest changed.");
  }
  assertPairOwnership(pairOwnership.value, options);
  const captures = {
    baseline: await readJourneyLivePairCapture({
      captureId: options.captureId,
      role: "baseline",
      ...options.baseline,
    }),
    candidate: await readJourneyLivePairCapture({
      captureId: options.captureId,
      role: "candidate",
      ...options.candidate,
    }),
  } as const;
  const cleanup = assertCleanupEvidence(options.cleanup, captures);
  const comparisons = [];
  const journeyEvidence = new Map<string, { baseline: Buffer; candidate: Buffer }>();
  for (const relativePath of JOURNEY_LIVE_PAIR_ARTIFACT_PATHS) {
    if (relativePath.endsWith("/journey.json")) {
      journeyEvidence.set(path.posix.dirname(relativePath), {
        baseline: await readJourneyLivePairArtifact(captures.baseline.root, relativePath),
        candidate: await readJourneyLivePairArtifact(captures.candidate.root, relativePath),
      });
    }
  }
  for (const relativePath of JOURNEY_LIVE_PAIR_ARTIFACT_PATHS) {
    const [baselineBytes, candidateBytes] = await Promise.all([
      readJourneyLivePairArtifact(captures.baseline.root, relativePath),
      readJourneyLivePairArtifact(captures.candidate.root, relativePath),
    ]);
    let comparison: "strict-pair-json" | "strict-pair-har" | "byte-exact-png" | "skip-link-allowlisted-png";
    let baselineProjected = baselineBytes;
    let candidateProjected = candidateBytes;
    if (relativePath.endsWith("/journey.json")) {
      const projected = projectJourneyEvidencePairBytes(
        adaptLiveBaselineFixtureForStrictProjection(baselineBytes, false),
        candidateBytes,
      );
      baselineProjected = projected.expected;
      candidateProjected = projected.actual;
      comparison = "strict-pair-json";
    } else if (relativePath.endsWith("/network.har.json")) {
      const projected = projectJourneyHarEvidencePairBytes(
        adaptLiveBaselineFixtureForStrictProjection(baselineBytes, true),
        candidateBytes,
      );
      baselineProjected = projected.expected;
      candidateProjected = projected.actual;
      comparison = "strict-pair-har";
    } else {
      const identity = screenshotIdentity(relativePath);
      const caseEvidence = journeyEvidence.get(identity.caseDirectory);
      if (!caseEvidence) {
        throw new Error("Journey live-pair screenshot lost its case evidence binding.");
      }
      const exact = baselineBytes.equals(candidateBytes);
      const allowlisted = !exact && await assertExactJourneyKeyboardSkipLinkScreenshot({
        project: identity.project,
        journeyId: identity.journey,
        label: identity.label,
        expectedEvidence: caseEvidence.baseline,
        actualEvidence: caseEvidence.candidate,
        expectedPng: baselineBytes,
        actualPng: candidateBytes,
      });
      if (!exact && !allowlisted) {
        throw new Error(`Journey live-pair PNG differs outside the exact allowlist: ${relativePath}.`);
      }
      comparison = exact ? "byte-exact-png" : "skip-link-allowlisted-png";
    }
    if (!baselineProjected.equals(candidateProjected)) {
      throw new Error(
        `Journey live-pair strict projection differs: ${relativePath} `
        + `at ${firstJsonDifferencePath(baselineProjected, candidateProjected)}.`,
      );
    }
    comparisons.push(Object.freeze({
      path: relativePath,
      comparison,
      baseline: Object.freeze({
        bytes: baselineBytes.byteLength,
        rawSha256: sha256(baselineBytes),
        projectedSha256: sha256(baselineProjected),
      }),
      candidate: Object.freeze({
        bytes: candidateBytes.byteLength,
        rawSha256: sha256(candidateBytes),
        projectedSha256: sha256(candidateProjected),
      }),
    }));
  }
  if (
    comparisons.length !== 141
    || comparisons.filter(({ comparison }) => comparison.endsWith("png")).length !== 105
    || comparisons.filter(({ comparison }) => comparison === "strict-pair-json").length !== 18
    || comparisons.filter(({ comparison }) => comparison === "strict-pair-har").length !== 18
  ) {
    throw new Error("Journey live-pair comparison ledger is incomplete.");
  }
  const proof = Object.freeze({
    schemaVersion: 1 as const,
    kind: "clean-pay-authenticated-journey-live-pair-proof" as const,
    suite: "authenticated-journey-live-pair-v1" as const,
    captureId: options.captureId,
    status: "strict-live-pair-match" as const,
    pairOwnershipSha256: pairOwnership.sha256,
    captures: Object.freeze({
      baseline: Object.freeze({
        bindingSha256: options.baseline.bindingSha256,
        ownershipSha256: options.baseline.ownershipSha256,
        receiptSha256: captures.baseline.receiptSha256,
        inventorySha256: captures.baseline.receipt.inventorySha256,
      }),
      candidate: Object.freeze({
        bindingSha256: options.candidate.bindingSha256,
        ownershipSha256: options.candidate.ownershipSha256,
        receiptSha256: captures.candidate.receiptSha256,
        inventorySha256: captures.candidate.receipt.inventorySha256,
      }),
    }),
    cleanup,
    comparison: Object.freeze({
      rawArtifactsPerRole: 141,
      journeyJsonPairs: 18,
      sanitizedHarPairs: 18,
      checkpointPngPairs: 105,
      pngPolicy: "byte-exact-except-existing-exact-skip-link-allowlist",
      ledgerSha256: sha256(JSON.stringify(comparisons)),
      ledger: Object.freeze(comparisons),
    }),
  });
  const proofBytes = jsonBytes(proof);
  await writeJourneyLivePairCompletionFile(options.captureId, "pair-proof.json", proofBytes);

  // Re-read every sealed role after proof creation. completion.json is the
  // pair-level completion marker and is written only after stack/proxy cleanup
  // and post-comparison raw-evidence immutability checks both succeeded.
  const finalCaptures = await Promise.all((["baseline", "candidate"] as const).map((role) => (
    readJourneyLivePairCapture({
      captureId: options.captureId,
      role,
      ...(role === "baseline" ? options.baseline : options.candidate),
    })
  )));
  if (
    finalCaptures[0].receiptSha256 !== captures.baseline.receiptSha256
    || finalCaptures[1].receiptSha256 !== captures.candidate.receiptSha256
    || (await readJourneyLivePairPairOwnership(options.captureId)).sha256 !== pairOwnership.sha256
  ) {
    throw new Error("Journey live-pair raw evidence changed after comparison.");
  }
  const completion = Object.freeze({
    schemaVersion: 1 as const,
    kind: "clean-pay-authenticated-journey-live-pair-completion" as const,
    captureId: options.captureId,
    status: "completed-after-exact-cleanup" as const,
    pairOwnershipSha256: pairOwnership.sha256,
    proofSha256: sha256(proofBytes),
    retainedRawArtifactCount: 282,
    captureReceiptSha256s: Object.freeze({
      baseline: finalCaptures[0].receiptSha256,
      candidate: finalCaptures[1].receiptSha256,
    }),
  });
  const completionBytes = jsonBytes(completion);
  await writeJourneyLivePairCompletionFile(
    options.captureId,
    "completion.json",
    completionBytes,
  );
  return Object.freeze({
    root: resolveJourneyLivePairRoot(options.captureId),
    proof,
    proofSha256: sha256(proofBytes),
    completion,
    completionSha256: sha256(completionBytes),
  });
}

function assertPairOwnership(
  value: Record<string, unknown>,
  options: {
    captureId: string;
    baseline: CaptureIdentity;
    candidate: CaptureIdentity;
  },
) {
  if (
    !hasExactKeys(value, ["captureId", "kind", "roles", "schemaVersion", "suite"])
    || value.schemaVersion !== 1
    || value.kind !== "clean-pay-authenticated-journey-live-pair"
    || value.suite !== "authenticated-journey-live-pair-v1"
    || value.captureId !== options.captureId
    || !Array.isArray(value.roles)
    || value.roles.length !== 2
  ) {
    throw new Error("Journey live-pair pair ownership receipt is invalid.");
  }
  for (const [index, role] of (["baseline", "candidate"] as const).entries()) {
    const entry = value.roles[index];
    const expected = options[role];
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, ["bindingSha256", "ownershipSha256", "role"])
      || entry.role !== role
      || entry.bindingSha256 !== expected.bindingSha256
      || entry.ownershipSha256 !== expected.ownershipSha256
    ) {
      throw new Error("Journey live-pair pair ownership role binding changed.");
    }
  }
}

function assertCleanupEvidence(
  value: JourneyLivePairCleanupEvidence,
  captures: {
    baseline: Awaited<ReturnType<typeof readJourneyLivePairCapture>>;
    candidate: Awaited<ReturnType<typeof readJourneyLivePairCapture>>;
  },
) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["connectProxies", "stacks", "status"])
    || value.status !== "authenticated-journey-live-pair-cleaned"
    || !Array.isArray(value.stacks)
    || value.stacks.length !== 2
    || !Array.isArray(value.connectProxies)
    || value.connectProxies.length !== 2
  ) {
    throw new Error("Journey live-pair cleanup evidence is invalid.");
  }
  for (const [index, role] of (["baseline", "candidate"] as const).entries()) {
    const stack = value.stacks[index];
    const proxy = value.connectProxies[index];
    const runtime = captures[role].ownership.receipt.binding.runtime;
    if (
      !isRecord(stack)
      || !hasExactKeys(stack, [
        "generatedEnvironmentDirectorySha256", "projectSha256", "role", "status",
      ])
      || stack.role !== role
      || stack.status !== "verifier-owned-stack-cleaned"
      || stack.projectSha256 !== runtime.projectSha256
      || stack.generatedEnvironmentDirectorySha256
        !== runtime.generatedEnvironmentDirectorySha256
      || !isRecord(proxy)
      || !hasExactKeys(proxy, ["role", "status", "summarySha256"])
      || proxy.role !== role
      || proxy.status !== "stopped-and-verified-absent"
      || !/^[a-f0-9]{64}$/.test(String(proxy.summarySha256))
    ) {
      throw new Error("Journey live-pair cleanup evidence is not bound to both owned stacks.");
    }
  }
  return Object.freeze({
    status: value.status,
    stacks: Object.freeze(value.stacks.map((entry) => Object.freeze({ ...entry }))),
    connectProxies: Object.freeze(value.connectProxies.map((entry) => Object.freeze({ ...entry }))),
  });
}

function screenshotIdentity(relativePath: string) {
  const segments = relativePath.split("/");
  if (
    segments.length !== 5
    || segments[2] !== "screenshots"
    || !segments[4]?.endsWith(".png")
  ) {
    // Exact path is project/journey/screenshots/label.png: four segments.
    if (segments.length !== 4 || segments[2] !== "screenshots" || !segments[3]?.endsWith(".png")) {
      throw new Error("Journey live-pair PNG path is invalid.");
    }
  }
  const project = segments[0]!;
  const journey = segments[1]!;
  const filename = segments.at(-1)!;
  return {
    project,
    journey,
    label: filename.slice(0, -4),
    caseDirectory: `${project}/${journey}`,
  };
}

function exactDigest(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Journey live-pair ${label} digest is invalid.`);
  }
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function adaptLiveBaselineFixtureForStrictProjection(
  bytes: Uint8Array,
  har: boolean,
) {
  const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const source = har ? value?._cleanPay?.source : value?.source;
  if (
    !isRecord(source)
    || !isRecord(source.fixtureContract)
    || source.fixtureContract.version !== "journey-v5"
    || typeof source.fixtureContract.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(source.fixtureContract.sha256)
  ) {
    throw new Error("Journey live-pair baseline fixture binding cannot enter strict projection.");
  }
  source.fixtureContract.sha256 = PINNED_JOURNEY_V5_FIXTURE_SHA256;
  return har
    ? Buffer.from(`${JSON.stringify(createSanitizedHarContract(value._cleanPay), null, 2)}\n`)
    : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function firstJsonDifferencePath(expectedBytes: Uint8Array, actualBytes: Uint8Array) {
  let expected: unknown;
  let actual: unknown;
  try {
    expected = JSON.parse(Buffer.from(expectedBytes).toString("utf8"));
    actual = JSON.parse(Buffer.from(actualBytes).toString("utf8"));
  } catch {
    return "<non-json-projection>";
  }
  const visit = (left: unknown, right: unknown, location: string): string | null => {
    if (Object.is(left, right)) return null;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return `${location}.length`;
      for (let index = 0; index < left.length; index += 1) {
        const difference = visit(left[index], right[index], `${location}[${index}]`);
        if (difference) return difference;
      }
      return null;
    }
    if (isRecord(left) && isRecord(right)) {
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();
      if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) return `${location}.<keys>`;
      for (const key of leftKeys) {
        const difference = visit(left[key], right[key], `${location}.${key}`);
        if (difference) return difference;
      }
      return null;
    }
    return location;
  };
  return visit(expected, actual, "$") ?? "<byte-format-only>";
}
