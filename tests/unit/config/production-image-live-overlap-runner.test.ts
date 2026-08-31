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
  proofArguments,
  providerProofArguments,
  validateChatwootArtifactManifest,
  validateLiveOverlapImageInspection,
  validateLiveOverlapOwnership,
} from "../../../tests/browser/journeys/run-production-image-live-overlap.mjs";
import {
  AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
  assertUnverifiedEmailLoginProof,
} from "../../../tests/browser/journeys/unverified-email-login-proof-contract.mjs";

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
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const unverifiedEmailRegression = readFileSync(
  "tests/browser/journeys/existing-unverified-email.candidate.spec.ts",
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
    expect(runner).toContain('"--candidate-unverified-email-proof-output"');
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

    // The immutable Windows-baseline runner remains independently selectable,
    // and its unchanged phase strings stay covered by the pre-existing tests.
    expect(fixedRunner).toContain(
      'await runPlaywright("playwright.config.ts", mainBrowserEnvironment);',
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
});
