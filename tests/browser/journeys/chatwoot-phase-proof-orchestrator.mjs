import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-manifest.mjs";
import {
  JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES,
  JOURNEY_COMPOSE_SERVICE_NAMES,
} from "./journey-compose-runtime-attestation.mjs";
import {
  journeyDockerCliEnvironment,
  runJourneyDockerCommand,
  withJourneyOwnedStackPair,
} from "./journey-owned-stack-orchestrator.mjs";
import {
  assertJourneyConnectProxyGate,
  startJourneyConnectProxy,
  stopJourneyConnectProxy,
} from "./journey-connect-proxy-controller.mjs";
import { createChatwootPhaseStaticAssetContract } from "./chatwoot-phase-browser-contract.mjs";
import { createChatwootPhaseEvidenceSealer } from "./chatwoot-phase-evidence-sealer.mjs";
import {
  abortChatwootPhaseEvidence,
  finalizeChatwootPhaseEvidence,
  prepareChatwootPhaseEvidenceDirectory,
  writeRawChatwootPhaseScreenshot,
} from "./chatwoot-phase-evidence-writer.mjs";
import {
  CHATWOOT_PHASE_PROOF_PAIR_COUNT,
  CHATWOOT_PHASE_PROOF_SCENARIO,
  assertChatwootDeterministicReset,
  assertChatwootJourneyContract,
  assertChatwootPhaseInput,
  createChatwootPhaseProof,
  sha256,
} from "./chatwoot-phase-proof-contract.mjs";

const roles = Object.freeze(["baseline", "candidate"]);
const phases = Object.freeze(["gap", "stable", "recreated"]);
const chatwootConnectAuthorityLedger = Object.freeze([
  "challenges.cloudflare.com:443",
  "chatwoot.browser.clean-pay.dev:443",
  "oauth.telegram.org:443",
  "pay.ci.clean-pay.dev:443",
].sort());
const eventContract = Object.freeze([
  ["pre_start_inputs_validated", 0, 0],
  ["concurrent_pair_started", 2, 0],
  ["runtime_attestation_completed", 2, 0],
  ["concurrent_dual_reset_started", 2, 0],
  ["concurrent_dual_reset_completed", 2, 2],
  ["concurrent_dual_capture_started", 2, 2],
  ["concurrent_dual_capture_completed", 2, 2],
  ["exact_dual_cleanup_completed", 0, 2],
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const MAXIMUM_CONTROL_BYTES = 2 * 1024 * 1024;
const containerdImageSelectionMode = "containerd-root-manifest";

export async function orchestrateChatwootPhaseProof({
  input,
  outputDirectory,
  repositoryRoot,
}) {
  exactKeys(arguments[0], [
    "input",
    "outputDirectory",
    "repositoryRoot",
  ], "Chatwoot orchestrator input");
  const root = await exactRepositoryRoot(repositoryRoot);
  const exactInput = assertChatwootPhaseInput(input);
  const evidenceOutputPreflight = await preflightChatwootOutputDirectory({
    generatedEnvironmentPaths: exactInput.pairs.flatMap((pair) => (
      roles.map((role) => pair[role].generatedEnvironmentPath)
    )),
    outputDirectory,
    repositoryRoot: root,
  });
  const fixtureContractSha256 = await currentJourneyFixtureContractSha256Async();
  const playwrightVersion = await installedPlaywrightVersion(root);
  // All six external contracts and image attestations are read and bound
  // before the proof-owned launcher can perform any Docker mutation.
  const launchPlan = await loadCompleteLaunchPlan({
    exactInput,
    fixtureContractSha256,
    repositoryRoot: root,
  });
  bindChatwootOutputPreflightToLaunchPlan(evidenceOutputPreflight, launchPlan);
  const evidenceOutputDirectory = evidenceOutputPreflight.target;
  const browserCapture = await loadBrowserCapture(root);
  const sealer = createChatwootPhaseEvidenceSealer();
  const pairs = [];
  const screenshots = [];
  for (const pair of launchPlan) {
    const pairResult = await executeOwnedPair({
      browserCapture,
      pair,
      playwrightVersion,
      repositoryRoot: root,
      sealer,
    });
    pairs.push(pairResult.report);
    screenshots.push(pairResult.screenshots);
  }
  const proof = createChatwootPhaseProof(pairs);
  await recheckChatwootOutputPreflight(evidenceOutputPreflight);
  const evidenceState = await prepareChatwootPhaseEvidenceDirectory({
    outputDirectory: evidenceOutputDirectory,
    repositoryRoot: root,
  });
  try {
    for (const [pairOffset, pairScreenshots] of screenshots.entries()) {
      for (const role of roles) {
        for (const phase of phases) {
          await writeRawChatwootPhaseScreenshot({
            state: evidenceState,
            pairIndex: pairOffset + 1,
            role,
            phase,
            bytes: pairScreenshots[role][phase],
          });
        }
      }
    }
    const evidence = await finalizeChatwootPhaseEvidence({ state: evidenceState, proof });
    return Object.freeze({ proof, evidence });
  } catch (error) {
    try {
      await abortChatwootPhaseEvidence({ state: evidenceState });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Chatwoot evidence write and exact owned-root abort both failed.",
      );
    }
    throw error;
  }
}

export async function assertChatwootOutputDirectoryDisjointForTest(
  outputDirectory,
  generatedEnvironmentPaths,
  repositoryRoot,
) {
  return (await preflightChatwootOutputDirectory({
    generatedEnvironmentPaths,
    outputDirectory,
    repositoryRoot,
  })).target;
}

export async function preflightChatwootOutputDirectoryForTest(
  outputDirectory,
  generatedEnvironmentPaths,
  repositoryRoot,
) {
  return preflightChatwootOutputDirectory({
    generatedEnvironmentPaths,
    outputDirectory,
    repositoryRoot,
  });
}

export async function recheckChatwootOutputDirectoryForTest(receipt) {
  return recheckChatwootOutputPreflight(receipt);
}

export function assertChatwootImagePlatformParityForTest(platforms) {
  if (!Array.isArray(platforms)
    || platforms.length !== CHATWOOT_PHASE_PROOF_PAIR_COUNT * roles.length) {
    throw new Error("Chatwoot image platform ledger is incomplete.");
  }
  const normalized = platforms.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || stableJson(Object.keys(value).sort()) !== stableJson(["architecture", "os"])
      || value.os !== "linux"
      || !new Set(["amd64", "arm64"]).has(value.architecture)) {
      throw new Error("Chatwoot image platform ledger is invalid.");
    }
    return Object.freeze({ architecture: value.architecture, os: value.os });
  });
  requireSame(normalized.map(stableJson), "image platform");
  return normalized[0];
}

