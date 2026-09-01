import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertBehavioralBaselineCleanupCapability,
  chatwootProofArguments,
  createLiveOverlapPlan,
  createRunnerChatwootLiveProofPlan,
  exactPersistedRoleProofInput,
  isProviderDiagnosticExecutionMode,
  parseLiveOverlapArguments,
  proofArguments,
  providerProofArguments,
  resolveLiveOverlapProviderExecutionMode,
  validateChatwootArtifactManifest,
  validateChatwootEvidenceCleanupCapability,
  validateLiveOverlapImageInspection,
  validateLiveOverlapOwnership,
  validateLiveOverlapPhaseFailure,
  validateLiveOverlapPhaseReceipt,
} from "../../../tests/browser/journeys/run-production-image-live-overlap.mjs";
import { expectedChatwootScreenshotPaths } from "../../../tests/browser/journeys/chatwoot-phase-evidence-writer.mjs";
import {
  AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
  assertUnverifiedEmailLoginProof,
} from "../../../tests/browser/journeys/unverified-email-login-proof-contract.mjs";
import {
  AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF,
  assertLinkedEmailFailureProof,
} from "../../../tests/browser/journeys/linked-email-failure-proof-contract.mjs";

const baselineRevision = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const candidateRevision = "b0cbdddbbbbc537b9f15bcfdbf4a0fa86d3c65b4";
const captureId = "0123456789abcdef";
const externalTemporaryRoot = path.join(tmpdir(), "clean-pay-external-ci-temp");
const runner = readFileSync(
  "tests/browser/journeys/run-production-image-live-overlap.mjs",
  "utf8",
);
const fixedRunner = readFileSync(
  "tests/browser/journeys/run-production-image-journey.mjs",
  "utf8",
);
const authenticatedRunner = readFileSync(
  "tests/browser/journeys/prove-authenticated-journey-live-pair.mjs",
  "utf8",
);
const fixtureManifest = readFileSync(
  "tests/browser/journeys/journey-fixture-manifest.mjs",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const unverifiedEmailRegression = readFileSync(
  "tests/browser/journeys/existing-unverified-email.candidate.spec.ts",
  "utf8",
);
const linkedEmailFailureRegression = readFileSync(
  "tests/browser/journeys/linked-email-failure.candidate.spec.ts",
  "utf8",
);
const providerMock = readFileSync(
  "tests/browser/journeys/provider-mock.mjs",
  "utf8",
);

type ChatwootRunnerStack = {
  assetAttestationPath: string;
  images: {
    application: { digest: string };
    migration: { digest: string };
  };
  project: string;
  resolverIp: string;
};

type ChatwootRunnerPlan = {
  pairs: Array<{
    baseline: ChatwootRunnerStack;
    candidate: ChatwootRunnerStack;
  }>;
};

function plan() {
  return createLiveOverlapPlan({
    captureId,
    candidateRevision,
    temporaryRoot: externalTemporaryRoot,
  });
}

function proofInputs() {
  return {
    baseline: {
      contractPath: path.join(externalTemporaryRoot, "baseline-contract.json"),
      assetAttestationPath: path.join(externalTemporaryRoot, "baseline-assets.json"),
      assetImageDigest: `sha256:${"1".repeat(64)}`,
      controlUrl: "http://127.0.0.1:43100/",
      migrationAssetImageDigest: `sha256:${"2".repeat(64)}`,
      resolverIp: "127.0.0.21",
    },
    candidate: {
      contractPath: path.join(externalTemporaryRoot, "candidate-contract.json"),
      assetAttestationPath: path.join(externalTemporaryRoot, "candidate-assets.json"),
      assetImageDigest: `sha256:${"3".repeat(64)}`,
      controlUrl: "http://127.0.0.1:43200/",
      migrationAssetImageDigest: `sha256:${"4".repeat(64)}`,
      resolverIp: "127.0.0.22",
    },
  };
}

const phaseNames = [
  "preparation",
  "build",
  "attestation",
  "public",
  "provider",
  "authenticated",
  "chatwoot",
  "evidence",
] as const;
const phaseOwnershipSha256 = "a".repeat(64);
const phasePublicBuildContract = {
  sha256: "b".repeat(64),
  version: "1",
};

function validPhaseResult(phase: typeof phaseNames[number]) {
  const digest = "c".repeat(64);
  const imageDigest = "sha256:" + "d".repeat(64);
  if (phase === "preparation") {
    return {
      baselineArchiveSha256:
        "6ccdccdd162ede951850759392a72376792988080307b4e29ae0cffef2397a03",
      baselineReceiptSha256: digest,
      status: "immutable-baseline-owned",
    };
  }
  if (phase === "build") {
    return {
      imageCount: 4,
      imageTagSha256s: {
        baselineApplication: digest,
        baselineMigration: digest,
        candidateApplication: digest,
        candidateMigration: digest,
      },
      status: "four-production-images-built",
    };
  }
  if (phase === "attestation") {
    return {
      assetAttestationSha256s: { baseline: digest, candidate: digest },
      contractSha256s: { baseline: digest, candidate: digest },
      images: {
        baselineApplication: imageDigest,
        baselineMigration: imageDigest,
        candidateApplication: imageDigest,
        candidateMigration: imageDigest,
      },
      status: "four-images-and-static-assets-attested",
    };
  }
  if (phase === "public") {
    return {
      artifact: "proof.json",
      artifactCountPerSide: 126,
      caseCount: 42,
      sha256: digest,
      status: "live-public-characterization-overlap-proven-after-exact-cleanup",
    };
  }
  if (phase === "provider") {
    return {
      artifact: "provider-overlap.json",
      sha256: digest,
      status: "proven",
    };
  }
  if (phase === "authenticated") {
    return {
      linkedEmailFailureFeedback: {
        artifact: "linked-email-failure-feedback.json",
        authorizedSemanticDiff: AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF,
        sha256: digest,
        status: "linked-email-auth-failure-feedback-specific",
      },
      unverifiedEmailLogin: {
        artifact: "unverified-email-login.json",
        authorizedSemanticDiff: AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
        sha256: digest,
        status: "existing-unverified-email-login-gated",
      },
    };
  }
  if (phase === "chatwoot") {
    return {
      aggregateSha256: digest,
      artifactCount: 19,
      artifactRoot: "clean-pay-chatwoot-phase-evidence-" + captureId,
      manifestSha256: digest,
      proofSha256: digest,
      status: "proven",
    };
  }
  return {
    completionSha256: digest,
    status: "sanitized-evidence-finalized",
  };
}

function phaseReceipt(
  phase: typeof phaseNames[number],
  status: "started" | "completed",
  previousReceiptSha256: string | null,
  startedReceiptSha256: string | null = null,
) {
  return {
    schemaVersion: 1,
    kind: "clean-pay-production-image-live-overlap-phase",
    status,
    phase,
    phaseIndex: phaseNames.indexOf(phase),
    captureId,
    baselineRevision,
    candidateRevision,
    ownershipSha256:
      status === "started" && phase === "preparation" ? null : phaseOwnershipSha256,
    previousReceiptSha256,
    publicBuildContractVersion: phasePublicBuildContract.version,
    publicBuildContractSha256: phasePublicBuildContract.sha256,
    startedReceiptSha256: status === "completed" ? startedReceiptSha256 : null,
    ...(status === "completed" ? { result: validPhaseResult(phase) } : {}),
  };
}

describe("ephemeral production-image live overlap runner", () => {
  it("binds the immutable baseline and candidate to isolated provider-proof projects", () => {
    const value = plan();

    expect(value.roles.baseline).toMatchObject({
      project: "clean-pay-browser-journey-provider-proof-baseline-0123456789ab",
      revision: baselineRevision,
      appPort: "42100",
      providerPort: "43100",
      connectProxyPort: "44100",
      proxyBind: "127.0.0.21",
    });
    expect(value.roles.candidate).toMatchObject({
      project: "clean-pay-browser-journey-provider-proof-candidate-0123456789ab",
      revision: candidateRevision,
      appPort: "42200",
      providerPort: "43200",
      connectProxyPort: "44200",
      proxyBind: "127.0.0.22",
    });
    expect(value.roles.baseline.appImage).not.toBe(value.roles.candidate.appImage);
    expect(value.roles.baseline.migrationImage).not.toBe(
      value.roles.candidate.migrationImage,
    );
    expect(value.providerProof).toEqual({
      externalFilename: "provider-overlap-proof.json",
      sanitizedFilename: "provider-overlap.json",
    });
  });

  it("passes the same exact identity inputs to both proof CLIs", () => {
    const value = plan();
    const inputs = proofInputs();
    const args = proofArguments(value, inputs);

    expect(args).toHaveLength(18);
    expect(args.slice(0, 2)).toEqual(["--capture-id", captureId]);
    for (const role of ["baseline", "candidate"]) {
      for (const suffix of [
        "contract",
        "asset-attestation",
        "asset-image-digest",
        "migration-asset-image-digest",
      ]) {
        expect(args).toContain(`--${role}-${suffix}`);
      }
    }

    const providerArgs = providerProofArguments(value, inputs);
    expect(providerArgs).toEqual([
      "--baseline-contract",
      inputs.baseline.contractPath,
      "--baseline-control-url",
      inputs.baseline.controlUrl,
      "--baseline-resolver-ip",
      inputs.baseline.resolverIp,
      "--baseline-asset-image-digest",
      inputs.baseline.assetImageDigest,
      "--baseline-migration-asset-image-digest",
      inputs.baseline.migrationAssetImageDigest,
      "--baseline-asset-attestation",
      inputs.baseline.assetAttestationPath,
      "--candidate-contract",
      inputs.candidate.contractPath,
      "--candidate-control-url",
      inputs.candidate.controlUrl,
      "--candidate-resolver-ip",
      inputs.candidate.resolverIp,
      "--candidate-asset-image-digest",
      inputs.candidate.assetImageDigest,
      "--candidate-migration-asset-image-digest",
      inputs.candidate.migrationAssetImageDigest,
      "--candidate-asset-attestation",
      inputs.candidate.assetAttestationPath,
      "--capture-id",
      captureId,
      "--scenario",
      "provider-overlap-v1",
      "--output",
      path.join(value.ownedRoot, "provider-overlap-proof.json"),
    ]);
    expect(() => providerProofArguments(value, {
      ...inputs,
      baseline: { ...inputs.baseline, resolverIp: "127.0.0.99" },
    })).toThrow(/differs from its exact contract/u);
  });

  it("streams only the verified baseline tar into Docker and keeps candidate context deny-listed", () => {
    expect(runner).toContain("materializeBehavioralBaselineSource({");
    expect(runner).toContain("const baselineArchiveBytes = await readBoundedFile(");
    expect(runner).toContain("assertBehavioralBaselineArchive(baselineArchiveBytes)");
    expect(runner).toContain("child.stdin.end(inputBytes)");
    expect(runner).toContain('baselineArchive ? "-" : repositoryRoot');
    expect(runner).not.toContain("materialized.sourceDirectory");
    expect(runner).not.toContain("createReadStream");
    expect(runner).toContain("cleanupBehavioralBaselineSource({");
    expect(runner).toContain(
      "expectedReceiptSha256: ownership.behavioralBaseline.receiptSha256",
    );
  });

  it("accepts identity-bound classic and containerd inspections but rejects descriptor drift", () => {
    const publicBuildContract = { version: "1", sha256: "a".repeat(64) };
    const base = {
      Id: `sha256:${"1".repeat(64)}`,
      Os: "linux",
      Architecture: "amd64",
      RepoDigests: [],
      Config: {
        Labels: {
          "io.clean-pay.role": "app",
          "org.opencontainers.image.revision": candidateRevision,
          "io.clean-pay.public-build-contract-version": "1",
          "io.clean-pay.public-build-contract-sha256": "a".repeat(64),
        },
      },
    };
    const input = {
      publicBuildContract,
      revision: candidateRevision,
      role: "app",
      tag: "clean-pay:live-overlap-candidate-0123456789abcdef",
    } as const;

    expect(validateLiveOverlapImageInspection(base, input)).toEqual({
      digest: base.Id,
      selectionMode: "classic-config",
    });
    expect(validateLiveOverlapImageInspection({
      ...base,
      Descriptor: {
        digest: base.Id,
        mediaType: "application/vnd.oci.image.index.v1+json",
        size: 1_024,
      },
    }, input)).toEqual({
      digest: base.Id,
      selectionMode: "containerd-root-manifest",
    });
    expect(() => validateLiveOverlapImageInspection({
      ...base,
      Descriptor: {
        digest: `sha256:${"2".repeat(64)}`,
        mediaType: "application/vnd.oci.image.index.v1+json",
        size: 1_024,
      },
    }, input)).toThrow(/descriptor differs/u);
  });

  it("binds cleanup to the original ownership receipt and rejects receipt tampering", () => {
    const value = plan();
    const receiptBytes = Buffer.from("reviewed-receipt\n", "utf8");
    const ownership = validateLiveOverlapOwnership({
      schemaVersion: 1,
      kind: "clean-pay-production-image-live-overlap-ownership",
      captureId,
      candidateRevision,
      behavioralBaseline: {
        rootName: "clean-pay-behavioral-baseline-Ab1234",
        receiptSha256: createHash("sha256").update(receiptBytes).digest("hex"),
      },
      evidence: {
        providerOverlapExternalFilename: "provider-overlap-proof.json",
        providerOverlapSanitizedFilename: "provider-overlap.json",
      },
      projects: {
        provider: {
          baseline: value.roles.baseline.project,
          candidate: value.roles.candidate.project,
        },
        chatwoot: [
          "clean-pay-browser-journey-chatwoot-baseline-p1-0123456789ab",
          "clean-pay-browser-journey-chatwoot-candidate-p1-0123456789ab",
          "clean-pay-browser-journey-chatwoot-baseline-p2-0123456789ab",
          "clean-pay-browser-journey-chatwoot-candidate-p2-0123456789ab",
          "clean-pay-browser-journey-chatwoot-baseline-p3-0123456789ab",
          "clean-pay-browser-journey-chatwoot-candidate-p3-0123456789ab",
        ],
      },
      images: {
        baselineApplication: value.roles.baseline.appImage,
        baselineMigration: value.roles.baseline.migrationImage,
        candidateApplication: value.roles.candidate.appImage,
        candidateMigration: value.roles.candidate.migrationImage,
      },
    }, value);

    expect(assertBehavioralBaselineCleanupCapability({
      ownership,
      receiptBytes,
      rootName: ownership.behavioralBaseline.rootName,
    })).toBe(ownership.behavioralBaseline.receiptSha256);
    expect(() => assertBehavioralBaselineCleanupCapability({
      ownership,
      receiptBytes: Buffer.from("tampered-receipt\n", "utf8"),
      rootName: ownership.behavioralBaseline.rootName,
    })).toThrow(/original cleanup capability/u);
    expect(() => validateLiveOverlapOwnership({
      ...ownership,
      projects: {
        provider: ownership.projects.provider,
        chatwoot: ownership.projects.chatwoot.slice(0, 5),
      },
    }, value)).toThrow(/differs from the exact cleanup plan/u);
  });

  it("runs public, provider, then authenticated overlap without selecting the fixed baseline runner", () => {
    const publicProof = runner.indexOf(
      "await runInherited(process.execPath, [publicProofCli, ...args]",
    );
    const providerProof = runner.indexOf(
      "[providerProofCli, ...providerProofArguments(plan, inputs)]",
    );
    const providerPublish = runner.indexOf(
      "const providerOverlap = await publishProviderProof(plan)",
    );
    const authenticatedProof = runner.indexOf(
      "const unverifiedEmailProof = unverifiedEmailProofPath(plan)",
    );
    expect(publicProof).toBeGreaterThan(0);
    expect(providerProof).toBeGreaterThan(publicProof);
    expect(providerPublish).toBeGreaterThan(providerProof);
    expect(authenticatedProof).toBeGreaterThan(providerPublish);
    expect(runner).toContain('"--candidate-linked-email-failure-proof-output"');
    expect(runner).toContain('"--candidate-unverified-email-proof-output"');
    expect(runner).toContain("const linkedEmailFailureFeedback = await validateLinkedEmailFailureProof(");
    expect(runner).toContain("const unverifiedEmailLogin = await validateUnverifiedEmailProof(");
    expect(runner).toContain("assertDualProviderOverlapProof(JSON.parse(");
    expect(runner).toContain(
      "await writeJourneySanitizedOutput(sanitizedTarget, artifact.bytes)",
    );
    expect(runner).toContain(
      "await unlinkExactProviderProof(providerProofExternalPath(plan), artifact.identity)",
    );
    expect(runner).toContain(
      "providerProofEnvironment.CLEAN_PAY_PROVIDER_OVERLAP_FAILURE_OUTPUT =",
    );
    expect(runner).toContain(
      "providerProofFailureSanitizedPath(plan, sanitizedCaptureRoot)",
    );
    expect(runner).not.toContain("copyFile(");
    expect(workflow).toContain(
      "node tests/browser/journeys/run-production-image-live-overlap.mjs run",
    );
    expect(workflow).not.toContain("run: npm run test:browser:journey:production-image");
    expect(authenticatedRunner).toContain(
      '"--candidate-linked-email-failure-proof-output"',
    );
    expect(authenticatedRunner).toContain(
      'CLEAN_PAY_BROWSER_LINKED_EMAIL_FAILURE_PROOF_OUTPUT: output',
    );
    expect(authenticatedRunner).toContain(
      '"linked-email-failure.playwright.config.ts"',
    );
    expect(authenticatedRunner).toContain("candidateAuthorizedRegressionCases: 2");
    for (const filename of [
      "linked-email-failure-proof-contract.mjs",
      "linked-email-failure.candidate.spec.ts",
      "linked-email-failure.playwright.config.ts",
    ]) {
      expect(fixtureManifest).toContain(`\"${filename}\"`);
    }

    // The immutable Windows-baseline runner remains independently selectable,
    // and its unchanged phase strings stay covered by the pre-existing tests.
    expect(fixedRunner).toContain(
      'await runPlaywright("config/playwright.config.ts", mainBrowserEnvironment);',
    );
    expect(fixedRunner).toContain("finalize-journey-baseline.mjs");
  });

  it("gives validate and the production-image job full immutable history", () => {
    const validate = workflow.slice(
      workflow.indexOf("  validate:"),
      workflow.indexOf("  integration-services:"),
    );
    const productionImage = workflow.slice(
      workflow.indexOf("  production-image-browser-journey:"),
      workflow.indexOf("  remnashop-migration-rehearsal:"),
    );
    for (const job of [validate, productionImage]) {
      expect(job).toContain("fetch-depth: 0");
      expect(job).toContain("persist-credentials: false");
    }
    expect(productionImage).toContain("test-results/browser-public-overlap");
    expect(productionImage).toContain(
      "test-results/browser-authenticated-journey-live-pair",
    );
    expect(productionImage).toContain(
      "test-results/browser-live-pair-ci/${{ env.CLEAN_PAY_BROWSER_LIVE_PAIR_CAPTURE_ID }}/provider-overlap-failure.json",
    );
    expect(productionImage).toContain(
      "test-results/browser-live-pair-ci/${{ env.CLEAN_PAY_BROWSER_LIVE_PAIR_CAPTURE_ID }}/provider-overlap.json",
    );
    expect(productionImage).toContain(
      "test-results/browser-live-pair-ci/${{ env.CLEAN_PAY_BROWSER_LIVE_PAIR_CAPTURE_ID }}/linked-email-failure-feedback.json",
    );
    expect(productionImage).toContain(
      "test-results/browser-live-pair-ci/${{ env.CLEAN_PAY_BROWSER_LIVE_PAIR_CAPTURE_ID }}/unverified-email-login.json",
    );
    expect(productionImage).not.toContain("provider-overlap-proof.json");
    const containerdStore = productionImage.indexOf(
      "Require the containerd image identity store",
    );
    const liveProof = productionImage.indexOf(
      "run-production-image-live-overlap.mjs run",
    );
    expect(containerdStore).toBeGreaterThan(-1);
    expect(productionImage).toContain('"containerd-snapshotter": true');
    expect(productionImage).toContain(
      '\"driver-type\",\"io.containerd.snapshotter.v1\"',
    );
    expect(liveProof).toBeGreaterThan(containerdStore);
  });

  it("prepares three exact Chatwoot A/B pairs after authenticated overlap", () => {
    const value = plan();
    const inputs = proofInputs();
    const livePlan = createRunnerChatwootLiveProofPlan(
      value,
      inputs,
    ) as ChatwootRunnerPlan;
    const stacks = livePlan.pairs.flatMap((pair) => [
      pair.baseline,
      pair.candidate,
    ]);

    expect(stacks).toHaveLength(6);
    expect(stacks.map((stack) => stack.project)).toEqual([
      "clean-pay-browser-journey-chatwoot-baseline-p1-0123456789ab",
      "clean-pay-browser-journey-chatwoot-candidate-p1-0123456789ab",
      "clean-pay-browser-journey-chatwoot-baseline-p2-0123456789ab",
      "clean-pay-browser-journey-chatwoot-candidate-p2-0123456789ab",
      "clean-pay-browser-journey-chatwoot-baseline-p3-0123456789ab",
      "clean-pay-browser-journey-chatwoot-candidate-p3-0123456789ab",
    ]);
    expect(stacks.map((stack) => stack.resolverIp)).toEqual([
      "127.0.0.31",
      "127.0.0.32",
      "127.0.0.33",
      "127.0.0.34",
      "127.0.0.35",
      "127.0.0.36",
    ]);
    expect(new Set(stacks.map((stack) => stack.assetAttestationPath)).size).toBe(6);
    expect(livePlan.pairs[0].baseline.images.application.digest)
      .toBe(inputs.baseline.assetImageDigest);
    expect(livePlan.pairs[0].candidate.images.migration.digest)
      .toBe(inputs.candidate.migrationAssetImageDigest);

    const cliPlanPath = path.join(value.ownedRoot, "chatwoot-phase-plan.json");
    expect(chatwootProofArguments(value, cliPlanPath)).toEqual([
      "--plan",
      cliPlanPath,
      "--output",
      path.join(
        value.temporaryRoot,
        `clean-pay-chatwoot-phase-evidence-${captureId}`,
      ),
    ]);

    const authenticatedProof = runner.indexOf(
      "const unverifiedEmailProof = unverifiedEmailProofPath(plan)",
    );
    const prepareChatwoot = runner.indexOf(
      "const chatwoot = await prepareChatwootLiveProofInputs(plan, inputs)",
    );
    const runChatwoot = runner.indexOf(
      "[chatwootProofCli, ...chatwootProofArguments(plan, chatwoot.cliPlanPath)]",
    );
    const validateChatwoot = runner.indexOf(
      "const chatwootPhase = await validateChatwootEvidence(plan, inputs)",
    );
    expect(prepareChatwoot).toBeGreaterThan(authenticatedProof);
    expect(runChatwoot).toBeGreaterThan(prepareChatwoot);
    expect(validateChatwoot).toBeGreaterThan(runChatwoot);
    expect(workflow).toContain(
      "${{ runner.temp }}/clean-pay-chatwoot-phase-evidence-${{ env.CLEAN_PAY_BROWSER_LIVE_PAIR_CAPTURE_ID }}/proof.json",
    );
    expect(workflow).toContain(
      "${{ runner.temp }}/clean-pay-chatwoot-phase-evidence-${{ env.CLEAN_PAY_BROWSER_LIVE_PAIR_CAPTURE_ID }}/raw",
    );
    expect(workflow).not.toContain("chatwoot-phase-plan.json");
  });

  it("accepts only the byte-bound nineteen-artifact Chatwoot manifest", () => {
    const paths = [
      "proof.json",
      ...[1, 2, 3].flatMap((pairIndex) => (
        ["baseline", "candidate"].flatMap((role) => (
          ["gap", "stable", "recreated"].map((phase) => (
            `raw/pair-${pairIndex}-${role}-${phase}.png`
          ))
        ))
      )),
    ].sort();
    const entries = paths.map((artifactPath, index) => ({
      path: artifactPath,
      byteLength: index + 1,
      sha256: createHash("sha256").update(artifactPath).digest("hex"),
    }));
    const aggregateSha256 = createHash("sha256").update(entries.map((entry) => (
      `${entry.path}\0${entry.byteLength}\0${entry.sha256}\n`
    )).join("")).digest("hex");
    const manifest = {
      schemaVersion: 1,
      kind: "clean-pay-chatwoot-phase-proof-artifact-manifest",
      artifactCount: 19,
      aggregateSha256,
      entries,
    };

    expect(validateChatwootArtifactManifest(structuredClone(manifest), entries))
      .toEqual(manifest);
    expect(() => validateChatwootArtifactManifest({
      ...manifest,
      entries: manifest.entries.map((entry, index) => (
        index === 0 ? { ...entry, byteLength: entry.byteLength + 1 } : entry
      )),
    }, entries)).toThrow(/differ from observed bytes/u);
    expect(() => validateChatwootArtifactManifest({
      ...manifest,
      ambientEnvironment: "forbidden",
    }, entries)).toThrow(/exact contract/u);
  });

  it("allowlists only the exact candidate unverified-email semantic correction", () => {
    const expected = {
      candidateRevision,
      candidateApplicationImageDigest: `sha256:${"3".repeat(64)}`,
      candidateMigrationImageDigest: `sha256:${"4".repeat(64)}`,
    };
    const proof = {
      schemaVersion: 2,
      kind: "clean-pay-authorized-unverified-email-login-proof",
      status: "existing-unverified-email-login-gated",
      authorizedSemanticDiff: AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
      ...expected,
      finalRoute:
        "/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30",
      telegramLinkedFixture: true,
      serverActionCount: 2,
      providerRequestCount: 6,
      cabinetNavigationCount: 0,
      cabinetReadCount: 0,
      directCabinetFinalRoute:
        "/register/verify-email?redirect_to=%2Fcabinet",
      directCabinetNavigationAttemptCount: 1,
      directCabinetReadCount: 0,
      directProviderRequestCount: 0,
      emailVerifiedAccessClaim: false,
      genericCabinetErrorCount: 0,
      telegramLinkedAccessClaim: true,
    };

    expect(assertUnverifiedEmailLoginProof(proof, expected)).toEqual(proof);
    expect(() => assertUnverifiedEmailLoginProof(proof, {
      ...expected,
      providerControlUrl: "http://127.0.0.1:43100/",
    })).toThrow(/exact authorized contract/u);
    for (const mutation of [
      { cabinetReadCount: 1 },
      { cabinetNavigationCount: 1 },
      { directCabinetFinalRoute: "/cabinet" },
      { directCabinetNavigationAttemptCount: 0 },
      { directCabinetReadCount: 1 },
      { directProviderRequestCount: 1 },
      { emailVerifiedAccessClaim: true },
      { genericCabinetErrorCount: 1 },
      { serverActionCount: 3 },
      { telegramLinkedAccessClaim: false },
      { telegramLinkedFixture: false },
      { authorizedSemanticDiff: "broader-diff" },
    ]) {
      expect(() => assertUnverifiedEmailLoginProof({
        ...proof,
        ...mutation,
      }, expected)).toThrow(/exact authorized contract/u);
    }
    for (const effect of [
      "read_devices",
      "read_notification_preferences",
      "read_offers",
      "read_payment_history",
      "read_referral_program",
      "read_subscription",
    ]) {
      expect(unverifiedEmailRegression).toContain(`\"${effect}\"`);
    }
    expect(unverifiedEmailRegression).toContain('redirect: "error"');
    expect(unverifiedEmailRegression).toContain(
      "readBoundedJsonResponse(linked, 16_384)",
    );
    expect(unverifiedEmailRegression).toContain('await page.goto("/cabinet"');
    expect(unverifiedEmailRegression).toContain("currentAccessClaims(page)");
    expect(unverifiedEmailRegression).toContain(
      "candidateRevision: environment.candidateRevision",
    );
    expect(unverifiedEmailRegression).toContain(
      "candidateApplicationImageDigest: environment.candidateApplicationImageDigest",
    );
    expect(unverifiedEmailRegression).toContain(
      "candidateMigrationImageDigest: environment.candidateMigrationImageDigest",
    );
  });

  it("allowlists only the exact candidate linked-email failure feedback correction", () => {
    const expected = {
      candidateRevision,
      candidateApplicationImageDigest: `sha256:${"3".repeat(64)}`,
      candidateMigrationImageDigest: `sha256:${"4".repeat(64)}`,
    };
    const providerEffectOrder = Array.from(
      { length: 10 },
      () => ["linked_email_login_auth_failed", "linked_email_register_conflict"],
    ).flat();
    const proof = {
      schemaVersion: 1,
      kind: "clean-pay-authorized-linked-email-failure-feedback-proof",
      status: "linked-email-auth-failure-feedback-specific",
      authorizedSemanticDiff: AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF,
      ...expected,
      finalRoute: "/link-account?reason=email-required",
      telegramLinkedFixture: true,
      emailInitiallyAbsent: true,
      wrongPasswordAttemptCount: 10,
      rateLimitedAttemptNumber: 11,
      wrongPasswordMessage: "Неверный e-mail или пароль.",
      rateLimitedMessage: "Слишком много попыток. Попробуйте позже.",
      serverActionCount: 11,
      serverActionMethodsAllPost: true,
      serverActionResponsesAllSuccessful: true,
      serverActionPayloadStable: true,
      serverActionPayloadContractSha256: "5".repeat(64),
      authFailedProviderRequestCount: 20,
      rateLimitedProviderRequestCount: 0,
      providerEffectOrder,
      databaseUnchanged: true,
      formStatePreserved: true,
      submitButtonEnabled: true,
      visibleErrorCount: 1,
      genericFallbackCount: 0,
      networkFallbackCount: 0,
    };

    expect(assertLinkedEmailFailureProof(proof, expected)).toEqual(proof);
    for (const mutation of [
      { authorizedSemanticDiff: "broader-diff" },
      { finalRoute: "/cabinet" },
      { wrongPasswordAttemptCount: 9 },
      { rateLimitedAttemptNumber: 10 },
      { wrongPasswordMessage: "Не удалось связать e-mail с аккаунтом." },
      { rateLimitedMessage: "Не удалось связать e-mail с аккаунтом." },
      { serverActionCount: 10 },
      { serverActionPayloadStable: false },
      { authFailedProviderRequestCount: 19 },
      { rateLimitedProviderRequestCount: 1 },
      { providerEffectOrder: providerEffectOrder.slice(1) },
      { databaseUnchanged: false },
      { formStatePreserved: false },
      { genericFallbackCount: 1 },
      { networkFallbackCount: 1 },
    ]) {
      expect(() => assertLinkedEmailFailureProof({
        ...proof,
        ...mutation,
      }, expected)).toThrow(/exact authorized contract/u);
    }
    expect(() => assertLinkedEmailFailureProof({
      ...proof,
      ambientEvidence: "forbidden",
    }, expected)).toThrow(/exact authorized contract/u);

    expect(linkedEmailFailureRegression).toContain("for (let attempt = 1; attempt <= 10; attempt += 1)");
    expect(linkedEmailFailureRegression).toContain("const recorder = recordNetwork(page, applicationOrigin)");
    expect(linkedEmailFailureRegression).toContain("expect(serverActions).toHaveLength(11)");
    expect(linkedEmailFailureRegression).toContain("expect(rateLimitedProviderRequests).toEqual([])");
    expect(linkedEmailFailureRegression).toContain("expect(ledgerAfter.database).toEqual(databaseBefore)");
    expect(linkedEmailFailureRegression).toContain('name: "Сохраните доступ к аккаунту"');
    expect(linkedEmailFailureRegression).toContain('name: "Добавьте резервный вход"');
    expect(linkedEmailFailureRegression).toContain("toHaveCount(0)");
    expect(linkedEmailFailureRegression).toContain('page.locator(".p-inline-message-error")');
    expect(linkedEmailFailureRegression).toContain('page.locator(".p-inline-message-error:visible")');
    expect(linkedEmailFailureRegression).not.toContain('data-severity="error"');
    expect(linkedEmailFailureRegression).toContain("expect(genericFallbackCount).toBe(0)");
    expect(linkedEmailFailureRegression).toContain("expect(networkFallbackCount).toBe(0)");
    expect(linkedEmailFailureRegression).not.toContain("page.screenshot(");
    expect(providerMock).toContain('const linkedEmailFailureScenarioPrefix = "authorized-linked-email-feedback:"');
    expect(providerMock).toContain('sendJson(response, 401, { detail: "Request failed" })');
    expect(providerMock).toContain('sendJson(response, 409, { detail: "Request failed" })');
    expect(runner).toContain("linkedEmailFailureFeedback,");
  });

  it("uses only exact project labels, image tags and allowlisted files for cleanup", () => {
    const ownershipRead = runner.indexOf("const ownership = await readCleanupOwnership(plan)");
    const providerRemoval = runner.indexOf(
      "await cleanupExactProject(ownership.projects.provider[roleName])",
    );
    expect(ownershipRead).toBeGreaterThan(-1);
    expect(providerRemoval).toBeGreaterThan(ownershipRead);
    expect(runner).toContain("chatwoot: Object.freeze(chatwootProjectNames(plan))");
    expect(runner).toContain("for (const project of ownership.projects.chatwoot)");
    expect(runner).toContain("resourcesTouched: 0");
    expect(runner).toContain('`label=com.docker.compose.project=${project}`');
    expect(runner).toContain(
      "Refusing cleanup of a ${resource.noun} outside the exact project.",
    );
    expect(runner).toContain('["image", "rm", "--force", tag]');
    expect(runner).toContain(
      "Generated environment contains an unexpected entry; refusing recursive cleanup.",
    );
    expect(runner).toContain(
      "Refusing cleanup of a changed provider overlap proof identity.",
    );
    expect(runner).toContain(
      "Provider overlap external proof failed its exact sanitized schema.",
    );
    expect(runner).toContain(
      "/^clean-pay-browser-journey-chatwoot-(?:baseline|candidate)-p[1-3]-[a-f0-9]{12}$/",
    );
    expect(runner).toContain(
      "Refusing cleanup of a non-empty or unowned Chatwoot input directory.",
    );
    expect(runner).toContain("fsConstants.O_NOFOLLOW ?? 0");
    expect(runner).toContain("Buffer.allocUnsafe(declaredBytes + 1)");
    expect(runner).toContain("await handle.stat({ bigint: true })");
    expect(runner).not.toContain("bytes = await handle.readFile()");
    expect(runner).not.toContain("docker system prune");
    expect(runner).not.toContain("docker builder prune");
    expect(runner).not.toContain("docker volume prune");
  });

  it("accepts only the fixed phase CLI while preserving one-shot run and cleanup", () => {
    const core = [
      "--capture-id",
      captureId,
      "--candidate-revision",
      candidateRevision,
      "--temporary-root",
      externalTemporaryRoot,
    ];
    expect(parseLiveOverlapArguments(["run", ...core])).toMatchObject({
      mode: "run",
      phase: null,
    });
    expect(parseLiveOverlapArguments(["cleanup", ...core])).toMatchObject({
      mode: "cleanup",
      phase: null,
    });
    for (const phase of phaseNames) {
      expect(parseLiveOverlapArguments(["run", ...core, "--phase", phase]))
        .toMatchObject({ mode: "run", phase });
    }
    for (const invalid of [
      ["run", ...core, "--phase", "unknown"],
      ["run", ...core, "--phase"],
      ["cleanup", ...core, "--phase", "build"],
      ["run", ...core, "--phase=build", "unused"],
      ["run", ...core, "--capture-id", captureId],
      ["run", ...core, "--phase", "build", "--extra", "value"],
    ]) {
      expect(() => parseLiveOverlapArguments(invalid)).toThrow();
    }
    expect(runner).toContain(
      "const { mode, phase, plan } = parseLiveOverlapArguments(process.argv.slice(2));",
    );
    expect(runner).toContain('if (mode === "run") await run(plan, phase);');
  });

  it("keeps isolated Chatwoot diagnostics red while deferring only the live Provider proof", () => {
    expect(resolveLiveOverlapProviderExecutionMode({})).toBe("prove");
    expect(resolveLiveOverlapProviderExecutionMode({
      CLEAN_PAY_LIVE_OVERLAP_PROVIDER_MODE: "prove",
    })).toBe("prove");
    expect(resolveLiveOverlapProviderExecutionMode({
      CLEAN_PAY_LIVE_OVERLAP_PROVIDER_MODE: "defer-chatwoot-diagnostic",
    })).toBe("defer-chatwoot-diagnostic");
    expect(() => resolveLiveOverlapProviderExecutionMode({
      CLEAN_PAY_LIVE_OVERLAP_PROVIDER_MODE: "skip",
    })).toThrow(/execution mode is invalid/u);

    const modeGate = runner.indexOf("resolveLiveOverlapProviderExecutionMode()");
    const providerLaunch = runner.indexOf("[providerProofCli, ...providerProofArguments(plan, inputs)]");
    expect(modeGate).toBeGreaterThan(-1);
    expect(providerLaunch).toBeGreaterThan(modeGate);
    expect(runner).toContain(
      "Provider live overlap was intentionally deferred for the isolated Chatwoot diagnostic.",
    );
    expect(workflow).toContain("browser_mode:");
    expect(workflow).toContain("- chatwoot-diagnostic");
    expect(workflow).toContain(
      "contains(github.event.head_commit.message, '[chatwoot-diagnostic]')",
    );
    expect(workflow.match(/contains\(github\.event\.head_commit\.message, '\[chatwoot-diagnostic\]'\)/gu))
      .toHaveLength(10);
    expect(workflow).toContain(
      "CLEAN_PAY_LIVE_OVERLAP_PROVIDER_MODE: ${{ ((github.event_name == 'workflow_dispatch'",
    );
    expect(workflow).not.toContain("continue-on-error:");
  });

  it("records an exact Provider diagnostic deferral without sealing full evidence", () => {
    expect(isProviderDiagnosticExecutionMode("defer-chatwoot-diagnostic")).toBe(true);
    expect(isProviderDiagnosticExecutionMode("deferred-chatwoot-diagnostic")).toBe(false);
    expect(isProviderDiagnosticExecutionMode("prove")).toBe(false);
    const previousReceiptSha256 = "e".repeat(64);
    const startedReceiptSha256 = "1".repeat(64);
    const message =
      "Provider live overlap was intentionally deferred for the isolated Chatwoot diagnostic.";
    const deferredResult = {
      reasonSha256: createHash("sha256").update(message).digest("hex"),
      status: "deferred-chatwoot-diagnostic",
    };
    const deferredReceipt = {
      ...phaseReceipt(
        "provider",
        "completed",
        previousReceiptSha256,
        startedReceiptSha256,
      ),
      result: deferredResult,
    };
    const expected = {
      candidateRevision,
      captureId,
      ownershipSha256: phaseOwnershipSha256,
      phase: "provider",
      previousReceiptSha256,
      publicBuildContract: phasePublicBuildContract,
      startedReceiptSha256,
      status: "completed" as const,
    };

    expect(validateLiveOverlapPhaseReceipt(deferredReceipt, expected)).toEqual(deferredReceipt);
    expect(() => validateLiveOverlapPhaseReceipt({
      ...deferredReceipt,
      result: { ...deferredResult, reasonSha256: "f".repeat(64) },
    }, expected)).toThrow(/sanitized exact projection/u);
    expect(() => validateLiveOverlapPhaseReceipt({
      ...deferredReceipt,
      result: { ...deferredResult, artifact: "provider-overlap.json" },
    }, expected)).toThrow(/exact contract/u);

    const modeGate = runner.indexOf("resolveLiveOverlapProviderExecutionMode()");
    const deferredCompletion = runner.indexOf(
      'await completePhase(plan, "provider", context, createProviderDiagnosticDeferral())',
    );
    const attestedInputInspection = runner.indexOf(
      "const inputs = await readAttestedPhaseInputs(plan, context);",
      deferredCompletion,
    );
    const providerLaunch = runner.indexOf(
      "[providerProofCli, ...providerProofArguments(plan, inputs)]",
    );
    expect(deferredCompletion).toBeGreaterThan(modeGate);
    expect(attestedInputInspection).toBeGreaterThan(deferredCompletion);
    expect(providerLaunch).toBeGreaterThan(deferredCompletion);
    expect(workflow).toContain(
      "CLEAN_PAY_LIVE_OVERLAP_PROVIDER_MODE: ${{ steps.provider_phase.outputs.execution_mode }}",
    );
    expect(workflow).toContain(
      "if test \"$CLEAN_PAY_LIVE_OVERLAP_PROVIDER_MODE\" = 'defer-chatwoot-diagnostic'; then",
    );
    expect(workflow).not.toContain("continue-on-error:");
  });

  it("validates the exact create-only phase chain and sanitized projections", () => {
    let previousReceiptSha256: string | null = null;
    const completedReceipts = [];
    for (const phase of phaseNames) {
      const started = phaseReceipt(phase, "started", previousReceiptSha256);
      expect(validateLiveOverlapPhaseReceipt(started, {
        candidateRevision,
        captureId,
        ownershipSha256: phase === "preparation" ? null : phaseOwnershipSha256,
        phase,
        previousReceiptSha256,
        publicBuildContract: phasePublicBuildContract,
        startedReceiptSha256: null,
        status: "started",
      })).toEqual(started);

      const startedReceiptSha256 = createHash("sha256")
        .update(Buffer.from(JSON.stringify(started, null, 2) + "\n", "utf8"))
        .digest("hex");
      const completed = phaseReceipt(
        phase,
        "completed",
        previousReceiptSha256,
        startedReceiptSha256,
      );
      expect(validateLiveOverlapPhaseReceipt(completed, {
        candidateRevision,
        captureId,
        ownershipSha256: phaseOwnershipSha256,
        phase,
        previousReceiptSha256,
        publicBuildContract: phasePublicBuildContract,
        startedReceiptSha256,
        status: "completed",
      })).toEqual(completed);
      completedReceipts.push(completed);
      previousReceiptSha256 = createHash("sha256")
        .update(Buffer.from(JSON.stringify(completed, null, 2) + "\n", "utf8"))
        .digest("hex");
    }

    const serialized = JSON.stringify(completedReceipts);
    expect(serialized).not.toContain(externalTemporaryRoot);
    expect(serialized).not.toContain("clean-pay:live-overlap-");
    expect(serialized).not.toContain("clean-pay-browser-journey-provider-proof-");
    expect(serialized).not.toContain("http://127.0.0.1:");
    expect(serialized).not.toContain('"inputs"');
    expect(serialized).not.toContain('"imageTags"');

    const publicStartedReceiptSha256 = "1".repeat(64);
    const publicReceipt = phaseReceipt(
      "public",
      "completed",
      "e".repeat(64),
      publicStartedReceiptSha256,
    );
    expect(() => validateLiveOverlapPhaseReceipt({
      ...publicReceipt,
      ambientPath: externalTemporaryRoot,
    }, {
      candidateRevision,
      captureId,
      ownershipSha256: phaseOwnershipSha256,
      phase: "public",
      previousReceiptSha256: "e".repeat(64),
      publicBuildContract: phasePublicBuildContract,
      startedReceiptSha256: publicStartedReceiptSha256,
      status: "completed",
    })).toThrow(/exact contract/u);
    expect(() => validateLiveOverlapPhaseReceipt({
      ...publicReceipt,
      previousReceiptSha256: "f".repeat(64),
    }, {
      candidateRevision,
      captureId,
      ownershipSha256: phaseOwnershipSha256,
      phase: "public",
      previousReceiptSha256: "e".repeat(64),
      publicBuildContract: phasePublicBuildContract,
      startedReceiptSha256: publicStartedReceiptSha256,
      status: "completed",
    })).toThrow(/chain contract/u);
    expect(() => validateLiveOverlapPhaseReceipt({
      ...publicReceipt,
      startedReceiptSha256: "2".repeat(64),
    }, {
      candidateRevision,
      captureId,
      ownershipSha256: phaseOwnershipSha256,
      phase: "public",
      previousReceiptSha256: "e".repeat(64),
      publicBuildContract: phasePublicBuildContract,
      startedReceiptSha256: publicStartedReceiptSha256,
      status: "completed",
    })).toThrow(/chain contract/u);
    expect(() => validateLiveOverlapPhaseReceipt({
      ...publicReceipt,
      result: { ...publicReceipt.result, inputPath: externalTemporaryRoot },
    }, {
      candidateRevision,
      captureId,
      ownershipSha256: phaseOwnershipSha256,
      phase: "public",
      previousReceiptSha256: "e".repeat(64),
      publicBuildContract: phasePublicBuildContract,
      startedReceiptSha256: publicStartedReceiptSha256,
      status: "completed",
    })).toThrow(/exact contract/u);
  });

  it("settles proof failures without weakening their red CI outcome", () => {
    const digest = "d".repeat(64);
    const failure = {
      schemaVersion: 1,
      kind: "clean-pay-production-image-live-overlap-phase-failure",
      status: "failed",
      captureId,
      phase: "provider",
      causeEvidence: [{
        depth: 1,
        errorClass: "Error",
        messageSha256: digest,
        ordinal: 1,
        parentOrdinal: 0,
      }],
      causeEvidenceTruncated: false,
      errorClass: "AggregateError",
      messageSha256: digest,
    };
    expect(validateLiveOverlapPhaseFailure(failure, {
      captureId,
      phase: "provider",
    })).toEqual(failure);

    const previousReceiptSha256 = "e".repeat(64);
    const startedReceiptSha256 = "f".repeat(64);
    const failedReceipt = {
      ...phaseReceipt(
        "provider",
        "completed",
        previousReceiptSha256,
        startedReceiptSha256,
      ),
      result: {
        artifact: "phase-provider-failure.json",
        sha256: digest,
        status: "failed",
      },
    };
    expect(validateLiveOverlapPhaseReceipt(failedReceipt, {
      candidateRevision,
      captureId,
      ownershipSha256: phaseOwnershipSha256,
      phase: "provider",
      previousReceiptSha256,
      publicBuildContract: phasePublicBuildContract,
      startedReceiptSha256,
      status: "completed",
    })).toEqual(failedReceipt);

    expect(() => validateLiveOverlapPhaseFailure({
      ...failure,
      rawMessage: "forbidden",
    }, {
      captureId,
      phase: "provider",
    })).toThrow(/exact contract/u);
    expect(() => validateLiveOverlapPhaseReceipt({
      ...failedReceipt,
      result: {
        ...failedReceipt.result,
        artifact: "provider-overlap-failure.json",
      },
    }, {
      candidateRevision,
      captureId,
      ownershipSha256: phaseOwnershipSha256,
      phase: "provider",
      previousReceiptSha256,
      publicBuildContract: phasePublicBuildContract,
      startedReceiptSha256,
      status: "completed",
    })).toThrow(/sanitized exact projection/u);

    const productionImage = workflow.slice(
      workflow.indexOf("  production-image-browser-journey:"),
      workflow.indexOf("  remnashop-migration-rehearsal:"),
    );
    expect(productionImage).toContain("id: public_phase");
    expect(productionImage.match(
      /if: \$\{\{ !cancelled\(\) && steps\.public_phase\.outcome == 'success' \}\}/g,
    )).toHaveLength(3);
    expect(productionImage).not.toContain("continue-on-error:");
    expect(runner).toContain("await settleProofPhaseFailure(");
    expect(runner).toContain(
      "Live overlap evidence cannot finalize while a proof phase is failed.",
    );
  });

  it("reloads persisted proof inputs only from exact plan-owned paths", () => {
    const value = plan();
    const baseline = {
      ...proofInputs().baseline,
      contractPath: path.join(
        value.ownedRoot,
        value.roles.baseline.envDirectoryName,
        "browser-journey-contract.json",
      ),
      assetAttestationPath: path.join(
        value.ownedRoot,
        value.roles.baseline.attestationFilename,
      ),
    };
    expect(exactPersistedRoleProofInput(value, { baseline }, "baseline"))
      .toEqual(baseline);
    expect(() => exactPersistedRoleProofInput(value, {
      baseline: {
        ...baseline,
        contractPath: path.join(externalTemporaryRoot, "substituted-contract.json"),
      },
    }, "baseline")).toThrow(/persisted baseline proof path/u);
    expect(() => exactPersistedRoleProofInput(value, {
      baseline: {
        ...baseline,
        assetAttestationPath: path.join(
          value.ownedRoot,
          value.roles.candidate.attestationFilename,
        ),
      },
    }, "baseline")).toThrow(/persisted baseline proof path/u);
    expect(proofArguments(value, proofInputs())).toHaveLength(18);
  });

  it("seals only the exact restartable Chatwoot cleanup inventory", () => {
    const value = plan();
    const paths = [
      "artifact-manifest.json",
      "proof.json",
      ...expectedChatwootScreenshotPaths(),
    ].sort();
    const capability = {
      schemaVersion: 1,
      kind: "clean-pay-chatwoot-evidence-cleanup-capability",
      captureId,
      evidenceRootName: "clean-pay-chatwoot-phase-evidence-" + captureId,
      artifactCount: paths.length,
      artifacts: paths.map((artifactPath) => ({
        byteLength: 1,
        path: artifactPath,
        sha256: "a".repeat(64),
      })),
    };
    expect(validateChatwootEvidenceCleanupCapability(capability, value))
      .toEqual(capability);
    expect(() => validateChatwootEvidenceCleanupCapability({
      ...capability,
      artifacts: capability.artifacts.slice(1),
    }, value)).toThrow(/header/u);
    expect(() => validateChatwootEvidenceCleanupCapability({
      ...capability,
      artifacts: capability.artifacts.map((entry, index) => (
        index === 0 ? { ...entry, path: "raw/unowned.png" } : entry
      )),
    }, value)).toThrow(/outside the exact inventory/u);
    expect(() => validateChatwootEvidenceCleanupCapability({
      ...capability,
      evidenceRootName: externalTemporaryRoot,
    }, value)).toThrow(/header/u);
    expect(() => validateChatwootEvidenceCleanupCapability({
      ...capability,
      imageTag: value.roles.candidate.appImage,
    }, value)).toThrow(/exact contract/u);
  });

  it("runs eight ordered diagnostic phases before evidence upload and exact cleanup", () => {
    const productionImage = workflow.slice(
      workflow.indexOf("  production-image-browser-journey:"),
      workflow.indexOf("  remnashop-migration-rehearsal:"),
    );
    const containerd = productionImage.indexOf(
      "Require the containerd image identity store",
    );
    const browser = productionImage.indexOf(
      "Install locked dependencies and pinned Chromium",
    );
    const capture = productionImage.indexOf(
      "Derive the unique live-pair capture identity",
    );
    let prior = capture;
    for (const phase of phaseNames) {
      const marker = "--phase " + phase;
      const position = productionImage.indexOf(marker);
      expect(position).toBeGreaterThan(prior);
      expect(productionImage.split(marker)).toHaveLength(2);
      prior = position;
    }
    const upload = productionImage.indexOf(
      "Preserve sanitized browser journey evidence",
    );
    const cleanup = productionImage.indexOf(
      "Clean up only the owned browser journey project",
    );
    expect(containerd).toBeGreaterThan(-1);
    expect(browser).toBeGreaterThan(containerd);
    expect(capture).toBeGreaterThan(browser);
    expect(upload).toBeGreaterThan(prior);
    expect(cleanup).toBeGreaterThan(upload);
    expect(productionImage).toContain("/phase-*.json");
    expect(productionImage.match(
      /run-production-image-live-overlap\.mjs run/g,
    )).toHaveLength(8);
    expect(productionImage).toContain(
      "node node_modules/playwright/cli.js install chromium",
    );
    expect(productionImage).not.toContain("playwright/cli.js install --with-deps");
    expect(productionImage).toContain("await chromium.launch({ headless: true })");
    expect(productionImage).toContain("id: capture_identity");
    expect(productionImage).toContain("id: preparation_phase");
    expect(productionImage).toContain(
      "if: ${{ always() && steps.preparation_phase.outcome != 'skipped' }}",
    );
    expect(productionImage).not.toContain("continue-on-error:");
    expect(runner).toContain(
      "Live overlap phase replay, overlap, or forward state is forbidden.",
    );
    expect(runner).toContain(
      'phase: liveOverlapPhases.includes(phase) ? phase : "runner"',
    );
    const evidenceSeal = runner.indexOf(
      'const evidenceReceipt = await completePhase(plan, "evidence"',
    );
    const completionCommit = runner.indexOf(
      'await writeResult(plan, "completion.json", completion)',
    );
    expect(evidenceSeal).toBeGreaterThan(-1);
    expect(completionCommit).toBeGreaterThan(evidenceSeal);
    expect(runner).toContain(
      'startedReceiptSha256: status === "completed" ? context.started.sha256 : null',
    );
    const chatwootEvidenceCleanup = runner.indexOf(
      "await cleanupFinalizedChatwootEvidence(plan, ownership)",
    );
    const providerProjectCleanup = runner.indexOf(
      "await cleanupExactProject(ownership.projects.provider[roleName])",
    );
    expect(chatwootEvidenceCleanup).toBeGreaterThan(-1);
    expect(providerProjectCleanup).toBeGreaterThan(chatwootEvidenceCleanup);
    expect(runner).toContain("await unlinkExactChatwootArtifact(");
    expect(runner).toContain("Chatwoot evidence root survived exact cleanup.");
    expect(runner).toContain(
      "clean-pay-chatwoot-evidence-cleanup-capability",
    );
    expect(runner).toContain(
      "Chatwoot evidence artifact changed after cleanup was sealed.",
    );
    expect(runner).toContain("if (errors.length === 0) {");
    expect(runner.indexOf("const remaining = await readdir(plan.ownedRoot)"))
      .toBeLessThan(runner.indexOf(
        "await unlinkRegularIfPresent(path.join(plan.ownedRoot, stateFilename))",
      ));
  });
});
