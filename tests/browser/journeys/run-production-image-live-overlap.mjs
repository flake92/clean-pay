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
  UNVERIFIED_EMAIL_PROOF_FILENAME,
  assertUnverifiedEmailLoginProof,
} from "./unverified-email-login-proof-contract.mjs";

const repositoryRoot = path.resolve(process.cwd());
const liveRootPrefix = "clean-pay-production-live-overlap-";
const stateFilename = "ownership.json";
const contractFilename = "browser-journey-contract.json";
const providerProofExternalFilename = "provider-overlap-proof.json";
const providerProofSanitizedFilename = "provider-overlap.json";
const maximumProviderProofBytes = 16 * 1024 * 1024;
const chatwootInputRootName = "chatwoot-live-proof";
const chatwootPlanFilename = "chatwoot-phase-plan.json";
const chatwootEvidencePrefix = "clean-pay-chatwoot-phase-evidence-";
const maximumChatwootProofBytes = 32 * 1024 * 1024;
const maximumChatwootManifestBytes = 256 * 1024;
const maximumChatwootScreenshotBytes = 5 * 1024 * 1024;
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
    "--scenario", "provider-overlap-v1",
    "--output", providerProofExternalPath(plan),
  );
  if (args.length !== 28) {
    throw new Error("Provider overlap proof arguments do not contain exactly fourteen pairs.");
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

async function run(plan) {
  await assertRepositoryAndHost(plan);
  await mkdir(plan.ownedRoot, { mode: 0o700, recursive: false });
  await enforcePrivateDirectory(plan.ownedRoot);
  let materialized;
  try {
    materialized = await materializeBehavioralBaselineSource({
      repositoryRoot,
      temporaryRoot: plan.ownedRoot,
    });
    await writeOwnedJson(path.join(plan.ownedRoot, stateFilename), createOwnership(plan, materialized));
    const baselineArchiveBytes = await readBoundedFile(
      materialized.archivePath,
      BEHAVIORAL_BASELINE_SOURCE.archiveBytes,
    );
    assertBehavioralBaselineArchive(baselineArchiveBytes);
    const publicBuildContract = await computePublicBuildContract();
    const buildArguments = sharedBuildArguments(publicBuildContract);

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

    const inputs = {};
    for (const roleName of ["baseline", "candidate"]) {
      inputs[roleName] = await prepareRoleInputs(plan, roleName, publicBuildContract);
    }
    const args = proofArguments(plan, inputs);
    const publicProofEnvironment = sanitizedProcessEnvironment();
    publicProofEnvironment.CLEAN_PAY_PUBLIC_OVERLAP_FAILURE_OUTPUT_ROOT =
      await ensureSanitizedCaptureRoot(plan);
    await runInherited(process.execPath, [publicProofCli, ...args], publicProofEnvironment);
    await runInherited(
      process.execPath,
      [providerProofCli, ...providerProofArguments(plan, inputs)],
      sanitizedProcessEnvironment(),
    );
    const providerOverlap = await publishProviderProof(plan);
    const unverifiedEmailProof = unverifiedEmailProofPath(plan);
    await runInherited(process.execPath, [
      authenticatedProofCli,
      ...args,
      "--candidate-unverified-email-proof-output",
      unverifiedEmailProof,
    ], sanitizedProcessEnvironment());
    const unverifiedEmailLogin = await validateUnverifiedEmailProof(
      plan,
      inputs,
      unverifiedEmailProof,
    );
    const chatwoot = await prepareChatwootLiveProofInputs(plan, inputs);
    await runInherited(
      process.execPath,
      [chatwootProofCli, ...chatwootProofArguments(plan, chatwoot.cliPlanPath)],
      sanitizedProcessEnvironment(),
    );
    const chatwootPhase = await validateChatwootEvidence(plan, inputs);
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
      unverifiedEmailLogin,
      chatwootPhase,
    };
    await writeResult(plan, "completion.json", completion);
    process.stdout.write(`${JSON.stringify({
      status: "production_image_live_overlap_proven",
      captureId: plan.captureId,
      baselineRevision: plan.roles.baseline.revision,
      candidateRevision: plan.roles.candidate.revision,
      images: completion.images,
    })}\n`);
  } catch (error) {
    await writeFailure(plan, error);
    throw error;
  }
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
  try {
    await cleanupOwnedInputRoot(plan, ownership);
  } catch (error) {
    errors.push(error);
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

async function cleanupExactImage(tag, revision, expectedRole) {
  const inspection = await runCaptured(
    "docker",
    ["image", "inspect", "--format", "{{json .}}", tag],
    sanitizedProcessEnvironment(),
    { allowedExitCodes: [0, 1] },
  );
  if (inspection.trim() === "") return;
  let image;
  try {
    image = JSON.parse(inspection);
  } catch {
    throw new Error("Owned cleanup image inspection is invalid.");
  }
  if (image?.Config?.Labels?.["org.opencontainers.image.revision"] !== revision
    || image?.Config?.Labels?.["io.clean-pay.role"] !== expectedRole) {
    throw new Error("Refusing cleanup of an image outside the exact live overlap identity.");
  }
  await runCaptured("docker", ["image", "rm", "--force", tag], sanitizedProcessEnvironment());
  const remaining = await runCaptured(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", tag],
    sanitizedProcessEnvironment(),
    { allowedExitCodes: [0, 1] },
  );
  if (remaining.trim() !== "") throw new Error("Owned live overlap image tag remains after cleanup.");
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
    throw new Error("Live overlap cleanup has no exact ownership receipt; no resources were touched.");
  }
  return readOwnership(plan, path.join(plan.ownedRoot, stateFilename));
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
  for (const filename of [...Object.values(attestationFilenames), stateFilename]) {
    await unlinkRegularIfPresent(path.join(plan.ownedRoot, filename));
  }
  const remaining = await readdir(plan.ownedRoot);
  if (remaining.length !== 0) {
    throw new Error("Live overlap input root contains an unexpected entry; refusing recursive cleanup.");
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

async function writeFailure(plan, error) {
  try {
    await writeResult(plan, "failure.json", {
      schemaVersion: 1,
      status: "production-image-live-overlap-failed",
      captureId: plan.captureId,
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

  const proofBytes = await readBoundedFile(
    path.join(target, "proof.json"),
    maximumChatwootProofBytes,
  );
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
    const screenshot = await readBoundedFile(
      path.join(target, ...relativePath.split("/")),
      maximumChatwootScreenshotBytes,
    );
    if (screenshot.byteLength < pngSignature.byteLength
      || !screenshot.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
      throw new Error("Chatwoot raw screenshot is not an exact PNG artifact.");
    }
    expectedEntries.push({
      path: relativePath,
      byteLength: screenshot.byteLength,
      sha256: sha256(screenshot),
    });
  }
  expectedEntries.sort((left, right) => left.path.localeCompare(right.path));
  const manifestBytes = await readBoundedFile(
    path.join(target, "artifact-manifest.json"),
    maximumChatwootManifestBytes,
  );
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
    aggregateSha256: manifest.aggregateSha256,
    artifactCount: manifest.artifactCount,
    artifactRoot: path.basename(target),
    manifestSha256: sha256(manifestBytes),
    proofSha256: sha256(proofBytes),
    status: proof.comparison.status,
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

function parseArguments(values) {
  const mode = values.shift();
  if (!new Set(["run", "cleanup"]).has(mode) || values.length !== 6) {
    throw new Error("usage: run-production-image-live-overlap.mjs run|cleanup --capture-id ID --candidate-revision SHA --temporary-root PATH");
  }
  const allowed = new Set(["--capture-id", "--candidate-revision", "--temporary-root"]);
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || parsed.has(name) || !value) {
      throw new Error("Live overlap CLI arguments do not match the exact contract.");
    }
    parsed.set(name, value);
  }
  return Object.freeze({
    mode,
    plan: createLiveOverlapPlan({
      captureId: parsed.get("--capture-id"),
      candidateRevision: parsed.get("--candidate-revision"),
      temporaryRoot: path.resolve(parsed.get("--temporary-root")),
    }),
  });
}

async function main() {
  const { mode, plan } = parseArguments(process.argv.slice(2));
  if (mode === "run") await run(plan);
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