async function preflightChatwootOutputDirectory({
  generatedEnvironmentPaths,
  outputDirectory,
  repositoryRoot,
}) {
  if (typeof outputDirectory !== "string" || !path.isAbsolute(outputDirectory)
    || canonicalInputPath(outputDirectory) !== canonicalInputPath(path.resolve(outputDirectory))
    || typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot)
    || !Array.isArray(generatedEnvironmentPaths)
    || generatedEnvironmentPaths.length !== 6
    || new Set(generatedEnvironmentPaths.map(normalizePath)).size !== 6) {
    throw new Error("Chatwoot evidence/output disjointness input is invalid.");
  }
  const repository = await captureExactPathIdentity(
    repositoryRoot,
    "directory",
    "Chatwoot evidence repository root",
  );
  const target = path.resolve(outputDirectory);
  if (normalizePath(target) === normalizePath(path.parse(target).root)
    || isWithin(repository.realpath, target)) {
    throw new Error("Chatwoot evidence output must stay outside the repository and root.");
  }
  try {
    await lstat(target);
    throw new Error("Chatwoot evidence output must be absent before stack launch.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = await captureExactPathIdentity(
    path.dirname(target),
    "directory",
    "Chatwoot evidence output parent",
  );
  if (isWithin(repository.realpath, parent.realpath)) {
    throw new Error("Chatwoot evidence output parent must stay outside the repository.");
  }
  const exactTarget = path.join(parent.realpath, path.basename(target));
  const environmentIdentities = [];
  for (const generatedEnvironmentPath of generatedEnvironmentPaths) {
    if (typeof generatedEnvironmentPath !== "string"
      || !path.isAbsolute(generatedEnvironmentPath)
      || canonicalInputPath(generatedEnvironmentPath)
        !== canonicalInputPath(path.resolve(generatedEnvironmentPath))) {
      throw new Error("Chatwoot generated environment path is invalid.");
    }
    const environment = await captureExactPathIdentity(
      generatedEnvironmentPath,
      "directory",
      "Chatwoot immutable input environment",
    );
    if (isWithin(environment.realpath, exactTarget)) {
      throw new Error("Chatwoot evidence output overlaps an immutable input environment.");
    }
    environmentIdentities.push(environment);
  }
  return Object.freeze({
    environmentIdentities: Object.freeze(environmentIdentities),
    parent,
    repository,
    status: "pre-start-evidence-output-validated",
    target: exactTarget,
  });
}

function bindChatwootOutputPreflightToLaunchPlan(receipt, launchPlan) {
  const loaded = launchPlan.flatMap((pair) => roles.map((role) => pair[role]));
  if (loaded.length !== receipt.environmentIdentities.length) {
    throw new Error("Chatwoot evidence preflight is not bound to all launch inputs.");
  }
  for (const [index, stack] of loaded.entries()) {
    if (!samePathIdentity(receipt.environmentIdentities[index], stack.environmentIdentity)) {
      throw new Error("Chatwoot evidence preflight input identity differs from launch plan.");
    }
  }
}

async function recheckChatwootOutputPreflight(receipt) {
  if (!receipt || !Object.isFrozen(receipt)
    || receipt.status !== "pre-start-evidence-output-validated"
    || !Array.isArray(receipt.environmentIdentities)
    || receipt.environmentIdentities.length !== 6) {
    throw new Error("Chatwoot evidence preflight receipt is invalid.");
  }
  try {
    await lstat(receipt.target);
    throw new Error("Chatwoot evidence output appeared after its pre-start validation.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const [repository, parent, ...environments] = await Promise.all([
    captureExactPathIdentity(
      receipt.repository.realpath,
      "directory",
      "Chatwoot evidence repository root recheck",
    ),
    captureExactPathIdentity(
      receipt.parent.realpath,
      "directory",
      "Chatwoot evidence output parent recheck",
    ),
    ...receipt.environmentIdentities.map((identity) => captureExactPathIdentity(
      identity.realpath,
      "directory",
      "Chatwoot immutable input environment recheck",
    )),
  ]);
  if (!samePathIdentity(receipt.repository, repository)
    || !samePathIdentity(receipt.parent, parent)
    || environments.some((identity, index) => (
      !samePathIdentity(receipt.environmentIdentities[index], identity)
    ))) {
    throw new Error("Chatwoot evidence preflight identity changed before publication.");
  }
  return receipt.target;
}

async function executeOwnedPair({
  browserCapture,
  pair,
  playwrightVersion,
  repositoryRoot,
  sealer,
}) {
  const proofSession = await withJourneyOwnedStackPair({
    baseline: ownedStackInput(pair.baseline, repositoryRoot),
    candidate: ownedStackInput(pair.candidate, repositoryRoot),
  }, async (owned) => {
    exactKeys(owned, ["baseline", "candidate", "launch"], "owned stack pair callback");
    const bound = Object.freeze(Object.fromEntries(roles.map((role) => [
      role,
      bindOwnedRuntime(pair[role], owned[role]),
    ])));
    assertDualRuntime(bound.baseline, bound.candidate);
    const launch = assertOwnedPairLaunchReceipt(owned.launch, bound, pair);
    await settleOwnedRoleOperations(
      (role) => assertStackPlanInputsUnchanged(pair[role], "pre-reset-inputs-unchanged"),
      "Chatwoot pre-reset immutable input recheck",
    );
    const proxies = await startBothConnectProxies(pair, repositoryRoot);
    let captures;
    let resets;
    let proxySummaries;
    let callbackError;
    try {
      resets = await settleOwnedRoleOperations(
        (role) => resetOwnedStack(pair[role]),
        "Chatwoot dual reset",
      );
      captures = await settleOwnedRoleOperations((role) => browserCapture({
        connectProxyBindingSha256: bound[role].runtimeBinding.connectProxyBindingSha256,
        connectProxyUrl: `http://${pair[role].contract.publications.connectProxy}`,
        controlUrl: pair[role].controlUrl,
        fixtureContractSha256: pair[role].contract.fixtureContract.sha256,
        pairIndex: pair.pairIndex,
        playwrightVersion,
        projectSha256: bound[role].runtimeBinding.projectSha256,
        resolverIp: pair[role].resolverIp,
        role,
        sealer,
        staticAssetContract: pair[role].staticAssetContract,
      }), "Chatwoot dual browser capture");
    } catch (error) {
      callbackError = error;
    } finally {
      try {
        proxySummaries = await stopBothConnectProxies(proxies);
      } catch (error) {
        if (callbackError) {
          throw new AggregateError(
            [callbackError, error],
            "Chatwoot capture and exact CONNECT cleanup both failed.",
          );
        }
        throw error;
      }
    }
    if (callbackError) throw callbackError;
    if (!captures || !resets || !proxySummaries) {
      throw new Error("Chatwoot owned pair callback did not complete exact capture evidence.");
    }
    const finalInputChecks = await settleOwnedRoleOperations(
      (role) => assertStackPlanInputsUnchanged(pair[role], "post-capture-inputs-unchanged"),
      "Chatwoot post-capture immutable input recheck",
    );
    return Object.freeze({
      bound,
      captures,
      finalInputChecks,
      launch,
      resets,
      proxySummaries,
    });
  });
  const cleanup = assertPairCleanupReceipt(proofSession.cleanup, pair);
  const value = proofSession.value;
  if (stableJson(proofSession.launch) !== stableJson(value.launch)) {
    throw new Error(`Pair ${pair.pairIndex} launcher receipt changed after callback.`);
  }
  const stacks = Object.freeze(Object.fromEntries(roles.map((role) => {
    const capture = assertExactCapture(value.captures[role], role);
    const cleanupReceipt = cleanup.stacks.find((entry) => entry.role === role);
    if (!cleanupReceipt) throw new Error(`Chatwoot ${role} cleanup receipt is missing.`);
    const listen = pair[role].contract.publications.connectProxy;
    const target = `${pair[role].resolverIp}:443`;
    const proxy = assertJourneyConnectProxyGate(value.proxySummaries[role], {
      accepted: chatwootConnectAuthorityLedger.length,
      authorityLedger: chatwootConnectAuthorityLedger,
      listen,
      target,
    });
    return [role, Object.freeze({
      role,
      pairIndex: pair.pairIndex,
      proofHmacScopeSha256: sealer.proofHmacScopeSha256,
      runScopeSha256: capture.runScopeSha256,
      inputReceipt: value.bound[role].inputReceipt,
      runtimeAttestation: value.bound[role].runtimeAttestation,
      applicationImage: Object.freeze({
        assetImageDigest: pair[role].imageDigest,
        configDigest: pair[role].expectedApplicationImageConfigDigest,
        ...(value.bound[role].runtimeAttestation.imageSelectionMode === undefined ? {} : {
          imageSelectionMode: value.bound[role].runtimeAttestation.imageSelectionMode,
        }),
        manifestDigest: pair[role].staticAssetContract.providerContract.manifestDigest,
        publicBuildContract: Object.freeze({ ...pair[role].contract.publicBuildContract }),
        referenceSha256: sha256(pair[role].contract.images.application),
        repoDigestContractSha256:
          value.bound[role].runtimeBinding.applicationRepoDigestContractSha256,
        revision: pair[role].contract.revision,
        role: "app",
        runtimeImageDigest: value.bound[role].runtimeAttestation.applicationRuntimeImageDigest,
      }),
      migrationImage: Object.freeze(
        value.bound[role].runtimeAttestation.imageSelectionMode === containerdImageSelectionMode
          ? {
            assetImageDigest: pair[role].migrationImageDigest,
            bindingContractSha256:
              value.bound[role].runtimeBinding.migrationImageBindingContractSha256,
            imageSelectionMode: value.bound[role].runtimeAttestation.imageSelectionMode,
            manifestDigest: value.bound[role].runtimeAttestation.migrationManifestDigest,
            referenceSha256: sha256(pair[role].contract.images.migration),
            revision: pair[role].contract.revision,
            role: "migration",
            runtimeImageDigest: value.bound[role].runtimeAttestation.migrationRuntimeImageDigest,
          }
          : {
            assetImageDigest: pair[role].migrationImageDigest,
            bindingContractSha256:
              value.bound[role].runtimeBinding.migrationImageBindingContractSha256,
            configDigest: value.bound[role].runtimeAttestation.migrationRuntimeImageDigest,
            referenceSha256: sha256(pair[role].contract.images.migration),
            revision: pair[role].contract.revision,
            role: "migration",
            runtimeImageDigest: value.bound[role].runtimeAttestation.migrationRuntimeImageDigest,
          },
      ),
      fixtureContract: Object.freeze({
        version: "journey-v5",
        sha256: pair[role].contract.fixtureContract.sha256,
      }),
      publicBuildContract: Object.freeze({ ...pair[role].contract.publicBuildContract }),
      runtimeBinding: value.bound[role].runtimeBinding,
      reset: value.resets[role],
      browser: capture.browser,
      phases: capture.phases,
      connectProxy: Object.freeze({
        authorityLedgerCount: proxy.authorityLedger.length,
        authorityLedgerSha256: sha256(stableJson(proxy.authorityLedger)),
        bindingSha256: value.bound[role].runtimeBinding.connectProxyBindingSha256,
        counters: proxy.counters,
        listenSha256: sha256(listen),
        targetSha256: sha256(target),
      }),
      cleanup: Object.freeze({ ...cleanupReceipt }),
    })];
  })));
  return Object.freeze({
    report: Object.freeze({
      pairIndex: pair.pairIndex,
      cleanup,
      execution: createExecutionEvidence({
        captures: value.captures,
        cleanup,
        finalInputChecks: value.finalInputChecks,
        launch: value.launch,
        pairIndex: pair.pairIndex,
        resets: value.resets,
        stacks,
      }),
      stacks,
    }),
    screenshots: Object.freeze(Object.fromEntries(roles.map((role) => [
      role,
      Object.freeze({ ...value.captures[role].screenshots }),
    ]))),
  });
}

