import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { BEHAVIORAL_BASELINE_COMMIT } from "../baseline-policy";
import { authenticatedJourneyLivePairCaptureEnvironment } from "./authenticated-journey-capture-mode";
import { journeyBaselineRoot } from "./journey-baseline-policy";
import {
  JOURNEY_LIVE_PAIR_ARTIFACT_PATHS,
  JOURNEY_LIVE_PAIR_CASES,
  JOURNEY_LIVE_PAIR_PROJECTS,
  assertJourneyLivePairCaptureReady,
  createJourneyLivePairStackBinding,
  journeyLivePairBindingSha256,
  journeyLivePairCaptureEnvironment,
  prepareJourneyLivePairEvidence,
  resolveJourneyLivePairRoot,
  sealJourneyLivePairCapture,
  writeJourneyLivePairCase,
} from "./journey-live-pair-evidence";
import { currentJourneyFixtureContractSha256 } from "./journey-fixture-contract";
import { proveJourneyLivePair } from "./journey-live-pair-proof";
import { createSanitizedHarContract } from "./sanitized-har";

test("defines the exact 18-case, 105-PNG, 141-raw-artifact live-pair matrix", () => {
  expect(JOURNEY_LIVE_PAIR_PROJECTS).toHaveLength(3);
  expect(Object.keys(JOURNEY_LIVE_PAIR_CASES)).toHaveLength(6);
  expect(JOURNEY_LIVE_PAIR_ARTIFACT_PATHS).toHaveLength(141);
  expect(JOURNEY_LIVE_PAIR_ARTIFACT_PATHS.filter((value) => value.endsWith(".png")))
    .toHaveLength(105);
  expect(JOURNEY_LIVE_PAIR_ARTIFACT_PATHS.filter((value) => value.endsWith("journey.json")))
    .toHaveLength(18);
  expect(JOURNEY_LIVE_PAIR_ARTIFACT_PATHS.filter((value) => value.endsWith("network.har.json")))
    .toHaveLength(18);
  expect(new Set(JOURNEY_LIVE_PAIR_ARTIFACT_PATHS).size).toBe(141);
});

test("pins an exact local CLI and publishes completion only after owned cleanup", async () => {
  const cliPath = path.join(
    process.cwd(),
    "tests/browser/journeys/prove-authenticated-journey-live-pair.mjs",
  );
  const source = await readFile(cliPath, "utf8");
  const pairStart = source.indexOf("const session = await withJourneyOwnedStackPair({");
  const proxyCleanup = source.indexOf("stopAndGateProxy(proxies.baseline)", pairStart);
  const proof = source.indexOf("const proof = await livePair.proveJourneyLivePair({", pairStart);
  expect(pairStart).toBeGreaterThan(-1);
  expect(proxyCleanup).toBeGreaterThan(pairStart);
  expect(proof).toBeGreaterThan(proxyCleanup);
  expect(source).toContain("const captureSettlements = await Promise.allSettled(");
  expect(source).toContain("[\"baseline\", \"candidate\"].map(async (role) => {");
  expect(source).toContain("Both authenticated live-pair browser captures must settle");
  expect(source).toContain("function startFullJourneyConnectProxy(");
  expect(source).toContain("function validFullJourneyProxyStopped(");
  expect(source).toContain("AuthenticatedJourneyConnectStartError");
  expect(source).toContain("terminateFailedJourneyConnectProxy");
  expect(source).toContain('handle.child.kill("SIGKILL")');
  expect(source).toContain("assertFullJourneyConnectProxyListenerAbsent");
  expect(source).toContain("listener remains after process cleanup");
  expect(source).not.toContain("CLEAN_PAY_BROWSER_CONNECT_AUTHORITY_LEDGER");
  expect(source).not.toContain("accepted > 16");
  expect(source).toContain(
    "baseline.contract.revision !== \"f5cb6f543d85256e7733a1ade6a4f451d86cf378\"",
  );
  expect(source).toContain("candidate.contract.revision === baseline.contract.revision");
  expect(source).toContain("process.execPath");
  expect(source).toContain("localPlaywrightCli");
  expect(source).not.toContain("npx");
  expect(source).not.toContain("CLEAN_PAY_UPDATE_JOURNEY_BASELINE");
  for (const flag of [
    "--baseline-contract",
    "--baseline-asset-attestation",
    "--baseline-asset-image-digest",
    "--baseline-migration-asset-image-digest",
    "--candidate-contract",
    "--candidate-asset-attestation",
    "--candidate-asset-image-digest",
    "--candidate-migration-asset-image-digest",
    "--capture-id",
  ]) {
    expect(source).toContain(`\"${flag}\"`);
  }
  const childEnvironment = { ...process.env };
  delete childEnvironment.FORCE_COLOR;
  delete childEnvironment.NO_COLOR;
  const noArguments = spawnSync(process.execPath, [cliPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnvironment,
    windowsHide: true,
  });
  expect(noArguments.status).toBe(1);
  expect(noArguments.stdout).toBe("");
  expect(JSON.parse(noArguments.stderr)).toMatchObject({
    status: "authenticated_journey_live_pair_failed",
  });
});

