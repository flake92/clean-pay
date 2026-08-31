import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BEHAVIORAL_BASELINE_SOURCE,
  assertBehavioralBaselineArchive,
  cleanupBehavioralBaselineSource,
  materializeBehavioralBaselineSource,
} from "../../../scripts/security/behavioral-baseline-source.mjs";
import { createJourneySanitizedErrorEvidence } from "./journey-error-evidence.mjs";
import { writeJourneySanitizedOutput } from "./journey-owned-stack-orchestrator.mjs";
import { JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES } from "./journey-synthetic-environment-contract.mjs";
import {
  createChatwootLiveProofCliPlanAfterPreparation,
  createChatwootLiveProofPlan,
} from "./chatwoot-live-proof-plan.mjs";
import { assertChatwootPhaseProof } from "./chatwoot-phase-proof-contract.mjs";
import { expectedChatwootScreenshotPaths } from "./chatwoot-phase-evidence-writer.mjs";
import { assertDualProviderOverlapProof } from "./provider-overlap-proof-contract.mjs";
import {
  PUBLIC_OVERLAP_PROOF_KIND,
  PUBLIC_OVERLAP_PROOF_SCHEMA_VERSION,
  resolvePublicOverlapProofPath,
} from "./public-overlap-proof-contract.mjs";
import {
  AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
  UNVERIFIED_EMAIL_PROOF_FILENAME,
  assertUnverifiedEmailLoginProof,
} from "./unverified-email-login-proof-contract.mjs";
import {
  AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF,
  LINKED_EMAIL_FAILURE_PROOF_FILENAME,
  assertLinkedEmailFailureProof,
} from "./linked-email-failure-proof-contract.mjs";

const repositoryRoot = path.resolve(process.cwd());
const liveRootPrefix = "clean-pay-production-live-overlap-";
const stateFilename = "ownership.json";
const liveOverlapPhases = Object.freeze([
  "preparation",
  "build",
  "attestation",
  "public",
  "provider",
  "authenticated",
  "chatwoot",
  "evidence",
]);
const phaseReceiptFilenames = Object.freeze(Object.fromEntries(
  liveOverlapPhases.map((phase) => [phase, `phase-${phase}.json`]),
));
const phaseStartedFilenames = Object.freeze(Object.fromEntries(
  liveOverlapPhases.map((phase) => [phase, `phase-${phase}-started.json`]),
));
const independentlySettledProofPhases = Object.freeze([
  "provider",
  "authenticated",
  "chatwoot",
]);
const maximumPhaseReceiptBytes = 64 * 1024;
const contractFilename = "browser-journey-contract.json";
const providerProofExternalFilename = "provider-overlap-proof.json";
const providerProofSanitizedFilename = "provider-overlap.json";
const providerProofFailureSanitizedFilename = "provider-overlap-failure.json";
const maximumProviderProofBytes = 16 * 1024 * 1024;
const chatwootInputRootName = "chatwoot-live-proof";
const chatwootPlanFilename = "chatwoot-phase-plan.json";
const chatwootEvidenceCleanupFilename = "chatwoot-evidence-cleanup.json";
const chatwootEvidencePrefix = "clean-pay-chatwoot-phase-evidence-";
const maximumChatwootProofBytes = 32 * 1024 * 1024;
const maximumChatwootManifestBytes = 256 * 1024;
const maximumChatwootScreenshotBytes = 5 * 1024 * 1024;
const maximumChatwootCleanupCapabilityBytes = 16 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const attestationFilenames = Object.freeze({
  baseline: "baseline-application-assets.json",
  candidate: "candidate-application-assets.json",
});
const outputParent = path.join(repositoryRoot, "test-results", "browser-live-pair-ci");
const publicProofCli = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "journeys",
  "prove-public-characterization-overlap.mjs",
);
const providerProofCli = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "journeys",
  "prove-provider-overlap.mjs",
);
const chatwootProofCli = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "journeys",
  "prove-chatwoot-phase-stability.mjs",
);
const authenticatedProofCli = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "journeys",
  "prove-authenticated-journey-live-pair.mjs",
);
const prepareEnvironmentCli = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "journeys",
  "prepare-synthetic-env.mjs",
);
const assetAttestationCli = path.join(
  repositoryRoot,
  "scripts",
  "security",
  "attest-production-image-assets.mjs",
);
const publicContractCli = path.join(
  repositoryRoot,
  "scripts",
  "security",
  "compute-public-build-contract.mjs",
);
const expectedEnvironment = Object.freeze({
  NEXT_PUBLIC_APP_URL: "https://pay.ci.clean-pay.dev",
  NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
  NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
  TURNSTILE_ENABLED: "true",
  TURNSTILE_SITE_KEY: "0x4AAAAABrowserJourneyOnly8Wp4Jz7Lc2",
});
const environmentFilenames = Object.freeze([
  ...JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
  contractFilename,
].sort());
const resourceKinds = Object.freeze([
  Object.freeze({ noun: "container", list: ["container", "ls", "--all", "--quiet"] }),
  Object.freeze({ noun: "network", list: ["network", "ls", "--quiet"] }),
  Object.freeze({ noun: "volume", list: ["volume", "ls", "--quiet"] }),
]);

export function createLiveOverlapPlan({ captureId, candidateRevision, temporaryRoot }) {
  exactKeys(arguments[0], ["captureId", "candidateRevision", "temporaryRoot"]);
  exactMatch(captureId, /^[a-f0-9]{16}$/, "capture id");
  exactMatch(candidateRevision, /^[a-f0-9]{40}$/, "candidate revision");
  if (!path.isAbsolute(temporaryRoot)) {
    throw new Error("Live overlap temporary root must be absolute.");
  }
  const suffix = captureId.slice(0, 12);
  const role = (name) => Object.freeze({
    appImage: `clean-pay:live-overlap-${name}-${captureId}`,
    appPort: name === "baseline" ? "42100" : "42200",
    attestationFilename: attestationFilenames[name],
    connectProxyPort: name === "baseline" ? "44100" : "44200",
    envDirectoryName: `${name}-environment`,
    migrationImage: `clean-pay-migration:live-overlap-${name}-${captureId}`,
    project: `clean-pay-browser-journey-provider-proof-${name}-${suffix}`,
    providerPort: name === "baseline" ? "43100" : "43200",
    proxyBind: name === "baseline" ? "127.0.0.21" : "127.0.0.22",
    revision: name === "baseline" ? BEHAVIORAL_BASELINE_SOURCE.commit : candidateRevision,
  });
  const plan = Object.freeze({
    captureId,
    candidateRevision,
    chatwootEvidenceRoot: path.join(
      temporaryRoot,
      `${chatwootEvidencePrefix}${captureId}`,
    ),
    ownedRoot: path.join(temporaryRoot, `${liveRootPrefix}${captureId}`),
    providerProof: Object.freeze({
      externalFilename: providerProofExternalFilename,
      sanitizedFilename: providerProofSanitizedFilename,
    }),
    roles: Object.freeze({ baseline: role("baseline"), candidate: role("candidate") }),
    temporaryRoot,
  });
  assertPlanIsolation(plan);
  return plan;
}

export function proofArguments(plan, inputs) {
  exactKeys(arguments[1], ["baseline", "candidate"]);
  const args = ["--capture-id", plan.captureId];
  for (const name of ["baseline", "candidate"]) {
    const input = exactRoleProofInput(plan, inputs, name);
    args.push(
      `--${name}-contract`, input.contractPath,
      `--${name}-asset-attestation`, input.assetAttestationPath,
      `--${name}-asset-image-digest`, input.assetImageDigest,
      `--${name}-migration-asset-image-digest`, input.migrationAssetImageDigest,
    );
  }
  return Object.freeze(args);
}

export function providerProofArguments(plan, inputs) {
  exactKeys(arguments[1], ["baseline", "candidate"]);
  const args = [];
  for (const name of ["baseline", "candidate"]) {
    const input = exactRoleProofInput(plan, inputs, name);
    args.push(
      `--${name}-contract`, input.contractPath,
      `--${name}-control-url`, input.controlUrl,
      `--${name}-resolver-ip`, input.resolverIp,
      `--${name}-asset-image-digest`, input.assetImageDigest,
      `--${name}-migration-asset-image-digest`, input.migrationAssetImageDigest,
      `--${name}-asset-attestation`, input.assetAttestationPath,
    );
  }
  args.push(
    "--capture-id", plan.captureId,
    "--scenario", "provider-overlap-v1",
    "--output", providerProofExternalPath(plan),
  );
  if (args.length !== 30) {
    throw new Error("Provider overlap proof arguments do not contain exactly fifteen pairs.");
  }
  return Object.freeze(args);
}

export function createRunnerChatwootLiveProofPlan(plan, inputs) {
  exactKeys(arguments[1], ["baseline", "candidate"]);
  return createChatwootLiveProofPlan({
    captureId: plan.captureId,
    ownedRoot: plan.ownedRoot,
    baseline: chatwootRoleSource(plan, inputs, "baseline"),
    candidate: chatwootRoleSource(plan, inputs, "candidate"),
  });
}

export function chatwootProofArguments(plan, cliPlanPath) {
  if (!path.isAbsolute(cliPlanPath)
    || path.dirname(cliPlanPath) !== plan.ownedRoot
    || path.basename(cliPlanPath) !== chatwootPlanFilename
    || path.dirname(plan.chatwootEvidenceRoot) !== plan.temporaryRoot
    || path.basename(plan.chatwootEvidenceRoot)
      !== `${chatwootEvidencePrefix}${plan.captureId}`) {
    throw new Error("Chatwoot live proof arguments escaped their exact external roots.");
  }
  return Object.freeze([
    "--plan", cliPlanPath,
    "--output", plan.chatwootEvidenceRoot,
  ]);
}

function chatwootRoleSource(plan, inputs, name) {
  const input = exactRoleProofInput(plan, inputs, name);
  const role = plan.roles[name];
  return Object.freeze({
    images: Object.freeze({
      application: Object.freeze({ digest: input.assetImageDigest, tag: role.appImage }),
      migration: Object.freeze({ digest: input.migrationAssetImageDigest, tag: role.migrationImage }),
    }),
    revision: role.revision,
  });
}