function bindOwnedRuntime(stack, owned) {
  exactKeys(owned, ["inputReceipt", "runtime", "status"], `${stack.role} owned runtime`);
  if (owned.status !== "verifier-owned-runtime-attested") {
    throw new Error(`${stack.role} owned runtime status is invalid.`);
  }
  const receipt = owned.inputReceipt;
  const receiptMode = receipt?.imageSelectionMode === undefined
    ? "classic-config"
    : receipt.imageSelectionMode;
  if (!new Set(["classic-config", containerdImageSelectionMode]).has(receiptMode)) {
    throw new Error(`${stack.role} owned input receipt image selection mode is invalid.`);
  }
  const sharedReceiptKeys = [
    "applicationImageBindingContractSha256",
    "applicationImageConfigDigest",
    "composeSourceSha256",
    "fixtureBindingContractSha256",
    "fixtureMountSubsetContractSha256",
    "fixtureSourceContractSha256",
    "generatedEnvironmentDirectorySha256",
    "globalFixtureContractSha256",
    "imageProbeOwnershipContractSha256",
    "migrationImageBindingContractSha256",
    "projectSha256",
    "renderedComposeSha256",
    "roleEnvironmentContractSha256",
    "roleEnvironmentPolicySha256",
  ];
  exactKeys(receipt, receiptMode === "classic-config"
    ? [...sharedReceiptKeys, "migrationImageConfigDigest"]
    : [
      ...sharedReceiptKeys,
      "applicationImageManifestDigest",
      "applicationImageRuntimeDigest",
      "imageSelectionMode",
      "migrationImageManifestDigest",
      "migrationImageRuntimeDigest",
    ], `${stack.role} owned input receipt`);
  for (const [name, value] of Object.entries(receipt)) {
    if (name === "imageSelectionMode") {
      if (value !== containerdImageSelectionMode) {
        throw new Error(`${stack.role} receipt image selection mode is invalid.`);
      }
    } else if (name.endsWith("ConfigDigest")
      || name.endsWith("RuntimeDigest") || name.endsWith("ManifestDigest")) {
      assertImageDigest(value, `${stack.role} receipt ${name}`);
    }
    else assertSha256(value, `${stack.role} receipt ${name}`);
  }
  const runtime = owned.runtime;
  const runtimeMode = runtime?.imageSelectionMode === undefined
    ? "classic-config"
    : runtime.imageSelectionMode;
  const sharedRuntimeKeys = [
    "applicationImageBindingContractSha256",
    "applicationRepoDigestContractSha256",
    "applicationRuntimeImageDigest",
    "composeRuntimeContractSha256",
    "composeSourceSha256",
    "fixtureExecutionContractSha256",
    "fixtureMountContractSha256",
    "migrationImageBindingContractSha256",
    "migrationRuntimeImageDigest",
    "networkSha256",
    "oneShotLifecycleContractSha256",
    "renderedComposeSha256",
    "serviceIdentitySha256",
    "syntheticRoleEnvironmentContractSha256",
    "syntheticRoleEnvironmentPolicySha256",
  ];
  exactKeys(runtime, runtimeMode === "classic-config"
    ? sharedRuntimeKeys
    : [
      ...sharedRuntimeKeys,
      "applicationManifestDigest",
      "imageSelectionMode",
      "migrationManifestDigest",
    ], `${stack.role} owned runtime attestation`);
  for (const [name, value] of Object.entries(runtime)) {
    if (name === "imageSelectionMode") {
      if (value !== containerdImageSelectionMode) {
        throw new Error(`${stack.role} runtime image selection mode is invalid.`);
      }
    } else if (name.endsWith("ImageDigest") || name.endsWith("ManifestDigest")) {
      assertImageDigest(value, `${stack.role} runtime ${name}`);
    }
    else assertSha256(value, `${stack.role} runtime ${name}`);
  }
  if (receiptMode !== runtimeMode) {
    throw new Error(`${stack.role} receipt and runtime image selection modes differ.`);
  }
  const imageSelectionMatches = receiptMode === "classic-config"
    ? receipt.applicationImageConfigDigest === runtime.applicationRuntimeImageDigest
      && receipt.migrationImageConfigDigest === runtime.migrationRuntimeImageDigest
    : receipt.applicationImageRuntimeDigest === runtime.applicationRuntimeImageDigest
      && receipt.applicationImageManifestDigest === runtime.applicationManifestDigest
      && receipt.migrationImageRuntimeDigest === runtime.migrationRuntimeImageDigest
      && receipt.migrationImageManifestDigest === runtime.migrationManifestDigest
      && receipt.applicationImageConfigDigest
        === stack.staticAssetContract.providerContract.configDigest
      && receipt.applicationImageRuntimeDigest === stack.imageDigest
      && receipt.applicationImageManifestDigest
        === stack.staticAssetContract.providerContract.manifestDigest
      && receipt.migrationImageRuntimeDigest === stack.migrationImageDigest;
  if (
    receipt.projectSha256 !== sha256(stack.contract.project)
    || receipt.composeSourceSha256 !== runtime.composeSourceSha256
    || receipt.renderedComposeSha256 !== runtime.renderedComposeSha256
    || receipt.fixtureSourceContractSha256 !== runtime.fixtureMountContractSha256
    || receipt.fixtureMountSubsetContractSha256 !== runtime.fixtureMountContractSha256
    || receipt.globalFixtureContractSha256 !== stack.contract.fixtureContract.sha256
    || receipt.fixtureBindingContractSha256 !== sha256(JSON.stringify({
      globalFixtureContractSha256: receipt.globalFixtureContractSha256,
      mountSubsetContractSha256: receipt.fixtureMountSubsetContractSha256,
    }))
    || receipt.roleEnvironmentContractSha256
      !== runtime.syntheticRoleEnvironmentContractSha256
    || receipt.roleEnvironmentPolicySha256
      !== runtime.syntheticRoleEnvironmentPolicySha256
    || !imageSelectionMatches
    || receipt.applicationImageBindingContractSha256
      !== runtime.applicationImageBindingContractSha256
    || receipt.migrationImageBindingContractSha256
      !== runtime.migrationImageBindingContractSha256
  ) {
    throw new Error(`${stack.role} pre-start receipt differs from live runtime attestation.`);
  }
  const connectProxyBindingSha256 = sha256(stableJson({
    authorityLedger: chatwootConnectAuthorityLedger,
    listen: stack.contract.publications.connectProxy,
    target: `${stack.resolverIp}:443`,
  }));
  const runtimeBinding = Object.freeze({
    status: "verifier-owned-runtime-bound",
    projectSha256: receipt.projectSha256,
    journeyContractSha256: stack.journeyContractSha256,
    networkSha256: runtime.networkSha256,
    publicationsSha256: sha256(stableJson(stack.contract.publications)),
    serviceIdentitySha256: runtime.serviceIdentitySha256,
    fixtureMountContractSha256: runtime.fixtureMountContractSha256,
    fixtureExecutionContractSha256: runtime.fixtureExecutionContractSha256,
    fixtureBindingContractSha256: receipt.fixtureBindingContractSha256,
    globalFixtureContractSha256: receipt.globalFixtureContractSha256,
    generatedEnvironmentDirectorySha256: receipt.generatedEnvironmentDirectorySha256,
    ownedInputReceiptSha256: sha256(JSON.stringify(receipt)),
    composeSourceSha256: runtime.composeSourceSha256,
    renderedComposeSha256: runtime.renderedComposeSha256,
    composeRuntimeContractSha256: runtime.composeRuntimeContractSha256,
    oneShotLifecycleContractSha256: runtime.oneShotLifecycleContractSha256,
    syntheticRoleEnvironmentContractSha256:
      runtime.syntheticRoleEnvironmentContractSha256,
    syntheticRoleEnvironmentPolicySha256:
      runtime.syntheticRoleEnvironmentPolicySha256,
    staticAssetAttestationSha256:
      stack.staticAssetContract.providerContract.attestationSha256,
    staticAssetConfigDigest: stack.staticAssetContract.providerContract.configDigest,
    staticAssetImageDigest: stack.staticAssetContract.providerContract.imageDigest,
    staticAssetManifestDigest: stack.staticAssetContract.providerContract.manifestDigest,
    staticAssetSourceFileSha256: stack.assetFileSha256,
    staticAssetInventorySha256:
      stack.staticAssetContract.providerContract.inventorySha256,
    staticAssetInventoryProjectionSha256:
      stack.staticAssetContract.providerContract.inventoryLedgerContractSha256,
    staticAssetRouteGraphSha256:
      stack.staticAssetContract.providerContract.routeDeclaredPathContractSha256,
    applicationImageBindingContractSha256:
      runtime.applicationImageBindingContractSha256,
    applicationRepoDigestContractSha256:
      runtime.applicationRepoDigestContractSha256,
    migrationImageBindingContractSha256:
      runtime.migrationImageBindingContractSha256,
    migrationAssetImageDigest: stack.migrationImageDigest,
    connectProxyBindingSha256,
  });
  return Object.freeze({
    inputReceipt: Object.freeze({ ...receipt }),
    runtimeAttestation: Object.freeze({ ...runtime }),
    runtimeBinding,
  });
}