test("refuses a reused capture identity and every non-f5 or non-distinct pair", async () => {
  const captureId = randomBytes(8).toString("hex");
  const root = resolveJourneyLivePairRoot(captureId);
  const { baseline, candidate } = await fixtureBindings();
  try {
    await prepareJourneyLivePairEvidence({ captureId, baseline, candidate });
    await expect(prepareJourneyLivePairEvidence({ captureId, baseline, candidate }))
      .rejects.toMatchObject({ code: "EEXIST" });
    expect(() => createJourneyLivePairStackBinding({
      ...candidate,
      source: { ...candidate.source, revision: BEHAVIORAL_BASELINE_COMMIT },
    })).not.toThrow();
    await expect(prepareJourneyLivePairEvidence({
      captureId: randomBytes(8).toString("hex"),
      baseline,
      candidate: createJourneyLivePairStackBinding({
        ...candidate,
        source: { ...candidate.source, revision: BEHAVIORAL_BASELINE_COMMIT },
      }),
    })).rejects.toThrow(/bindings are not exact and distinct/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("seals and proves an exact ephemeral authenticated live pair only after cleanup", async () => {
  test.setTimeout(60_000);
  const captureId = randomBytes(8).toString("hex");
  const root = resolveJourneyLivePairRoot(captureId);
  const { baseline, candidate } = await fixtureBindings();
  try {
    const prepared = await prepareJourneyLivePairEvidence({ captureId, baseline, candidate });
    const environments = {
      baseline: {
        ...authenticatedJourneyLivePairCaptureEnvironment(),
        ...journeyLivePairCaptureEnvironment({
          captureId,
          ownership: prepared.roles.baseline,
        }),
      },
      candidate: {
        ...authenticatedJourneyLivePairCaptureEnvironment(),
        ...journeyLivePairCaptureEnvironment({
          captureId,
          ownership: prepared.roles.candidate,
        }),
      },
    } as const;
    await assertJourneyLivePairCaptureReady(environments.baseline);
    await assertJourneyLivePairCaptureReady(environments.candidate);
    await captureRole("baseline", environments.baseline, baseline);
    await captureRole("candidate", environments.candidate, candidate);
    const baselineSeal = await sealJourneyLivePairCapture(environments.baseline);
    const candidateSeal = await sealJourneyLivePairCapture(environments.candidate);
    expect(baselineSeal.receipt.rawArtifactCount).toBe(141);
    expect(candidateSeal.receipt.checkpointPngCount).toBe(105);

    const cleanup = {
      status: "authenticated-journey-live-pair-cleaned" as const,
      stacks: [
        {
          role: "baseline" as const,
          status: "verifier-owned-stack-cleaned" as const,
          projectSha256: baseline.runtime.projectSha256,
          generatedEnvironmentDirectorySha256:
            baseline.runtime.generatedEnvironmentDirectorySha256,
        },
        {
          role: "candidate" as const,
          status: "verifier-owned-stack-cleaned" as const,
          projectSha256: candidate.runtime.projectSha256,
          generatedEnvironmentDirectorySha256:
            candidate.runtime.generatedEnvironmentDirectorySha256,
        },
      ] as const,
      connectProxies: [
        {
          role: "baseline" as const,
          status: "stopped-and-verified-absent" as const,
          summarySha256: "a".repeat(64),
        },
        {
          role: "candidate" as const,
          status: "stopped-and-verified-absent" as const,
          summarySha256: "b".repeat(64),
        },
      ] as const,
    };
    await expect(proveJourneyLivePair({
      captureId,
      pairOwnershipSha256: prepared.pairReceiptSha256,
      baseline: {
        bindingSha256: journeyLivePairBindingSha256(baseline),
        ownershipSha256: prepared.roles.baseline.receiptSha256,
      },
      candidate: {
        bindingSha256: journeyLivePairBindingSha256(candidate),
        ownershipSha256: prepared.roles.candidate.receiptSha256,
      },
      cleanup: {
        ...cleanup,
        stacks: [cleanup.stacks[0], {
          ...cleanup.stacks[1],
          projectSha256: "f".repeat(64),
        }],
      },
    })).rejects.toThrow(/cleanup evidence is not bound/);
    const proof = await proveJourneyLivePair({
      captureId,
      pairOwnershipSha256: prepared.pairReceiptSha256,
      baseline: {
        bindingSha256: journeyLivePairBindingSha256(baseline),
        ownershipSha256: prepared.roles.baseline.receiptSha256,
      },
      candidate: {
        bindingSha256: journeyLivePairBindingSha256(candidate),
        ownershipSha256: prepared.roles.candidate.receiptSha256,
      },
      cleanup,
    });
    expect(proof.proof.comparison).toMatchObject({
      rawArtifactsPerRole: 141,
      journeyJsonPairs: 18,
      sanitizedHarPairs: 18,
      checkpointPngPairs: 105,
    });
    expect(proof.completion).toMatchObject({
      status: "completed-after-exact-cleanup",
      retainedRawArtifactCount: 282,
    });
    expect(await readFile(path.join(root, "completion.json"), "utf8"))
      .toContain("completed-after-exact-cleanup");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function fixtureBindings() {
  const example = JSON.parse(await readFile(path.join(
    journeyBaselineRoot,
    "journey-390x844",
    "email-register-verify-and-login",
    "journey.json",
  ), "utf8"));
  const source = example.source as {
    revision: string;
    imageDigest: string;
    imageTag: string;
    migrationImageDigest: string;
    migrationImageTag: string;
    publicBuildContract: { sha256: string };
    fixtureContract: { sha256: string };
  };
  const baseline = createJourneyLivePairStackBinding({
    schemaVersion: 1,
    role: "baseline",
    source: {
      revision: BEHAVIORAL_BASELINE_COMMIT,
      imageDigest: source.imageDigest,
      imageTag: source.imageTag,
      migrationImageDigest: source.migrationImageDigest,
      migrationImageTag: source.migrationImageTag,
      publicBuildContractSha256: source.publicBuildContract.sha256,
      fixtureContractSha256: currentJourneyFixtureContractSha256(),
    },
    runtime: {
      projectSha256: "1".repeat(64),
      generatedEnvironmentDirectorySha256: "2".repeat(64),
      launchReceiptSha256: "3".repeat(64),
      runtimeAttestationSha256: "4".repeat(64),
    },
  });
  const candidate = createJourneyLivePairStackBinding({
    schemaVersion: 1,
    role: "candidate",
    source: {
      revision: "b".repeat(40),
      imageDigest: `sha256:${"5".repeat(64)}`,
      imageTag: "clean-pay:contract-candidate",
      migrationImageDigest: `sha256:${"6".repeat(64)}`,
      migrationImageTag: "clean-pay-migration:contract-candidate",
      publicBuildContractSha256: source.publicBuildContract.sha256,
      fixtureContractSha256: currentJourneyFixtureContractSha256(),
    },
    runtime: {
      projectSha256: "7".repeat(64),
      generatedEnvironmentDirectorySha256: "8".repeat(64),
      launchReceiptSha256: "9".repeat(64),
      runtimeAttestationSha256: "a".repeat(64),
    },
  });
  return { baseline, candidate };
}

async function captureRole(
  role: "baseline" | "candidate",
  environment: Readonly<Record<string, string>>,
  binding: ReturnType<typeof createJourneyLivePairStackBinding>,
) {
  for (const project of JOURNEY_LIVE_PAIR_PROJECTS) {
    for (const [journey, labels] of Object.entries(JOURNEY_LIVE_PAIR_CASES)) {
      const sourceDirectory = path.join(journeyBaselineRoot, project, journey);
      const rawEvidence = await readFile(path.join(sourceDirectory, "journey.json"));
      const rawHar = await readFile(path.join(sourceDirectory, "network.har.json"));
      const journeyEvidence = role === "baseline"
        ? liveBaselineJourneyBytes(rawEvidence, binding)
        : candidateJourneyBytes(rawEvidence, binding);
      const networkEvidence = role === "baseline"
        ? liveBaselineHarBytes(rawHar, binding)
        : candidateHarBytes(rawHar, binding);
      const screenshots = await Promise.all(labels.map(async (label) => ({
        label,
        bytes: await readFile(path.join(sourceDirectory, "screenshots", `${label}.png`)),
      })));
      await writeJourneyLivePairCase({
        project,
        journeyId: journey,
        networkEvidence,
        rawEvidence: journeyEvidence,
        screenshots,
        environment,
      });
    }
  }
}

function candidateJourneyBytes(
  value: Uint8Array,
  binding: ReturnType<typeof createJourneyLivePairStackBinding>,
) {
  const parsed = JSON.parse(Buffer.from(value).toString("utf8"));
  parsed.source = candidateSource(parsed.source, binding);
  replacePwaCacheNames(parsed, `clean-pay-shell-${binding.source.revision}`);
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function liveBaselineJourneyBytes(
  value: Uint8Array,
  binding: ReturnType<typeof createJourneyLivePairStackBinding>,
) {
  const parsed = JSON.parse(Buffer.from(value).toString("utf8"));
  parsed.source = liveSource(parsed.source, binding);
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function candidateHarBytes(
  value: Uint8Array,
  binding: ReturnType<typeof createJourneyLivePairStackBinding>,
) {
  const parsed = JSON.parse(Buffer.from(value).toString("utf8"));
  parsed._cleanPay.source = candidateSource(parsed._cleanPay.source, binding);
  replacePwaCacheNames(parsed._cleanPay, `clean-pay-shell-${binding.source.revision}`);
  return Buffer.from(`${JSON.stringify(createSanitizedHarContract(parsed._cleanPay), null, 2)}\n`);
}

function liveBaselineHarBytes(
  value: Uint8Array,
  binding: ReturnType<typeof createJourneyLivePairStackBinding>,
) {
  const parsed = JSON.parse(Buffer.from(value).toString("utf8"));
  parsed._cleanPay.source = liveSource(parsed._cleanPay.source, binding);
  return Buffer.from(`${JSON.stringify(createSanitizedHarContract(parsed._cleanPay), null, 2)}\n`);
}

function candidateSource(
  current: Record<string, unknown>,
  binding: ReturnType<typeof createJourneyLivePairStackBinding>,
) {
  return {
    ...liveSource(current, binding),
    revision: binding.source.revision,
    imageDigest: binding.source.imageDigest,
    imageTag: binding.source.imageTag,
    migrationImageDigest: binding.source.migrationImageDigest,
    migrationImageTag: binding.source.migrationImageTag,
  };
}

function liveSource(
  current: Record<string, unknown>,
  binding: ReturnType<typeof createJourneyLivePairStackBinding>,
) {
  return {
    ...current,
    revision: binding.source.revision,
    imageDigest: binding.source.imageDigest,
    imageTag: binding.source.imageTag,
    migrationImageDigest: binding.source.migrationImageDigest,
    migrationImageTag: binding.source.migrationImageTag,
    fixtureContract: {
      version: "journey-v5",
      sha256: binding.source.fixtureContractSha256,
    },
  };
}

function replacePwaCacheNames(value: unknown, replacement: string) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (typeof value[index] === "string" && /^clean-pay-shell-/.test(value[index])) {
        value[index] = replacement;
      } else {
        replacePwaCacheNames(value[index], replacement);
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && /^clean-pay-shell-/.test(entry)) {
      (value as Record<string, unknown>)[key] = replacement;
    } else {
      replacePwaCacheNames(entry, replacement);
    }
  }
}