function exactRoleProofInput(plan, inputs, name) {
  if (!new Set(["baseline", "candidate"]).has(name)) {
    throw new Error("Live overlap proof role is invalid.");
  }
  const input = inputs[name];
  exactKeys(input, [
    "assetAttestationPath",
    "assetImageDigest",
    "contractPath",
    "controlUrl",
    "migrationAssetImageDigest",
    "resolverIp",
  ]);
  const role = plan.roles[name];
  if (input.controlUrl !== `http://127.0.0.1:${role.providerPort}/`
    || input.resolverIp !== role.proxyBind
    || !path.isAbsolute(input.contractPath)
    || !path.isAbsolute(input.assetAttestationPath)
    || !/^sha256:[a-f0-9]{64}$/.test(input.assetImageDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(input.migrationAssetImageDigest)) {
    throw new Error(`Live overlap ${name} proof input differs from its exact contract.`);
  }
  return input;
}

async function run(plan, selectedPhase = null) {
  let activePhase = selectedPhase;
  try {
    if (selectedPhase !== null) {
      await runLiveOverlapPhase(plan, selectedPhase);
      return;
    }
    for (const phase of liveOverlapPhases) {
      activePhase = phase;
      await runLiveOverlapPhase(plan, phase);
    }
  } catch (error) {
    await writeFailure(plan, error, activePhase);
    throw error;
  }
}

async function runLiveOverlapPhase(plan, phase) {
  if (!liveOverlapPhases.includes(phase)) {
    throw new Error("Live overlap execution phase is invalid.");
  }
  if (phase === "preparation") await runPreparationPhase(plan);
  else if (phase === "build") await runBuildPhase(plan);
  else if (phase === "attestation") await runAttestationPhase(plan);
  else if (phase === "public") await runPublicPhase(plan);
  else if (phase === "provider") await runProviderPhase(plan);
  else if (phase === "authenticated") await runAuthenticatedPhase(plan);
  else if (phase === "chatwoot") await runChatwootPhase(plan);
  else await runEvidencePhase(plan);
}

async function runPreparationPhase(plan) {
  await assertRepositoryAndHost(plan);
  const context = await beginPhase(plan, "preparation");
  await mkdir(plan.ownedRoot, { mode: 0o700, recursive: false });
  await enforcePrivateDirectory(plan.ownedRoot);
  const materialized = await materializeBehavioralBaselineSource({
    repositoryRoot,
    temporaryRoot: plan.ownedRoot,
  });
  await writeOwnedJson(path.join(plan.ownedRoot, stateFilename), createOwnership(plan, materialized));
  const ownership = await readOwnershipArtifact(plan);
  await completePhase(plan, "preparation", context, {
    baselineArchiveSha256: BEHAVIORAL_BASELINE_SOURCE.archiveSha256,
    baselineReceiptSha256: ownership.value.behavioralBaseline.receiptSha256,
    status: "immutable-baseline-owned",
  }, ownership.sha256);
}

async function runBuildPhase(plan) {
  await assertRepositoryAndHost(plan);
  const context = await beginPhase(plan, "build");
  const baselineRoot = path.join(
    plan.ownedRoot,
    context.ownership.value.behavioralBaseline.rootName,
  );
  const baselineArchiveBytes = await readBoundedFile(
    path.join(baselineRoot, "behavioral-baseline.tar"),
    BEHAVIORAL_BASELINE_SOURCE.archiveBytes,
  );
  assertBehavioralBaselineArchive(baselineArchiveBytes);
  const buildArguments = sharedBuildArguments(context.publicBuildContract);

  for (const roleName of ["baseline", "candidate"]) {
    const role = plan.roles[roleName];
    const baselineArchive = roleName === "baseline" ? baselineArchiveBytes : undefined;
    await buildImage({
      baselineArchive,
      buildArguments,
      release: `live-overlap-${roleName}`,
      revision: role.revision,
      tag: role.appImage,
      target: "runner",
    });
    await buildImage({
      baselineArchive,
      buildArguments,
      release: `live-overlap-${roleName}`,
      revision: role.revision,
      tag: role.migrationImage,
      target: "migration",
    });
  }
  await completePhase(plan, "build", context, {
    imageCount: 4,
    imageTagSha256s: {
      baselineApplication: sha256(plan.roles.baseline.appImage),
      baselineMigration: sha256(plan.roles.baseline.migrationImage),
      candidateApplication: sha256(plan.roles.candidate.appImage),
      candidateMigration: sha256(plan.roles.candidate.migrationImage),
    },
    status: "four-production-images-built",
  });
}

async function runAttestationPhase(plan) {
  await assertRepositoryAndHost(plan);
  const context = await beginPhase(plan, "attestation");
  const inputs = {};
  for (const roleName of ["baseline", "candidate"]) {
    inputs[roleName] = await prepareRoleInputs(plan, roleName, context.publicBuildContract);
  }
  await completePhase(
    plan,
    "attestation",
    context,
    await summarizeAttestedInputs(plan, inputs),
  );
}

async function runPublicPhase(plan) {
  await assertRepositoryAndHost(plan);
  const context = await beginPhase(plan, "public");
  const inputs = await readAttestedPhaseInputs(plan, context);
  const args = proofArguments(plan, inputs);
  const sanitizedCaptureRoot = await ensureSanitizedCaptureRoot(plan);
  const publicProofEnvironment = sanitizedProcessEnvironment();
  publicProofEnvironment.CLEAN_PAY_PUBLIC_OVERLAP_FAILURE_OUTPUT_ROOT =
    sanitizedCaptureRoot;
  await runInherited(process.execPath, [publicProofCli, ...args], publicProofEnvironment);
  await completePhase(
    plan,
    "public",
    context,
    await validatePublishedPublicProof(plan),
  );
}

async function runProviderPhase(plan) {
  await assertRepositoryAndHost(plan);
  await runSettledProofPhase(plan, "provider", async (context) => {
    const inputs = await readAttestedPhaseInputs(plan, context);
    assertSamePhaseResult(
      await validatePublishedPublicProof(plan),
      context.receipts.public.value.result,
      "public",
    );
    const sanitizedCaptureRoot = await ensureSanitizedCaptureRoot(plan);
    const providerProofEnvironment = sanitizedProcessEnvironment();
    providerProofEnvironment.CLEAN_PAY_PROVIDER_OVERLAP_FAILURE_OUTPUT =
      providerProofFailureSanitizedPath(plan, sanitizedCaptureRoot);
    await runInherited(
      process.execPath,
      [providerProofCli, ...providerProofArguments(plan, inputs)],
      providerProofEnvironment,
    );
    const providerOverlap = await publishProviderProof(plan);
    await completePhase(plan, "provider", context, providerOverlap);
  });
}

async function runAuthenticatedPhase(plan) {
  await assertRepositoryAndHost(plan);
  await runSettledProofPhase(plan, "authenticated", async (context) => {
    const inputs = await readAttestedPhaseInputs(plan, context);
    await validatePriorProofPhaseOutcome(plan, "provider", context.receipts.provider);
    const args = proofArguments(plan, inputs);
    const unverifiedEmailProof = unverifiedEmailProofPath(plan);
    const linkedEmailFailureProof = linkedEmailFailureProofPath(plan);
    await runInherited(process.execPath, [
      authenticatedProofCli,
      ...args,
      "--candidate-linked-email-failure-proof-output",
      linkedEmailFailureProof,
      "--candidate-unverified-email-proof-output",
      unverifiedEmailProof,
    ], sanitizedProcessEnvironment());
    const unverifiedEmailLogin = await validateUnverifiedEmailProof(
      plan,
      inputs,
      unverifiedEmailProof,
    );
    const linkedEmailFailureFeedback = await validateLinkedEmailFailureProof(
      plan,
      inputs,
      linkedEmailFailureProof,
    );
    await completePhase(plan, "authenticated", context, {
      linkedEmailFailureFeedback,
      unverifiedEmailLogin,
    });
  });
}

async function runChatwootPhase(plan) {
  await assertRepositoryAndHost(plan);
  await runSettledProofPhase(plan, "chatwoot", async (context) => {
    const inputs = await readAttestedPhaseInputs(plan, context);
    await validatePriorProofPhaseOutcome(
      plan,
      "authenticated",
      context.receipts.authenticated,
      inputs,
    );
    const chatwoot = await prepareChatwootLiveProofInputs(plan, inputs);
    await runInherited(
      process.execPath,
      [chatwootProofCli, ...chatwootProofArguments(plan, chatwoot.cliPlanPath)],
      sanitizedProcessEnvironment(),
    );
    const chatwootPhase = await validateChatwootEvidence(plan, inputs);
    await completePhase(plan, "chatwoot", context, chatwootPhase);
  });
}

async function runSettledProofPhase(plan, phase, runPhase) {
  const context = await beginPhase(plan, phase);
  try {
    return await runPhase(context);
  } catch (primaryError) {
    try {
      await settleProofPhaseFailure(plan, phase, context, primaryError);
    } catch (settlementError) {
      throw new AggregateError(
        [primaryError, settlementError],
        "Live overlap proof phase and its sanitized settlement both failed.",
      );
    }
    throw primaryError;
  }
}

async function settleProofPhaseFailure(plan, phase, context, error) {
  const document = validateLiveOverlapPhaseFailure({
    schemaVersion: 1,
    kind: "clean-pay-production-image-live-overlap-phase-failure",
    status: "failed",
    captureId: plan.captureId,
    phase,
    ...createJourneySanitizedErrorEvidence(error),
  }, {
    captureId: plan.captureId,
    phase,
  });
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  const artifact = phaseFailureFilename(phase);
  const captureRoot = await ensureSanitizedCaptureRoot(plan);
  const target = path.join(captureRoot, artifact);
  if (path.dirname(target) !== captureRoot || path.basename(target) !== artifact) {
    throw new Error("Live overlap phase failure output escaped its sanitized root.");
  }
  const publication = await writeJourneySanitizedOutput(target, bytes);
  if (publication.bytes !== bytes.byteLength
    || publication.sha256 !== sha256(bytes)
    || publication.status !== "sanitized-create-only-output-written") {
    throw new Error("Live overlap phase failure publication is not byte-bound.");
  }
  await completePhase(plan, phase, context, {
    artifact,
    sha256: publication.sha256,
    status: "failed",
  });
}

async function validatePriorProofPhaseOutcome(plan, phase, receipt, inputs) {
  const result = receipt.value.result;
  if (result.status === "failed") {
    await validateSettledPhaseFailure(plan, phase, result);
    return;
  }
  if (phase === "provider") {
    assertSamePhaseResult(
      await validatePublishedProviderProof(plan),
      result,
      "provider",
    );
    return;
  }
  if (phase !== "authenticated" || !inputs) {
    throw new Error("Live overlap prior proof phase validation is invalid.");
  }
  const unverifiedEmailLogin = await validateUnverifiedEmailProof(
    plan,
    inputs,
    unverifiedEmailProofPath(plan),
  );
  const linkedEmailFailureFeedback = await validateLinkedEmailFailureProof(
    plan,
    inputs,
    linkedEmailFailureProofPath(plan),
  );
  assertSamePhaseResult(
    { linkedEmailFailureFeedback, unverifiedEmailLogin },
    result,
    "authenticated",
  );
}

async function runEvidencePhase(plan) {
  await assertRepositoryAndHost(plan);
  const context = await beginPhase(plan, "evidence");
  const inputs = await readAttestedPhaseInputs(plan, context);
  const { publicBuildContract, receipts } = context;
  const failedProofPhases = independentlySettledProofPhases.filter(
    (phase) => receipts[phase].value.result.status === "failed",
  );
  for (const phase of failedProofPhases) {
    await validateSettledPhaseFailure(plan, phase, receipts[phase].value.result);
  }
  if (failedProofPhases.length > 0) {
    throw new Error("Live overlap evidence cannot finalize while a proof phase is failed.");
  }
  assertSamePhaseResult(
    await validatePublishedPublicProof(plan),
    receipts.public.value.result,
    "public",
  );
  const providerOverlap = await validatePublishedProviderProof(plan);
  const unverifiedEmailLogin = await validateUnverifiedEmailProof(
    plan,
    inputs,
    unverifiedEmailProofPath(plan),
  );
  const linkedEmailFailureFeedback = await validateLinkedEmailFailureProof(
    plan,
    inputs,
    linkedEmailFailureProofPath(plan),
  );
  const chatwootPhase = await validateChatwootEvidence(plan, inputs);
  assertSamePhaseResult(providerOverlap, receipts.provider.value.result, "provider");
  assertSamePhaseResult(
    { linkedEmailFailureFeedback, unverifiedEmailLogin },
    receipts.authenticated.value.result,
    "authenticated",
  );
  assertSamePhaseResult(chatwootPhase, receipts.chatwoot.value.result, "Chatwoot");
  const completion = {
    schemaVersion: 1,
    status: "production-image-live-overlap-proven",
    captureId: plan.captureId,
    baselineRevision: plan.roles.baseline.revision,
    candidateRevision: plan.roles.candidate.revision,
    publicBuildContractSha256: publicBuildContract.sha256,
    projects: {
      baselineSha256: sha256(plan.roles.baseline.project),
      candidateSha256: sha256(plan.roles.candidate.project),
    },
    images: {
      baselineApplication: inputs.baseline.assetImageDigest,
      baselineMigration: inputs.baseline.migrationAssetImageDigest,
      candidateApplication: inputs.candidate.assetImageDigest,
      candidateMigration: inputs.candidate.migrationAssetImageDigest,
    },
    providerOverlap,
    linkedEmailFailureFeedback,
    unverifiedEmailLogin,
    chatwootPhase,
  };
  const completionBytes = Buffer.from(`${JSON.stringify(completion, null, 2)}\n`, "utf8");
  const evidenceReceipt = await completePhase(plan, "evidence", context, {
    completionSha256: sha256(completionBytes),
    status: "sanitized-evidence-finalized",
  }, undefined, false);
  await writeResult(plan, "completion.json", completion);
  const publishedCompletion = await readBoundedFile(
    path.join(await ensureSanitizedCaptureRoot(plan), "completion.json"),
    64 * 1024,
  );
  if (!publishedCompletion.equals(completionBytes)) {
    throw new Error("Live overlap completion changed after its final create-only commit.");
  }
  announceCompletedPhase(plan, "evidence", evidenceReceipt);
  process.stdout.write(`${JSON.stringify({
    status: "production_image_live_overlap_proven",
    captureId: plan.captureId,
    baselineRevision: plan.roles.baseline.revision,
    candidateRevision: plan.roles.candidate.revision,
    images: completion.images,
  })}\n`);
}

async function beginPhase(plan, phase) {
  const context = await readPhaseContext(plan, phase);
  const started = createPhaseReceipt(plan, phase, context, "started", null);
  const artifact = await writePhaseDocument(
    plan,
    phaseStartedFilenames[phase],
    started,
  );
  return Object.freeze({ ...context, started: artifact });
}

async function completePhase(
  plan,
  phase,
  context,
  result,
  ownershipSha256,
  announce = true,
) {
  const completionContext = ownershipSha256 === undefined
    ? context
    : Object.freeze({ ...context, ownershipSha256 });
  const receipt = createPhaseReceipt(
    plan,
    phase,
    completionContext,
    "completed",
    result,
  );
  const artifact = await writePhaseDocument(plan, phaseReceiptFilenames[phase], receipt);
  if (announce) announceCompletedPhase(plan, phase, artifact);
  return artifact;
}

function announceCompletedPhase(plan, phase, artifact) {
  process.stdout.write(JSON.stringify({
    status: "production_image_live_overlap_phase_completed",
    captureId: plan.captureId,
    phase,
    receiptSha256: artifact.sha256,
  }) + "\n");
}

async function readPhaseContext(plan, phase) {
  const phaseIndex = liveOverlapPhases.indexOf(phase);
  if (phaseIndex < 0) throw new Error("Live overlap execution phase is invalid.");
  const publicBuildContract = await computePublicBuildContract();
  const ownership = phaseIndex === 0 ? null : await readOwnershipArtifact(plan);
  const ownershipSha256 = ownership?.sha256 ?? null;
  const receipts = {};
  let previousReceiptSha256 = null;

  for (const priorPhase of liveOverlapPhases.slice(0, phaseIndex)) {
    const started = await readPhaseDocument(plan, phaseStartedFilenames[priorPhase]);
    validateLiveOverlapPhaseReceipt(started.value, {
      candidateRevision: plan.candidateRevision,
      captureId: plan.captureId,
      ownershipSha256: priorPhase === "preparation" ? null : ownershipSha256,
      phase: priorPhase,
      previousReceiptSha256,
      publicBuildContract,
      startedReceiptSha256: null,
      status: "started",
    });
    const completed = await readPhaseDocument(plan, phaseReceiptFilenames[priorPhase]);
    validateLiveOverlapPhaseReceipt(completed.value, {
      candidateRevision: plan.candidateRevision,
      captureId: plan.captureId,
      ownershipSha256,
      phase: priorPhase,
      previousReceiptSha256,
      publicBuildContract,
      startedReceiptSha256: started.sha256,
      status: "completed",
    });
    assertPhaseStartCompletionBinding(started, completed, priorPhase);
    assertPhaseResultPlanBinding(plan, ownership, priorPhase, completed.value.result);
    receipts[priorPhase] = completed;
    previousReceiptSha256 = completed.sha256;
  }

  for (const pendingPhase of liveOverlapPhases.slice(phaseIndex)) {
    for (const filename of [
      phaseStartedFilenames[pendingPhase],
      phaseReceiptFilenames[pendingPhase],
    ]) {
      if (await regularPathExists(phaseDocumentPath(plan, filename))) {
        throw new Error("Live overlap phase replay, overlap, or forward state is forbidden.");
      }
    }
  }

  return Object.freeze({
    ownership,
    ownershipSha256,
    previousReceiptSha256,
    publicBuildContract,
    receipts: Object.freeze(receipts),
  });
}

function createPhaseReceipt(plan, phase, context, status, result) {
  const value = {
    schemaVersion: 1,
    kind: "clean-pay-production-image-live-overlap-phase",
    status,
    phase,
    phaseIndex: liveOverlapPhases.indexOf(phase),
    captureId: plan.captureId,
    baselineRevision: plan.roles.baseline.revision,
    candidateRevision: plan.candidateRevision,
    ownershipSha256: context.ownershipSha256,
    previousReceiptSha256: context.previousReceiptSha256,
    publicBuildContractVersion: context.publicBuildContract.version,
    publicBuildContractSha256: context.publicBuildContract.sha256,
    startedReceiptSha256: status === "completed" ? context.started.sha256 : null,
    ...(status === "completed" ? { result } : {}),
  };
  return validateLiveOverlapPhaseReceipt(value, {
    candidateRevision: plan.candidateRevision,
    captureId: plan.captureId,
    ownershipSha256: context.ownershipSha256,
    phase,
    previousReceiptSha256: context.previousReceiptSha256,
    publicBuildContract: context.publicBuildContract,
    startedReceiptSha256: status === "completed" ? context.started.sha256 : null,
    status,
  });
}

function phaseFailureFilename(phase) {
  if (!independentlySettledProofPhases.includes(phase)) {
    throw new Error("Live overlap independently settled phase is invalid.");
  }
  return `phase-${phase}-failure.json`;
}

export function validateLiveOverlapPhaseFailure(value, expected) {
  exactKeys(expected, ["captureId", "phase"]);
  exactKeys(value, [
    "captureId",
    "causeEvidence",
    "causeEvidenceTruncated",
    "errorClass",
    "kind",
    "messageSha256",
    "phase",
    "schemaVersion",
    "status",
  ]);
  if (value.schemaVersion !== 1
    || value.kind !== "clean-pay-production-image-live-overlap-phase-failure"
    || value.status !== "failed"
    || value.captureId !== expected.captureId
    || !/^[a-f0-9]{16}$/.test(value.captureId ?? "")
    || value.phase !== expected.phase
    || !independentlySettledProofPhases.includes(value.phase)
    || typeof value.causeEvidenceTruncated !== "boolean"
    || !new Set(["AggregateError", "Error", "NonError"]).has(value.errorClass)
    || !/^[a-f0-9]{64}$/.test(value.messageSha256 ?? "")
    || !Array.isArray(value.causeEvidence)
    || value.causeEvidence.length > 16) {
    throw new Error("Live overlap phase failure differs from its sanitized contract.");
  }
  for (const [index, cause] of value.causeEvidence.entries()) {
    exactKeys(cause, [
      "depth",
      "errorClass",
      "messageSha256",
      "ordinal",
      "parentOrdinal",
    ]);
    if (!Number.isSafeInteger(cause.depth)
      || cause.depth < 1
      || cause.depth > 4
      || !new Set(["AggregateError", "Error", "NonError"]).has(cause.errorClass)
      || !/^[a-f0-9]{64}$/.test(cause.messageSha256 ?? "")
      || cause.ordinal !== index + 1
      || !Number.isSafeInteger(cause.parentOrdinal)
      || cause.parentOrdinal < 0
      || cause.parentOrdinal >= cause.ordinal) {
      throw new Error("Live overlap phase failure cause is invalid.");
    }
  }
  return Object.freeze(value);
}

async function validateSettledPhaseFailure(plan, phase, result) {
  const artifact = phaseFailureFilename(phase);
  const captureRoot = path.join(outputParent, plan.captureId);
  const target = path.join(captureRoot, artifact);
  if (result.artifact !== artifact
    || path.dirname(target) !== captureRoot
    || path.basename(target) !== artifact) {
    throw new Error("Live overlap settled phase failure path is invalid.");
  }
  const bytes = await readBoundedFile(target, maximumPhaseReceiptBytes);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Live overlap settled phase failure is not valid JSON.");
  }
  validateLiveOverlapPhaseFailure(document, {
    captureId: plan.captureId,
    phase,
  });
  if (sha256(bytes) !== result.sha256) {
    throw new Error("Live overlap settled phase failure lost its receipt binding.");
  }
  return result;
}