export function bindChatwootOwnedRuntimeForTest(stack, owned) {
  return bindOwnedRuntime(stack, owned);
}

function assertDualRuntime(baseline, candidate) {
  if ((baseline.inputReceipt.imageSelectionMode ?? "classic-config")
    !== (candidate.inputReceipt.imageSelectionMode ?? "classic-config")) {
    throw new Error("Chatwoot dual runtime image selection modes differ across images.");
  }
  for (const name of [
    "projectSha256",
    "networkSha256",
    "publicationsSha256",
    "serviceIdentitySha256",
    "generatedEnvironmentDirectorySha256",
    "composeRuntimeContractSha256",
    "renderedComposeSha256",
    "syntheticRoleEnvironmentContractSha256",
    "connectProxyBindingSha256",
  ]) {
    if (baseline.runtimeBinding[name] === candidate.runtimeBinding[name]) {
      throw new Error(`Chatwoot dual runtime ${name} is not isolated.`);
    }
  }
  for (const name of [
    "composeSourceSha256",
    "fixtureMountContractSha256",
    "syntheticRoleEnvironmentPolicySha256",
  ]) {
    if (baseline.runtimeBinding[name] !== candidate.runtimeBinding[name]) {
      throw new Error(`Chatwoot dual runtime ${name} differs across images.`);
    }
  }
}

async function resetOwnedStack(stack) {
  const response = await controlJson(stack.controlUrl, "/__reset", {
    method: "POST",
    body: { scenario: CHATWOOT_PHASE_PROOF_SCENARIO },
  });
  return assertChatwootDeterministicReset(
    response,
    stack.contract.project,
    `${stack.role} pair ${stack.pairIndex}`,
  );
}

async function loadCompleteLaunchPlan({ exactInput, fixtureContractSha256, repositoryRoot }) {
  const validateProductionImageAssetAttestation = await loadProductionImageAssetValidator(
    repositoryRoot,
  );
  const result = [];
  for (const pair of exactInput.pairs) {
    const loaded = await concurrentRoles((role) => loadStackPlan({
      input: pair[role],
      fixtureContractSha256,
      pairIndex: pair.pairIndex,
      repositoryRoot,
      role,
      validateProductionImageAssetAttestation,
    }));
    result.push(Object.freeze({ pairIndex: pair.pairIndex, ...loaded }));
  }
  const stacks = result.flatMap((pair) => roles.map((role) => pair[role]));
  requireUnique(stacks.map((stack) => stack.contract.project), "Chatwoot Compose projects");
  requireUnique(stacks.map((stack) => stack.journeyContractSha256), "Chatwoot journey contracts");
  requireUnique(stacks.map((stack) => stack.contractRealpath), "Chatwoot contract realpaths");
  requireUnique(stacks.map((stack) => stack.environmentRealpath), "Chatwoot environment realpaths");
  requireUnique(
    stacks.map((stack) => pathObjectIdentityKey(stack.contractFileIdentity)),
    "Chatwoot contract file identities",
  );
  requireUnique(
    stacks.map((stack) => pathObjectIdentityKey(stack.environmentIdentity)),
    "Chatwoot environment identities",
  );
  requireUnique(
    stacks.map((stack) => pathObjectIdentityKey(stack.assetFileIdentity)),
    "Chatwoot asset file identities",
  );
  requireUnique(stacks.flatMap((stack) => Object.values(stack.contract.publications)), "Chatwoot publications");
  requireUnique(stacks.map((stack) => stack.resolverIp), "Chatwoot resolver addresses");
  requireSame(stacks.map((stack) => stack.contract.fixtureContract.sha256), "fixture contract");
  requireSame(stacks.map((stack) => stableJson(stack.contract.publicBuildContract)), "public build");
  assertChatwootImagePlatformParityForTest(
    stacks.map((stack) => stack.expectedImagePlatform),
  );
  for (const role of roles) {
    const roleStacks = stacks.filter((stack) => stack.role === role);
    requireSame(roleStacks.map((stack) => stack.imageDigest), `${role} image digest`);
    requireSame(roleStacks.map((stack) => stack.migrationImageDigest), `${role} migration digest`);
    requireSame(roleStacks.map((stack) => stack.contract.revision), `${role} source revision`);
    requireSame(
      roleStacks.map((stack) => stack.staticAssetContract.providerContract.attestationSha256),
      `${role} asset attestation`,
    );
    requireSame(
      roleStacks.map((stack) => stack.staticAssetContract.providerContract.inventorySha256),
      `${role} asset inventory`,
    );
  }
  if (
    result[0].baseline.imageDigest === result[0].candidate.imageDigest
    || result[0].baseline.migrationImageDigest === result[0].candidate.migrationImageDigest
    || result[0].baseline.contract.revision === result[0].candidate.contract.revision
    || result[0].baseline.staticAssetContract.providerContract.attestationSha256
      === result[0].candidate.staticAssetContract.providerContract.attestationSha256
  ) {
    throw new Error("Chatwoot launch plan does not bind distinct baseline/candidate images.");
  }
  return Object.freeze(result);
}

async function loadStackPlan({
  input,
  fixtureContractSha256,
  pairIndex,
  repositoryRoot,
  role,
  validateProductionImageAssetAttestation,
}) {
  const [contractFile, assetFile, environment] = await Promise.all([
    exactExternalFile(input.contractPath, repositoryRoot, `${role} contract`),
    exactExternalFile(input.assetAttestationPath, repositoryRoot, `${role} asset attestation`),
    exactExternalDirectory(
      input.generatedEnvironmentPath,
      repositoryRoot,
      `${role} environment`,
    ),
  ]);
  if (normalizePath(path.dirname(contractFile.realpath)) !== normalizePath(environment.realpath)) {
    throw new Error(`${role} contract is not contained by its exact environment directory.`);
  }
  const [contractRead, assetRead] = await Promise.all([
    readBoundedExactFileWithIdentity(contractFile.realpath, 64 * 1024, `${role} contract`),
    readBoundedExactFileWithIdentity(
      assetFile.realpath,
      32 * 1024 * 1024,
      `${role} asset attestation`,
    ),
  ]);
  const contractBytes = contractRead.bytes;
  const assetBytes = assetRead.bytes;
  const contract = assertChatwootJourneyContract(
    parseJson(contractBytes, `${role} contract`),
    role,
    pairIndex,
  );
  if (
    contract.fixtureContract.sha256 !== fixtureContractSha256
    || input.controlUrl !== `http://${contract.publications.providerControl}/`
    || input.resolverIp !== contract.publications.browserTls.split(":", 1)[0]
  ) {
    throw new Error(`${role} launch input differs from its exact journey contract.`);
  }
  const assetDocument = parseJson(assetBytes, `${role} asset attestation`);
  const expectedImagePlatform = parseAssetPlatform(assetDocument);
  const assetAttestation = validateProductionImageAssetAttestation(
    assetDocument,
    {
      fixtureContract: { version: "journey-v5", sha256: fixtureContractSha256 },
      imageDigest: input.imageDigest,
      platform: expectedImagePlatform,
      publicBuildContract: contract.publicBuildContract,
      revision: contract.revision,
    },
    `${role} pair ${pairIndex}`,
  );
  return Object.freeze({
    ...input,
    role,
    pairIndex,
    contract,
    contractRealpath: contractFile.realpath,
    contractFileIdentity: contractRead.identity,
    contractFileSha256: sha256(contractBytes),
    environmentRealpath: environment.realpath,
    environmentIdentity: environment.identity,
    assetFileIdentity: assetRead.identity,
    assetFileSha256: sha256(assetBytes),
    assetRealpath: assetFile.realpath,
    assetAttestationRealpathSha256: sha256(normalizePath(assetFile.realpath)),
    expectedApplicationImageConfigDigest: assetAttestation.source.configDigest,
    expectedApplicationManifestDigest: assetAttestation.source.manifestDigest,
    expectedApplicationRepoDigests: Object.freeze([...new Set([
      assetAttestation.source.imageDigest,
      assetAttestation.source.manifestDigest,
    ])].sort()),
    expectedImagePlatform: Object.freeze(expectedImagePlatform),
    journeyContractSha256: sha256(contractBytes),
    staticAssetContract: createChatwootPhaseStaticAssetContract(assetAttestation),
  });
}

async function loadProductionImageAssetValidator(repositoryRoot) {
  const target = path.join(
    repositoryRoot,
    "scripts",
    "security",
    "prove-served-cabinet-assets.mjs",
  );
  const validatorModule = await import(pathToFileURL(target).href);
  if (typeof validatorModule.validateProductionImageAssetAttestation !== "function") {
    throw new Error("Production-image asset validator export is absent.");
  }
  return validatorModule.validateProductionImageAssetAttestation;
}

function ownedStackInput(stack, repositoryRoot) {
  return {
    repositoryRoot,
    contractPath: stack.contractRealpath,
    contract: stack.contract,
    expectedApplicationAssetImageDigest: stack.imageDigest,
    expectedApplicationImageConfigDigest: stack.expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest: stack.expectedApplicationManifestDigest,
    expectedApplicationRepoDigests: stack.expectedApplicationRepoDigests,
    expectedImagePlatform: stack.expectedImagePlatform,
    expectedMigrationAssetImageDigest: stack.migrationImageDigest,
    runDocker: (args, maximumBytes, environment, commandOptions = {}) => {
      assertOwnedDockerCommandOptions(commandOptions);
      return runJourneyDockerCommand(args, maximumBytes, environment, {
        repositoryRoot,
        ...commandOptions,
      });
    },
  };
}

function assertOwnedDockerCommandOptions(commandOptions) {
  if (!commandOptions || typeof commandOptions !== "object" || Array.isArray(commandOptions)
    || Object.keys(commandOptions).some((name) => name !== "timeoutMs")
    || (commandOptions.timeoutMs !== undefined
      && (!Number.isSafeInteger(commandOptions.timeoutMs)
        || commandOptions.timeoutMs < 1 || commandOptions.timeoutMs > 600_000))) {
    throw new Error("Chatwoot owned-stack Docker command options are invalid.");
  }
}