export function validateLiveOverlapPhaseReceipt(value, expected) {
  exactKeys(expected, [
    "candidateRevision",
    "captureId",
    "ownershipSha256",
    "phase",
    "previousReceiptSha256",
    "publicBuildContract",
    "startedReceiptSha256",
    "status",
  ]);
  exactKeys(expected.publicBuildContract, ["sha256", "version"]);
  const completed = expected.status === "completed";
  exactKeys(value, [
    "baselineRevision",
    "candidateRevision",
    "captureId",
    "kind",
    "ownershipSha256",
    "phase",
    "phaseIndex",
    "previousReceiptSha256",
    "publicBuildContractSha256",
    "publicBuildContractVersion",
    "schemaVersion",
    "startedReceiptSha256",
    "status",
    ...(completed ? ["result"] : []),
  ]);
  const phaseIndex = liveOverlapPhases.indexOf(expected.phase);
  if (phaseIndex < 0
    || !new Set(["started", "completed"]).has(expected.status)
    || value.schemaVersion !== 1
    || value.kind !== "clean-pay-production-image-live-overlap-phase"
    || value.status !== expected.status
    || value.phase !== expected.phase
    || value.phaseIndex !== phaseIndex
    || value.captureId !== expected.captureId
    || !/^[a-f0-9]{16}$/.test(value.captureId ?? "")
    || value.baselineRevision !== BEHAVIORAL_BASELINE_SOURCE.commit
    || value.candidateRevision !== expected.candidateRevision
    || !/^[a-f0-9]{40}$/.test(value.candidateRevision ?? "")
    || value.ownershipSha256 !== expected.ownershipSha256
    || value.previousReceiptSha256 !== expected.previousReceiptSha256
    || value.publicBuildContractVersion !== expected.publicBuildContract.version
    || value.publicBuildContractSha256 !== expected.publicBuildContract.sha256
    || value.startedReceiptSha256 !== expected.startedReceiptSha256
    || value.publicBuildContractVersion !== "1"
    || !/^[a-f0-9]{64}$/.test(value.publicBuildContractSha256 ?? "")
    || (value.startedReceiptSha256 !== null
      && !/^[a-f0-9]{64}$/.test(value.startedReceiptSha256))
    || (value.ownershipSha256 !== null
      && !/^[a-f0-9]{64}$/.test(value.ownershipSha256))
    || (value.previousReceiptSha256 !== null
      && !/^[a-f0-9]{64}$/.test(value.previousReceiptSha256))) {
    throw new Error("Live overlap phase receipt differs from its exact chain contract.");
  }
  if (completed) validateLiveOverlapPhaseResult(expected.phase, value.result);
  return Object.freeze(value);
}

function validateLiveOverlapPhaseResult(phase, result) {
  if (
    independentlySettledProofPhases.includes(phase)
    && result?.status === "failed"
  ) {
    exactKeys(result, ["artifact", "sha256", "status"]);
    if (result.artifact !== phaseFailureFilename(phase)
      || !/^[a-f0-9]{64}$/.test(result.sha256 ?? "")) {
      phaseResultError();
    }
    return result;
  }
  if (phase === "preparation") {
    exactKeys(result, ["baselineArchiveSha256", "baselineReceiptSha256", "status"]);
    if (result.baselineArchiveSha256 !== BEHAVIORAL_BASELINE_SOURCE.archiveSha256
      || !/^[a-f0-9]{64}$/.test(result.baselineReceiptSha256 ?? "")
      || result.status !== "immutable-baseline-owned") phaseResultError();
  } else if (phase === "build") {
    exactKeys(result, ["imageCount", "imageTagSha256s", "status"]);
    exactDigestRecord(result.imageTagSha256s, [
      "baselineApplication", "baselineMigration", "candidateApplication", "candidateMigration",
    ], false);
    if (result.imageCount !== 4 || result.status !== "four-production-images-built") {
      phaseResultError();
    }
  } else if (phase === "attestation") {
    exactKeys(result, ["assetAttestationSha256s", "contractSha256s", "images", "status"]);
    exactDigestRecord(result.assetAttestationSha256s, ["baseline", "candidate"], false);
    exactDigestRecord(result.contractSha256s, ["baseline", "candidate"], false);
    exactDigestRecord(result.images, [
      "baselineApplication", "baselineMigration", "candidateApplication", "candidateMigration",
    ], true);
    if (result.status !== "four-images-and-static-assets-attested") phaseResultError();
  } else if (phase === "public") {
    exactKeys(result, ["artifact", "artifactCountPerSide", "caseCount", "sha256", "status"]);
    if (result.artifact !== "proof.json"
      || result.artifactCountPerSide !== 126
      || result.caseCount !== 42
      || !/^[a-f0-9]{64}$/.test(result.sha256 ?? "")
      || result.status !== "live-public-characterization-overlap-proven-after-exact-cleanup") {
      phaseResultError();
    }
  } else if (phase === "provider") {
    exactKeys(result, ["artifact", "sha256", "status"]);
    if (result.artifact !== providerProofSanitizedFilename
      || !/^[a-f0-9]{64}$/.test(result.sha256 ?? "")
      || result.status !== "proven") phaseResultError();
  } else if (phase === "authenticated") {
    exactKeys(result, ["linkedEmailFailureFeedback", "unverifiedEmailLogin"]);
    validateAuthorizedProofSummary(result.linkedEmailFailureFeedback, {
      artifact: LINKED_EMAIL_FAILURE_PROOF_FILENAME,
      authorizedSemanticDiff: AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF,
      status: "linked-email-auth-failure-feedback-specific",
    });
    validateAuthorizedProofSummary(result.unverifiedEmailLogin, {
      artifact: UNVERIFIED_EMAIL_PROOF_FILENAME,
      authorizedSemanticDiff: AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
      status: "existing-unverified-email-login-gated",
    });
  } else if (phase === "chatwoot") {
    exactKeys(result, [
      "aggregateSha256", "artifactCount", "artifactRoot", "manifestSha256", "proofSha256", "status",
    ]);
    if (![result.aggregateSha256, result.manifestSha256, result.proofSha256]
      .every((digest) => /^[a-f0-9]{64}$/.test(digest ?? ""))
      || result.artifactCount !== 19
      || !/^clean-pay-chatwoot-phase-evidence-[a-f0-9]{16}$/.test(result.artifactRoot ?? "")
      || result.status !== "proven") phaseResultError();
  } else if (phase === "evidence") {
    exactKeys(result, ["completionSha256", "status"]);
    if (!/^[a-f0-9]{64}$/.test(result.completionSha256 ?? "")
      || result.status !== "sanitized-evidence-finalized") phaseResultError();
  } else {
    phaseResultError();
  }
  return result;
}

function exactDigestRecord(value, keys, imageDigest) {
  exactKeys(value, keys);
  const pattern = imageDigest ? /^sha256:[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/;
  if (!keys.every((key) => pattern.test(value[key] ?? ""))) phaseResultError();
}

function validateAuthorizedProofSummary(value, expected) {
  exactKeys(value, ["artifact", "authorizedSemanticDiff", "sha256", "status"]);
  if (value.artifact !== expected.artifact
    || value.authorizedSemanticDiff !== expected.authorizedSemanticDiff
    || value.status !== expected.status
    || !/^[a-f0-9]{64}$/.test(value.sha256 ?? "")) phaseResultError();
}

function phaseResultError() {
  throw new Error("Live overlap phase result is not a sanitized exact projection.");
}

function assertPhaseStartCompletionBinding(startedArtifact, completedArtifact, phase) {
  const started = startedArtifact.value;
  const completed = completedArtifact.value;
  const comparable = [
    "baselineRevision",
    "candidateRevision",
    "captureId",
    "kind",
    "phase",
    "phaseIndex",
    "previousReceiptSha256",
    "publicBuildContractSha256",
    "publicBuildContractVersion",
  ];
  if (comparable.some((key) => started[key] !== completed[key])
    || completed.startedReceiptSha256 !== startedArtifact.sha256
    || (phase !== "preparation" && started.ownershipSha256 !== completed.ownershipSha256)
    || (phase === "preparation" && started.ownershipSha256 !== null)) {
    throw new Error("Live overlap phase start and completion receipts are not byte-chain compatible.");
  }
}

function assertPhaseResultPlanBinding(plan, ownership, phase, result) {
  if (phase === "preparation"
    && result.baselineReceiptSha256 !== ownership?.value.behavioralBaseline.receiptSha256) {
    throw new Error("Live overlap preparation receipt lost its baseline ownership binding.");
  }
  if (phase === "build" && JSON.stringify(result.imageTagSha256s) !== JSON.stringify({
    baselineApplication: sha256(plan.roles.baseline.appImage),
    baselineMigration: sha256(plan.roles.baseline.migrationImage),
    candidateApplication: sha256(plan.roles.candidate.appImage),
    candidateMigration: sha256(plan.roles.candidate.migrationImage),
  })) {
    throw new Error("Live overlap build receipt lost its exact image-tag binding.");
  }
  if (phase === "chatwoot"
    && result.artifactRoot !== path.basename(plan.chatwootEvidenceRoot)) {
    throw new Error("Live overlap Chatwoot receipt lost its exact evidence-root binding.");
  }
}

async function writePhaseDocument(plan, filename, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > maximumPhaseReceiptBytes) {
    throw new Error("Live overlap phase receipt exceeds its sanitized bound.");
  }
  const target = phaseDocumentPath(plan, filename);
  await ensureSanitizedCaptureRoot(plan);
  await writeOwnedBytes(target, bytes);
  return Object.freeze({ bytes, sha256: sha256(bytes), value });
}

async function readPhaseDocument(plan, filename) {
  const bytes = await readBoundedFile(
    phaseDocumentPath(plan, filename),
    maximumPhaseReceiptBytes,
  );
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Live overlap phase receipt is not valid JSON.");
  }
  return Object.freeze({ bytes, sha256: sha256(bytes), value });
}

function phaseDocumentPath(plan, filename) {
  if (![...Object.values(phaseStartedFilenames), ...Object.values(phaseReceiptFilenames)]
    .includes(filename)) {
    throw new Error("Live overlap phase evidence filename is invalid.");
  }
  const root = path.join(outputParent, plan.captureId);
  const target = path.join(root, filename);
  if (path.dirname(target) !== root || path.basename(target) !== filename) {
    throw new Error("Live overlap phase evidence escaped its sanitized capture root.");
  }
  return target;
}

async function regularPathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readOwnershipArtifact(plan) {
  const target = path.join(plan.ownedRoot, stateFilename);
  const bytes = await readBoundedFile(target, 8_192);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Live overlap ownership receipt is not valid JSON.");
  }
  return Object.freeze({
    bytes,
    sha256: sha256(bytes),
    value: validateLiveOverlapOwnership(value, plan),
  });
}

async function summarizeAttestedInputs(plan, inputs) {
  const assetAttestationSha256s = {};
  const contractSha256s = {};
  const images = {};
  for (const roleName of ["baseline", "candidate"]) {
    const input = exactPersistedRoleProofInput(plan, inputs, roleName);
    assetAttestationSha256s[roleName] = sha256(await readBoundedFile(
      input.assetAttestationPath,
      32 * 1024 * 1024,
    ));
    contractSha256s[roleName] = sha256(await readBoundedFile(
      input.contractPath,
      512 * 1024,
    ));
    images[roleName + "Application"] = input.assetImageDigest;
    images[roleName + "Migration"] = input.migrationAssetImageDigest;
  }
  return Object.freeze({
    assetAttestationSha256s: Object.freeze(assetAttestationSha256s),
    contractSha256s: Object.freeze(contractSha256s),
    images: Object.freeze(images),
    status: "four-images-and-static-assets-attested",
  });
}

async function readAttestedPhaseInputs(plan, context) {
  const inputs = {};
  for (const roleName of ["baseline", "candidate"]) {
    const role = plan.roles[roleName];
    const envDirectory = path.join(plan.ownedRoot, role.envDirectoryName);
    const generatedContract = await assertGeneratedEnvironment(envDirectory, role);
    const application = await inspectOwnedImage(
      role.appImage,
      "app",
      role.revision,
      context.publicBuildContract,
    );
    const migration = await inspectOwnedImage(
      role.migrationImage,
      "migration",
      role.revision,
      context.publicBuildContract,
    );
    if (application.digest === migration.digest) {
      throw new Error("Live overlap application and migration image identities alias.");
    }
    const input = Object.freeze({
      assetAttestationPath: path.join(plan.ownedRoot, role.attestationFilename),
      assetImageDigest: application.digest,
      contractPath: path.join(envDirectory, contractFilename),
      controlUrl: generatedContract.controlUrl,
      migrationAssetImageDigest: migration.digest,
      resolverIp: generatedContract.resolverIp,
    });
    await assertRegularFile(
      input.assetAttestationPath,
      32 * 1024 * 1024,
      "asset attestation",
    );
    inputs[roleName] = exactPersistedRoleProofInput(
      plan,
      { [roleName]: input },
      roleName,
    );
  }
  const frozen = Object.freeze(inputs);
  assertSamePhaseResult(
    await summarizeAttestedInputs(plan, frozen),
    context.receipts.attestation.value.result,
    "attestation",
  );
  return frozen;
}

export function exactPersistedRoleProofInput(plan, inputs, name) {
  const input = exactRoleProofInput(plan, inputs, name);
  const role = plan.roles[name];
  if (input.contractPath !== path.join(plan.ownedRoot, role.envDirectoryName, contractFilename)
    || input.assetAttestationPath !== path.join(plan.ownedRoot, role.attestationFilename)) {
    throw new Error("Live overlap persisted " + name
      + " proof path differs from its exact plan.");
  }
  return input;
}

async function validatePublishedPublicProof(plan) {
  const target = resolvePublicOverlapProofPath(repositoryRoot, plan.captureId);
  const bytes = await readBoundedFile(target, 512 * 1024);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Public overlap proof is not valid JSON.");
  }
  exactKeys(value, [
    "artifactCountPerSide",
    "baselineBindingSha256",
    "candidateBindingSha256",
    "captureId",
    "caseCount",
    "cleanupReceiptSha256",
    "kind",
    "launchReceiptSha256",
    "pairReceiptSha256",
    "schemaVersion",
    "status",
  ]);
  if (value.schemaVersion !== PUBLIC_OVERLAP_PROOF_SCHEMA_VERSION
    || value.kind !== PUBLIC_OVERLAP_PROOF_KIND
    || value.captureId !== plan.captureId
    || value.status !== "live-public-characterization-overlap-proven-after-exact-cleanup"
    || value.caseCount !== 42
    || value.artifactCountPerSide !== 126
    || [
      value.baselineBindingSha256,
      value.candidateBindingSha256,
      value.cleanupReceiptSha256,
      value.launchReceiptSha256,
      value.pairReceiptSha256,
    ].some((digest) => !/^[a-f0-9]{64}$/.test(digest ?? ""))) {
    throw new Error("Public overlap proof differs from its exact sanitized contract.");
  }
  return Object.freeze({
    artifact: path.basename(target),
    artifactCountPerSide: value.artifactCountPerSide,
    caseCount: value.caseCount,
    sha256: sha256(bytes),
    status: value.status,
  });
}

async function validatePublishedProviderProof(plan) {
  const target = path.join(
    outputParent,
    plan.captureId,
    plan.providerProof.sanitizedFilename,
  );
  if (path.dirname(target) !== path.join(outputParent, plan.captureId)) {
    throw new Error("Provider overlap sanitized proof escaped its exact capture root.");
  }
  const artifact = await readExactProviderProofArtifact(target);
  return Object.freeze({
    artifact: plan.providerProof.sanitizedFilename,
    sha256: artifact.sha256,
    status: artifact.document.comparison.status,
  });
}

function assertSamePhaseResult(observed, expected, phase) {
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error("Live overlap " + phase
      + " evidence changed after its completed phase.");
  }
  return observed;
}