async function assertStackPlanInputsUnchanged(stack, status) {
  if (!new Set([
    "post-capture-inputs-unchanged",
    "pre-reset-inputs-unchanged",
  ]).has(status)) {
    throw new Error(`${stack.role} immutable input recheck status is invalid.`);
  }
  const [contractRead, assetRead, environmentIdentity] = await Promise.all([
    readBoundedExactFileWithIdentity(stack.contractRealpath, 64 * 1024, `${stack.role} contract`),
    readBoundedExactFileWithIdentity(
      stack.assetRealpath,
      32 * 1024 * 1024,
      `${stack.role} asset attestation`,
    ),
    captureExactPathIdentity(
      stack.environmentRealpath,
      "directory",
      `${stack.role} environment`,
    ),
  ]);
  if (!samePathIdentity(contractRead.identity, stack.contractFileIdentity)
    || !samePathIdentity(assetRead.identity, stack.assetFileIdentity)
    || !samePathObjectIdentity(environmentIdentity, stack.environmentIdentity)
    || sha256(contractRead.bytes) !== stack.contractFileSha256
    || sha256(assetRead.bytes) !== stack.assetFileSha256) {
    throw new Error(`${stack.role} immutable preflight inputs changed before reset.`);
  }
  return Object.freeze({
    assetFileSha256: stack.assetFileSha256,
    contractFileSha256: stack.contractFileSha256,
    status,
  });
}

async function startBothConnectProxies(pair, repositoryRoot) {
  const settled = await Promise.allSettled(roles.map((role) => {
    const [listenHost, listenPort] = pair[role].contract.publications.connectProxy.split(":");
    return startJourneyConnectProxy({
      environment: journeyDockerCliEnvironment(),
      listenHost,
      listenPort,
      repositoryRoot,
      targetHost: pair[role].resolverIp,
      targetPort: "443",
    });
  }));
  if (settled.some(({ status }) => status === "rejected")) {
    const cleanup = await Promise.allSettled(settled.map((entry, index) => (
      entry.status === "fulfilled"
        ? stopJourneyConnectProxy(entry.value).then((summary) => {
          assertConnectProxySummary(summary, pair, roles[index]);
          return summary;
        })
        : Promise.resolve(null)
    )));
    const failures = [
      ...settledFailureReasons(settled),
      ...settledFailureReasons(cleanup),
    ];
    throw new AggregateError(
      failures,
      "Both Chatwoot CONNECT proxies must start and partially-started proxies must clean exactly.",
    );
  }
  return Object.freeze({
    baseline: fulfilledValue(settled[0], "baseline CONNECT start"),
    candidate: fulfilledValue(settled[1], "candidate CONNECT start"),
  });
}

async function stopBothConnectProxies(handles) {
  const settled = await Promise.allSettled(roles.map((role) => (
    stopJourneyConnectProxy(handles[role])
  )));
  const failures = settledFailureReasons(settled);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Both Chatwoot CONNECT proxies must stop with exact summaries.",
    );
  }
  return Object.freeze({
    baseline: fulfilledValue(settled[0], "baseline CONNECT cleanup"),
    candidate: fulfilledValue(settled[1], "candidate CONNECT cleanup"),
  });
}

function assertConnectProxySummary(summary, pair, role) {
  const listen = pair[role].contract.publications.connectProxy;
  const target = `${pair[role].resolverIp}:443`;
  return assertJourneyConnectProxyGate(summary, {
    accepted: chatwootConnectAuthorityLedger.length,
    authorityLedger: chatwootConnectAuthorityLedger,
    listen,
    target,
  });
}

export async function settleChatwootConnectProxyStartsForTest({ pair, starts, stop }) {
  exactKeys(arguments[0], ["pair", "starts", "stop"], "Chatwoot CONNECT test adapter");
  if (!isDenseArray(starts) || starts.length !== roles.length || typeof stop !== "function") {
    throw new Error("Chatwoot CONNECT test adapter is invalid.");
  }
  const settled = await Promise.allSettled(starts.map((start) => {
    if (typeof start !== "function") throw new Error("Chatwoot CONNECT start is invalid.");
    return start();
  }));
  if (settled.some(({ status }) => status === "rejected")) {
    const cleanup = await Promise.allSettled(settled.map((entry, index) => (
      entry.status === "fulfilled"
        ? Promise.resolve(stop(entry.value, roles[index])).then((summary) => {
          assertConnectProxySummary(summary, pair, roles[index]);
          return summary;
        })
        : Promise.resolve(null)
    )));
    const failures = [
      ...settledFailureReasons(settled),
      ...settledFailureReasons(cleanup),
    ];
    throw new AggregateError(failures, "Chatwoot CONNECT partial start failed closed.");
  }
  return Object.freeze({
    baseline: fulfilledValue(settled[0], "baseline CONNECT test start"),
    candidate: fulfilledValue(settled[1], "candidate CONNECT test start"),
  });
}

function assertPairCleanupReceipt(value, pair) {
  exactKeys(value, ["stacks", "status"], `pair ${pair.pairIndex} cleanup receipt`);
  if (value.status !== "verifier-owned-stack-pair-cleaned"
    || !isDenseArray(value.stacks) || value.stacks.length !== roles.length) {
    throw new Error(`Pair ${pair.pairIndex} cleanup receipt is invalid.`);
  }
  const stacks = value.stacks.map((entry, index) => {
    exactKeys(entry, [
      "generatedEnvironmentDirectorySha256",
      "projectSha256",
      "role",
      "status",
    ], `pair ${pair.pairIndex} cleanup stack ${index + 1}`);
    const role = roles[index];
    if (entry.role !== role
      || entry.status !== "verifier-owned-stack-cleaned"
      || entry.projectSha256 !== sha256(pair[role].contract.project)) {
      throw new Error(`Pair ${pair.pairIndex} ${role} cleanup receipt is not bound.`);
    }
    assertSha256(entry.generatedEnvironmentDirectorySha256, `${role} cleanup environment`);
    return Object.freeze({ ...entry });
  });
  return Object.freeze({ status: value.status, stacks: Object.freeze(stacks) });
}

export function assertChatwootPairCleanupReceiptForTest(value, pair) {
  return assertPairCleanupReceipt(value, pair);
}

/**
 * @param {PromiseSettledResult<unknown>[]} settled
 */
function settledFailureReasons(settled) {
  const failures = [];
  for (const entry of settled) {
    if (entry.status === "rejected") failures.push(entry.reason);
  }
  return failures;
}

function assertExactCapture(value, role) {
  exactKeys(value, [
    "browser",
    "phases",
    "runScopeSha256",
    "screenshots",
  ], `${role} Chatwoot capture`);
  assertSha256(value.runScopeSha256, `${role} capture run scope`);
  exactKeys(value.screenshots, phases, `${role} Chatwoot screenshots`);
  for (const phase of phases) {
    if (!Buffer.isBuffer(value.screenshots[phase])
      || value.screenshots[phase].byteLength < 1
      || value.screenshots[phase].byteLength > 5 * 1024 * 1024) {
      throw new Error(`${role} ${phase} screenshot is not raw PNG bytes.`);
    }
  }
  return value;
}