async function cleanup(plan) {
  await assertRepositoryAndHost(plan, { requireHead: false });
  const ownership = await readCleanupOwnership(plan);
  if (!ownership) {
    process.stdout.write(`${JSON.stringify({
      status: "production_image_live_overlap_not_owned",
      captureId: plan.captureId,
      resourcesTouched: 0,
    })}\n`);
    return;
  }
  await cleanupFinalizedChatwootEvidence(plan, ownership);
  const errors = [];
  for (const roleName of ["baseline", "candidate"]) {
    try {
      await cleanupExactProject(ownership.projects.provider[roleName]);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const project of ownership.projects.chatwoot) {
    try {
      await cleanupExactChatwootProject(project);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const roleName of ["baseline", "candidate"]) {
    for (const [tag, expectedRole] of [
      [ownership.images[`${roleName}Application`], "app"],
      [ownership.images[`${roleName}Migration`], "migration"],
    ]) {
      try {
        await cleanupExactImage(tag, plan.roles[roleName].revision, expectedRole);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 0) {
    try {
      await cleanupOwnedInputRoot(plan, ownership);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Live overlap exact cleanup was not proven.");
  }
  process.stdout.write(`${JSON.stringify({
    status: "production_image_live_overlap_cleaned",
    captureId: plan.captureId,
    projectSha256s: [
      sha256(plan.roles.baseline.project),
      sha256(plan.roles.candidate.project),
      ...ownership.projects.chatwoot.map(sha256),
    ],
  })}\n`);
}

async function prepareRoleInputs(plan, roleName, publicBuildContract) {
  const role = plan.roles[roleName];
  const envDirectory = path.join(plan.ownedRoot, role.envDirectoryName);
  const prepareEnvironment = {
    ...sanitizedProcessEnvironment(),
    CLEAN_PAY_BROWSER_APP_IMAGE: role.appImage,
    CLEAN_PAY_BROWSER_APP_PORT: role.appPort,
    CLEAN_PAY_BROWSER_COMPOSE_PROJECT: role.project,
    CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT: role.connectProxyPort,
    CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR: envDirectory,
    CLEAN_PAY_BROWSER_MIGRATION_IMAGE: role.migrationImage,
    CLEAN_PAY_BROWSER_PROVIDER_PORT: role.providerPort,
    CLEAN_PAY_BROWSER_PROXY_BIND: role.proxyBind,
    CLEAN_PAY_BROWSER_SOURCE_REVISION: role.revision,
    CLEAN_PAY_BROWSER_TURNSTILE_SITE_KEY: expectedEnvironment.TURNSTILE_SITE_KEY,
  };
  await runInherited(process.execPath, [prepareEnvironmentCli], prepareEnvironment);
  const contractPath = path.join(envDirectory, contractFilename);
  const generatedContract = await assertGeneratedEnvironment(envDirectory, role);
  const application = await inspectOwnedImage(role.appImage, "app", role.revision, publicBuildContract);
  const migration = await inspectOwnedImage(
    role.migrationImage,
    "migration",
    role.revision,
    publicBuildContract,
  );
  if (application.digest === migration.digest) {
    throw new Error("Live overlap application and migration image identities alias.");
  }
  const assetAttestationPath = path.join(plan.ownedRoot, role.attestationFilename);
  await runInherited(process.execPath, [
    assetAttestationCli,
    "--image", role.appImage,
    "--expected-image-digest", application.digest,
    "--expected-revision", role.revision,
    "--expected-public-build-contract-version", publicBuildContract.version,
    "--expected-public-build-contract-sha256", publicBuildContract.sha256,
    "--platform", "linux/amd64",
    "--output", assetAttestationPath,
  ], sanitizedProcessEnvironment());
  await assertRegularFile(assetAttestationPath, 32 * 1024 * 1024, "asset attestation");
  return Object.freeze({
    assetAttestationPath,
    assetImageDigest: application.digest,
    contractPath,
    controlUrl: generatedContract.controlUrl,
    migrationAssetImageDigest: migration.digest,
    resolverIp: generatedContract.resolverIp,
  });
}

async function prepareChatwootLiveProofInputs(plan, inputs) {
  const livePlan = createRunnerChatwootLiveProofPlan(plan, inputs);
  const inputRoot = path.join(plan.ownedRoot, chatwootInputRootName);
  if (livePlan.ownedRoot !== plan.ownedRoot
    || path.dirname(inputRoot) !== plan.ownedRoot
    || path.basename(inputRoot) !== chatwootInputRootName) {
    throw new Error("Chatwoot live proof input root differs from the exact runner plan.");
  }
  await mkdir(inputRoot, { mode: 0o700, recursive: false });
  await enforcePrivateDirectory(inputRoot);

  const attestationBytes = Object.freeze(Object.fromEntries(await Promise.all(
    ["baseline", "candidate"].map(async (role) => [
      role,
      await readBoundedFile(inputs[role].assetAttestationPath, 32 * 1024 * 1024),
    ]),
  )));

  for (const pair of livePlan.pairs) {
    const pairRoot = path.join(inputRoot, `pair-${pair.pairIndex}`);
    await mkdir(pairRoot, { mode: 0o700, recursive: false });
    await enforcePrivateDirectory(pairRoot);
    for (const roleName of ["baseline", "candidate"]) {
      const stack = pair[roleName];
      const roleRoot = path.dirname(stack.generatedEnvironmentPath);
      if (path.dirname(roleRoot) !== pairRoot
        || path.basename(roleRoot) !== roleName
        || path.dirname(stack.assetAttestationPath) !== roleRoot) {
        throw new Error("Chatwoot live stack input paths differ from the exact pair root.");
      }
      await mkdir(roleRoot, { mode: 0o700, recursive: false });
      await enforcePrivateDirectory(roleRoot);
      await runInherited(process.execPath, [prepareEnvironmentCli], {
        ...sanitizedProcessEnvironment(),
        CLEAN_PAY_BROWSER_APP_IMAGE: stack.images.application.tag,
        CLEAN_PAY_BROWSER_APP_PORT: stack.appPort,
        CLEAN_PAY_BROWSER_COMPOSE_PROJECT: stack.project,
        CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT: stack.connectProxyPort,
        CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR: stack.generatedEnvironmentPath,
        CLEAN_PAY_BROWSER_MIGRATION_IMAGE: stack.images.migration.tag,
        CLEAN_PAY_BROWSER_PROVIDER_PORT: stack.providerPort,
        CLEAN_PAY_BROWSER_PROXY_BIND: stack.resolverIp,
        CLEAN_PAY_BROWSER_SOURCE_REVISION: stack.revision,
        CLEAN_PAY_BROWSER_TURNSTILE_SITE_KEY: expectedEnvironment.TURNSTILE_SITE_KEY,
      });
      const generatedContract = await assertGeneratedEnvironment(
        stack.generatedEnvironmentPath,
        {
          appImage: stack.images.application.tag,
          appPort: stack.appPort,
          connectProxyPort: stack.connectProxyPort,
          migrationImage: stack.images.migration.tag,
          project: stack.project,
          providerPort: stack.providerPort,
          proxyBind: stack.resolverIp,
          revision: stack.revision,
        },
      );
      if (generatedContract.controlUrl !== `http://127.0.0.1:${stack.providerPort}/`
        || generatedContract.resolverIp !== stack.resolverIp
        || stack.contractPath
          !== path.join(stack.generatedEnvironmentPath, contractFilename)) {
        throw new Error("Chatwoot generated environment differs from its exact live plan.");
      }
      await writeOwnedBytes(stack.assetAttestationPath, attestationBytes[roleName]);
      const copied = await readBoundedFile(
        stack.assetAttestationPath,
        32 * 1024 * 1024,
      );
      if (!copied.equals(attestationBytes[roleName])) {
        throw new Error("Chatwoot asset attestation copy is not byte-exact.");
      }
    }
  }

  const cliPlan = createChatwootLiveProofCliPlanAfterPreparation(livePlan);
  const cliPlanPath = path.join(plan.ownedRoot, chatwootPlanFilename);
  await writeOwnedJson(cliPlanPath, cliPlan);
  return Object.freeze({ cliPlanPath, livePlan });
}

async function buildImage({ baselineArchive, buildArguments, release, revision, tag, target }) {
  const args = [
    "build",
    "--platform", "linux/amd64",
    "--pull=false",
    "--target", target,
    "--build-arg", `CLEAN_PAY_RELEASE=${release}`,
    "--build-arg", `CLEAN_PAY_REVISION=${revision}`,
    ...buildArguments,
    "--tag", tag,
    baselineArchive ? "-" : repositoryRoot,
  ];
  if (baselineArchive) {
    await runInheritedWithFileInput("docker", args, baselineArchive, sanitizedProcessEnvironment());
  } else {
    await runInherited("docker", args, sanitizedProcessEnvironment());
  }
}

function sharedBuildArguments(publicBuildContract) {
  return Object.freeze([
    "--build-arg", `CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION=${publicBuildContract.version}`,
    "--build-arg", `CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256=${publicBuildContract.sha256}`,
    "--build-arg", `NEXT_PUBLIC_APP_URL=${expectedEnvironment.NEXT_PUBLIC_APP_URL}`,
    "--build-arg", `TURNSTILE_ENABLED=${expectedEnvironment.TURNSTILE_ENABLED}`,
    "--build-arg", `TURNSTILE_WIDGET_ID=${expectedEnvironment.TURNSTILE_SITE_KEY}`,
    "--build-arg", `NEXT_PUBLIC_BRAND_NAME=${expectedEnvironment.NEXT_PUBLIC_BRAND_NAME}`,
    "--build-arg", `NEXT_PUBLIC_BRAND_LOGO_URL=${expectedEnvironment.NEXT_PUBLIC_BRAND_LOGO_URL}`,
  ]);
}

async function computePublicBuildContract() {
  for (const [name, expected] of Object.entries(expectedEnvironment)) {
    if (process.env[name] !== expected) {
      throw new Error(`Live overlap public build input ${name} differs from its reviewed value.`);
    }
  }
  const environment = { ...sanitizedProcessEnvironment(), ...expectedEnvironment };
  const version = (await runCaptured(process.execPath, [publicContractCli, "--version"], environment)).trim();
  const digest = (await runCaptured(process.execPath, [publicContractCli], environment)).trim();
  exactMatch(version, /^1$/, "public build contract version");
  exactMatch(digest, /^[a-f0-9]{64}$/, "public build contract digest");
  return Object.freeze({ sha256: digest, version });
}

async function inspectOwnedImage(tag, role, revision, publicBuildContract) {
  const output = await runCaptured(
    "docker",
    ["image", "inspect", "--format", "{{json .}}", tag],
    sanitizedProcessEnvironment(),
  );
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("Live overlap image inspection is not valid JSON.");
  }
  return validateLiveOverlapImageInspection(value, {
    publicBuildContract,
    revision,
    role,
    tag,
  });
}

export function validateLiveOverlapImageInspection(value, {
  publicBuildContract,
  revision,
  role,
  tag,
}) {
  exactKeys(arguments[1], ["publicBuildContract", "revision", "role", "tag"]);
  exactMatch(tag, /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/, "image tag");
  exactMatch(revision, /^[a-f0-9]{40}$/, "image revision");
  if (!new Set(["app", "migration"]).has(role)
    || !publicBuildContract || typeof publicBuildContract !== "object"
    || Array.isArray(publicBuildContract)
    || JSON.stringify(Object.keys(publicBuildContract).sort()) !== JSON.stringify(["sha256", "version"])
    || publicBuildContract.version !== "1"
    || !/^[a-f0-9]{64}$/.test(publicBuildContract.sha256 ?? "")) {
    throw new Error("Live overlap image validation contract is invalid.");
  }
  const digest = value?.Id;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")
    || value?.Os !== "linux" || value?.Architecture !== "amd64"
    || !Array.isArray(value?.RepoDigests)
    || value.Config?.Labels?.["io.clean-pay.role"] !== role
    || value.Config?.Labels?.["org.opencontainers.image.revision"] !== revision
    || value.Config?.Labels?.["io.clean-pay.public-build-contract-version"]
      !== publicBuildContract.version
    || value.Config?.Labels?.["io.clean-pay.public-build-contract-sha256"]
      !== publicBuildContract.sha256) {
    throw new Error("Live overlap image is not identity-bound to its exact role and build inputs.");
  }
  const descriptorPresent = value.Descriptor !== undefined && value.Descriptor !== null;
  const descriptorKeys = Object.keys(value.Descriptor ?? {}).sort();
  const annotationsPresent = Object.hasOwn(value.Descriptor ?? {}, "annotations");
  const allowedDescriptorKeys = annotationsPresent
    ? ["annotations", "digest", "mediaType", "size"]
    : ["digest", "mediaType", "size"];
  if (descriptorPresent && (
    !value.Descriptor || typeof value.Descriptor !== "object" || Array.isArray(value.Descriptor)
    || JSON.stringify(descriptorKeys) !== JSON.stringify(allowedDescriptorKeys)
    || value.Descriptor.digest !== digest
    || !/^sha256:[a-f0-9]{64}$/.test(value.Descriptor.digest ?? "")
    || !new Set([
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.oci.image.manifest.v1+json",
    ]).has(value.Descriptor.mediaType)
    || !Number.isSafeInteger(value.Descriptor.size)
    || value.Descriptor.size < 1 || value.Descriptor.size > 16 * 1024 * 1024
    || (annotationsPresent && (
      !value.Descriptor.annotations
      || typeof value.Descriptor.annotations !== "object"
      || Array.isArray(value.Descriptor.annotations)
      || JSON.stringify(Object.keys(value.Descriptor.annotations))
        !== JSON.stringify(["config.digest"])
      || !/^sha256:[a-f0-9]{64}$/.test(
        value.Descriptor.annotations["config.digest"] ?? "",
      )
    ))
  )) {
    throw new Error("Live overlap containerd image descriptor differs from its selected root.");
  }
  const repoDigests = new Set();
  for (const repoDigest of value.RepoDigests ?? []) {
    if (typeof repoDigest !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,240}@sha256:[a-f0-9]{64}$/.test(repoDigest)
      || repoDigests.has(repoDigest)) {
      throw new Error("Live overlap image repository digest set is invalid.");
    }
    repoDigests.add(repoDigest);
  }
  return Object.freeze({
    digest,
    selectionMode: descriptorPresent ? "containerd-root-manifest" : "classic-config",
  });
}

async function assertGeneratedEnvironment(directory, role) {
  const details = await lstat(directory);
  const resolved = await realpath(directory);
  if (!details.isDirectory() || details.isSymbolicLink()
    || path.dirname(resolved) !== await realpath(path.dirname(directory))) {
    throw new Error("Live overlap generated environment ownership is invalid.");
  }
  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify(environmentFilenames)) {
    throw new Error("Live overlap generated environment inventory is incomplete.");
  }
  const contract = JSON.parse(await readFile(path.join(directory, contractFilename), "utf8"));
  if (contract?.project !== role.project || contract?.revision !== role.revision
    || contract?.images?.application !== role.appImage
    || contract?.images?.migration !== role.migrationImage
    || contract?.publications?.app !== `127.0.0.1:${role.appPort}`
    || contract?.publications?.providerControl !== `127.0.0.1:${role.providerPort}`
    || contract?.publications?.connectProxy !== `127.0.0.1:${role.connectProxyPort}`
    || contract?.publications?.browserTls !== `${role.proxyBind}:443`) {
    throw new Error("Live overlap generated contract differs from its isolated role plan.");
  }
  return Object.freeze({
    controlUrl: `http://${contract.publications.providerControl}/`,
    resolverIp: contract.publications.browserTls.split(":", 1)[0],
  });
}

async function assertRepositoryAndHost(plan, { requireHead = true } = {}) {
  if (process.platform !== "linux") {
    throw new Error("Production-image live overlap is pinned to the CI linux renderer.");
  }
  const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const temporary = await realpath(plan.temporaryRoot);
  const repository = await realpath(repositoryRoot);
  const temporaryDetails = await lstat(plan.temporaryRoot);
  if (rootPackage?.name !== "clean-pay" || rootPackage?.private !== true
    || !temporaryDetails.isDirectory() || temporaryDetails.isSymbolicLink()
    || isWithin(repository, temporary) || isWithin(temporary, repository)) {
    throw new Error("Live overlap repository or external temporary root is invalid.");
  }
  if (requireHead) {
    const head = (await runCaptured("git", ["rev-parse", "HEAD"], sanitizedProcessEnvironment())).trim();
    if (head !== plan.candidateRevision || head === BEHAVIORAL_BASELINE_SOURCE.commit) {
      throw new Error("Live overlap candidate revision does not match the exact checkout HEAD.");
    }
  }
  for (const executable of [
    publicProofCli,
    providerProofCli,
    authenticatedProofCli,
    chatwootProofCli,
    prepareEnvironmentCli,
  ]) {
    await assertRegularFile(executable, 4 * 1024 * 1024, "live overlap local executable");
  }
}

function createOwnership(plan, materialized) {
  const baselineRoot = path.basename(materialized.root);
  if (path.dirname(materialized.root) !== plan.ownedRoot
    || !baselineRoot.startsWith("clean-pay-behavioral-baseline-")) {
    throw new Error("Behavioral baseline root escaped live overlap ownership.");
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: "clean-pay-production-image-live-overlap-ownership",
    captureId: plan.captureId,
    candidateRevision: plan.candidateRevision,
    behavioralBaseline: Object.freeze({
      rootName: baselineRoot,
      receiptSha256: materialized.receiptSha256,
    }),
    evidence: Object.freeze({
      providerOverlapExternalFilename: plan.providerProof.externalFilename,
      providerOverlapSanitizedFilename: plan.providerProof.sanitizedFilename,
    }),
    projects: Object.freeze({
      provider: Object.freeze({
        baseline: plan.roles.baseline.project,
        candidate: plan.roles.candidate.project,
      }),
      chatwoot: Object.freeze(chatwootProjectNames(plan)),
    }),
    images: Object.freeze({
      baselineApplication: plan.roles.baseline.appImage,
      baselineMigration: plan.roles.baseline.migrationImage,
      candidateApplication: plan.roles.candidate.appImage,
      candidateMigration: plan.roles.candidate.migrationImage,
    }),
  });
}

async function cleanupExactProject(project) {
  exactMatch(
    project,
    /^clean-pay-browser-journey-provider-proof-(?:baseline|candidate)-[a-f0-9]{12}$/,
    "cleanup project",
  );
  await cleanupExactProjectResources(project);
}

async function cleanupExactChatwootProject(project) {
  exactMatch(
    project,
    /^clean-pay-browser-journey-chatwoot-(?:baseline|candidate)-p[1-3]-[a-f0-9]{12}$/,
    "Chatwoot cleanup project",
  );
  await cleanupExactProjectResources(project);
}

async function cleanupExactProjectResources(project) {
  for (const resource of resourceKinds) {
    const listed = await runCaptured(
      "docker",
      [...resource.list, "--filter", `label=com.docker.compose.project=${project}`],
      sanitizedProcessEnvironment(),
      { allowedExitCodes: [0] },
    );
    const ids = splitLines(listed);
    for (const id of ids) {
      exactMatch(id, /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/, `${resource.noun} id`);
      const observed = (await runCaptured(
        "docker",
        [
          resource.noun,
          "inspect",
          "--format",
          resource.noun === "container"
            ? "{{ index .Config.Labels \"com.docker.compose.project\" }}"
            : "{{ index .Labels \"com.docker.compose.project\" }}",
          id,
        ],
        sanitizedProcessEnvironment(),
      )).trim();
      if (observed !== project) {
        throw new Error(`Refusing cleanup of a ${resource.noun} outside the exact project.`);
      }
      const removal = resource.noun === "container"
        ? ["container", "rm", "--force", "--volumes", id]
        : [resource.noun, "rm", id];
      await runCaptured("docker", removal, sanitizedProcessEnvironment());
    }
  }
  for (const resource of resourceKinds) {
    const remaining = await runCaptured(
      "docker",
      [...resource.list, "--filter", `label=com.docker.compose.project=${project}`],
      sanitizedProcessEnvironment(),
    );
    if (splitLines(remaining).length !== 0) {
      throw new Error(`Exact ${resource.noun} cleanup did not prove project absence.`);
    }
  }
}

function chatwootProjectNames(plan) {
  return [1, 2, 3].flatMap((pairIndex) => (
    ["baseline", "candidate"].map((role) => (
      `clean-pay-browser-journey-chatwoot-${role}-p${pairIndex}-${plan.captureId.slice(0, 12)}`
    ))
  ));
}

async function cleanupFinalizedChatwootEvidence(plan, ownership) {
  const capabilityTarget = path.join(plan.ownedRoot, chatwootEvidenceCleanupFilename);
  let capability;
  if (await regularPathExists(capabilityTarget)) {
    capability = await readChatwootEvidenceCleanupCapability(plan, capabilityTarget);
  } else {
    if (!await regularPathExists(plan.chatwootEvidenceRoot)) return;
    const inputs = {};
    for (const roleName of ["baseline", "candidate"]) {
      const application = await inspectCleanupOwnedImage(
        ownership.images[roleName + "Application"],
        plan.roles[roleName].revision,
        "app",
      );
      const migration = await inspectCleanupOwnedImage(
        ownership.images[roleName + "Migration"],
        plan.roles[roleName].revision,
        "migration",
      );
      if (!application || !migration || application.Id === migration.Id) {
        throw new Error("Chatwoot evidence cleanup lost its exact image identities.");
      }
      inputs[roleName] = Object.freeze({
        assetImageDigest: application.Id,
        migrationAssetImageDigest: migration.Id,
      });
    }
    const inspected = await inspectChatwootEvidence(plan, Object.freeze(inputs));
    const document = createChatwootEvidenceCleanupCapability(plan, inspected.cleanup.artifacts);
    await writeOwnedJson(capabilityTarget, document);
    capability = await readChatwootEvidenceCleanupCapability(plan, capabilityTarget);
  }

  if (!await assertRestartableChatwootEvidenceInventory(plan, capability)) return;
  for (const entry of capability.artifacts) {
    const target = chatwootCleanupArtifactPath(plan, entry.path);
    let artifact;
    try {
      artifact = await readBoundedFileArtifact(
        target,
        maximumChatwootCleanupArtifactBytes(entry.path),
      );
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (artifact.bytes.byteLength !== entry.byteLength
      || sha256(artifact.bytes) !== entry.sha256) {
      throw new Error("Chatwoot evidence artifact changed after cleanup was sealed.");
    }
    await unlinkExactChatwootArtifact(target, artifact.identity);
  }
  await removeRestartableChatwootEvidenceDirectories(plan);
}

function createChatwootEvidenceCleanupCapability(plan, artifacts) {
  const entries = artifacts.map((artifact) => {
    const relativePath = path.relative(plan.chatwootEvidenceRoot, artifact.target)
      .split(path.sep)
      .join("/");
    return Object.freeze({
      byteLength: artifact.byteLength,
      path: relativePath,
      sha256: artifact.sha256,
    });
  }).sort((left, right) => left.path.localeCompare(right.path));
  return validateChatwootEvidenceCleanupCapability({
    schemaVersion: 1,
    kind: "clean-pay-chatwoot-evidence-cleanup-capability",
    captureId: plan.captureId,
    evidenceRootName: path.basename(plan.chatwootEvidenceRoot),
    artifactCount: entries.length,
    artifacts: entries,
  }, plan);
}

async function readChatwootEvidenceCleanupCapability(plan, target) {
  if (target !== path.join(plan.ownedRoot, chatwootEvidenceCleanupFilename)) {
    throw new Error("Chatwoot cleanup capability escaped its exact owned root.");
  }
  const bytes = await readBoundedFile(target, maximumChatwootCleanupCapabilityBytes);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Chatwoot cleanup capability is not valid JSON.");
  }
  return validateChatwootEvidenceCleanupCapability(value, plan);
}

export function validateChatwootEvidenceCleanupCapability(value, plan) {
  exactKeys(value, [
    "artifactCount",
    "artifacts",
    "captureId",
    "evidenceRootName",
    "kind",
    "schemaVersion",
  ]);
  const expectedPaths = [
    "artifact-manifest.json",
    "proof.json",
    ...expectedChatwootScreenshotPaths(),
  ].sort();
  if (value.schemaVersion !== 1
    || value.kind !== "clean-pay-chatwoot-evidence-cleanup-capability"
    || value.captureId !== plan.captureId
    || value.evidenceRootName !== path.basename(plan.chatwootEvidenceRoot)
    || value.artifactCount !== expectedPaths.length
    || !Array.isArray(value.artifacts)
    || value.artifacts.length !== expectedPaths.length) {
    throw new Error("Chatwoot cleanup capability header differs from its exact plan.");
  }
  for (const entry of value.artifacts) {
    exactKeys(entry, ["byteLength", "path", "sha256"]);
    if (!Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 1
      || entry.byteLength > maximumChatwootCleanupArtifactBytes(entry.path)
      || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
      throw new Error("Chatwoot cleanup capability artifact is invalid.");
    }
  }
  if (JSON.stringify(value.artifacts.map((entry) => entry.path))
    !== JSON.stringify(expectedPaths)) {
    throw new Error("Chatwoot cleanup capability inventory is not exact.");
  }
  return Object.freeze(value);
}

function maximumChatwootCleanupArtifactBytes(relativePath) {
  if (relativePath === "artifact-manifest.json") return maximumChatwootManifestBytes;
  if (relativePath === "proof.json") return maximumChatwootProofBytes;
  if (expectedChatwootScreenshotPaths().includes(relativePath)) {
    return maximumChatwootScreenshotBytes;
  }
  throw new Error("Chatwoot cleanup artifact path is outside the exact inventory.");
}

function chatwootCleanupArtifactPath(plan, relativePath) {
  maximumChatwootCleanupArtifactBytes(relativePath);
  const target = path.join(plan.chatwootEvidenceRoot, ...relativePath.split("/"));
  if (!isWithin(plan.chatwootEvidenceRoot, target)
    || path.resolve(target) === path.resolve(plan.chatwootEvidenceRoot)) {
    throw new Error("Chatwoot cleanup artifact escaped its exact evidence root.");
  }
  return target;
}

async function assertRestartableChatwootEvidenceInventory(plan, capability) {
  const root = plan.chatwootEvidenceRoot;
  let rootDetails;
  try {
    rootDetails = await lstat(root);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()
    || path.resolve(await realpath(root)) !== path.resolve(root)
    || await realpath(path.dirname(root)) !== await realpath(plan.temporaryRoot)) {
    throw new Error("Chatwoot restartable cleanup root is not exact.");
  }
  const allowedRootNames = new Set(["artifact-manifest.json", "proof.json", "raw"]);
  const rootEntries = await readdir(root, { withFileTypes: true });
  if (rootEntries.some((entry) => !allowedRootNames.has(entry.name)
    || (entry.name === "raw" ? !entry.isDirectory() : !entry.isFile()))) {
    throw new Error("Chatwoot restartable cleanup root contains an unexpected entry.");
  }
  const rawEntry = rootEntries.find((entry) => entry.name === "raw");
  if (rawEntry) {
    const rawRoot = path.join(root, "raw");
    const rawDetails = await lstat(rawRoot);
    const expectedRawNames = new Set(capability.artifacts
      .filter((entry) => entry.path.startsWith("raw/"))
      .map((entry) => path.basename(entry.path)));
    const rawEntries = await readdir(rawRoot, { withFileTypes: true });
    if (!rawDetails.isDirectory() || rawDetails.isSymbolicLink()
      || path.dirname(await realpath(rawRoot)) !== await realpath(root)
      || rawEntries.some((entry) => !entry.isFile() || !expectedRawNames.has(entry.name))) {
      throw new Error("Chatwoot restartable raw cleanup inventory is not exact.");
    }
  }
  return true;
}