function assertOwnedPairLaunchReceipt(value, bound, pair) {
  exactKeys(value, [
    "barrierSha256",
    "coexistence",
    "dispatches",
    "inputReceiptContractSha256s",
    "lifecycleNotBefore",
    "status",
  ], `pair ${pair.pairIndex} owned launch receipt`);
  if (value.status !== "dual-compose-up-dispatched-after-shared-barrier"
    || !isDenseArray(value.dispatches) || value.dispatches.length !== roles.length
    || !isDenseArray(value.inputReceiptContractSha256s)
    || value.inputReceiptContractSha256s.length !== roles.length
    || !exactIsoTimestamp(value.lifecycleNotBefore)) {
    throw new Error(`Pair ${pair.pairIndex} owned launch receipt is invalid.`);
  }
  assertSha256(value.barrierSha256, `pair ${pair.pairIndex} launch barrier`);
  const projectSha256s = [];
  for (const [index, dispatch] of value.dispatches.entries()) {
    exactKeys(dispatch, ["barrierSha256", "ordinal", "projectSha256"],
      `pair ${pair.pairIndex} launch dispatch ${index}`);
    const role = roles[index];
    if (dispatch.barrierSha256 !== value.barrierSha256 || dispatch.ordinal !== index
      || dispatch.projectSha256 !== bound[role].runtimeBinding.projectSha256) {
      throw new Error(`Pair ${pair.pairIndex} launch dispatch ledger is not role-bound.`);
    }
    projectSha256s.push(dispatch.projectSha256);
    const receiptDigest = sha256(JSON.stringify(bound[role].inputReceipt));
    if (value.inputReceiptContractSha256s[index] !== receiptDigest) {
      throw new Error(`Pair ${pair.pairIndex} launch input receipt digest is not exact.`);
    }
  }
  if (new Set(projectSha256s).size !== roles.length
    || value.barrierSha256 !== sha256(JSON.stringify({
      inputReceiptContractSha256s: value.inputReceiptContractSha256s,
      projects: projectSha256s,
      version: 1,
    }))) {
    throw new Error(`Pair ${pair.pairIndex} launch barrier is not input-bound.`);
  }
  exactKeys(value.coexistence, ["observations", "status"],
    `pair ${pair.pairIndex} coexistence receipt`);
  if (value.coexistence.status !== "both-project-container-sets-coexisted"
    || !isDenseArray(value.coexistence.observations)
    || value.coexistence.observations.length !== roles.length) {
    throw new Error(`Pair ${pair.pairIndex} coexistence receipt is incomplete.`);
  }
  const expectedServices = [...JOURNEY_COMPOSE_SERVICE_NAMES].sort();
  const allContainerIds = new Set();
  for (const [roleIndex, observation] of value.coexistence.observations.entries()) {
    exactKeys(observation, [
      "containerSetSha256", "projectSha256", "serviceCount", "services",
    ], `pair ${pair.pairIndex} coexistence observation ${roleIndex}`);
    const role = roles[roleIndex];
    if (observation.projectSha256 !== bound[role].runtimeBinding.projectSha256
      || observation.serviceCount !== expectedServices.length
      || !isDenseArray(observation.services)
      || observation.services.length !== expectedServices.length
      || observation.containerSetSha256 !== sha256(JSON.stringify(observation.services))) {
      throw new Error(`Pair ${pair.pairIndex} coexistence observation is not runtime-bound.`);
    }
    assertSha256(observation.containerSetSha256,
      `pair ${pair.pairIndex} coexistence container set`);
    for (const [serviceIndex, service] of observation.services.entries()) {
      exactKeys(service, ["containerIdSha256", "service", "state"],
        `pair ${pair.pairIndex} coexistence service ${serviceIndex}`);
      if (service.service !== expectedServices[serviceIndex]
        || service.state !== JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[service.service]
        || allContainerIds.has(service.containerIdSha256)) {
        throw new Error(`Pair ${pair.pairIndex} coexistence service ledger is invalid.`);
      }
      assertSha256(service.containerIdSha256,
        `pair ${pair.pairIndex} coexistence container identity`);
      allContainerIds.add(service.containerIdSha256);
    }
  }
  if (allContainerIds.size !== expectedServices.length * roles.length) {
    throw new Error(`Pair ${pair.pairIndex} coexistence container identities are not isolated.`);
  }
  return deepFreezeJson(value);
}

function createExecutionEvidence({
  captures, cleanup, finalInputChecks, launch, pairIndex, resets, stacks,
}) {
  const bindings = Object.freeze({
    browserCaptureContractSha256s: Object.freeze(roles.map((role) => sha256(stableJson({
      browser: captures[role].browser,
      runScopeSha256: captures[role].runScopeSha256,
    })))),
    cleanupContractSha256: sha256(JSON.stringify(cleanup)),
    finalInputChecks: Object.freeze(roles.map((role) => Object.freeze({
      ...finalInputChecks[role],
    }))),
    finalInputContractSha256s: Object.freeze(roles.map((role) => (
      sha256(stableJson(finalInputChecks[role]))
    ))),
    inputReceiptContractSha256s: Object.freeze(roles.map((role) => (
      sha256(JSON.stringify(stacks[role].inputReceipt))
    ))),
    resetContractSha256s: Object.freeze(roles.map((role) => sha256(stableJson(resets[role])))),
    runtimeAttestationContractSha256s: Object.freeze(roles.map((role) => (
      sha256(JSON.stringify(stacks[role].runtimeAttestation))
    ))),
  });
  const eventBindings = [
    bindings.inputReceiptContractSha256s,
    launch.dispatches,
    bindings.runtimeAttestationContractSha256s,
    launch.inputReceiptContractSha256s,
    bindings.resetContractSha256s,
    roles.map((role) => stacks[role].runtimeBinding.projectSha256),
    bindings.browserCaptureContractSha256s,
    { cleanup, finalInputContractSha256s: bindings.finalInputContractSha256s },
  ];
  const events = eventContract.map(([event, liveStackCount, destructiveResetCount], index) => (
    Object.freeze({
      destructiveResetCount,
      event,
      evidenceSha256: sha256(stableJson(eventBindings[index])),
      globalOrdinal: ((pairIndex - 1) * eventContract.length) + index + 1,
      liveStackCount,
      pairIndex,
    })
  ));
  return Object.freeze({
    baselineCandidateConcurrent:
      launch.coexistence.status === "both-project-container-sets-coexisted",
    bindings,
    cleanupCompletedWithinPair:
      cleanup.status === "verifier-owned-stack-pair-cleaned",
    dualPreflightBeforeMutation: launch.status
      === "dual-compose-up-dispatched-after-shared-barrier",
    events: Object.freeze(events),
    launch,
    pairIndex,
    peakLiveStackCount: launch.coexistence.observations.length,
  });
}

export function createChatwootExecutionEvidenceForTest(input) {
  return createExecutionEvidence(input);
}

async function loadBrowserCapture(repositoryRoot) {
  const require = createRequire(path.join(repositoryRoot, "package.json"));
  const playwrightCommon = require(path.join(
    repositoryRoot,
    "node_modules",
    "playwright",
    "lib",
    "common",
    "index.js",
  ));
  const transform = playwrightCommon?.transform;
  if (!transform || typeof transform.requireOrImport !== "function"
    || typeof transform.setSingleTSConfig !== "function") {
    throw new Error("Pinned Playwright TypeScript loader is unavailable.");
  }
  transform.setSingleTSConfig(path.join(repositoryRoot, "tsconfig.json"));
  const captureModule = await transform.requireOrImport(path.join(
    repositoryRoot,
    "tests",
    "browser",
    "journeys",
    "chatwoot-phase-browser-capture.ts",
  ));
  if (typeof captureModule?.captureChatwootPhaseStack !== "function") {
    throw new Error("Chatwoot browser capture module has no exact entrypoint.");
  }
  return captureModule.captureChatwootPhaseStack;
}

async function installedPlaywrightVersion(repositoryRoot) {
  const [installed, rootPackage] = await Promise.all([
    readBoundedJson(
      path.join(repositoryRoot, "node_modules", "playwright", "package.json"),
      64 * 1024,
      "installed Playwright package",
    ),
    readBoundedJson(path.join(repositoryRoot, "package.json"), 64 * 1024, "root package"),
  ]);
  const expected = rootPackage?.devDependencies?.["@playwright/test"];
  if (typeof installed?.version !== "string" || installed.version !== expected
    || !/^\d+\.\d+\.\d+$/.test(installed.version)) {
    throw new Error("Installed Playwright differs from the exact local package contract.");
  }
  return installed.version;
}