async function removeRestartableChatwootEvidenceDirectories(plan) {
  const root = plan.chatwootEvidenceRoot;
  const rawRoot = path.join(root, "raw");
  try {
    const rawDetails = await lstat(rawRoot);
    if (!rawDetails.isDirectory() || rawDetails.isSymbolicLink()
      || path.dirname(await realpath(rawRoot)) !== await realpath(root)
      || (await readdir(rawRoot)).length !== 0) {
      throw new Error("Chatwoot raw evidence directory changed before exact cleanup.");
    }
    await rmdir(rawRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    const rootDetails = await lstat(root);
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()
      || path.resolve(await realpath(root)) !== path.resolve(root)
      || await realpath(path.dirname(root)) !== await realpath(plan.temporaryRoot)
      || (await readdir(root)).length !== 0) {
      throw new Error("Chatwoot evidence root changed before exact cleanup.");
    }
    await rmdir(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (await regularPathExists(root)) {
    throw new Error("Chatwoot evidence root survived exact cleanup.");
  }
}

async function unlinkExactChatwootArtifact(target, identity) {
  const current = await lstat(target, { bigint: true });
  if (!sameProviderProofIdentity(identity, current)) {
    throw new Error("Refusing cleanup of a changed Chatwoot evidence artifact.");
  }
  await unlink(target);
  try {
    await lstat(target);
    throw new Error("Chatwoot evidence artifact survived exact cleanup.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function cleanupExactImage(tag, revision, expectedRole) {
  const image = await inspectCleanupOwnedImage(tag, revision, expectedRole);
  if (!image) return;
  await runCaptured("docker", ["image", "rm", "--force", tag], sanitizedProcessEnvironment());
  const remaining = await runCaptured(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", tag],
    sanitizedProcessEnvironment(),
    { allowedExitCodes: [0, 1] },
  );
  if (remaining.trim() !== "") throw new Error("Owned live overlap image tag remains after cleanup.");
}

async function inspectCleanupOwnedImage(tag, revision, expectedRole) {
  const inspection = await runCaptured(
    "docker",
    ["image", "inspect", "--format", "{{json .}}", tag],
    sanitizedProcessEnvironment(),
    { allowedExitCodes: [0, 1] },
  );
  if (inspection.trim() === "") return null;
  let image;
  try {
    image = JSON.parse(inspection);
  } catch {
    throw new Error("Owned cleanup image inspection is invalid.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(image?.Id ?? "")
    || image?.Config?.Labels?.["org.opencontainers.image.revision"] !== revision
    || image?.Config?.Labels?.["io.clean-pay.role"] !== expectedRole) {
    throw new Error("Refusing cleanup of an image outside the exact live overlap identity.");
  }
  return Object.freeze(image);
}

async function readCleanupOwnership(plan) {
  let rootDetails;
  try {
    rootDetails = await lstat(plan.ownedRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()
    || await realpath(path.dirname(plan.ownedRoot)) !== await realpath(plan.temporaryRoot)) {
    throw new Error("Live overlap cleanup root is not owned by the exact plan.");
  }
  const names = await readdir(plan.ownedRoot);
  if (!names.includes(stateFilename)) {
    await cleanupIncompletePreparationRoot(plan, names);
    return null;
  }
  return readOwnership(plan, path.join(plan.ownedRoot, stateFilename));
}

async function cleanupIncompletePreparationRoot(plan, names) {
  if (names.length === 0) {
    await rmdir(plan.ownedRoot);
    return;
  }
  if (names.length !== 1
    || !/^clean-pay-behavioral-baseline-[A-Za-z0-9_-]{6}$/.test(names[0])) {
    throw new Error("Live overlap cleanup has no exact ownership receipt; no resources were touched.");
  }
  const baselineRoot = path.join(plan.ownedRoot, names[0]);
  if (path.dirname(baselineRoot) !== plan.ownedRoot) {
    throw new Error("Live overlap incomplete preparation root escaped its exact plan.");
  }
  let receiptBytes;
  try {
    receiptBytes = await readBoundedFile(path.join(baselineRoot, "receipt.json"), 4_096);
  } catch (error) {
    throw new Error(
      "Live overlap cleanup has no exact ownership receipt; no resources were touched.",
      { cause: error },
    );
  }
  await cleanupBehavioralBaselineSource({
    expectedReceiptSha256: sha256(receiptBytes),
    root: baselineRoot,
    temporaryRoot: plan.ownedRoot,
  });
  if ((await readdir(plan.ownedRoot)).length !== 0) {
    throw new Error("Live overlap incomplete preparation root retained unexpected entries.");
  }
  await rmdir(plan.ownedRoot);
}

async function cleanupOwnedInputRoot(plan, ownership) {
  let rootDetails;
  try {
    rootDetails = await lstat(plan.ownedRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()
    || await realpath(path.dirname(plan.ownedRoot)) !== await realpath(plan.temporaryRoot)) {
    throw new Error("Refusing cleanup of an unowned live overlap root.");
  }
  const names = await readdir(plan.ownedRoot);
  if (names.includes(plan.providerProof.externalFilename)) {
    await cleanupProviderProofOutput(plan);
  }
  if (names.includes(chatwootInputRootName) || names.includes(chatwootPlanFilename)) {
    await cleanupChatwootOwnedInputs(plan);
  }
  const baselineRootNames = names.filter((name) => name.startsWith("clean-pay-behavioral-baseline-"));
  if (baselineRootNames.length > 1) {
    throw new Error("Live overlap root contains multiple behavioral baseline owners.");
  }
  if (baselineRootNames.length === 1) {
    const baselineRoot = path.join(plan.ownedRoot, baselineRootNames[0]);
    if (ownership.behavioralBaseline.rootName !== baselineRootNames[0]) {
      throw new Error("Behavioral baseline cleanup has no original ownership capability.");
    }
    const receiptBytes = await readBoundedFile(path.join(baselineRoot, "receipt.json"), 4_096);
    assertBehavioralBaselineCleanupCapability({
      ownership,
      receiptBytes,
      rootName: baselineRootNames[0],
    });
    await cleanupBehavioralBaselineSource({
      expectedReceiptSha256: ownership.behavioralBaseline.receiptSha256,
      root: baselineRoot,
      temporaryRoot: plan.ownedRoot,
    });
  }
  for (const roleName of ["baseline", "candidate"]) {
    await cleanupGeneratedEnvironment(path.join(plan.ownedRoot, plan.roles[roleName].envDirectoryName));
  }
  for (const filename of [
    ...Object.values(attestationFilenames),
    chatwootEvidenceCleanupFilename,
  ]) {
    await unlinkRegularIfPresent(path.join(plan.ownedRoot, filename));
  }
  const remaining = await readdir(plan.ownedRoot);
  if (JSON.stringify(remaining) !== JSON.stringify([stateFilename])) {
    throw new Error("Live overlap input root contains an unexpected entry; refusing recursive cleanup.");
  }
  await unlinkRegularIfPresent(path.join(plan.ownedRoot, stateFilename));
  if ((await readdir(plan.ownedRoot)).length !== 0) {
    throw new Error("Live overlap ownership survived exact input cleanup.");
  }
  await rmdir(plan.ownedRoot);
}

async function cleanupChatwootOwnedInputs(plan) {
  const inputRoot = path.join(plan.ownedRoot, chatwootInputRootName);
  for (const pairIndex of [1, 2, 3]) {
    const pairRoot = path.join(inputRoot, `pair-${pairIndex}`);
    for (const roleName of ["baseline", "candidate"]) {
      const roleRoot = path.join(pairRoot, roleName);
      await cleanupGeneratedEnvironment(path.join(roleRoot, "environment"));
      await unlinkRegularIfPresent(path.join(roleRoot, "production-image-assets.json"));
      await removeExactEmptyDirectoryIfPresent(roleRoot, pairRoot, roleName);
    }
    await removeExactEmptyDirectoryIfPresent(pairRoot, inputRoot, `pair-${pairIndex}`);
  }
  await removeExactEmptyDirectoryIfPresent(
    inputRoot,
    plan.ownedRoot,
    chatwootInputRootName,
  );
  await unlinkRegularIfPresent(path.join(plan.ownedRoot, chatwootPlanFilename));
}

async function removeExactEmptyDirectoryIfPresent(target, expectedParent, expectedName) {
  let details;
  try {
    details = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!details.isDirectory() || details.isSymbolicLink()
    || path.basename(target) !== expectedName
    || path.dirname(target) !== expectedParent
    || await realpath(path.dirname(target)) !== await realpath(expectedParent)
    || (await readdir(target)).length !== 0) {
    throw new Error("Refusing cleanup of a non-empty or unowned Chatwoot input directory.");
  }
  await rmdir(target);
}

async function readOwnership(plan, target) {
  const bytes = await readBoundedFile(target, 8_192);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Live overlap ownership receipt is not valid JSON.");
  }
  return validateLiveOverlapOwnership(value, plan);
}

export function validateLiveOverlapOwnership(value, plan) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([
        "behavioralBaseline", "candidateRevision", "captureId", "evidence", "images",
        "kind", "projects", "schemaVersion",
      ].sort())
    || value.schemaVersion !== 1
    || value.kind !== "clean-pay-production-image-live-overlap-ownership"
    || value.captureId !== plan.captureId
    || value.candidateRevision !== plan.candidateRevision
    || JSON.stringify(value.projects) !== JSON.stringify({
      provider: {
        baseline: plan.roles.baseline.project,
        candidate: plan.roles.candidate.project,
      },
      chatwoot: chatwootProjectNames(plan),
    })
    || JSON.stringify(value.images) !== JSON.stringify({
      baselineApplication: plan.roles.baseline.appImage,
      baselineMigration: plan.roles.baseline.migrationImage,
      candidateApplication: plan.roles.candidate.appImage,
      candidateMigration: plan.roles.candidate.migrationImage,
    })
    || JSON.stringify(value.evidence) !== JSON.stringify({
      providerOverlapExternalFilename: plan.providerProof.externalFilename,
      providerOverlapSanitizedFilename: plan.providerProof.sanitizedFilename,
    })
    || !value.behavioralBaseline || typeof value.behavioralBaseline !== "object"
    || Array.isArray(value.behavioralBaseline)
    || JSON.stringify(Object.keys(value.behavioralBaseline).sort())
      !== JSON.stringify(["receiptSha256", "rootName"])
    || !/^clean-pay-behavioral-baseline-[A-Za-z0-9_-]{6}$/.test(
      value.behavioralBaseline.rootName ?? "",
    )
    || !/^[a-f0-9]{64}$/.test(value.behavioralBaseline.receiptSha256 ?? "")) {
    throw new Error("Live overlap ownership receipt differs from the exact cleanup plan.");
  }
  return Object.freeze(value);
}

export function assertBehavioralBaselineCleanupCapability({
  ownership,
  receiptBytes,
  rootName,
}) {
  exactKeys(arguments[0], ["ownership", "receiptBytes", "rootName"]);
  if (!(receiptBytes instanceof Uint8Array)
    || ownership?.behavioralBaseline?.rootName !== rootName
    || ownership?.behavioralBaseline?.receiptSha256 !== sha256(receiptBytes)) {
    throw new Error("Behavioral baseline receipt differs from its original cleanup capability.");
  }
  return ownership.behavioralBaseline.receiptSha256;
}

async function cleanupGeneratedEnvironment(directory) {
  let details;
  try {
    details = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("Refusing cleanup of an invalid generated environment directory.");
  }
  const names = await readdir(directory);
  if (names.some((name) => !environmentFilenames.includes(name))) {
    throw new Error("Generated environment contains an unexpected entry; refusing recursive cleanup.");
  }
  for (const filename of names) await unlinkRegularIfPresent(path.join(directory, filename));
  await rmdir(directory);
}

async function unlinkRegularIfPresent(target) {
  try {
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error("Refusing cleanup of a non-regular owned file.");
    }
    await unlink(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeFailure(plan, error, phase) {
  try {
    await writeResult(plan, "failure.json", {
      schemaVersion: 1,
      status: "production-image-live-overlap-failed",
      captureId: plan.captureId,
      phase: liveOverlapPhases.includes(phase) ? phase : "runner",
      ...createJourneySanitizedErrorEvidence(error),
    });
  } catch {
    // The original failure remains authoritative; stderr below is hash-only.
  }
}

async function writeResult(plan, filename, value) {
  const captureRoot = await ensureSanitizedCaptureRoot(plan);
  await writeOwnedJson(path.join(captureRoot, filename), value);
}

async function ensureSanitizedCaptureRoot(plan) {
  await mkdir(outputParent, { recursive: true, mode: 0o700 });
  const parentDetails = await lstat(outputParent);
  const parentReal = await realpath(outputParent);
  if (!parentDetails.isDirectory() || parentDetails.isSymbolicLink()
    || !isWithin(await realpath(repositoryRoot), parentReal)) {
    throw new Error("Live overlap sanitized output parent is invalid.");
  }
  const captureRoot = path.join(outputParent, plan.captureId);
  try {
    await mkdir(captureRoot, { mode: 0o700, recursive: false });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const captureDetails = await lstat(captureRoot);
  if (!captureDetails.isDirectory() || captureDetails.isSymbolicLink()
    || path.dirname(await realpath(captureRoot)) !== parentReal) {
    throw new Error("Live overlap sanitized capture root is invalid.");
  }
  return captureRoot;
}

function providerProofExternalPath(plan) {
  const target = path.join(plan.ownedRoot, plan.providerProof.externalFilename);
  if (path.dirname(target) !== plan.ownedRoot
    || path.basename(target) !== providerProofExternalFilename) {
    throw new Error("Provider overlap output escaped its exact external owned root.");
  }
  return target;
}

function providerProofFailureSanitizedPath(plan, captureRoot) {
  const expectedRoot = path.join(outputParent, plan.captureId);
  const target = path.join(expectedRoot, providerProofFailureSanitizedFilename);
  if (captureRoot !== expectedRoot
    || path.dirname(target) !== expectedRoot
    || path.basename(target) !== providerProofFailureSanitizedFilename) {
    throw new Error("Provider overlap failure output escaped its exact sanitized capture root.");
  }
  return target;
}

async function publishProviderProof(plan) {
  const artifact = await readExactProviderProofArtifact(providerProofExternalPath(plan));
  const captureRoot = await ensureSanitizedCaptureRoot(plan);
  const sanitizedTarget = path.join(captureRoot, plan.providerProof.sanitizedFilename);
  const receipt = await writeJourneySanitizedOutput(sanitizedTarget, artifact.bytes);
  if (receipt.sha256 !== artifact.sha256
    || receipt.bytes !== artifact.bytes.byteLength
    || receipt.status !== "sanitized-create-only-output-written") {
    throw new Error("Provider overlap sanitized copy receipt is not byte-bound.");
  }
  await unlinkExactProviderProof(providerProofExternalPath(plan), artifact.identity);
  return Object.freeze({
    artifact: plan.providerProof.sanitizedFilename,
    sha256: artifact.sha256,
    status: artifact.document.comparison.status,
  });
}

function unverifiedEmailProofPath(plan) {
  const target = path.join(outputParent, plan.captureId, UNVERIFIED_EMAIL_PROOF_FILENAME);
  if (path.dirname(target) !== path.join(outputParent, plan.captureId)
    || path.basename(target) !== UNVERIFIED_EMAIL_PROOF_FILENAME) {
    throw new Error("Candidate unverified e-mail proof escaped its sanitized capture root.");
  }
  return target;
}

function linkedEmailFailureProofPath(plan) {
  const target = path.join(outputParent, plan.captureId, LINKED_EMAIL_FAILURE_PROOF_FILENAME);
  if (path.dirname(target) !== path.join(outputParent, plan.captureId)
    || path.basename(target) !== LINKED_EMAIL_FAILURE_PROOF_FILENAME) {
    throw new Error("Candidate linked e-mail failure proof escaped its sanitized capture root.");
  }
  return target;
}

async function validateUnverifiedEmailProof(plan, inputs, target) {
  const bytes = await readBoundedFile(target, 16_384);
  let document;
  try {
    document = assertUnverifiedEmailLoginProof(JSON.parse(bytes.toString("utf8")), {
      candidateApplicationImageDigest: inputs.candidate.assetImageDigest,
      candidateMigrationImageDigest: inputs.candidate.migrationAssetImageDigest,
      candidateRevision: plan.candidateRevision,
    });
  } catch (error) {
    throw new Error("Candidate unverified e-mail proof failed its exact schema.", {
      cause: error,
    });
  }
  return Object.freeze({
    artifact: UNVERIFIED_EMAIL_PROOF_FILENAME,
    authorizedSemanticDiff: document.authorizedSemanticDiff,
    sha256: sha256(bytes),
    status: document.status,
  });
}

async function validateLinkedEmailFailureProof(plan, inputs, target) {
  const bytes = await readBoundedFile(target, 16_384);
  let document;
  try {
    document = assertLinkedEmailFailureProof(JSON.parse(bytes.toString("utf8")), {
      candidateApplicationImageDigest: inputs.candidate.assetImageDigest,
      candidateMigrationImageDigest: inputs.candidate.migrationAssetImageDigest,
      candidateRevision: plan.candidateRevision,
    });
  } catch (error) {
    throw new Error("Candidate linked e-mail failure proof failed its exact schema.", {
      cause: error,
    });
  }
  return Object.freeze({
    artifact: LINKED_EMAIL_FAILURE_PROOF_FILENAME,
    authorizedSemanticDiff: document.authorizedSemanticDiff,
    sha256: sha256(bytes),
    status: document.status,
  });
}

async function cleanupProviderProofOutput(plan) {
  const target = providerProofExternalPath(plan);
  let artifact;
  try {
    artifact = await readExactProviderProofArtifact(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await unlinkExactProviderProof(target, artifact.identity);
}

async function readExactProviderProofArtifact(target) {
  let artifact;
  try {
    artifact = await readBoundedFileArtifact(target, maximumProviderProofBytes);
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw new Error("Provider overlap external proof is outside its exact file contract.", {
      cause: error,
    });
  }
  const { bytes } = artifact;
  let document;
  try {
    document = assertDualProviderOverlapProof(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    throw new Error("Provider overlap external proof failed its exact sanitized schema.", {
      cause: error,
    });
  }
  return Object.freeze({
    bytes,
    document,
    identity: artifact.identity,
    sha256: sha256(bytes),
  });
}

async function unlinkExactProviderProof(target, identity) {
  const current = await lstat(target, { bigint: true });
  if (!sameProviderProofIdentity(identity, current)) {
    throw new Error("Refusing cleanup of a changed provider overlap proof identity.");
  }
  await unlink(target);
  try {
    await lstat(target);
    throw new Error("Provider overlap external proof survived exact cleanup.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function providerProofIdentity(value) {
  return Object.freeze({
    changed: value.ctimeNs,
    device: value.dev,
    inode: value.ino,
    modified: value.mtimeNs,
    size: value.size,
  });
}

function sameProviderProofIdentity(left, right) {
  const leftIdentity = "device" in left ? left : providerProofIdentity(left);
  const rightIdentity = "device" in right ? right : providerProofIdentity(right);
  return leftIdentity.device === rightIdentity.device
    && leftIdentity.inode === rightIdentity.inode
    && leftIdentity.changed === rightIdentity.changed
    && leftIdentity.modified === rightIdentity.modified
    && leftIdentity.size === rightIdentity.size;
}

async function validateChatwootEvidence(plan, inputs) {
  return (await inspectChatwootEvidence(plan, inputs)).summary;
}

async function inspectChatwootEvidence(plan, inputs) {
  const target = plan.chatwootEvidenceRoot;
  const rootBefore = await lstat(target, { bigint: true });
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()
    || path.resolve(await realpath(target)) !== path.resolve(target)
    || await realpath(path.dirname(target)) !== await realpath(plan.temporaryRoot)) {
    throw new Error("Chatwoot evidence root differs from its exact external contract.");
  }
  const rootNames = (await readdir(target)).sort();
  if (JSON.stringify(rootNames)
    !== JSON.stringify(["artifact-manifest.json", "proof.json", "raw"])) {
    throw new Error("Chatwoot evidence root inventory is not exact.");
  }
  const rawRoot = path.join(target, "raw");
  const rawBefore = await lstat(rawRoot, { bigint: true });
  if (!rawBefore.isDirectory() || rawBefore.isSymbolicLink()
    || path.dirname(await realpath(rawRoot)) !== await realpath(target)) {
    throw new Error("Chatwoot raw evidence root is not exact.");
  }

  const proofTarget = path.join(target, "proof.json");
  const proofArtifact = await readBoundedFileArtifact(
    proofTarget,
    maximumChatwootProofBytes,
  );
  const proofBytes = proofArtifact.bytes;
  const cleanupArtifacts = [{
    byteLength: proofBytes.byteLength,
    identity: proofArtifact.identity,
    sha256: sha256(proofBytes),
    target: proofTarget,
  }];
  let proof;
  try {
    proof = assertChatwootPhaseProof(JSON.parse(proofBytes.toString("utf8")));
  } catch (error) {
    throw new Error("Chatwoot proof failed its exact runtime schema.", { cause: error });
  }
  if (proof.comparison.status !== "proven"
    || proof.comparison.baselineImageDigest !== inputs.baseline.assetImageDigest
    || proof.comparison.candidateImageDigest !== inputs.candidate.assetImageDigest
    || proof.pairs[0]?.stacks?.baseline?.migrationImage?.assetImageDigest
      !== inputs.baseline.migrationAssetImageDigest
    || proof.pairs[0]?.stacks?.candidate?.migrationImage?.assetImageDigest
      !== inputs.candidate.migrationAssetImageDigest) {
    throw new Error("Chatwoot proof is not bound to the exact production images.");
  }

  const expectedScreenshotPaths = expectedChatwootScreenshotPaths();
  const rawNames = (await readdir(rawRoot)).sort();
  const expectedRawNames = expectedScreenshotPaths
    .map((entry) => path.basename(entry))
    .sort();
  if (JSON.stringify(rawNames) !== JSON.stringify(expectedRawNames)) {
    throw new Error("Chatwoot raw screenshot inventory is not exact.");
  }
  const expectedEntries = [{
    path: "proof.json",
    byteLength: proofBytes.byteLength,
    sha256: sha256(proofBytes),
  }];
  for (const relativePath of expectedScreenshotPaths) {
    const screenshotTarget = path.join(target, ...relativePath.split("/"));
    const screenshotArtifact = await readBoundedFileArtifact(
      screenshotTarget,
      maximumChatwootScreenshotBytes,
    );
    const screenshot = screenshotArtifact.bytes;
    if (screenshot.byteLength < pngSignature.byteLength
      || !screenshot.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
      throw new Error("Chatwoot raw screenshot is not an exact PNG artifact.");
    }
    expectedEntries.push({
      path: relativePath,
      byteLength: screenshot.byteLength,
      sha256: sha256(screenshot),
    });
    cleanupArtifacts.push({
      byteLength: screenshot.byteLength,
      identity: screenshotArtifact.identity,
      sha256: sha256(screenshot),
      target: screenshotTarget,
    });
  }
  expectedEntries.sort((left, right) => left.path.localeCompare(right.path));
  const manifestTarget = path.join(target, "artifact-manifest.json");
  const manifestArtifact = await readBoundedFileArtifact(
    manifestTarget,
    maximumChatwootManifestBytes,
  );
  const manifestBytes = manifestArtifact.bytes;
  cleanupArtifacts.push({
    byteLength: manifestBytes.byteLength,
    identity: manifestArtifact.identity,
    sha256: sha256(manifestBytes),
    target: manifestTarget,
  });
  let manifest;
  try {
    manifest = validateChatwootArtifactManifest(
      JSON.parse(manifestBytes.toString("utf8")),
      expectedEntries,
    );
  } catch (error) {
    throw new Error("Chatwoot artifact manifest failed its exact runtime schema.", {
      cause: error,
    });
  }

  const [rootAfter, rawAfter] = await Promise.all([
    lstat(target, { bigint: true }),
    lstat(rawRoot, { bigint: true }),
  ]);
  if (!sameProviderProofIdentity(rootBefore, rootAfter)
    || !sameProviderProofIdentity(rawBefore, rawAfter)) {
    throw new Error("Chatwoot evidence directory identity changed during validation.");
  }
  return Object.freeze({
    cleanup: Object.freeze({
      artifacts: Object.freeze(cleanupArtifacts),
      rawRoot,
      root: target,
    }),
    summary: Object.freeze({
      aggregateSha256: manifest.aggregateSha256,
      artifactCount: manifest.artifactCount,
      artifactRoot: path.basename(target),
      manifestSha256: sha256(manifestBytes),
      proofSha256: sha256(proofBytes),
      status: proof.comparison.status,
    }),
  });
}

export function validateChatwootArtifactManifest(value, expectedEntries) {
  exactKeys(value, [
    "aggregateSha256",
    "artifactCount",
    "entries",
    "kind",
    "schemaVersion",
  ]);
  if (value.schemaVersion !== 1
    || value.kind !== "clean-pay-chatwoot-phase-proof-artifact-manifest"
    || !Array.isArray(expectedEntries)
    || expectedEntries.length !== 19
    || !Array.isArray(value.entries)
    || value.entries.length !== expectedEntries.length) {
    throw new Error("Chatwoot artifact manifest header is invalid.");
  }
  for (const entry of value.entries) {
    exactKeys(entry, ["byteLength", "path", "sha256"]);
    if (typeof entry.path !== "string"
      || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 1
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("Chatwoot artifact manifest entry is invalid.");
    }
  }
  if (JSON.stringify(value.entries) !== JSON.stringify(expectedEntries)
    || value.artifactCount !== expectedEntries.length) {
    throw new Error("Chatwoot artifact manifest entries differ from observed bytes.");
  }
  const aggregateSha256 = sha256(Buffer.from(expectedEntries.map((entry) => (
    `${entry.path}\0${entry.byteLength}\0${entry.sha256}\n`
  )).join(""), "utf8"));
  if (value.aggregateSha256 !== aggregateSha256) {
    throw new Error("Chatwoot artifact manifest aggregate digest is invalid.");
  }
  return Object.freeze(value);
}

async function writeOwnedJson(target, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeOwnedBytes(target, bytes);
}

async function writeOwnedBytes(target, bytes) {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function enforcePrivateDirectory(directory) {
  const before = await lstat(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error("Owned live overlap directory is invalid.");
  }
  const mode = Number(before.mode) & 0o777;
  if (mode !== 0o700) {
    throw new Error("Owned live overlap directory is not private.");
  }
}

async function assertRegularFile(target, maximumBytes, label) {
  const details = await lstat(target);
  if (!details.isFile() || details.isSymbolicLink()
    || details.size < 1 || details.size > maximumBytes) {
    throw new Error(`${label} does not match its bounded regular-file contract.`);
  }
}

async function readBoundedFile(target, maximumBytes) {
  return (await readBoundedFileArtifact(target, maximumBytes)).bytes;
}

async function readBoundedFileArtifact(target, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("Owned bounded file limit is invalid.");
  }
  const before = await lstat(target, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()
    || before.size < 1n || before.size > BigInt(maximumBytes)) {
    throw new Error("Owned bounded file is invalid.");
  }
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(target, flags);
  let opened;
  let afterHandle;
  let bytes;
  try {
    opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameProviderProofIdentity(before, opened)) {
      throw new Error("Owned bounded file identity changed before it was read.");
    }
    const declaredBytes = Number(opened.size);
    const buffer = Buffer.allocUnsafe(declaredBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    bytes = buffer.subarray(0, offset);
    afterHandle = await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
  const afterPath = await lstat(target, { bigint: true });
  if (!sameProviderProofIdentity(before, afterHandle)
    || !sameProviderProofIdentity(before, afterPath)
    || bytes.byteLength !== Number(before.size)) {
    throw new Error("Owned bounded file changed while it was read.");
  }
  return Object.freeze({
    bytes,
    identity: providerProofIdentity(before),
  });
}

async function runInherited(command, args, environment) {
  await runProcess(command, args, environment, { inherit: true });
}

async function runInheritedWithFileInput(command, args, inputBytes, environment) {
  assertBehavioralBaselineArchive(inputBytes);
  await runProcess(command, args, environment, { inherit: true, inputBytes });
}

async function runCaptured(command, args, environment, options = {}) {
  return runProcess(command, args, environment, { ...options, inherit: false });
}

function runProcess(command, args, environment, {
  allowedExitCodes = [0],
  inherit,
  inputBytes,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: [inputBytes ? "pipe" : "ignore", inherit ? "inherit" : "pipe", inherit ? "inherit" : "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    const maximumBytes = 4 * 1024 * 1024;
    const collect = (target, chunk, observed) => {
      const bytes = Buffer.from(chunk);
      if (observed + bytes.byteLength > maximumBytes) {
        overflow = true;
        child.kill("SIGTERM");
        return observed;
      }
      target.push(bytes);
      return observed + bytes.byteLength;
    };
    if (!inherit) {
      child.stdout.on("data", (chunk) => { stdoutBytes = collect(stdout, chunk, stdoutBytes); });
      child.stderr.on("data", (chunk) => { stderrBytes = collect(stderr, chunk, stderrBytes); });
    }
    if (inputBytes) {
      child.stdin.once("error", () => undefined);
      child.stdin.end(inputBytes);
    }
    child.once("error", (error) => reject(new Error(
      `Live overlap command could not start: ${path.basename(command)}.`,
      { cause: error },
    )));
    child.once("close", (code, signal) => {
      if (!overflow && signal === null && allowedExitCodes.includes(code)) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new Error(
        `Live overlap command failed (${path.basename(command)}:${code ?? signal ?? "unknown"}:`
        + `${sha256(Buffer.concat(stderr))}).`,
      ));
    });
  });
}

function sanitizedProcessEnvironment(source = process.env) {
  const result = Object.create(null);
  for (const name of [
    "CI", "DOCKER_CERT_PATH", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST",
    "DOCKER_TLS_VERIFY", "HOME", "LANG", "LC_ALL", "PATH", "TEMP", "TMP",
    "TMPDIR", "XDG_CONFIG_HOME",
  ]) {
    if (typeof source[name] === "string") result[name] = source[name];
  }
  return result;
}

function assertPlanIsolation(plan) {
  const roles = Object.values(plan.roles);
  const distinct = [
    roles.map(({ project }) => project),
    roles.map(({ appImage }) => appImage),
    roles.map(({ migrationImage }) => migrationImage),
    roles.map(({ appPort }) => appPort),
    roles.map(({ providerPort }) => providerPort),
    roles.map(({ connectProxyPort }) => connectProxyPort),
    roles.map(({ proxyBind }) => proxyBind),
  ];
  if (distinct.some((values) => new Set(values).size !== 2)
    || roles[0].revision === roles[1].revision
    || roles.some(({ project }) => !/^clean-pay-browser-journey-provider-proof-(?:baseline|candidate)-[a-f0-9]{12}$/.test(project))) {
    throw new Error("Live overlap plan does not isolate both image stacks exactly.");
  }
  if (JSON.stringify(plan.providerProof) !== JSON.stringify({
    externalFilename: providerProofExternalFilename,
    sanitizedFilename: providerProofSanitizedFilename,
  }) || path.dirname(providerProofExternalPath(plan)) !== plan.ownedRoot) {
    throw new Error("Live overlap provider proof paths do not match the exact plan.");
  }
  if (path.dirname(plan.chatwootEvidenceRoot) !== plan.temporaryRoot
    || path.basename(plan.chatwootEvidenceRoot)
      !== `${chatwootEvidencePrefix}${plan.captureId}`
    || isWithin(plan.ownedRoot, plan.chatwootEvidenceRoot)
    || new Set(chatwootProjectNames(plan)).size !== 6) {
    throw new Error("Live overlap Chatwoot proof paths or projects are not isolated.");
  }
}

function splitLines(value) {
  return String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function exactKeys(value, required) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...required].sort())) {
    throw new Error("Live overlap options do not match the exact contract.");
  }
}

function exactMatch(value, pattern, label) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`Live overlap ${label} is invalid.`);
  }
  return value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseLiveOverlapArguments(inputValues) {
  const values = [...inputValues];
  const mode = values.shift();
  const phaseSelected = mode === "run" && values.length === 8;
  if (!new Set(["run", "cleanup"]).has(mode)
    || (values.length !== 6 && !phaseSelected)) {
    throw new Error("usage: run-production-image-live-overlap.mjs run|cleanup --capture-id ID --candidate-revision SHA --temporary-root PATH [--phase PHASE]");
  }
  const allowed = new Set([
    "--capture-id",
    "--candidate-revision",
    "--temporary-root",
    ...(mode === "run" ? ["--phase"] : []),
  ]);
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || parsed.has(name) || !value) {
      throw new Error("Live overlap CLI arguments do not match the exact contract.");
    }
    parsed.set(name, value);
  }
  const phase = parsed.get("--phase") ?? null;
  if ((phaseSelected && !liveOverlapPhases.includes(phase))
    || (!phaseSelected && phase !== null)) {
    throw new Error("Live overlap CLI phase does not match the fixed execution plan.");
  }
  return Object.freeze({
    mode,
    phase,
    plan: createLiveOverlapPlan({
      captureId: parsed.get("--capture-id"),
      candidateRevision: parsed.get("--candidate-revision"),
      temporaryRoot: path.resolve(parsed.get("--temporary-root")),
    }),
  });
}

async function main() {
  const { mode, phase, plan } = parseLiveOverlapArguments(process.argv.slice(2));
  if (mode === "run") await run(plan, phase);
  else await cleanup(plan);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: "production_image_live_overlap_failed",
      ...createJourneySanitizedErrorEvidence(error),
    })}\n`);
    process.exitCode = 1;
  });
}