async function exactRepositoryRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("Chatwoot repository root must be absolute.");
  }
  const resolved = await realpath(value);
  const packageValue = await readBoundedJson(
    path.join(resolved, "package.json"),
    64 * 1024,
    "repository package",
  );
  if (packageValue?.name !== "clean-pay" || packageValue?.private !== true) {
    throw new Error("Chatwoot proof must run from the Clean Pay repository root.");
  }
  return resolved;
}

async function exactExternalFile(target, repositoryRoot, label) {
  if (!path.isAbsolute(target) || isWithin(repositoryRoot, target)) {
    throw new Error(`${label} must be an absolute path outside the repository.`);
  }
  const identity = await captureExactPathIdentity(target, "file", label);
  const resolved = identity.realpath;
  if (isWithin(repositoryRoot, resolved)) {
    throw new Error(`${label} realpath escaped into the repository.`);
  }
  return Object.freeze({ identity, realpath: resolved });
}

async function exactExternalDirectory(target, repositoryRoot, label) {
  if (!path.isAbsolute(target) || isWithin(repositoryRoot, target)) {
    throw new Error(`${label} must be an absolute path outside the repository.`);
  }
  const identity = await captureExactPathIdentity(target, "directory", label);
  const resolved = identity.realpath;
  if (isWithin(repositoryRoot, resolved)) {
    throw new Error(`${label} realpath escaped into the repository.`);
  }
  return Object.freeze({ identity, realpath: resolved });
}

async function readBoundedExactFile(target, maximumBytes, label) {
  return (await readBoundedExactFileWithIdentity(target, maximumBytes, label)).bytes;
}

async function readBoundedExactFileWithIdentity(target, maximumBytes, label) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > 64 * 1024 * 1024) {
    throw new Error(`${label} file byte bound is invalid.`);
  }
  const before = await captureExactPathIdentity(target, "file", label);
  if (before.size <= 0 || before.size > maximumBytes) {
    throw new Error(`${label} is outside its bounded file contract.`);
  }
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(target, fsConstants.O_RDONLY | noFollow);
  let bytes;
  let handleBefore;
  let handleAfter;
  try {
    handleBefore = pathIdentityFromMetadata(await handle.stat(), before.realpath, "file");
    if (!samePathIdentity(before, handleBefore)) {
      throw new Error(`${label} path and FileHandle identity differ.`);
    }
    bytes = await handle.readFile();
    handleAfter = pathIdentityFromMetadata(await handle.stat(), before.realpath, "file");
  } finally {
    await handle.close();
  }
  const after = await captureExactPathIdentity(target, "file", label);
  if (!samePathIdentity(before, handleAfter) || !samePathIdentity(before, after)
    || bytes.byteLength !== before.size || bytes.byteLength > maximumBytes) {
    throw new Error(`${label} changed while its immutable bytes were read.`);
  }
  return Object.freeze({ bytes, identity: before });
}

async function captureExactPathIdentity(target, kind, label) {
  const requested = path.resolve(target);
  const beforeMetadata = await lstat(requested);
  if (beforeMetadata.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link or junction.`);
  }
  const resolved = await realpath(requested);
  if (normalizePath(resolved) !== normalizePath(requested)) {
    throw new Error(`${label} realpath traversed an alias.`);
  }
  const before = pathIdentityFromMetadata(beforeMetadata, resolved, kind);
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(requested, fsConstants.O_RDONLY | noFollow);
  let handleIdentity;
  try {
    handleIdentity = pathIdentityFromMetadata(await handle.stat(), resolved, kind);
  } finally {
    await handle.close();
  }
  const afterMetadata = await lstat(requested);
  const afterResolved = await realpath(requested);
  const after = pathIdentityFromMetadata(afterMetadata, afterResolved, kind);
  if (afterMetadata.isSymbolicLink() || !samePathIdentity(before, handleIdentity)
    || !samePathIdentity(before, after)) {
    throw new Error(`${label} path/FileHandle identity changed during attestation.`);
  }
  return before;
}

function pathIdentityFromMetadata(metadata, resolved, kind) {
  if ((kind === "file" && !metadata.isFile())
    || (kind === "directory" && !metadata.isDirectory())
    || !Number.isFinite(metadata.ctimeMs) || metadata.ctimeMs < 0
    || !Number.isFinite(metadata.mtimeMs) || metadata.mtimeMs < 0
    || !Number.isFinite(metadata.size) || metadata.size < 0) {
    throw new Error("Chatwoot immutable path identity is invalid.");
  }
  return Object.freeze({
    ctimeMs: metadata.ctimeMs,
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    kind,
    mtimeMs: metadata.mtimeMs,
    realpath: path.resolve(resolved),
    size: metadata.size,
  });
}

function samePathIdentity(left, right) {
  return left.ctimeMs === right.ctimeMs
    && left.dev === right.dev
    && left.ino === right.ino
    && left.kind === right.kind
    && left.mtimeMs === right.mtimeMs
    && normalizePath(left.realpath) === normalizePath(right.realpath)
    && left.size === right.size;
}

function samePathObjectIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.kind === right.kind
    && normalizePath(left.realpath) === normalizePath(right.realpath);
}

function pathObjectIdentityKey(value) {
  return `${value.dev}:${value.ino}:${value.kind}`;
}

async function readBoundedJson(target, maximumBytes, label) {
  return parseJson(await readBoundedExactFile(target, maximumBytes, label), label);
}

/**
 * @param {string} controlUrl
 * @param {string} pathname
 * @param {{method?: string, body?: unknown}} [options]
 */
async function controlJson(controlUrl, pathname, options = {}) {
  const { method = "GET", body } = options;
  const response = await fetch(new URL(pathname, controlUrl), {
    method,
    redirect: "error",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Chatwoot fixture control ${pathname} failed with HTTP ${response.status}.`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAXIMUM_CONTROL_BYTES) {
        await reader.cancel();
        throw new Error("Chatwoot fixture control response exceeded its bounded contract.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return parseJson(Buffer.concat(chunks, size), `control ${pathname}`);
}

function parseAssetPlatform(document) {
  const platform = document?.source?.platform;
  if (!platform || Object.keys(platform).sort().join(",") !== "architecture,os"
    || platform.os !== "linux" || !new Set(["amd64", "arm64"]).has(platform.architecture)) {
    throw new Error("Chatwoot production-image asset platform is invalid.");
  }
  return { architecture: platform.architecture, os: platform.os };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function concurrentRoles(operation) {
  return Promise.all(roles.map(operation)).then(([baseline, candidate]) => (
    Object.freeze({ baseline, candidate })
  ));
}

async function settleOwnedRoleOperations(operation, label) {
  const settled = await Promise.allSettled(roles.map(operation));
  const failures = settled
    .filter((entry) => entry.status === "rejected")
    .map((entry) => entry.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, `${label} did not settle successfully for both roles.`);
  }
  const baseline = fulfilledValue(settled[0], `${label} baseline`);
  const candidate = fulfilledValue(settled[1], `${label} candidate`);
  return Object.freeze({ baseline, candidate });
}

function fulfilledValue(entry, label) {
  if (entry.status !== "fulfilled") {
    throw new Error(`${label} did not produce a fulfilled result.`);
  }
  return entry.value;
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be pairwise distinct.`);
}

function requireSame(values, label) {
  if (values.length === 0 || values.some((value) => value !== values[0])) {
    throw new Error(`Chatwoot ${label} differs across the required stacks.`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new Error(`${label} is not an exact SHA-256 digest.`);
  }
}

function assertImageDigest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} is not an exact image config digest.`);
  }
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function deepFreezeJson(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => deepFreezeJson(entry)));
  }
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => (
      [key, deepFreezeJson(entry)]
    ))));
  }
  return value;
}

function normalizePath(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function canonicalInputPath(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has unexpected fields.`);
  }
}
