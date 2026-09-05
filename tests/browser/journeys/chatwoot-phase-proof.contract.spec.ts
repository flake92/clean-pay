import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { expect, test } from "@playwright/test";
import Ajv from "ajv";

import {
  CHATWOOT_PHASE_PROOF_KIND,
  CHATWOOT_PHASE_PROOF_PAIR_COUNT,
  CHATWOOT_PHASE_PROOF_SCENARIO,
  assertChatwootDeterministicReset,
  assertChatwootJourneyContract,
  assertChatwootPhaseInput,
  assertChatwootPhaseProof,
  createChatwootPhaseComposeProjectName,
  createChatwootPhaseProof,
  readExactChatwootExternalPlan,
  readExactChatwootExternalPlanForTest,
  resolveChatwootPhaseInputPaths,
  sha256,
} from "./chatwoot-phase-proof-contract.mjs";
import { createChatwootPhaseEvidenceSealer } from "./chatwoot-phase-evidence-sealer.mjs";
import { canonicalChatwootPhaseEvidence } from "./chatwoot-phase-canonical-evidence";
import {
  assertChatwootAtomicPhaseRead,
  assertChatwootFinalSourceReread,
  assertChatwootHistoryLifecycle,
  advanceInitialCabinetBarrierForTest,
  canonicalChatwootHistorySemantics,
  assertChatwootPhaseBoundaryLedger,
  assertChatwootPhaseProviderLedger,
  assertChatwootProviderPhaseRelations,
  assertChatwootStrictClassificationForTest,
  createChatwootBoundaryLifecycleCollectorForTest,
  createChatwootCausalClearGateForTest,
  createChatwootHistoryClearGateForTest,
  installChatwootCommonRequestLifecycleForTest,
  boundedChatwootBrowserOperationForTest,
} from "./chatwoot-phase-browser-capture";
import { createChatwootPhaseCausalContract } from "./chatwoot-phase-causal-contract.mjs";
import { createChatwootPhaseEventLedger } from "./chatwoot-phase-event-ledger.mjs";
import {
  assertChatwootPhaseRedirect,
  classifyChatwootPhaseBrowserRequest,
  createChatwootPhaseStaticAssetContract,
  finalizeChatwootPhaseBrowserContract,
  finalizeChatwootPhaseHistoryContract,
} from "./chatwoot-phase-browser-contract.mjs";
import {
  createJourneyBrowserRequestEnvelope,
  extractProviderOverlapCssMediaReferences,
  extractProviderOverlapResponseStaticDeclarations,
  finalizeProviderOverlapHistoryContract,
  readProviderOverlapStaticResponseEvidence,
} from "./provider-overlap-browser-contract.mjs";
import {
  JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES,
  JOURNEY_COMPOSE_SERVICE_NAMES,
} from "./journey-compose-runtime-attestation.mjs";
import { buildJourneySyntheticEnvironment } from "./journey-synthetic-environment-contract.mjs";
import { JOURNEY_FIXTURE_FILENAMES } from "./journey-fixture-manifest.mjs";
import { withJourneyOwnedStackPair } from "./journey-owned-stack-orchestrator.mjs";
import { SYNTHETIC_APPLICATION_ORIGIN } from "./synthetic-logout-storage";
import {
  abortChatwootPhaseEvidence,
  chatwootWindowsPowerShellEnvironmentForTest,
  expectedChatwootScreenshotPaths,
  finalizeChatwootPhaseEvidence,
  finalizeChatwootPhaseEvidenceForTest,
  prepareChatwootPhaseEvidenceDirectory,
  prepareChatwootPhaseEvidenceDirectoryForTest,
  writeRawChatwootPhaseScreenshot,
} from "./chatwoot-phase-evidence-writer.mjs";
import {
  assertChatwootOutputDirectoryDisjointForTest,
  assertChatwootImagePlatformParityForTest,
  assertChatwootPairCleanupReceiptForTest,
  bindChatwootOwnedRuntimeForTest,
  createChatwootExecutionEvidenceForTest,
  preflightChatwootOutputDirectoryForTest,
  recheckChatwootOutputDirectoryForTest,
  settleChatwootConnectProxyStartsForTest,
} from "./chatwoot-phase-proof-orchestrator.mjs";

const baselineRevision = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const candidateRevision = "08a787d016205e6a10d4c3bf7b77437555e885ad";
const fixtureContractSha256 = "a".repeat(64);
const publicBuildContractSha256 = "b".repeat(64);

type DeepMutable<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer Entry>
    ? Array<DeepMutable<Entry>>
    : T extends object
      ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
      : T;

type MutableStaticGenerationEvidence = {
  documentGenerationCount: number;
  requestContractSha256: string;
  requestCount: number;
  requestOrderContractSha256: string;
  requestOrderLedger: Array<{ kind: "semantic" | "static"; occurrence: number }>;
  responseDeclarationContractSha256: string;
  responseDeclarationLedger: Array<{
    documentKey: string;
    pathSha256s: string[];
  }>;
  semanticRequestLedger: Array<{
    disposition: string;
    key: string;
    redirectEdge: string | null;
    responseContentType: string | null;
    responseFailureSha256: string | null;
    responseStatus: number | null;
  }>;
  staticLoadGraph: {
    assetAttestationSha256: string;
    cssMediaReferenceLedger: Array<{
      occurrence: number;
      sourcePathSha256: string;
      targetPathSha256: string;
    }>;
    documentLoadLedger: Array<{
      documentKey: string;
      expectedChunkPathSha256s: string[];
      expectedMediaPathSha256s: string[];
      routeDeclaredPathSha256s: string[];
    }>;
    inventoryLedger: Array<{ extension: string; pathSha256: string }>;
    referenceStaticLoadGraphContractSha256?: string;
  };
  staticLoadGraphContractSha256: string;
  staticRequestContractSha256: string;
  staticRequestLedger: Array<{
    assetBytes: number;
    assetSha256: string;
    class: string;
    contentType: string;
    documentKey: string;
    pathSha256: string;
  }>;
};

type MutableStaticProvenanceEvidence = {
  assetAttestationSha256: string;
  initial: MutableStaticGenerationEvidence;
  recreated: MutableStaticGenerationEvidence;
};

function primeAndSealCausalContract(
  causal: ReturnType<typeof createChatwootPhaseCausalContract>,
) {
  causal.observeDocument({
    presence: { conversationCookiePresent: false, userCookiePresent: false },
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  causal.observeBoundary({
    method: "setUser",
    presence: { conversationCookiePresent: true, userCookiePresent: false },
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  return causal.sealPreClearGeneration();
}

test("requires three independent A/B pairs and exact cross-image PNG quorums", () => {
  const proof = createChatwootPhaseProof(pairReports());

  expect(proof).toMatchObject({
    schemaVersion: 1,
    kind: CHATWOOT_PHASE_PROOF_KIND,
    scenario: {
      label: CHATWOOT_PHASE_PROOF_SCENARIO,
      sha256: sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
    },
    execution: {
      mode: "pair-serial-dual-concurrent-v1",
      independentPairCount: 3,
      peakLiveStackCount: 2,
      chromiumProcessCount: 6,
      chromiumContextCount: 6,
      ledgerEntryCount: 24,
      pairSerialCleanupProven: true,
      dualStackConcurrencyProven: true,
    },
    quorum: {
      independentPairCount: 3,
      requiredByteIdenticalProcesses: 2,
      semanticAgreementRequired: 6,
      screenshots: {
        gap: {
          baseline: { agreeingPairIndexes: [1, 2], dissentingPairIndexes: [3] },
          candidate: { agreeingPairIndexes: [1, 2], dissentingPairIndexes: [3] },
          crossImageByteExact: true,
        },
      },
    },
    comparison: {
      status: "proven",
      distinctComposeProjects: true,
      distinctRuntimeBindings: true,
      distinctApplicationImages: true,
      distinctSourceRevisions: true,
      sameProofHmacScope: true,
      allPhaseSemanticsExact: true,
      allCanonicalPhaseEvidenceExact: true,
      allScreenshotsCrossImageByteExact: true,
    },
    lifecycle: {
      automaticCleanup: true,
      cleanupMode: "exact-owned-project-v1",
      expectedStackCount: 6,
      cleanedStackCount: 6,
      allOwnedResourcesRemoved: true,
    },
  });
  expect(assertChatwootPhaseProof(structuredClone(proof))).toEqual(proof);
  const serialized = JSON.stringify(proof);
  for (const forbidden of [
    "cw_conversation=",
    "cw_user_",
    "synthetic.browser@clean-pay.dev",
    "access_token=",
    "refresh_token=",
    "browser-journey-contract.json",
    "C:\\",
  ]) expect(serialized).not.toContain(forbidden);
});

test("accepts the exact containerd root-manifest image identity union", () => {
  const proof = createChatwootPhaseProof(containerdPairReports());
  expect(proof.pairs[0].stacks.baseline).toMatchObject({
    applicationImage: {
      imageSelectionMode: "containerd-root-manifest",
      runtimeImageDigest: `sha256:${"1".repeat(64)}`,
    },
    migrationImage: {
      imageSelectionMode: "containerd-root-manifest",
      runtimeImageDigest: `sha256:${"3".repeat(64)}`,
    },
    inputReceipt: { imageSelectionMode: "containerd-root-manifest" },
    runtimeAttestation: { imageSelectionMode: "containerd-root-manifest" },
  });
  expect(proof.pairs[0].stacks.baseline.migrationImage).not.toHaveProperty("configDigest");
  expect(proof.pairs[0].stacks.baseline.inputReceipt)
    .not.toHaveProperty("migrationImageConfigDigest");
  expect(assertChatwootPhaseProof(structuredClone(proof))).toEqual(proof);
});

test("requires one attested linux platform across all six Chatwoot A/B stacks", () => {
  const arm64Platforms = Array.from(
    { length: CHATWOOT_PHASE_PROOF_PAIR_COUNT * 2 },
    () => ({ architecture: "arm64", os: "linux" }),
  );
  expect(assertChatwootImagePlatformParityForTest(arm64Platforms)).toEqual(
    arm64Platforms[0],
  );
  const mixed = structuredClone(arm64Platforms);
  mixed[1].architecture = "amd64";
  expect(() => assertChatwootImagePlatformParityForTest(mixed))
    .toThrow(/image platform differs/);
});

test("rejects containerd config masquerades, wrong manifests, and mixed selection modes", () => {
  const rootNamedConfig = containerdPairReports();
  Object.assign(rootNamedConfig[0].stacks.baseline.migrationImage, {
    configDigest: rootNamedConfig[0].stacks.baseline.migrationImage.assetImageDigest,
  });
  expect(() => createChatwootPhaseProof(rootNamedConfig)).toThrow(/unexpected fields/);

  const wrongManifest = containerdPairReports();
  const wrongManifestStack = wrongManifest[0].stacks.baseline;
  const forgedManifestDigest = `sha256:${"f".repeat(64)}`;
  wrongManifestStack.applicationImage.manifestDigest = forgedManifestDigest;
  wrongManifestStack.inputReceipt.applicationImageManifestDigest = forgedManifestDigest;
  wrongManifestStack.runtimeAttestation.applicationManifestDigest = forgedManifestDigest;
  const forgedBinding = sha256(JSON.stringify({
    assetImageDigest: wrongManifestStack.applicationImage.assetImageDigest,
    configDigest: wrongManifestStack.applicationImage.configDigest,
    imageSelectionMode: "containerd-root-manifest",
    manifestDigest: forgedManifestDigest,
    referenceSha256: wrongManifestStack.applicationImage.referenceSha256,
    repoDigests: [
      wrongManifestStack.applicationImage.assetImageDigest,
      forgedManifestDigest,
    ].sort(),
    role: "application",
    runtimeImageDigest: wrongManifestStack.applicationImage.runtimeImageDigest,
  }));
  wrongManifestStack.inputReceipt.applicationImageBindingContractSha256 = forgedBinding;
  wrongManifestStack.runtimeAttestation.applicationImageBindingContractSha256 = forgedBinding;
  wrongManifestStack.runtimeBinding.applicationImageBindingContractSha256 = forgedBinding;
  wrongManifestStack.runtimeBinding.ownedInputReceiptSha256 = sha256(JSON.stringify(
    wrongManifestStack.inputReceipt,
  ));
  wrongManifest[0].execution = executionEvidence(
    wrongManifest[0].pairIndex,
    wrongManifest[0].stacks,
    wrongManifest[0].cleanup,
  );
  expect(() => createChatwootPhaseProof(wrongManifest)).toThrow(/manifest image binding/);

  const mixedMode = containerdPairReports();
  const migration = mixedMode[0].stacks.baseline.migrationImage;
  Reflect.deleteProperty(migration, "imageSelectionMode");
  Reflect.deleteProperty(migration, "manifestDigest");
  const classicConfigDigest = `sha256:${"d".repeat(64)}`;
  Object.assign(migration, {
    configDigest: classicConfigDigest,
    runtimeImageDigest: classicConfigDigest,
  });
  expect(() => createChatwootPhaseProof(mixedMode)).toThrow(/selection mode/);
});

test("fails closed on phase, clearing, recreation, and browser near misses", () => {
  const mutations: Array<[
    string,
    (value: ReturnType<typeof pairReports>) => void,
  ]> = [
    ["gap user cookie", (value) => {
      value[0].stacks.baseline.phases.gap.userCookieCount = 1;
    }],
    ["gap pending state", (value) => {
      value[0].stacks.baseline.phases.gap.pendingWaitingForFrame = false;
    }],
    ["unheld replacement", (value) => {
      value[0].stacks.baseline.phases.gap.replacementRequestHeld = false;
    }],
    ["stable conversation replacement", (value) => {
      value[0].stacks.baseline.phases.stable.hashes.conversationHmacSha256 = "f".repeat(64);
    }],
    ["stable missing user cookie", (value) => {
      value[0].stacks.baseline.phases.stable.userCookieCount = 0;
    }],
    ["stable setUser delta", (value) => {
      value[0].stacks.baseline.phases.stable.setUserCount += 1;
    }],
    ["clear left a cookie", (value) => {
      value[0].stacks.baseline.phases.cleared.afterCookieCount = 1;
    }],
    ["clear changed origin", (value) => {
      value[0].stacks.baseline.phases.cleared.exactApplicationOrigin = false;
    }],
    ["clear erased fixture Turnstile ledger", (value) => {
      value[0].stacks.baseline.phases.cleared.afterSessionStorageKeyCount = 0;
    }],
    ["clear changed fixture Turnstile ledger bytes", (value) => {
      value[0].stacks.baseline.phases.cleared.preservedFixtureStorageByteExact = false;
    }],
    ["recreation without a new setUser", (value) => {
      value[0].stacks.baseline.phases.recreated.newSetUserObserved = false;
    }],
    ["recreation reuses pre-clear setUser", (value) => {
      value[0].stacks.baseline.phases.recreated.recreationCausality.postClearSetUserCount = 0;
    }],
    ["recreation cookie precedes setUser", (value) => {
      const ordinals = value[0].stacks.baseline.phases.recreated.recreationCausality.eventOrdinals;
      ordinals.cabinetCookiePairObserved = ordinals.cabinetSetUserObserved;
    }],
    ["recreation without a provider proof", (value) => {
      value[0].stacks.baseline.phases.recreated.contactProbeCount = 1;
    }],
    ["unexpected console", (value) => {
      value[0].stacks.baseline.browser.unexpectedConsoleCount = 1;
    }],
    ["unexpected request", (value) => {
      value[0].stacks.baseline.browser.unexpectedRequestCount = 1;
    }],
    ["one-stack replaceState history semantic", (value) => {
      value[0].stacks.baseline.browser.historySemantics.contractSha256 = sha256(
        "one-stack-replaceState",
      );
    }],
    ["one-stack history semantic count", (value) => {
      value[0].stacks.baseline.browser.historySemantics.entryCount += 1;
      value[0].stacks.baseline.browser.historySemantics.recreatedEntryCount += 1;
    }],
    ["changed DOM", (value) => {
      value[0].stacks.baseline.phases.gap.hashes.domHmacSha256 = "a".repeat(64);
    }],
    ["changed computed style", (value) => {
      value[0].stacks.baseline.phases.stable.hashes.computedStylesHmacSha256 = "b".repeat(64);
    }],
    ["changed accessibility tree", (value) => {
      value[0].stacks.baseline.phases.recreated.hashes.accessibilityHmacSha256 = "c".repeat(64);
    }],
    ["changed button state", (value) => {
      value[0].stacks.baseline.phases.gap.hashes.interactiveHmacSha256 = "d".repeat(64);
    }],
    ["changed request order", (value) => {
      value[0].stacks.baseline.phases.stable.hashes.requestSequenceHmacSha256 = "e".repeat(64);
    }],
    ["changed Server Action payload/order/status", (value) => {
      value[0].stacks.baseline.phases.stable.hashes.serverActionsHmacSha256 = "f".repeat(64);
    }],
    ["changed Server Action count", (value) => {
      value[0].stacks.baseline.phases.stable.serverActionCount += 1;
    }],
    ["truncated boundary evidence count", (value) => {
      value[0].stacks.baseline.phases.stable.evidenceCounts.boundaryCalls -= 1;
    }],
    ["changed request range seal", (value) => {
      value[0].stacks.baseline.phases.stable.evidenceRanges.requestSequence.lastHmacSha256 =
        "2".repeat(64);
    }],
    ["changed provider order", (value) => {
      value[0].stacks.baseline.phases.recreated.hashes.providerLedgerHmacSha256 = "0".repeat(64);
    }],
    ["changed provider effects", (value) => {
      value[0].stacks.baseline.phases.recreated.hashes.providerEffectsHmacSha256 = "1".repeat(64);
    }],
  ];

  for (const [label, mutate] of mutations) {
    const nearMiss = pairReports();
    mutate(nearMiss);
    expect(() => createChatwootPhaseProof(nearMiss), label).toThrow();
  }
});

test("requires 6/6 semantic equality and one exact 2/3 PNG majority per role", () => {
  const semanticMismatch = pairReports();
  semanticMismatch[2].stacks.candidate.phases.gap.conversationCookieByteLength += 1;
  expect(() => createChatwootPhaseProof(semanticMismatch)).toThrow(
    /six Chatwoot phase semantic observations/,
  );

  const noMajority = pairReports();
  noMajority[1].stacks.baseline.phases.gap.screenshot.sha256 = "1".repeat(64);
  noMajority[2].stacks.baseline.phases.gap.screenshot.sha256 = "2".repeat(64);
  expect(() => createChatwootPhaseProof(noMajority)).toThrow(/no single exact/);

  const differentCrossImageMajority = pairReports();
  for (const pair of differentCrossImageMajority.slice(0, 2)) {
    pair.stacks.candidate.phases.stable.screenshot.sha256 = "3".repeat(64);
  }
  expect(() => createChatwootPhaseProof(differentCrossImageMajority)).toThrow(
    /selected baseline\/candidate PNG bytes/,
  );

  const symmetricCandidateRequestDivergence = structuredClone(pairReports()) as unknown as
    DeepMutable<ReturnType<typeof pairReports>>;
  for (const pair of symmetricCandidateRequestDivergence) {
    for (const name of ["initial", "recreated"] as const) {
      const generation = pair.stacks.candidate.browser.staticProvenance[name] as unknown as
        MutableStaticGenerationEvidence;
      generation.semanticRequestLedger.push({
        disposition: "continue",
        key: "app-brand-logo",
        redirectEdge: null,
        responseContentType: "image/png",
        responseFailureSha256: null,
        responseStatus: 200,
      });
      generation.requestOrderLedger.push({
        kind: "semantic",
        occurrence: generation.semanticRequestLedger.length,
      });
      generation.requestCount = generation.requestOrderLedger.length;
      generation.requestOrderContractSha256 = sha256(JSON.stringify(
        generation.requestOrderLedger,
      ));
      const summary = {
        version: 1,
        ...(name === "recreated" ? { scenario: CHATWOOT_PHASE_PROOF_SCENARIO } : {}),
        semanticLedger: generation.semanticRequestLedger,
        staticClasses: [...new Set(generation.staticRequestLedger.map((entry) => entry.class))]
          .sort(),
      };
      generation.requestContractSha256 = sha256(JSON.stringify(summary));
    }
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(symmetricCandidateRequestDivergence)).toThrow(
    /cross-image browser semantic request contract/,
  );

  const symmetricCandidateStaticOrderDivergence = structuredClone(pairReports()) as unknown as
    DeepMutable<ReturnType<typeof pairReports>>;
  for (const pair of symmetricCandidateStaticOrderDivergence) {
    const provenance = pair.stacks.candidate.browser.staticProvenance as unknown as
      MutableStaticProvenanceEvidence;
    const loginEntries = provenance.initial.staticRequestLedger
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.documentKey === "app-login-document");
    const left = loginEntries[0];
    const right = loginEntries.find(({ entry }) => entry.class !== left?.entry.class);
    if (!left || !right) throw new Error("Static fixture lacks two independent login classes.");
    for (const generation of [provenance.initial, provenance.recreated]) {
      const leftIndex = generation.staticRequestLedger.findIndex(
        ({ pathSha256 }) => pathSha256 === left.entry.pathSha256,
      );
      const rightIndex = generation.staticRequestLedger.findIndex(
        ({ pathSha256 }) => pathSha256 === right.entry.pathSha256,
      );
      if (leftIndex < 0 || rightIndex < 0) {
        throw new Error("Static fixture paths are absent from one generation.");
      }
      [generation.staticRequestLedger[leftIndex], generation.staticRequestLedger[rightIndex]] = [
        generation.staticRequestLedger[rightIndex], generation.staticRequestLedger[leftIndex],
      ];
      generation.staticRequestContractSha256 = sha256(JSON.stringify(
        generation.staticRequestLedger,
      ));
    }
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(symmetricCandidateStaticOrderDivergence)).toThrow(
    /cross-image browser semantic request contract/,
  );
});

test("recomputes identity, runtime, reset, cleanup, and claimed comparison invariants", () => {
  const exact = createChatwootPhaseProof(pairReports());
  const mutations: Array<[string, (value: typeof exact) => void]> = [
    ["claimed semantic equality", (value) => {
      value.comparison.allPhaseSemanticsExact = false;
    }],
    ["claimed PNG equality", (value) => {
      value.quorum.screenshots.gap.crossImageByteExact = false;
    }],
    ["same project", (value) => {
      value.pairs[0].stacks.candidate.runtimeBinding.projectSha256 =
        value.pairs[0].stacks.baseline.runtimeBinding.projectSha256;
    }],
    ["same image", (value) => {
      value.pairs[0].stacks.candidate.applicationImage.assetImageDigest =
        value.pairs[0].stacks.baseline.applicationImage.assetImageDigest;
    }],
    ["same application config", (value) => {
      value.pairs[0].stacks.candidate.applicationImage.configDigest =
        value.pairs[0].stacks.baseline.applicationImage.configDigest;
    }],
    ["same migration image", (value) => {
      value.pairs[0].stacks.candidate.migrationImage.assetImageDigest =
        value.pairs[0].stacks.baseline.migrationImage.assetImageDigest;
    }],
    ["same migration config", (value) => {
      value.pairs[0].stacks.candidate.migrationImage.configDigest =
        value.pairs[0].stacks.baseline.migrationImage.configDigest;
    }],
    ["application image binding forgery", (value) => {
      value.pairs[0].stacks.baseline.applicationImage.referenceSha256 = "1".repeat(64);
    }],
    ["migration image binding forgery", (value) => {
      value.pairs[0].stacks.baseline.migrationImage.referenceSha256 = "2".repeat(64);
    }],
    ["same revision", (value) => {
      value.pairs[0].stacks.candidate.applicationImage.revision =
        value.pairs[0].stacks.baseline.applicationImage.revision;
    }],
    ["fixture mismatch", (value) => {
      value.pairs[2].stacks.candidate.fixtureContract.sha256 = "9".repeat(64);
    }],
    ["environment mismatch", (value) => {
      value.pairs[1].stacks.baseline.runtimeBinding.syntheticRoleEnvironmentPolicySha256 =
        "8".repeat(64);
    }],
    ["input receipt mismatch", (value) => {
      value.pairs[0].stacks.baseline.inputReceipt.renderedComposeSha256 = "4".repeat(64);
    }],
    ["reset sequence", (value) => {
      value.pairs[1].stacks.candidate.reset.database.resetSequence = 2;
    }],
    ["cleanup mismatch", (value) => {
      value.pairs[2].stacks.baseline.cleanup.projectSha256 = "7".repeat(64);
    }],
    ["pair cleanup mismatch", (value) => {
      value.pairs[2].cleanup.stacks[0].generatedEnvironmentDirectorySha256 = "7".repeat(64);
    }],
    ["run scope reuse", (value) => {
      value.pairs[2].stacks.candidate.runScopeSha256 =
        value.pairs[2].stacks.baseline.runScopeSha256;
    }],
    ["image probe ownership reuse", (value) => {
      value.pairs[2].stacks.candidate.inputReceipt.imageProbeOwnershipContractSha256 =
        value.pairs[2].stacks.baseline.inputReceipt.imageProbeOwnershipContractSha256;
    }],
    ["one-shot lifecycle reuse", (value) => {
      value.pairs[2].stacks.candidate.runtimeAttestation.oneShotLifecycleContractSha256 =
        value.pairs[2].stacks.baseline.runtimeAttestation.oneShotLifecycleContractSha256;
    }],
    ["fixture execution reuse", (value) => {
      value.pairs[2].stacks.candidate.runtimeAttestation.fixtureExecutionContractSha256 =
        value.pairs[2].stacks.baseline.runtimeAttestation.fixtureExecutionContractSha256;
    }],
    ["Chromium process reuse", (value) => {
      value.pairs[2].stacks.candidate.browser.processScopeSha256 =
        value.pairs[2].stacks.baseline.browser.processScopeSha256;
    }],
    ["Chromium context reuse", (value) => {
      value.pairs[1].stacks.candidate.browser.contextScopeSha256 =
        value.pairs[1].stacks.baseline.browser.contextScopeSha256;
    }],
    ["browser project binding", (value) => {
      value.pairs[0].stacks.baseline.browser.projectBindingSha256 = "5".repeat(64);
    }],
    ["CONNECT behavior mismatch", (value) => {
      value.pairs[2].stacks.candidate.connectProxy.counters.accepted += 1;
      value.pairs[2].stacks.candidate.connectProxy.counters.upstreamAttempts += 1;
      value.pairs[2].stacks.candidate.connectProxy.counters.upstreamConnected += 1;
    }],
    ["six-stack cookie descriptor overflow", (value) => {
      for (const pair of value.pairs) {
        pair.stacks.baseline.phases.gap.cookieDescriptorCount = 33;
        pair.stacks.candidate.phases.gap.cookieDescriptorCount = 33;
      }
    }],
    ["six-stack event source overflow", (value) => {
      for (const pair of value.pairs) {
        pair.stacks.baseline.browser.eventSeal.sourceCounts.network = 16_385;
        pair.stacks.candidate.browser.eventSeal.sourceCounts.network = 16_385;
      }
    }],
    ["pair overlap ledger", (value) => {
      value.pairs[1].execution.events[0].globalOrdinal -= 1;
    }],
    ["sparse pair execution ledger", (value) => {
      value.pairs[0].execution.events = new Array(8) as never;
    }],
    ["sparse pair cleanup ledger", (value) => {
      value.pairs[0].cleanup.stacks = new Array(2) as never;
    }],
    ["peak live stacks", (value) => {
      value.pairs[0].execution.peakLiveStackCount = 3;
    }],
    ["proof HMAC scope mismatch", (value) => {
      value.pairs[2].stacks.candidate.proofHmacScopeSha256 = "6".repeat(64);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const nearMiss = structuredClone(exact);
    mutate(nearMiss);
    expect(() => assertChatwootPhaseProof(nearMiss), label).toThrow();
  }
});

test("replays full serialized static order and graph evidence after symmetric rehashes", () => {
  const roleSpecific = pairReports();
  const baselineStatic = roleSpecific[0].stacks.baseline.browser.staticProvenance.initial
    .staticRequestLedger as ReadonlyArray<{ pathSha256: string }>;
  const candidateStatic = roleSpecific[0].stacks.candidate.browser.staticProvenance.initial
    .staticRequestLedger as ReadonlyArray<{ pathSha256: string }>;
  expect(
    baselineStatic.map(({ pathSha256 }) => pathSha256),
  ).not.toEqual(
    candidateStatic.map(({ pathSha256 }) => pathSha256),
  );
  expect(() => createChatwootPhaseProof(roleSpecific)).not.toThrow();

  const wrongDocument = structuredClone(pairReports()) as unknown as DeepMutable<
    ReturnType<typeof pairReports>
  >;
  for (const pair of wrongDocument) {
    for (const role of ["baseline", "candidate"] as const) {
      const staticProvenance = pair.stacks[role].browser.staticProvenance as unknown as
        MutableStaticProvenanceEvidence;
      staticProvenance.initial.staticRequestLedger[0].documentKey = "app-cabinet-document";
      staticProvenance.recreated.staticRequestLedger[0].documentKey = "app-cabinet-document";
      for (const generation of [staticProvenance.initial, staticProvenance.recreated]) {
        generation.staticRequestContractSha256 = sha256(JSON.stringify(
          generation.staticRequestLedger,
        ));
      }
    }
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(wrongDocument))
    .toThrow(/active document generation|document chunk closure/);

  const wrongCssClosure = structuredClone(pairReports()) as unknown as DeepMutable<
    ReturnType<typeof pairReports>
  >;
  for (const pair of wrongCssClosure) {
    for (const role of ["baseline", "candidate"] as const) {
      const staticProvenance = pair.stacks[role].browser.staticProvenance as unknown as
        MutableStaticProvenanceEvidence;
      const target = staticProvenance.initial.staticLoadGraph.inventoryLedger.find(
        ({ extension }) => extension === "ttf",
      )?.pathSha256;
      if (!target) throw new Error("Static test fixture TTF path is absent.");
      staticProvenance.initial.staticLoadGraph.cssMediaReferenceLedger[0].targetPathSha256 = target;
      staticProvenance.recreated.staticLoadGraph.cssMediaReferenceLedger[0].targetPathSha256 = target;
      staticProvenance.initial.staticLoadGraphContractSha256 = sha256(JSON.stringify(
        staticProvenance.initial.staticLoadGraph,
      ));
      staticProvenance.recreated.staticLoadGraph.referenceStaticLoadGraphContractSha256 =
        staticProvenance.initial.staticLoadGraphContractSha256;
      staticProvenance.recreated.staticLoadGraphContractSha256 = sha256(JSON.stringify(
        staticProvenance.recreated.staticLoadGraph,
      ));
    }
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(wrongCssClosure))
    .toThrow(/CSS fallback extension closure/);

  const wrongPerDocumentDeclaration = structuredClone(pairReports()) as unknown as DeepMutable<
    ReturnType<typeof pairReports>
  >;
  for (const pair of wrongPerDocumentDeclaration) {
    for (const role of ["baseline", "candidate"] as const) {
      const generation = pair.stacks[role].browser.staticProvenance.recreated as unknown as
        MutableStaticGenerationEvidence;
      generation.responseDeclarationLedger[0].pathSha256s[0] = sha256(
        `${role}:forged-login-response-declaration`,
      );
      generation.responseDeclarationLedger[0].pathSha256s.sort();
      generation.responseDeclarationContractSha256 = sha256(JSON.stringify(
        generation.responseDeclarationLedger,
      ));
    }
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(wrongPerDocumentDeclaration))
    .toThrow(/response declaration union|per-document response declaration closure/);

  const swappedDocumentPartitions = structuredClone(pairReports()) as unknown as DeepMutable<
    ReturnType<typeof pairReports>
  >;
  for (const pair of swappedDocumentPartitions) {
    for (const role of ["baseline", "candidate"] as const) {
      const staticProvenance = pair.stacks[role].browser.staticProvenance as unknown as
        MutableStaticProvenanceEvidence;
      for (const generation of [staticProvenance.initial, staticProvenance.recreated]) {
        const loginLoad = generation.staticLoadGraph.documentLoadLedger.find(({ documentKey }) => (
          documentKey === "app-login-document"
        ));
        const cabinetLoad = generation.staticLoadGraph.documentLoadLedger.find(({ documentKey }) => (
          documentKey === "app-cabinet-document"
        ));
        const loginDeclaration = generation.responseDeclarationLedger.find(({ documentKey }) => (
          documentKey === "app-login-document"
        ));
        const cabinetDeclaration = generation.responseDeclarationLedger.find(({ documentKey }) => (
          documentKey === "app-cabinet-document"
        ));
        const loginOnly = loginLoad?.routeDeclaredPathSha256s.find((digest) => (
          !cabinetLoad?.routeDeclaredPathSha256s.includes(digest)
        ));
        const cabinetOnly = cabinetLoad?.routeDeclaredPathSha256s.find((digest) => (
          !loginLoad?.routeDeclaredPathSha256s.includes(digest)
        ));
        if (!loginDeclaration || !cabinetDeclaration || !loginOnly || !cabinetOnly) {
          throw new Error("Role-specific route declaration fixture is incomplete.");
        }
        loginDeclaration.pathSha256s[
          loginDeclaration.pathSha256s.indexOf(loginOnly)
        ] = cabinetOnly;
        cabinetDeclaration.pathSha256s[
          cabinetDeclaration.pathSha256s.indexOf(cabinetOnly)
        ] = loginOnly;
        loginDeclaration.pathSha256s.sort();
        cabinetDeclaration.pathSha256s.sort();
        generation.responseDeclarationContractSha256 = sha256(JSON.stringify(
          generation.responseDeclarationLedger,
        ));
      }
    }
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(swappedDocumentPartitions))
    .toThrow(/response-declared chunk partition/);
});

test("requires distinct baseline and candidate static attestation receipts", () => {
  const reusedAttestation = structuredClone(pairReports()) as unknown as DeepMutable<
    ReturnType<typeof pairReports>
  >;
  for (const pair of reusedAttestation) {
    const digest = pair.stacks.baseline.runtimeBinding.staticAssetAttestationSha256;
    const candidate = pair.stacks.candidate;
    candidate.runtimeBinding.staticAssetAttestationSha256 = digest;
    const provenance = candidate.browser.staticProvenance as unknown as
      MutableStaticProvenanceEvidence;
    provenance.assetAttestationSha256 = digest;
    provenance.initial.staticLoadGraph.assetAttestationSha256 = digest;
    provenance.initial.staticLoadGraphContractSha256 = sha256(JSON.stringify(
      provenance.initial.staticLoadGraph,
    ));
    provenance.recreated.staticLoadGraph.assetAttestationSha256 = digest;
    provenance.recreated.staticLoadGraph.referenceStaticLoadGraphContractSha256 =
      provenance.initial.staticLoadGraphContractSha256;
    provenance.recreated.staticLoadGraphContractSha256 = sha256(JSON.stringify(
      provenance.recreated.staticLoadGraph,
    ));
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(reusedAttestation)).toThrow(
    /static asset attestations must be distinct/,
  );
});

test("rejects symmetric application and migration image identity conflation", () => {
  const conflated = structuredClone(pairReports()) as unknown as DeepMutable<
    ReturnType<typeof pairReports>
  >;
  for (const pair of conflated) {
    for (const role of ["baseline", "candidate"] as const) {
      const stack = pair.stacks[role];
      stack.migrationImage.assetImageDigest = stack.applicationImage.assetImageDigest;
      stack.migrationImage.configDigest = stack.applicationImage.configDigest;
      stack.migrationImage.referenceSha256 = stack.applicationImage.referenceSha256;
      stack.migrationImage.runtimeImageDigest = stack.applicationImage.runtimeImageDigest;
      stack.migrationImage.revision = stack.applicationImage.revision;
      stack.migrationImage.bindingContractSha256 = sha256(JSON.stringify({
        assetImageDigest: stack.migrationImage.assetImageDigest,
        configDigest: stack.migrationImage.configDigest,
        referenceSha256: stack.migrationImage.referenceSha256,
        repoDigests: [stack.migrationImage.assetImageDigest],
        role: "migration",
      }));
      stack.inputReceipt.migrationImageBindingContractSha256 =
        stack.migrationImage.bindingContractSha256;
      stack.inputReceipt.migrationImageConfigDigest = stack.migrationImage.configDigest;
      stack.runtimeAttestation.migrationImageBindingContractSha256 =
        stack.migrationImage.bindingContractSha256;
      stack.runtimeAttestation.migrationRuntimeImageDigest = stack.migrationImage.configDigest;
      stack.runtimeBinding.migrationAssetImageDigest = stack.migrationImage.assetImageDigest;
      stack.runtimeBinding.migrationImageBindingContractSha256 =
        stack.migrationImage.bindingContractSha256;
      stack.runtimeBinding.ownedInputReceiptSha256 = sha256(JSON.stringify(stack.inputReceipt));
    }
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup) as never;
  }
  expect(() => createChatwootPhaseProof(conflated)).toThrow(
    /application and migration image identities are conflated/,
  );
});

test("rejects recomputed containerd application and migration identity overlap", () => {
  const collisions: Array<[
    string,
    (stack: ContainerdStackReport) => void,
  ]> = [
    ["migration root aliases application config", (stack) => {
      stack.migrationImage.assetImageDigest = stack.applicationImage.configDigest;
      stack.migrationImage.runtimeImageDigest = stack.applicationImage.configDigest;
    }],
    ["migration root aliases application manifest", (stack) => {
      stack.migrationImage.assetImageDigest = stack.applicationImage.manifestDigest;
      stack.migrationImage.runtimeImageDigest = stack.applicationImage.manifestDigest;
    }],
    ["migration manifest aliases application root", (stack) => {
      stack.migrationImage.manifestDigest = stack.applicationImage.assetImageDigest;
    }],
    ["migration manifest aliases application config", (stack) => {
      stack.migrationImage.manifestDigest = stack.applicationImage.configDigest;
    }],
    ["migration manifest aliases application manifest", (stack) => {
      stack.migrationImage.manifestDigest = stack.applicationImage.manifestDigest;
    }],
  ];
  for (const [label, collide] of collisions) {
    const overlapped = containerdPairReports();
    const pair = overlapped[0];
    const stack = pair.stacks.baseline;
    collide(stack);
    rebindContainerdMigrationImage(stack);
    pair.execution = executionEvidence(pair.pairIndex, pair.stacks, pair.cleanup);
    expect(() => createChatwootPhaseProof(overlapped), label).toThrow(
      /application and migration containerd image identities overlap/,
    );
  }
});

test("accepts only the exact three-pair external input envelope", () => {
  const exact = inputDocument();
  expect(assertChatwootPhaseInput(exact)).toEqual(exact);
  const mutations: Array<[string, (value: typeof exact) => void]> = [
    ["pair removed", (value) => { value.pairs.pop(); }],
    ["pair reordered", (value) => { value.pairs[0].pairIndex = 2; }],
    ["duplicate contract", (value) => {
      value.pairs[2].candidate.contractPath = value.pairs[1].candidate.contractPath;
    }],
    ["same-pair asset attestation", (value) => {
      value.pairs[0].candidate.assetAttestationPath = value.pairs[0].baseline.assetAttestationPath;
    }],
    ["duplicate control", (value) => {
      value.pairs[1].baseline.controlUrl = value.pairs[0].baseline.controlUrl;
    }],
    ["duplicate resolver", (value) => {
      value.pairs[1].candidate.resolverIp = value.pairs[0].candidate.resolverIp;
    }],
    ["same pair image", (value) => {
      value.pairs[0].candidate.imageDigest = value.pairs[0].baseline.imageDigest;
    }],
    ["same pair migration image", (value) => {
      value.pairs[0].candidate.migrationImageDigest =
        value.pairs[0].baseline.migrationImageDigest;
    }],
    ["application aliases migration image", (value) => {
      value.pairs[0].baseline.migrationImageDigest = value.pairs[0].baseline.imageDigest;
    }],
    ["baseline image differs across pairs", (value) => {
      value.pairs[2].baseline.imageDigest = `sha256:${"9".repeat(64)}`;
    }],
    ["migration image differs across pairs", (value) => {
      value.pairs[1].candidate.migrationImageDigest = `sha256:${"8".repeat(64)}`;
    }],
    ["extra credential", (value) => {
      (value.pairs[0].baseline as unknown as Record<string, unknown>).credential = "forbidden";
    }],
    ["non-loopback control", (value) => {
      value.pairs[0].baseline.controlUrl = "http://localhost:15100/";
    }],
  ];
  for (const [label, mutate] of mutations) {
    const nearMiss = structuredClone(exact);
    mutate(nearMiss);
    expect(() => assertChatwootPhaseInput(nearMiss), label).toThrow();
  }
});

test("resolves six exact non-aliased contract and environment paths before mutation", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-input-"));
  try {
    const input = inputDocument(temporaryParent);
    for (const pair of input.pairs) {
      for (const role of ["baseline", "candidate"] as const) {
        await mkdir(pair[role].generatedEnvironmentPath, { recursive: false });
        await writeFile(pair[role].contractPath, "{}", { flag: "wx" });
        await writeFile(pair[role].assetAttestationPath, "{}", { flag: "wx" });
      }
    }
    const resolved = await resolveChatwootPhaseInputPaths(input);
    expect(resolved).toHaveLength(6);
    expect(new Set(resolved.map((entry) => entry.contractRealpathSha256)).size).toBe(6);
    expect(new Set(
      resolved.map((entry) => entry.generatedEnvironmentDirectorySha256),
    ).size).toBe(6);
    expect(resolved.every((entry) => /^[a-f0-9]{64}$/.test(
      entry.assetAttestationRealpathSha256,
    ))).toBe(true);

    const alias = structuredClone(input);
    alias.pairs[2].candidate.contractPath = alias.pairs[2].baseline.contractPath;
    await expect(resolveChatwootPhaseInputPaths(alias)).rejects.toThrow();

    await rm(input.pairs[2].candidate.assetAttestationPath);
    await link(
      input.pairs[2].baseline.assetAttestationPath,
      input.pairs[2].candidate.assetAttestationPath,
    );
    await expect(resolveChatwootPhaseInputPaths(input)).rejects.toThrow(/asset identities/);
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("rejects an evidence output nested in any immutable external environment", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-output-"));
  try {
    const environments = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const directory = path.join(temporaryParent, `environment-${index + 1}`);
      await mkdir(directory);
      return directory;
    }));
    const exactOutput = path.join(temporaryParent, "evidence");
    await expect(assertChatwootOutputDirectoryDisjointForTest(
      exactOutput,
      environments,
      process.cwd(),
    )).resolves.toBe(exactOutput);
    await expect(assertChatwootOutputDirectoryDisjointForTest(
      path.join(environments[2], "evidence"),
      environments,
      process.cwd(),
    )).rejects.toThrow(/overlaps an immutable input environment/);
    await expect(assertChatwootOutputDirectoryDisjointForTest(
      path.join(process.cwd(), ".chatwoot-evidence-must-not-be-created"),
      environments,
      process.cwd(),
    )).rejects.toThrow(/outside the repository/);

    const regularFileParent = path.join(temporaryParent, "regular-file-parent");
    await writeFile(regularFileParent, "not a directory", { flag: "wx" });
    await expect(assertChatwootOutputDirectoryDisjointForTest(
      path.join(regularFileParent, "evidence"),
      environments,
      process.cwd(),
    )).rejects.toThrow(/path identity is invalid/);

    const receipt = await preflightChatwootOutputDirectoryForTest(
      exactOutput,
      environments,
      process.cwd(),
    );
    await expect(recheckChatwootOutputDirectoryForTest(receipt))
      .resolves.toBe(exactOutput);
    await mkdir(exactOutput);
    await expect(recheckChatwootOutputDirectoryForTest(receipt))
      .rejects.toThrow(/appeared after its pre-start validation/);
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("reads the external launch plan through one exact immutable FileHandle identity", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-plan-"));
  try {
    const planPath = path.join(temporaryParent, "plan.json");
    const original = Buffer.from("{\"value\":1}\n", "utf8");
    const changed = Buffer.from("{\"value\":2}\n", "utf8");
    await writeFile(planPath, original, { flag: "wx", mode: 0o600 });
    expect(await readExactChatwootExternalPlan(planPath, process.cwd(), 1024))
      .toEqual(original);
    await expect(readExactChatwootExternalPlanForTest(
      planPath,
      process.cwd(),
      1024,
      {
        afterOpen: async () => {
          const before = await stat(planPath);
          await writeFile(planPath, changed);
          await utimes(planPath, before.atime, before.mtime);
        },
      },
    )).rejects.toThrow(/changed during its exact FileHandle read/);
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("binds exact role/pair journey contracts and pristine deterministic resets", () => {
  const contract = journeyContract("baseline", 1);
  expect(assertChatwootJourneyContract(contract, "baseline", 1)).toEqual(contract);
  const adjacent = structuredClone(contract) as typeof contract & { token?: string };
  adjacent.token = "forbidden";
  expect(() => assertChatwootJourneyContract(adjacent, "baseline", 1)).toThrow();
  const wrongPair = structuredClone(contract);
  wrongPair.project = wrongPair.project.replace("-p1-", "-p2-");
  expect(() => assertChatwootJourneyContract(wrongPair, "baseline", 1)).toThrow();

  const reset = resetEvidence(contract.project);
  expect(assertChatwootDeterministicReset(reset, contract.project, "baseline pair 1"))
    .toMatchObject({
      scenarioSha256: sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
      seedSha256: sha256(`clean-pay-browser-journey-v1:${CHATWOOT_PHASE_PROOF_SCENARIO}`),
      database: { resetSequence: 1, sequenceCount: 0 },
    });
  for (const [label, mutate] of [
    ["scenario", (value: ReturnType<typeof resetEvidence>) => {
      value.scenario_sha256 = "1".repeat(64);
    }],
    ["non-pristine ledger", (value: ReturnType<typeof resetEvidence>) => {
      value.state.ledger = 1;
    }],
    ["armed injection", (value: ReturnType<typeof resetEvidence>) => {
      value.state.payment_disconnect_injection_armed = true;
    }],
    ["wrong scope", (value: ReturnType<typeof resetEvidence>) => {
      value.database.scopeSha256 = "2".repeat(64);
    }],
    ["reset replay", (value: ReturnType<typeof resetEvidence>) => {
      value.database.resetSequence = 2;
    }],
  ] as const) {
    const nearMiss = resetEvidence(contract.project);
    mutate(nearMiss);
    expect(() => assertChatwootDeterministicReset(nearMiss, contract.project, label), label)
      .toThrow();
  }
});

test("keeps all six Chatwoot Compose projects inside the production environment contract", () => {
  for (let pairIndex = 1; pairIndex <= CHATWOOT_PHASE_PROOF_PAIR_COUNT; pairIndex += 1) {
    for (const role of ["baseline", "candidate"] as const) {
      const contract = journeyContract(role, pairIndex);
      expect(contract.project.length).toBeLessThanOrEqual(63);
      expect(assertChatwootJourneyContract(contract, role, pairIndex)).toEqual(contract);
      const generated = buildJourneySyntheticEnvironment({
        appImage: contract.images.application,
        appPort: String(14_100 + pairIndex),
        connectProxyPort: String(16_100 + pairIndex),
        directory: path.join(tmpdir(), "clean-pay-chatwoot-project-contract", contract.project),
        migrationImage: contract.images.migration,
        project: contract.project,
        providerPort: String(15_100 + pairIndex),
        proxyBind: `127.0.0.${20 + pairIndex}`,
        revision: contract.revision,
        turnstileSiteKey: "0x4AAAAABrowserJourneyOnly8Wp4Jz7Lc2",
      });
      expect(generated.environment.COMPOSE_PROJECT_NAME).toBe(contract.project);
    }
  }

  expect(() => createChatwootPhaseComposeProjectName("baseline", 1, "a".repeat(11)))
    .toThrow(/project identity is invalid/);
});

test("seals complete ordered evidence with one in-memory HMAC scope", () => {
  const sealer = createChatwootPhaseEvidenceSealer();
  const exact = orderedEvidence("stable", 8, 1, 2, 1);
  const first = sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: exact,
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  });
  const second = sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: structuredClone(exact),
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  });
  expect(second).toEqual(first);
  const changedCookieMetadata = cookieFixture("stable", "same-scope");
  changedCookieMetadata[0].path = "/changed";
  const changedCookieSeal = sealer.sealPhase({
    cookies: changedCookieMetadata,
    phase: "stable",
    orderedEvidence: structuredClone(exact),
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  });
  expect(changedCookieSeal.hashes.cookieJarHmacSha256)
    .not.toBe(first.hashes.cookieJarHmacSha256);
  expect(changedCookieSeal.hashes.cookieDescriptorHmacSha256)
    .not.toBe(first.hashes.cookieDescriptorHmacSha256);
  const changedCookieValue = cookieFixture("stable", "same-scope");
  changedCookieValue[0].value = "same-length-opaque-cookie-b";
  const changedValueSeal = sealer.sealPhase({
    cookies: changedCookieValue,
    phase: "stable",
    orderedEvidence: structuredClone(exact),
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  });
  expect(changedValueSeal.hashes.cookieJarHmacSha256)
    .not.toBe(first.hashes.cookieJarHmacSha256);
  expect(changedValueSeal.hashes.cookieDescriptorHmacSha256)
    .toBe(first.hashes.cookieDescriptorHmacSha256);
  expect(sealer).toEqual(expect.objectContaining({
    proofHmacScopeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
  expect(Object.keys(sealer)).not.toContain("key");
  const clearedFixture = sealer.sealClearedFixtureStorage({
    beforeValue: "opaque-turnstile-ledger",
    afterValue: "opaque-turnstile-ledger",
  });
  expect(clearedFixture).toEqual({
    preservedFixtureStorageByteExact: true,
    preservedFixtureStorageByteLength: Buffer.byteLength("opaque-turnstile-ledger"),
    preservedFixtureStorageHmacSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const maximumFixtureStorage = "x".repeat(64 * 1024);
  expect(sealer.sealClearedFixtureStorage({
    beforeValue: maximumFixtureStorage,
    afterValue: maximumFixtureStorage,
  }).preservedFixtureStorageByteLength).toBe(64 * 1024);
  expect(() => sealer.sealClearedFixtureStorage({
    beforeValue: "opaque-turnstile-ledger",
    afterValue: "changed-turnstile-ledger",
  })).toThrow(/changed the preserved fixture storage bytes/);
  const oversizedFixtureStorage = "x".repeat((64 * 1024) + 1);
  expect(() => sealer.sealClearedFixtureStorage({
    beforeValue: oversizedFixtureStorage,
    afterValue: oversizedFixtureStorage,
  })).toThrow(/fixture storage value is outside its byte bound/);

  const swapped = structuredClone(exact);
  [swapped.boundaryCalls[0], swapped.boundaryCalls[1]] = [
    swapped.boundaryCalls[1],
    swapped.boundaryCalls[0],
  ];
  const swappedSeal = sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: swapped,
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  });
  expect(swappedSeal.hashes.boundaryCallsHmacSha256)
    .not.toBe(first.hashes.boundaryCallsHmacSha256);
  expect(swappedSeal.evidenceRanges.boundaryCalls.firstHmacSha256)
    .not.toBe(first.evidenceRanges.boundaryCalls.firstHmacSha256);

  const dropped = structuredClone(exact);
  dropped.providerLedger.pop();
  const droppedSeal = sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: dropped,
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  });
  expect(droppedSeal.evidenceCounts.providerLedger)
    .toBe(first.evidenceCounts.providerLedger - 1);
  expect(droppedSeal.hashes.providerLedgerHmacSha256)
    .not.toBe(first.hashes.providerLedgerHmacSha256);

  const empty = structuredClone(exact);
  empty.serverActions = [];
  expect(() => sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: empty,
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/empty or outside/);

  expect(() => sealer.sealPhase({
    cookies: Array.from({ length: 33 }, (_, index) => (
      cookieFixture("gap", `scope-${index}`)[0]
    )),
    phase: "stable",
    orderedEvidence: structuredClone(exact),
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/cookie jar.*outside/);
  const unsafeCookie = cookieFixture("stable", "unsafe-cookie");
  unsafeCookie[0].name = "unsafe;name";
  expect(() => sealer.sealPhase({
    cookies: unsafeCookie,
    phase: "stable",
    orderedEvidence: structuredClone(exact),
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/cookie descriptor.*scope/);
  const sparseCookies = cookieFixture("stable", "sparse-cookie");
  delete sparseCookies[0];
  expect(() => sealer.sealPhase({
    cookies: sparseCookies,
    phase: "stable",
    orderedEvidence: structuredClone(exact),
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/cookie jar is empty or outside/);
  const wrongCookieType = cookieFixture("stable", "wrong-cookie-type") as Array<unknown>;
  wrongCookieType[0] = null;
  expect(() => sealer.sealPhase({
    cookies: wrongCookieType as never,
    phase: "stable",
    orderedEvidence: structuredClone(exact),
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/cookie descriptor 0/);
  const tooManyBoundaryEntries = structuredClone(exact);
  tooManyBoundaryEntries.boundaryCalls = Array.from({ length: 1_001 }, () => "bounded");
  expect(() => sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: tooManyBoundaryEntries,
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/boundaryCalls.*outside/);
  const tooManyDomBytes = structuredClone(exact);
  tooManyDomBytes.dom = Array.from({ length: 9 }, () => "x".repeat(1024 * 1024));
  expect(() => sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: tooManyDomBytes,
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/aggregate byte bound/);
  const sparseOrderedEvidence = structuredClone(exact);
  delete sparseOrderedEvidence.dom[0];
  expect(() => sealer.sealPhase({
    cookies: cookieFixture("stable", "same-scope"),
    phase: "stable",
    orderedEvidence: sparseOrderedEvidence,
    conversationValue: "opaque-conversation-a",
    userCookieValue: "opaque-user-a",
  })).toThrow(/dom evidence is empty or outside/);
});

test("uses only the exact journey-v5 referential projection before ordered HMAC evidence", () => {
  const baselineDynamic = "1".repeat(64);
  const candidateDynamic = "2".repeat(64);
  const baseline = canonicalChatwootPhaseEvidence(
    canonicalEvidenceInput(baselineDynamic),
  );
  const candidate = canonicalChatwootPhaseEvidence(
    canonicalEvidenceInput(candidateDynamic),
  );
  expect(candidate).toEqual(baseline);
  expect(JSON.stringify(baseline)).not.toContain(baselineDynamic);
  expect(JSON.stringify(candidate)).not.toContain(candidateDynamic);

  const reorderedInput = canonicalEvidenceInput(candidateDynamic);
  reorderedInput.providerEffects.entries.reverse();
  const reordered = canonicalChatwootPhaseEvidence(reorderedInput);
  expect(reordered.providerLedger).not.toEqual(candidate.providerLedger);
  expect(reordered.providerEffects).not.toEqual(candidate.providerEffects);

  const changedBrowserSemantics = canonicalEvidenceInput(candidateDynamic);
  (changedBrowserSemantics.browserRequests[0] as Record<string, unknown>)
    .responseStatus = 500;
  expect(canonicalChatwootPhaseEvidence(changedBrowserSemantics).requestSequence)
    .not.toEqual(candidate.requestSequence);

  const missingAction = canonicalEvidenceInput(candidateDynamic);
  missingAction.network.serverActions = [];
  missingAction.network.serverActionCount = 0;
  expect(() => canonicalChatwootPhaseEvidence(missingAction)).toThrow(/network is incomplete/);

  const sparseTopLevel = canonicalEvidenceInput(candidateDynamic);
  delete sparseTopLevel.browserRequests[0];
  expect(() => canonicalChatwootPhaseEvidence(sparseTopLevel))
    .toThrow(/strict browser requests must be a dense own-index array/);

  const sparseNestedDom = canonicalEvidenceInput(candidateDynamic);
  sparseNestedDom.dom.children = new Array(1) as never;
  expect(() => canonicalChatwootPhaseEvidence(sparseNestedDom))
    .toThrow(/nested canonical evidence must be a dense own-index array/);

  const sparseNestedStorage = canonicalEvidenceInput(candidateDynamic);
  sparseNestedStorage.storage.local = new Array(1) as never;
  expect(() => canonicalChatwootPhaseEvidence(sparseNestedStorage))
    .toThrow(/nested canonical evidence must be a dense own-index array/);
});

test("uses only the proof-owned pair launcher and keeps pairs sequential", async () => {
  const source = await readFile(
    path.join(process.cwd(), "tests/browser/journeys/chatwoot-phase-proof-orchestrator.mjs"),
    "utf8",
  );
  expect(source).toContain("withJourneyOwnedStackPair({");
  expect(source).toContain("for (const pair of launchPlan)");
  expect(source).toContain("assertPairCleanupReceipt(proofSession.cleanup, pair)");
  expect(source).toContain("loadCompleteLaunchPlan({");
  expect(source).toContain("settleOwnedRoleOperations(");
  expect(source).toContain("await Promise.allSettled(roles.map(operation))");
  expect(source).not.toMatch(/driver|startStack|preflightStack|cleanupStack/);
  expect(source.indexOf("loadCompleteLaunchPlan({")).toBeLessThan(
    source.indexOf("prepareChatwootPhaseEvidenceDirectory({"),
  );
  expect(source.indexOf("await executeOwnedPair({")).toBeLessThan(
    source.indexOf("pairs.push(pairResult.report)"),
  );
});

test("executes the committed owned-stack API and exact Chatwoot callback adapter", async () => {
  let dockerCalls = 0;
  const contract = journeyContract("baseline", 1);
  const aliased = {
    contract,
    contractPath: "C:/synthetic/chatwoot-contract.json",
    expectedApplicationAssetImageDigest: `sha256:${"1".repeat(64)}`,
    expectedApplicationImageConfigDigest: `sha256:${"5".repeat(64)}`,
    expectedApplicationManifestDigest: `sha256:${"9".repeat(64)}`,
    expectedApplicationRepoDigests: [
      `sha256:${"1".repeat(64)}`,
      `sha256:${"9".repeat(64)}`,
    ],
    expectedMigrationAssetImageDigest: `sha256:${"3".repeat(64)}`,
    repositoryRoot: process.cwd(),
    runDocker: async () => {
      dockerCalls += 1;
      return "";
    },
  };
  await expect(withJourneyOwnedStackPair({
    baseline: aliased,
    candidate: { ...aliased },
  }, async () => undefined)).rejects.toThrow(/not isolated/);
  expect(dockerCalls).toBe(0);

  const report = stackReport("baseline", 1, createChatwootPhaseEvidenceSealer());
  const inputReceipt = {
    ...report.inputReceipt,
    projectSha256: sha256(contract.project),
  };
  const stack = {
    assetFileSha256: sha256("baseline asset file"),
    contract,
    journeyContractSha256: sha256("baseline journey contract"),
    migrationImageDigest: report.migrationImage.assetImageDigest,
    resolverIp: "127.0.0.20",
    role: "baseline",
    staticAssetContract: createChatwootPhaseStaticAssetContract(
      staticAssetAttestation("baseline"),
    ),
  };
  const owned = {
    inputReceipt,
    runtime: report.runtimeAttestation,
    status: "verifier-owned-runtime-attested",
  };
  expect(bindChatwootOwnedRuntimeForTest(stack, owned)).toMatchObject({
    inputReceipt,
    runtimeAttestation: report.runtimeAttestation,
    runtimeBinding: {
      ownedInputReceiptSha256: sha256(JSON.stringify(inputReceipt)),
      projectSha256: sha256(contract.project),
      status: "verifier-owned-runtime-bound",
    },
  });
  expect(() => bindChatwootOwnedRuntimeForTest(stack, {
    ...owned,
    inputReceipt: { ...inputReceipt, adjacent: sha256("adjacent") },
  })).toThrow(/owned input receipt has unexpected fields/);

  const containerdReport = containerdPairReports()[0].stacks.baseline;
  const containerdReceipt = {
    ...containerdReport.inputReceipt,
    projectSha256: sha256(contract.project),
  };
  const containerdStack = {
    ...stack,
    imageDigest: containerdReport.applicationImage.assetImageDigest,
    migrationImageDigest: containerdReport.migrationImage.assetImageDigest,
  };
  const containerdBound = bindChatwootOwnedRuntimeForTest(containerdStack, {
    inputReceipt: containerdReceipt,
    runtime: containerdReport.runtimeAttestation,
    status: "verifier-owned-runtime-attested",
  });
  expect(containerdBound).toMatchObject({
    inputReceipt: {
      imageSelectionMode: "containerd-root-manifest",
      applicationImageRuntimeDigest: containerdReport.applicationImage.assetImageDigest,
      migrationImageRuntimeDigest: containerdReport.migrationImage.assetImageDigest,
    },
    runtimeAttestation: {
      imageSelectionMode: "containerd-root-manifest",
      applicationManifestDigest: containerdReport.applicationImage.manifestDigest,
      migrationManifestDigest: containerdReport.migrationImage.manifestDigest,
    },
  });
  expect(containerdBound.inputReceipt).not.toHaveProperty("migrationImageConfigDigest");
});

test("binds every Chatwoot runtime and toolchain input into the global fixture manifest", () => {
  const required = [
    "../baseline-provenance.ts",
    "../csp-console-normalizer.ts",
    "../turnstile-stub.ts",
    "../../../package.json",
    "../../../scripts/security/prove-served-cabinet-assets.mjs",
    "../../../tsconfig.json",
    "CHATWOOT_PHASE_PROOF.md",
    "chatwoot-phase-browser-capture.ts",
    "chatwoot-phase-browser-contract.mjs",
    "chatwoot-phase-canonical-evidence.ts",
    "chatwoot-phase-causal-contract.mjs",
    "chatwoot-phase-event-ledger.mjs",
    "chatwoot-phase-evidence-sealer.mjs",
    "chatwoot-phase-evidence-writer.mjs",
    "chatwoot-phase-proof-contract.mjs",
    "chatwoot-phase-proof-orchestrator.mjs",
    "chatwoot-phase-proof.contract.spec.ts",
    "chatwoot-phase-proof.schema.json",
    "prove-chatwoot-phase-stability.mjs",
  ];
  expect(new Set(JOURNEY_FIXTURE_FILENAMES).size).toBe(JOURNEY_FIXTURE_FILENAMES.length);
  expect(JOURNEY_FIXTURE_FILENAMES.filter((entry) => required.includes(entry)))
    .toEqual(required);
});

test("rejects sparse owned-stack cleanup receipts before proof serialization", () => {
  const pair = {
    pairIndex: 1,
    baseline: { contract: { project: "clean-pay-chatwoot-baseline-pair-1" } },
    candidate: { contract: { project: "clean-pay-chatwoot-candidate-pair-1" } },
  };
  const cleanup = {
    status: "verifier-owned-stack-pair-cleaned",
    stacks: (["baseline", "candidate"] as const).map((role, index) => ({
      generatedEnvironmentDirectorySha256: String(index + 1).repeat(64),
      projectSha256: sha256(pair[role].contract.project),
      role,
      status: "verifier-owned-stack-cleaned",
    })),
  };
  expect(assertChatwootPairCleanupReceiptForTest(cleanup, pair)).toEqual(cleanup);

  const sparse = structuredClone(cleanup);
  delete sparse.stacks[0];
  expect(() => assertChatwootPairCleanupReceiptForTest(sparse, pair))
    .toThrow(/cleanup receipt is invalid/);
  expect(() => assertChatwootPairCleanupReceiptForTest({
    ...cleanup,
    stacks: { 0: cleanup.stacks[0], 1: cleanup.stacks[1], length: 2 },
  }, pair)).toThrow(/cleanup receipt is invalid/);
});

test("retains and validates partial CONNECT cleanup receipts before failing closed", async () => {
  const pair = {
    pairIndex: 1,
    baseline: {
      contract: journeyContract("baseline", 1),
      resolverIp: "127.0.0.20",
    },
    candidate: {
      contract: journeyContract("candidate", 1),
      resolverIp: "127.0.0.21",
    },
  };
  const stopped: string[] = [];
  const summary = (role: "baseline" | "candidate") => ({
    allowedHostCount: 4,
    authorityLedger: [
      "challenges.cloudflare.com:443",
      "chatwoot.browser.clean-pay.dev:443",
      "oauth.telegram.org:443",
      "pay.ci.clean-pay.dev:443",
    ],
    counters: {
      accepted: 4,
      rejected: 0,
      upstreamAttempts: 4,
      upstreamConnected: 4,
      upstreamFailures: 0,
    },
    listen: pair[role].contract.publications.connectProxy,
    outcome: "clean",
    status: "stopped",
    target: `${pair[role].resolverIp}:443`,
  });
  await expect(settleChatwootConnectProxyStartsForTest({
    pair,
    starts: [
      async () => ({ owner: "baseline" }),
      async () => { throw new Error("candidate start failed"); },
    ],
    stop: async (_handle: unknown, role: "baseline" | "candidate") => {
      stopped.push(role);
      return summary(role);
    },
  })).rejects.toThrow(/partial start failed closed/);
  expect(stopped).toEqual(["baseline"]);

  let cleanupAttempted = false;
  try {
    await settleChatwootConnectProxyStartsForTest({
      pair,
      starts: [
        async () => ({ owner: "baseline" }),
        async () => { throw new Error("candidate start failed"); },
      ],
      stop: async () => {
        cleanupAttempted = true;
        throw new Error("baseline cleanup failed");
      },
    });
    throw new Error("Expected partial CONNECT cleanup to fail closed.");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
  }
  expect(cleanupAttempted).toBe(true);
});

test("binds the causal route barrier and exact logout helper without fixture substitution", async () => {
  const source = await readFile(
    path.join(process.cwd(), "tests/browser/journeys/chatwoot-phase-browser-capture.ts"),
    "utf8",
  );
  expect(source).toContain("classification.key === \"chatwoot-widget-conversation-frame\"");
  expect(source).toMatch(/generation === "initial"\s+&& ledger\.currentDocumentKey === "app-cabinet-document"\s+&& classification\.key === "chatwoot-widget-frame"/);
  expect(source).toMatch(/generation === "initial"\s+&& ledger\.currentDocumentKey === "app-cabinet-document"\s+&& classification\.key === "chatwoot-widget-conversation-frame"/);
  expect(source).toContain("initialCabinetFreshWidgetCount < 1");
  expect(source).toContain("await input.barrier.hold(route)");
  expect(source).toContain("await waitForInitialProfileSupportContext(page)");
  expect(source).toContain('await completeTelegramNavigation(page, telegram, "/profile")');
  expect(source).toContain('await completeTelegramNavigation(page, telegram, redirectPath)');
  expect(source).toContain('pending.phase === "ownership_confirmed"');
  expect(source).toContain("removedLabels.has(\"payment_problem\")");
  expect(source).toContain("removedLabels.has(\"subscription_expired\")");
  expect(source).toContain('paymentContextStatus === "stale"');
  expect(source).toContain("paymentLabelCalls.length === 0");
  expect(source).toContain("await clearSyntheticLogoutState(page)");
  expect(source).toContain("await recreatedCausality.sealPreClearGeneration(page)");
  expect(source).toContain("createChatwootPhaseCausalContract(MAXIMUM_EVENTS)");
  expect(source).toContain("await recreatedCausality.waitForCabinetIdentityConfirmed()");
  expect(source).toContain("input.eventLedger.assertStable(checkpoint)");
  expect(source).toContain("await eventLedger.drainAndSeal(() => requestLifecycle.isIdle()");
  expect(source).toContain("assertChatwootAtomicPhaseRead({");
  expect(source.match(/if \(window !== window\.top\) return;/g)).toHaveLength(2);
  expect(source.indexOf("await recreatedCausality.sealPreClearGeneration(page)")).toBeLessThan(
    source.indexOf("await clearSyntheticLogoutState(page)"),
  );
  expect(source.indexOf("await waitForInitialProfileSupportContext(page)")).toBeLessThan(
    source.indexOf("await history.captureInitialProfile(page)"),
  );
  expect(source.indexOf("await clearSyntheticLogoutState(page)")).toBeLessThan(
    source.indexOf("await recreatedCausality.markPostClear(page)"),
  );
  expect(source).not.toMatch(/postMessage\s*\(|route\.fulfill|toHaveScreenshot|threshold|mask:/);
});

test("binds the replacement barrier to the committed cabinet owner document", () => {
  const common = {
    barrierConsumed: false,
    currentDocumentKey: "app-cabinet-document" as const,
    generation: "initial" as const,
    initialCabinetFreshWidgetCount: 0,
    isNavigationRequest: true,
    ownerIsMainFrame: true,
  };
  expect(advanceInitialCabinetBarrierForTest({
    ...common,
    classificationKey: "chatwoot-widget-frame",
    ownerUrl: `${SYNTHETIC_APPLICATION_ORIGIN}/login`,
  })).toEqual({
    action: "continue",
    initialCabinetFreshWidgetCount: 0,
  });
  const lateProfileWidget = advanceInitialCabinetBarrierForTest({
    ...common,
    classificationKey: "chatwoot-widget-frame",
    ownerUrl: `${SYNTHETIC_APPLICATION_ORIGIN}/profile`,
  });
  expect(lateProfileWidget).toEqual({
    action: "continue",
    initialCabinetFreshWidgetCount: 0,
  });
  const lateProfileConversation = advanceInitialCabinetBarrierForTest({
    ...common,
    classificationKey: "chatwoot-widget-conversation-frame",
    initialCabinetFreshWidgetCount: lateProfileWidget.initialCabinetFreshWidgetCount,
    ownerUrl: `${SYNTHETIC_APPLICATION_ORIGIN}/profile`,
  });
  expect(lateProfileConversation).toEqual({
    action: "continue",
    initialCabinetFreshWidgetCount: 0,
  });
  expect(advanceInitialCabinetBarrierForTest({
    ...common,
    classificationKey: "chatwoot-widget-frame",
    ownerIsMainFrame: false,
    ownerUrl: `${SYNTHETIC_APPLICATION_ORIGIN}/cabinet`,
  })).toEqual({
    action: "continue",
    initialCabinetFreshWidgetCount: 0,
  });
  const cabinetWidget = advanceInitialCabinetBarrierForTest({
    ...common,
    classificationKey: "chatwoot-widget-frame",
    ownerUrl: `${SYNTHETIC_APPLICATION_ORIGIN}/cabinet`,
  });
  expect(cabinetWidget).toEqual({
    action: "continue",
    initialCabinetFreshWidgetCount: 1,
  });
  expect(advanceInitialCabinetBarrierForTest({
    ...common,
    classificationKey: "chatwoot-widget-conversation-frame",
    initialCabinetFreshWidgetCount: cabinetWidget.initialCabinetFreshWidgetCount,
    ownerUrl: `${SYNTHETIC_APPLICATION_ORIGIN}/cabinet`,
  })).toEqual({
    action: "hold",
    initialCabinetFreshWidgetCount: 1,
  });
});

test("keeps Chatwoot capture failures bound to one bounded coarse stage", async () => {
  const source = await readFile(
    path.join(process.cwd(), "tests/browser/journeys/chatwoot-phase-browser-capture.ts"),
    "utf8",
  );
  const stages = [
    "browser-context",
    "initial-setup",
    "initial-profile-login",
    "initial-cabinet-navigation",
    "gap-barrier",
    "gap-snapshot",
    "stable-transition",
    "stable-snapshot",
    "logout-clear",
    "recreated-login",
    "recreated-snapshot",
    "final-reread",
  ];
  for (const stage of stages) {
    expect(source).toContain(`"${stage}"`);
  }
  expect(source).toContain("let captureStage: CaptureStage = \"browser-context\"");
  expect(source).toContain("{ cause: error }");
  expect(source).toContain("Chatwoot browser capture failed during ${captureStage}.");
});

test("executes the direct-cabinet causal reducer and fails closed on reordered live events", () => {
  const absent = {
    conversationCookiePresent: false,
    userCookiePresent: false,
  };
  const pair = {
    conversationCookiePresent: true,
    userCookiePresent: true,
  };
  const exact = createChatwootPhaseCausalContract();
  primeAndSealCausalContract(exact);
  exact.markClear(absent);
  expect(exact.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
  })).toBe("login-document");
  exact.markNegativeLoginCheckpoint({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
  });
  expect(exact.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toBe("cabinet-document");
  expect(exact.observeBoundary({
    method: "setUser",
    presence: { conversationCookiePresent: true, userCookiePresent: false },
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toBe("cabinet-set-user");
  expect(exact.observeBoundary({
    method: "identity.confirmed",
    presence: pair,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toBe("cabinet-identity-confirmed");
  exact.observeCookiePair(pair);
  exact.markCabinetCompleted();
  expect(exact.finish(pair)).toMatchObject({
    firstCabinetSetUserBeforeConversationCookiePresent: true,
    firstCabinetSetUserBeforeUserCookieAbsent: true,
    cabinetIdentityConfirmedObservedAfterSetUser: true,
    cabinetSetUserCount: 1,
    cabinetIdentityConfirmedCount: 1,
  });

  const prematureUserCookie = createChatwootPhaseCausalContract();
  primeAndSealCausalContract(prematureUserCookie);
  prematureUserCookie.markClear(absent);
  prematureUserCookie.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
  });
  prematureUserCookie.markNegativeLoginCheckpoint({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
  });
  prematureUserCookie.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  expect(() => prematureUserCookie.observeBoundary({
    method: "setUser",
    presence: { conversationCookiePresent: false, userCookiePresent: true },
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toThrow(/user-cookie-negative/);

  const wrongDocument = createChatwootPhaseCausalContract();
  primeAndSealCausalContract(wrongDocument);
  wrongDocument.markClear(absent);
  expect(() => wrongDocument.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/profile",
  })).toThrow(/direct-cabinet flow/);
});

test("accepts the exact pre-clear Gap and Stable boundary stream before recreation", () => {
  const absent = {
    conversationCookiePresent: false,
    userCookiePresent: false,
  };
  const conversationOnly = {
    conversationCookiePresent: true,
    userCookiePresent: false,
  };
  const pair = {
    conversationCookiePresent: true,
    userCookiePresent: true,
  };
  const causal = createChatwootPhaseCausalContract();

  expect(causal.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/profile",
  })).toBe("pre-clear");
  expect(causal.observeBoundary({
    method: "setUser",
    presence: conversationOnly,
    url: "https://pay.ci.clean-pay.dev/profile",
  })).toBe("pre-clear-boundary");
  expect(causal.observeDocument({
    presence: conversationOnly,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toBe("pre-clear");
  expect(causal.observeBoundary({
    method: "setUser",
    presence: conversationOnly,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toBe("pre-clear-boundary");
  expect(causal.observeBoundary({
    method: "identity.confirmed",
    presence: pair,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toBe("pre-clear-boundary");
  expect(causal.snapshot()).toEqual({
    eventCount: 5,
    preClearSealed: false,
    postClearEventCount: 0,
    eventOrdinals: {},
  });

  expect(causal.sealPreClearGeneration()).toEqual({
    eventCount: 5,
    status: "pre-clear-sealed",
  });
  causal.markClear(absent);
  causal.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
  });
  causal.markNegativeLoginCheckpoint({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
  });
  causal.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  causal.observeBoundary({
    method: "setUser",
    presence: conversationOnly,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  causal.observeBoundary({
    method: "identity.confirmed",
    presence: pair,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  causal.observeCookiePair(pair);
  causal.markCabinetCompleted();
  expect(causal.finish(pair)).toMatchObject({
    postClearSetUserCount: 1,
    cabinetSetUserCount: 1,
    cabinetIdentityConfirmedCount: 1,
  });
  expect(causal.snapshot()).toMatchObject({
    eventCount: 9,
    preClearSealed: true,
    postClearEventCount: 4,
  });

  const unknownPreClearBoundary = createChatwootPhaseCausalContract();
  unknownPreClearBoundary.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  expect(() => unknownPreClearBoundary.observeBoundary({
    method: "reset",
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  })).toThrow(/outside the exact recreation contract/);
});

test("seals pre-clear callbacks and rejects a late setUser during physical clear", async () => {
  const absent = {
    conversationCookiePresent: false,
    userCookiePresent: false,
  };
  const causal = createChatwootPhaseCausalContract();
  causal.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  causal.observeBoundary({
    method: "setUser",
    presence: { conversationCookiePresent: true, userCookiePresent: false },
    url: "https://pay.ci.clean-pay.dev/cabinet",
  });
  let lateError: unknown;
  const transitions: string[] = [];
  const gate = createChatwootCausalClearGateForTest({
    assertClean() {
      if (lateError !== undefined) throw lateError;
    },
    causal,
    async markDocumentPostClear() {
      transitions.push("post-clear-drain");
      return absent;
    },
    sealBoundaryDocument() {
      transitions.push("boundary-document-sealed");
    },
    async sealDocumentPreClear() {
      transitions.push("pre-clear-drain-and-seal");
    },
  });
  await gate.sealPreClearGeneration();
  expect(causal.snapshot()).toMatchObject({ preClearSealed: true, postClearEventCount: 0 });

  try {
    causal.observeBoundary({
      method: "setUser",
      presence: { conversationCookiePresent: false, userCookiePresent: false },
      url: "https://pay.ci.clean-pay.dev/cabinet",
    });
  } catch (error) {
    lateError = error;
  }
  await expect(gate.markPostClear()).rejects.toThrow(/after the pre-clear generation seal/);
  expect(transitions).toEqual([
    "pre-clear-drain-and-seal",
    "boundary-document-sealed",
    "post-clear-drain",
  ]);
  expect(causal.snapshot()).toMatchObject({
    eventOrdinals: {},
    postClearEventCount: 0,
    preClearSealed: true,
  });
  expect(() => causal.observeDocument({
    presence: absent,
    url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
  })).toThrow(/after the pre-clear generation seal/);
});

test("seals history before physical clear and surfaces late document mutations", async () => {
  const historyErrors: unknown[] = [];
  const transitions: string[] = [];
  const gate = createChatwootHistoryClearGateForTest({
    assertClean() {
      if (historyErrors.length > 0) throw historyErrors[0];
    },
    async markDocumentPostClear() {
      transitions.push("post-clear-drain");
    },
    markNodeGeneration() {
      transitions.push("node-generation-marked");
    },
    async sealDocumentPreClear() {
      transitions.push("pre-clear-drain-and-seal");
    },
  });
  await gate.sealPreClearGeneration();
  await gate.markPostClearGeneration();
  expect(transitions).toEqual([
    "pre-clear-drain-and-seal",
    "post-clear-drain",
    "node-generation-marked",
  ]);

  historyErrors.push(new Error("late replaceState after the history generation seal"));
  expect(() => gate.assertClean()).toThrow(/late replaceState/);

  let betweenSealAndMarkError: unknown;
  let nodeGenerationMarked = false;
  const physicalClearWindow = createChatwootHistoryClearGateForTest({
    assertClean() {
      if (betweenSealAndMarkError !== undefined) throw betweenSealAndMarkError;
    },
    async markDocumentPostClear() {
      betweenSealAndMarkError = new Error("late hashchange during physical clear");
    },
    markNodeGeneration() {
      nodeGenerationMarked = true;
    },
    async sealDocumentPreClear() {},
  });
  await physicalClearWindow.sealPreClearGeneration();
  await expect(physicalClearWindow.markPostClearGeneration()).rejects.toThrow(
    /late hashchange during physical clear/,
  );
  expect(nodeGenerationMarked).toBe(false);
});

test("drains one bounded event generation and rejects in-flight or late evidence", async () => {
  expect(() => createChatwootPhaseEventLedger(4_097))
    .toThrow(/event ledger bound is invalid/);
  const aggregateBound = createChatwootPhaseEventLedger();
  for (let index = 0; index < 4_096; index += 1) aggregateBound.record("network");
  expect(() => aggregateBound.record("network")).toThrow(/event ledger overflowed/);
  const exact = createChatwootPhaseEventLedger();
  for (const source of [
    "boundary",
    "browserRequests",
    "browserResponses",
    "diagnostics",
    "history",
    "network",
    "provider",
  ] as const) exact.observe(source, sha256(`exact:${source}`));
  const checkpoint = exact.checkpoint("stable-snapshot");
  exact.assertStable(checkpoint);
  const receipt = await exact.drainAndSeal(() => true, {
    pollMs: 1,
    quietMs: 2,
    timeoutMs: 50,
  });
  expect(receipt).toMatchObject({
    lateEventCount: 0,
    sourceDigestsPresent: {
      boundary: true,
      browserRequests: true,
      browserResponses: true,
      diagnostics: true,
      history: true,
      network: true,
      provider: true,
    },
    status: "drained-and-sealed",
  });
  expect(exact.assertClean()).toMatchObject({ status: "sealed-clean" });

  const changed = createChatwootPhaseEventLedger();
  changed.observe("network", sha256("network:first"));
  const changedCheckpoint = changed.checkpoint("gap-snapshot");
  changed.observe("network", sha256("network:changed"));
  expect(() => changed.assertStable(changedCheckpoint)).toThrow(/generation changed/);

  const inFlight = createChatwootPhaseEventLedger();
  const finish = inFlight.begin("provider");
  expect(() => inFlight.checkpoint("provider-read")).toThrow(/idle exact boundary/);
  await expect(inFlight.drainAndSeal(() => true, {
    pollMs: 1,
    quietMs: 2,
    timeoutMs: 5,
  })).rejects.toThrow(/did not drain/);
  finish();

  const late = createChatwootPhaseEventLedger();
  await late.drainAndSeal(() => true, { pollMs: 1, quietMs: 2, timeoutMs: 50 });
  late.record("browserResponses");
  expect(() => late.assertClean()).toThrow(/changed after the final seal/);
});

test("executes the common request listeners, pending drain, and late-event gate", async () => {
  const handlers = new Map<string, Array<(value: unknown) => void>>();
  const page = {
    on(name: string, handler: (value: unknown) => void) {
      const values = handlers.get(name) ?? [];
      values.push(handler);
      handlers.set(name, values);
      return this;
    },
  };
  const emit = (name: string, value: unknown) => {
    for (const handler of handlers.get(name) ?? []) handler(value);
  };
  const request = {
    headers: () => ({ "content-type": "application/json", "next-action": "opaque-action" }),
    isNavigationRequest: () => false,
    method: () => "POST",
    postDataBuffer: () => Buffer.from("opaque-payload", "utf8"),
    redirectedFrom: () => null,
    resourceType: () => "fetch",
    url: () => "https://pay.ci.clean-pay.dev/cabinet",
  };
  const response = {
    headers: () => ({ "content-type": "text/x-component; charset=utf-8" }),
    request: () => request,
    status: () => 200,
  };
  const ledger = createChatwootPhaseEventLedger();
  const lifecycle = installChatwootCommonRequestLifecycleForTest(page as never, ledger);
  emit("request", request);
  expect(lifecycle.isIdle()).toBe(false);
  expect(lifecycle.snapshot()).toEqual({
    pendingRequestIndexes: [0],
    records: [expect.objectContaining({
      index: 0,
      postDataByteLength: Buffer.byteLength("opaque-payload"),
      serverActionPresent: true,
      terminal: null,
    })],
  });
  expect(JSON.stringify(lifecycle.snapshot())).not.toContain("opaque-payload");
  expect(JSON.stringify(lifecycle.snapshot())).not.toContain("opaque-action");
  emit("response", response);
  emit("requestfinished", request);
  expect(lifecycle.isIdle()).toBe(true);
  expect(lifecycle.snapshot()).toMatchObject({
    pendingRequestIndexes: [],
    records: [{ responseContentType: "text/x-component", responseStatus: 200, terminal: "finished" }],
  });
  await ledger.drainAndSeal(() => lifecycle.isIdle(), {
    pollMs: 1,
    quietMs: 2,
    timeoutMs: 50,
  });
  const lateRequest = { ...request, url: () => "https://pay.ci.clean-pay.dev/late" };
  emit("request", lateRequest);
  expect(() => ledger.assertClean()).toThrow(/changed after the final seal/);
});

test("decodes exact phase boundary and provider ledgers with phase-specific failures", () => {
  const gapBoundary = [
    { method: "run", baseUrl: "https://chatwoot.browser.clean-pay.dev", websiteTokenBytes: 64 },
    { method: "frame.loaded" },
    {
      method: "setUser",
      identifierBytes: 40,
      attributeKeys: ["custom_attributes", "email", "identifier_hash", "name"],
    },
  ];
  expect(assertChatwootPhaseBoundaryLedger(gapBoundary, "gap")).toEqual(gapBoundary);
  expect(() => assertChatwootPhaseBoundaryLedger([
    ...gapBoundary,
    { method: "identity.confirmed" },
  ], "gap")).toThrow(/premature identity/);
  expect(assertChatwootPhaseBoundaryLedger([
    ...gapBoundary,
    { method: "identity.confirmed" },
  ], "stable")).toHaveLength(4);
  const changedOrder = structuredClone(gapBoundary);
  [changedOrder[0], changedOrder[2]] = [changedOrder[2], changedOrder[0]];
  expect(() => assertChatwootPhaseBoundaryLedger(changedOrder, "gap")).toThrow(/out of order/);

  const provider = strictProviderFixture("recreated");
  expect(assertChatwootPhaseProviderLedger(provider, "recreated")).toEqual(provider);
  for (const [phase, entryCount] of [
    ["gap", 15],
    ["stable", 15],
    ["recreated", 28],
  ] as const) {
    const exactProvider = strictProviderFixture(phase);
    expect(assertChatwootPhaseProviderLedger(exactProvider, phase)).toEqual(exactProvider);
    expect(exactProvider.entries).toHaveLength(entryCount);
  }
  for (const challengeIndex of [0, 15]) {
    for (const action of ["login", "telegram_auth_start", "payment", "anything"]) {
      const wrongTurnstileAction = structuredClone(provider);
      (wrongTurnstileAction.entries[challengeIndex].body_contract as {
        fields: Array<{ value: unknown }>;
      }).fields[0].value =
        `synthetic-turnstile-token:${action}:synthetic-turnstile-1:${challengeIndex + 1}`;
      expect(() => assertChatwootPhaseProviderLedger(
        wrongTurnstileAction,
        "recreated",
      ), `challenge ${challengeIndex} action ${action}`)
        .toThrow(/Turnstile response is invalid/);
    }
  }
  const changedProviderOrder = structuredClone(provider);
  changedProviderOrder.entries.reverse();
  expect(() => assertChatwootPhaseProviderLedger(changedProviderOrder, "recreated"))
    .toThrow(/exact endpoint contract/);
  const extraProviderField = structuredClone(provider);
  (extraProviderField.entries[0] as Record<string, unknown>).identifier = "forbidden";
  expect(() => assertChatwootPhaseProviderLedger(extraProviderField, "recreated"))
    .toThrow(/unexpected fields/);
  const unredacted = structuredClone(provider);
  (unredacted.entries[0] as Record<string, unknown>).body_contract = {
    email: "synthetic@example.invalid",
  };
  expect(() => assertChatwootPhaseProviderLedger(unredacted, "recreated"))
    .toThrow(/unexpected fields/);
  const wrongEndpoint = structuredClone(provider);
  wrongEndpoint.entries[0].pathname = "/api/v1/widget/contacts";
  expect(() => assertChatwootPhaseProviderLedger(wrongEndpoint, "recreated"))
    .toThrow(/exact endpoint contract/);
  const wrongQuery = structuredClone(provider);
  wrongQuery.entries[0].query_keys = ["identifier"];
  expect(() => assertChatwootPhaseProviderLedger(wrongQuery, "recreated"))
    .toThrow(/exact endpoint contract/);
  const sparseProviderQuery = structuredClone(provider);
  sparseProviderQuery.entries[1].query_keys = new Array(8);
  expect(() => assertChatwootPhaseProviderLedger(sparseProviderQuery, "recreated"))
    .toThrow(/exact endpoint contract/);
  const wrongCredential = structuredClone(provider);
  wrongCredential.entries[0].credential_contract.header_names = ["authorization"];
  expect(() => assertChatwootPhaseProviderLedger(wrongCredential, "recreated"))
    .toThrow(/credential projection/);
  const wrongTurnstileResponse = structuredClone(provider);
  (wrongTurnstileResponse.entries[0].body_contract as {
    fields: Array<{ value: unknown }>;
  }).fields[0].value = { totally: "wrong" };
  expect(() => assertChatwootPhaseProviderLedger(wrongTurnstileResponse, "recreated"))
    .toThrow(/Turnstile response is invalid/);
  const numericTurnstileSecret = structuredClone(provider);
  (numericTurnstileSecret.entries[0].body_contract as {
    fields: Array<{ value: unknown }>;
  }).fields[1].value = 64;
  expect(() => assertChatwootPhaseProviderLedger(numericTurnstileSecret, "recreated"))
    .toThrow(/secret descriptor/);
  const sparseDatabaseTables = structuredClone(provider);
  delete sparseDatabaseTables.database.tables[0];
  expect(() => assertChatwootPhaseProviderLedger(sparseDatabaseTables, "recreated"))
    .toThrow(/database snapshot is invalid/);
  const wrongDatabaseTableType = structuredClone(provider);
  (wrongDatabaseTableType.database.tables as Array<unknown>)[0] = null;
  expect(() => assertChatwootPhaseProviderLedger(wrongDatabaseTableType, "recreated"))
    .toThrow(/provider table 0/);
  const wrongTelegramDescriptor = structuredClone(provider);
  ((wrongTelegramDescriptor.entries[1].body_contract as {
    fields: Array<{ value: { format: string } }>;
  }).fields[1].value).format = "opaque";
  expect(() => assertChatwootPhaseProviderLedger(wrongTelegramDescriptor, "recreated"))
    .toThrow(/code_challenge descriptor is invalid/);
  const extraRemnashopValue = structuredClone(provider);
  (extraRemnashopValue.entries[3].body_contract as {
    value: Record<string, unknown>;
  }).value.unexpected = { nested: true };
  expect(() => assertChatwootPhaseProviderLedger(extraRemnashopValue, "recreated"))
    .toThrow(/JSON body.*fields are not exact/);
  const contactOnly = {
    database: structuredClone(provider.database),
    entries: provider.entries
      .filter(({ service }) => service === "chatwoot")
      .map((entry, index) => ({ ...entry, sequence: index + 1 })),
  };
  expect(() => assertChatwootPhaseProviderLedger(contactOnly, "recreated"))
    .toThrow(/incomplete or outside/);
  for (const service of [
    "chatwoot",
    "telegram-oidc",
    "turnstile",
    "remnashop",
    "remnawave",
  ]) {
    const missingService = strictProviderFixture("recreated");
    missingService.entries = missingService.entries
      .filter((entry) => entry.service !== service)
      .map((entry, index) => ({ ...entry, sequence: index + 1 }));
    expect(() => assertChatwootPhaseProviderLedger(missingService, "recreated"), service)
      .toThrow(/incomplete or outside/);
  }
  const missingRecreatedProbe = strictProviderFixture("recreated");
  missingRecreatedProbe.entries.pop();
  expect(() => assertChatwootPhaseProviderLedger(missingRecreatedProbe, "recreated"))
    .toThrow(/incomplete or outside/);
  const phases = {
    gap: strictProviderFixture("gap"),
    stable: strictProviderFixture("stable"),
    recreated: strictProviderFixture("recreated"),
  };
  expect(assertChatwootProviderPhaseRelations(phases)).toMatchObject({
    gapEntryCount: 15,
    recreatedEntryCount: 28,
    stableEntryCount: 15,
    status: "exact-provider-phase-prefixes",
  });
  const brokenPrefix = structuredClone(phases);
  brokenPrefix.stable.entries[0].body_sha256 = "f".repeat(64);
  expect(() => assertChatwootProviderPhaseRelations(brokenPrefix))
    .toThrow(/not an exact ordered prefix/);
});

test("collects every boundary method and exposes late custom calls to the final reread", () => {
  const collector = createChatwootBoundaryLifecycleCollectorForTest();
  const firstDocumentToken = "11111111-1111-4111-8111-111111111111";
  const secondDocumentToken = "22222222-2222-4222-8222-222222222222";
  collector.bindDocument(firstDocumentToken);
  collector.observe({ documentToken: firstDocumentToken, entry: null, kind: "array" });
  for (const entry of [
    { method: "run", baseUrl: "https://chatwoot.browser.clean-pay.dev", websiteTokenBytes: 64 },
    { method: "frame.loaded" },
    {
      method: "setUser",
      identifierBytes: 40,
      attributeKeys: ["custom_attributes", "email", "identifier_hash", "name"],
    },
    { method: "identity.confirmed" },
  ]) collector.observe({ documentToken: firstDocumentToken, entry, kind: "entry" });
  const before = collector.snapshot();
  expect(before).toHaveLength(4);
  collector.observe({
    documentToken: firstDocumentToken,
    entry: { attributeKeys: ["plan"], method: "setCustomAttributes" },
    kind: "entry",
  });
  const after = collector.snapshot();
  expect(after).toHaveLength(5);
  expect(() => assertChatwootFinalSourceReread({
    before: {
      boundary: before,
      diagnostics: {},
      history: [],
      network: [],
      provider: {},
    },
    after: {
      boundary: after,
      diagnostics: {},
      history: [],
      network: [],
      provider: {},
    },
  })).toThrow(/final boundary source changed/);
  expect(() => collector.observe({
    documentToken: firstDocumentToken,
    entry: { method: "unknown" },
    kind: "entry",
  })).toThrow(/not allowed/);

  collector.sealDocument(firstDocumentToken);
  expect(() => collector.observe({
    documentToken: firstDocumentToken,
    entry: { method: "identity.confirmed" },
    kind: "entry",
  })).toThrow(/escaped its active unsealed document/);
  collector.bindDocument(secondDocumentToken);
  collector.observe({ documentToken: secondDocumentToken, entry: null, kind: "array" });
  collector.observe({
    documentToken: secondDocumentToken,
    entry: { method: "frame.loaded" },
    kind: "entry",
  });
  expect(collector.snapshot()).toEqual([{ method: "frame.loaded" }]);
  expect(() => collector.observe({
    documentToken: firstDocumentToken,
    entry: { method: "identity.confirmed" },
    kind: "entry",
  })).toThrow(/escaped its active unsealed document/);
});

test("executes the atomic phase reader and rejects every changed captured surface", () => {
  const raw = { boundaryCalls: [{ method: "setUser" }], conversationPresent: true };
  const provider = strictProviderFixture("stable");
  const snapshot = {
    accessibility: "- document\n  - button \"Поддержка\"",
    computedStyles: [{ path: "html > body", display: "block" }],
    cookies: cookieFixture("stable", "atomic"),
    dom: { type: "element", tag: "html", children: [] },
    interactive: [{ path: "button", disabled: false, loading: false }],
    networkLifecycle: { pendingRequestIndexes: [], records: [{ index: 0 }] },
    provider,
    raw,
    storage: { local: [], session: ["turnstile"] },
  };
  const input = {
    beforeProvider: structuredClone(provider),
    beforeRaw: structuredClone(raw),
    first: structuredClone(snapshot),
    phase: "stable" as const,
    second: structuredClone(snapshot),
  };
  expect(assertChatwootAtomicPhaseRead(input)).toEqual({
    phase: "stable",
    status: "atomic-phase-read-exact",
  });
  for (const key of [
    "accessibility",
    "computedStyles",
    "cookies",
    "dom",
    "interactive",
    "networkLifecycle",
    "provider",
    "raw",
    "storage",
  ] as const) {
    const changed = structuredClone(input);
    changed.second[key] = { changed: key } as never;
    expect(() => assertChatwootAtomicPhaseRead(changed), key).toThrow(/atomic snapshot/);
  }
  const changedBefore = structuredClone(input);
  changedBefore.beforeRaw = { boundaryCalls: [], conversationPresent: false };
  expect(() => assertChatwootAtomicPhaseRead(changedBefore)).toThrow(/before.*atomic snapshot/);
});

test("executes final source rereads and rejects every late source mutation", () => {
  const exact = {
    boundary: [{ method: "setUser" }],
    diagnostics: { unexpectedConsole: [], unexpectedPageErrors: [] },
    history: [{ kind: "checkpoint" }],
    network: { pendingRequestIndexes: [], records: [{ index: 0, terminal: "finished" }] },
    provider: strictProviderFixture("recreated"),
  };
  expect(assertChatwootFinalSourceReread({
    after: structuredClone(exact),
    before: structuredClone(exact),
  })).toEqual({ sourceCount: 5, status: "exact-final-source-reread" });
  for (const source of ["boundary", "diagnostics", "history", "network", "provider"] as const) {
    const after = structuredClone(exact);
    after[source] = { lateMutation: source } as never;
    expect(() => assertChatwootFinalSourceReread({
      after,
      before: structuredClone(exact),
    }), source).toThrow(new RegExp(`final ${source} source changed`));
  }
});

test("validates the executable full history lifecycle and fails closed on near misses", () => {
  const projectedUrl = {
    fragmentPresent: false,
    originSha256: sha256("https://pay.ci.clean-pay.dev"),
    pathnameSha256: sha256("/cabinet"),
    queryKeys: [],
  };
  const exact = [
    {
      generation: "initial",
      historyLength: null,
      kind: "framenavigated",
      url: projectedUrl,
    },
    {
      generation: "initial",
      historyLength: 2,
      kind: "checkpoint",
      url: projectedUrl,
    },
    {
      generation: "recreated",
      historyLength: null,
      kind: "generation-boundary",
      url: null,
    },
    {
      generation: "recreated",
      historyLength: 3,
      kind: "replaceState",
      url: projectedUrl,
    },
  ];
  expect(assertChatwootHistoryLifecycle(exact)).toEqual(exact);
  const semantics = canonicalChatwootHistorySemantics(exact);
  expect(semantics).toMatchObject({
    entryCount: 4,
    generationBoundaryCount: 1,
    initialEntryCount: 2,
    recreatedEntryCount: 2,
  });
  const changedKind = structuredClone(exact);
  changedKind[3].kind = "hashchange";
  expect(canonicalChatwootHistorySemantics(changedKind).contractSha256)
    .not.toBe(semantics.contractSha256);
  const changedCount = structuredClone(exact);
  changedCount.push({
    generation: "recreated",
    historyLength: 3,
    kind: "hashchange",
    url: projectedUrl,
  });
  expect(canonicalChatwootHistorySemantics(changedCount)).toMatchObject({ entryCount: 5 });
  expect(canonicalChatwootHistorySemantics(changedCount).contractSha256)
    .not.toBe(semantics.contractSha256);
  const extraField = structuredClone(exact) as Array<Record<string, unknown>>;
  extraField[0].rawUrl = "forbidden";
  expect(() => assertChatwootHistoryLifecycle(extraField)).toThrow(/unexpected fields/);
  const badQuery = structuredClone(exact) as Array<Record<string, unknown>>;
  (badQuery[3].url as Record<string, unknown>).queryKeys = ["redirect_to", "redirect_to"];
  expect(() => assertChatwootHistoryLifecycle(badQuery)).toThrow(/invalid/);
  expect(() => assertChatwootHistoryLifecycle(exact.filter(({ kind }) => (
    kind !== "framenavigated"
  )))).toThrow(/lacks an observed navigation boundary/);
  const sparseHistory = structuredClone(exact);
  delete sparseHistory[1];
  expect(() => assertChatwootHistoryLifecycle(sparseHistory))
    .toThrow(/history lifecycle is incomplete/);
  const wrongHistoryType = structuredClone(exact) as Array<unknown>;
  wrongHistoryType[1] = null;
  expect(() => assertChatwootHistoryLifecycle(wrongHistoryType))
    .toThrow(/history lifecycle entry 1/);
  const sparseQueryKeys = structuredClone(exact) as Array<Record<string, unknown>>;
  sparseQueryKeys[3].url = {
    ...(sparseQueryKeys[3].url as Record<string, unknown>),
    queryKeys: new Array(1),
  };
  expect(() => assertChatwootHistoryLifecycle(sparseQueryKeys))
    .toThrow(/history lifecycle URL 3 is invalid/);
  const wrongQueryKeyType = structuredClone(exact) as Array<Record<string, unknown>>;
  wrongQueryKeyType[3].url = {
    ...(wrongQueryKeyType[3].url as Record<string, unknown>),
    queryKeys: [42],
  };
  expect(() => assertChatwootHistoryLifecycle(wrongQueryKeyType))
    .toThrow(/history lifecycle URL 3 is invalid/);
});

test("executes the exact direct-cabinet browser classifier with serialized parity", () => {
  const staticAssetContract = createChatwootPhaseStaticAssetContract(staticAssetAttestation());
  expect(createChatwootPhaseStaticAssetContract(staticAssetAttestation()))
    .toEqual(staticAssetContract);
  const state = {
    cabinetDocumentAllowed: false,
    generation: "recreated",
    staticAssetContract,
  };
  const request = (url: string, overrides: Record<string, unknown> = {}) => ({
    isMainFrame: true,
    isNavigation: true,
    method: "GET",
    resourceType: "document",
    url,
    ...overrides,
  });
  const login = request("https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet");
  const live = classifyChatwootPhaseBrowserRequest(login, state);
  const serialized = classifyChatwootPhaseBrowserRequest(
    JSON.parse(JSON.stringify(login)),
    JSON.parse(JSON.stringify(state)),
  );
  expect(serialized).toEqual(live);
  const malformedNestedContract = structuredClone(staticAssetContract) as DeepMutable<
    typeof staticAssetContract
  >;
  malformedNestedContract.providerContract.inventorySha256 = "0".repeat(63);
  expect(() => classifyChatwootPhaseBrowserRequest(login, {
    ...state,
    staticAssetContract: malformedNestedContract,
  })).toThrow(/Static asset contract is invalid/);
  const duplicateStaticPath = structuredClone(staticAssetContract) as DeepMutable<
    typeof staticAssetContract
  >;
  duplicateStaticPath.directCabinetRouteDeclaredPaths.push(
    duplicateStaticPath.directCabinetRouteDeclaredPaths[0],
  );
  expect(() => classifyChatwootPhaseBrowserRequest(login, {
    ...state,
    staticAssetContract: duplicateStaticPath,
  })).toThrow(/direct-cabinet static route contract is invalid/);
  const reversedStaticPaths = structuredClone(staticAssetContract) as DeepMutable<
    typeof staticAssetContract
  >;
  reversedStaticPaths.directCabinetRouteDeclaredPaths.reverse();
  expect(() => classifyChatwootPhaseBrowserRequest(login, {
    ...state,
    staticAssetContract: reversedStaticPaths,
  })).toThrow(/direct-cabinet static route contract is invalid/);
  const sparseStaticPaths = structuredClone(staticAssetContract) as DeepMutable<
    typeof staticAssetContract
  >;
  delete sparseStaticPaths.directCabinetRouteDeclaredPaths[0];
  expect(() => classifyChatwootPhaseBrowserRequest(login, {
    ...state,
    staticAssetContract: sparseStaticPaths,
  })).toThrow(/direct-cabinet static route contract is invalid/);
  const wrongStaticPathType = structuredClone(staticAssetContract) as DeepMutable<
    typeof staticAssetContract
  >;
  (wrongStaticPathType.directCabinetRouteDeclaredPaths as Array<unknown>)[0] = 42;
  expect(() => classifyChatwootPhaseBrowserRequest(login, {
    ...state,
    staticAssetContract: wrongStaticPathType,
  })).toThrow(/direct-cabinet static route contract is invalid/);
  expect(live).toMatchObject({ key: "app-login-document", navigation: true });

  for (const [label, url] of [
    ["profile target", "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile"],
    ["missing redirect", "https://pay.ci.clean-pay.dev/login"],
    ["duplicate redirect", "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet&redirect_to=%2Fcabinet"],
    ["extra query", "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet&extra=1"],
    ["hash", "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet#extra"],
    ["profile document", "https://pay.ci.clean-pay.dev/profile"],
  ]) {
    expect(() => classifyChatwootPhaseBrowserRequest(request(url), state), label).toThrow();
  }
  expect(() => classifyChatwootPhaseBrowserRequest(request(
    "https://pay.ci.clean-pay.dev/auth/telegram/callback?code=opaque&state=opaque&extra=1",
  ), state)).toThrow();
  const exactTurnstileToken = encodeURIComponent(
    "synthetic-turnstile-token:auth_login:synthetic-turnstile-1:1",
  );
  expect(classifyChatwootPhaseBrowserRequest(request(
    `https://pay.ci.clean-pay.dev/auth/telegram/start?redirect_to=%2Fcabinet&turnstile_token=${exactTurnstileToken}`,
  ), state)).toMatchObject({ key: "app-telegram-start", navigation: true });
  for (const action of ["login", "telegram_auth_start", "payment", "anything"]) {
    const token = encodeURIComponent(
      `synthetic-turnstile-token:${action}:synthetic-turnstile-1:1`,
    );
    expect(() => classifyChatwootPhaseBrowserRequest(request(
      `https://pay.ci.clean-pay.dev/auth/telegram/start?redirect_to=%2Fcabinet&turnstile_token=${token}`,
    ), state), action).toThrow(/Turnstile token is invalid/);
  }

  const start = {
    classification: { key: "app-telegram-start" },
    url: "https://pay.ci.clean-pay.dev/auth/telegram/start?redirect_to=%2Fcabinet&turnstile_token=synthetic-turnstile-token%3Aauth_login%3Asynthetic-turnstile-1%3A1",
  };
  const oidc = {
    classification: { key: "telegram-oidc-authorize" },
    url: "https://oauth.telegram.org/auth?response_type=code",
  };
  expect(assertChatwootPhaseRedirect({
    from: start,
    location: oidc.url,
    status: 307,
    to: oidc,
  }, "recreated")).toBe("app-telegram-start:307->telegram-oidc-authorize");
  expect(() => assertChatwootPhaseRedirect({
    from: start,
    location: `${oidc.url}#extra`,
    status: 307,
    to: oidc,
  }, "recreated")).toThrow();

  const history = [
    {
      historyLength: 2,
      kind: "checkpoint",
      url: "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fcabinet",
    },
    {
      historyLength: 3,
      kind: "checkpoint",
      url: "https://pay.ci.clean-pay.dev/cabinet",
    },
  ];
  expect(finalizeChatwootPhaseHistoryContract(history, "recreated").historyCount).toBe(2);
  const sparseDirectHistory = structuredClone(history);
  delete sparseDirectHistory[1];
  for (const generation of ["initial", "recreated"] as const) {
    expect(() => finalizeChatwootPhaseHistoryContract(
      sparseDirectHistory,
      generation,
    ), generation).toThrow(/dense own-index array/);
  }
  const wrongHistory = structuredClone(history);
  wrongHistory[0].url = "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile";
  expect(() => finalizeChatwootPhaseHistoryContract(wrongHistory, "recreated")).toThrow();

  const records = directCabinetBrowserRecords(staticAssetContract);
  const initialGraph = staticLoadGraphFixture(staticAssetContract, [
    "app-login-document",
    "app-profile-document",
    "app-cabinet-document",
  ]);
  const initialReference = finalizeChatwootPhaseBrowserContract(
    initialBrowserRecords(staticAssetContract),
    {
      cssMediaReferences: initialGraph.cssMediaReferences,
      generation: "initial",
      referenceStaticContract: null,
      responseDeclarationsByDocument: initialGraph.responseDeclarationsByDocument,
      staticAssetContract,
    },
  );
  const directGraph = staticLoadGraphFixture(staticAssetContract, [
    "app-login-document",
    "app-cabinet-document",
  ]);
  const loadGraph = {
    cssMediaReferences: directGraph.cssMediaReferences,
    generation: "recreated",
    referenceStaticContract: initialReference,
    responseDeclarationsByDocument: directGraph.responseDeclarationsByDocument,
    staticAssetContract,
  };
  const finalized = finalizeChatwootPhaseBrowserContract(records, loadGraph);
  expect(finalized).toMatchObject({
    requestCount: records.length,
    staticRequestCount: 12,
  });
  expect(initialReference.responseDeclarationLedger[1].pathSha256s).toContain(
    sha256(staticFixturePaths("generic").routeChunksByDocument["app-profile-document"][1]),
  );
  expect(finalized.responseDeclarationLedger).toEqual(
    initialReference.responseDeclarationLedger.filter((entry: { documentKey: string }) => (
      entry.documentKey !== "app-profile-document"
    )),
  );
  const changedLoginDeclaration = structuredClone(loadGraph);
  changedLoginDeclaration.responseDeclarationsByDocument[0].paths = (
    changedLoginDeclaration.responseDeclarationsByDocument[0].paths.filter((servedPath) => (
      servedPath !== staticFixturePaths("generic").routeChunksByDocument["app-login-document"][1]
    ))
  );
  expect(() => finalizeChatwootPhaseBrowserContract(records, changedLoginDeclaration))
    .toThrow(/per-document response declaration closure/);
  const changedCabinetDeclaration = structuredClone(loadGraph);
  changedCabinetDeclaration.responseDeclarationsByDocument[1].paths = (
    changedCabinetDeclaration.responseDeclarationsByDocument[1].paths.filter((servedPath) => (
      servedPath !== staticFixturePaths("generic").routeChunksByDocument["app-cabinet-document"][1]
    ))
  );
  expect(() => finalizeChatwootPhaseBrowserContract(records, changedCabinetDeclaration))
    .toThrow(/per-document response declaration closure/);
  expect(finalizeChatwootPhaseBrowserContract(
    JSON.parse(JSON.stringify(records)),
    JSON.parse(JSON.stringify(loadGraph)),
  )).toEqual(finalized);
  const reorderedRecords = structuredClone(records);
  [reorderedRecords[7], reorderedRecords[9]] = [reorderedRecords[9], reorderedRecords[7]];
  expect(() => finalizeChatwootPhaseBrowserContract(reorderedRecords, loadGraph))
    .toThrow(/navigation flow/);
  const changedObservedDigest = structuredClone(records);
  changedObservedDigest[1].staticResponseSha256 = "0".repeat(64);
  expect(() => finalizeChatwootPhaseBrowserContract(changedObservedDigest, loadGraph))
    .toThrow(/static request path/);
  const changedObservedLength = structuredClone(records);
  changedObservedLength[1].staticResponseBytes =
    (changedObservedLength[1].staticResponseBytes ?? 0) + 1;
  expect(() => finalizeChatwootPhaseBrowserContract(changedObservedLength, loadGraph))
    .toThrow(/static request path/);
  const changedObservedType = structuredClone(records);
  changedObservedType[1].responseContentType = "text/css";
  expect(() => finalizeChatwootPhaseBrowserContract(changedObservedType, loadGraph))
    .toThrow(/static request path/);
  const unknownAbort = structuredClone(records);
  unknownAbort.splice(1, 0, {
    classification: {
      disposition: "abort",
      expectedStatuses: [],
      key: "unknown-direct-abort",
      navigation: false,
      staticAssetSha256: null,
      staticPath: null,
    },
    documentKey: "app-login-document",
    redirectEdge: null,
    responseContentType: null,
    responseFailureSha256: null,
    responseStatus: null as never,
    staticResponseBytes: null,
    staticResponseSha256: null,
  });
  expect(() => finalizeChatwootPhaseBrowserContract(unknownAbort, loadGraph))
    .toThrow(/exact direct-cabinet descriptor/);
  for (const [label, mutate] of [
    ["wrong login disposition", (classification: DeepMutable<
      (typeof records)[number]["classification"]
    >) => { classification.disposition = "abort"; classification.expectedStatuses = []; }],
    ["wrong login navigation", (classification: DeepMutable<
      (typeof records)[number]["classification"]
    >) => { classification.navigation = false; }],
    ["wrong login statuses", (classification: DeepMutable<
      (typeof records)[number]["classification"]
    >) => { classification.expectedStatuses = [201]; }],
  ] as const) {
    const changed = structuredClone(records);
    mutate(changed[0].classification);
    expect(() => finalizeChatwootPhaseBrowserContract(changed, loadGraph), label)
      .toThrow(/exact direct-cabinet descriptor/);
  }

  const sparseStatuses = new Array<number>(2);
  sparseStatuses[1] = 200;
  for (const [label, statuses] of [
    ["sparse", sparseStatuses],
    ["below HTTP range", [0]],
    ["above HTTP range", [600]],
  ] as const) {
    const changed = structuredClone(records);
    changed[0].classification.expectedStatuses = statuses as number[];
    expect(() => finalizeChatwootPhaseBrowserContract(changed, loadGraph), label)
      .toThrow(/classification(?: 0)? is invalid/);
    expect(() => assertChatwootStrictClassificationForTest({
      ...records[0].classification,
      expectedStatuses: statuses,
    }), label).toThrow(/strict browser classification is invalid/);
  }
});

test("executes the committed shared static/history adapters under bounded lifecycle", async () => {
  const mainFrame = {};
  const requestEnvelope = (
    navigation: boolean,
    frame: () => unknown,
  ) => createJourneyBrowserRequestEnvelope({
    frame,
    isNavigationRequest: () => navigation,
    method: () => "GET",
    resourceType: () => navigation ? "document" : "script",
    url: () => navigation
      ? "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile"
      : "https://pay.ci.clean-pay.dev/_next/static/chunks/app.js",
  }, mainFrame);
  expect(requestEnvelope(true, () => mainFrame)).toMatchObject({
    isMainFrame: true,
    isNavigation: true,
  });
  expect(requestEnvelope(false, () => {
    throw new Error("non-navigation frame lookup must short-circuit");
  })).toMatchObject({
    isMainFrame: false,
    isNavigation: false,
  });

  const contract = createChatwootPhaseStaticAssetContract(staticAssetAttestation());
  const fixturePaths = staticFixturePaths("generic");
  const woff2Path = fixturePaths.media.interWoff2;
  const javascriptPath = fixturePaths.routeChunksByDocument["app-login-document"][0];
  expect(extractProviderOverlapResponseStaticDeclarations(
    Buffer.from(`"${woff2Path}"`, "utf8"),
    contract.providerContract,
  )).toEqual([woff2Path]);
  const flightChunk = `1:I["${woff2Path}","default"]\n`;
  expect(extractProviderOverlapResponseStaticDeclarations(
    Buffer.from(`<script>self.__next_f.push(${JSON.stringify([1, flightChunk])})</script>`, "utf8"),
    contract.providerContract,
  )).toEqual([woff2Path]);
  for (const [label, unsafeBody] of [
    ["external origin", `"https://evil.example${javascriptPath}"`],
    ["local prefix", `"/prefix${javascriptPath}"`],
    ["dotted suffix", `"${woff2Path}.cache"`],
    ["query suffix", `"${woff2Path}?v=1"`],
    ["HTML entity suffix", `"${javascriptPath}&amp;evil"`],
    ["entity quote pair", `&quot;${javascriptPath}&quot;`],
    ["single quote pair", `'${javascriptPath}'`],
    ["raw-open escaped-close", `"${javascriptPath}\\"`],
    ["escaped-open raw-close", `\\"${javascriptPath}"`],
  ] as const) {
    expect(() => extractProviderOverlapResponseStaticDeclarations(
      Buffer.from(unsafeBody, "utf8"),
      contract.providerContract,
    ), label).toThrow(/unknown, partial, or unsafe|paired/);
  }

  const staticRecord = staticRecordsForDocument(contract, "app-login-document")[0];
  const staticPath = staticRecord.classification.staticPath;
  if (!staticPath) throw new Error("Shared static adapter fixture path is absent.");
  const body = Buffer.from(
    staticAssetBodyFixture(staticFixtureVariantForContract(contract))[staticPath],
    "utf8",
  );
  const lifecycle: string[] = [];
  await expect(readProviderOverlapStaticResponseEvidence({
    classification: staticRecord.classification,
    response: {
      body: async () => {
        lifecycle.push("body");
        return body;
      },
      finished: async () => {
        lifecycle.push("finished");
        return null;
      },
      status: () => 200,
    },
    responseContentType: staticRecord.responseContentType,
  }, contract.providerContract)).resolves.toMatchObject({
    observation: {
      staticResponseBytes: body.byteLength,
      staticResponseSha256: sha256(body),
    },
  });
  expect(lifecycle).toEqual(["finished", "body"]);
  await expect(boundedChatwootBrowserOperationForTest(
    new Promise<never>(() => undefined),
    5,
    "synthetic stalled response body",
  )).rejects.toThrow(/exceeded its bounded lifecycle/);

  const checkpoint = {
    frameId: "main-frame-1",
    historyLength: 4,
    kind: "checkpoint",
    loaderId: "profile-loader-1",
    url: "https://pay.ci.clean-pay.dev/profile",
  };
  const documentNavigation = {
    frameId: "main-frame-1",
    kind: "document-navigation",
    loaderId: "cabinet-loader-2",
    navigationType: "Navigation",
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const replaceState = {
    afterNextAppRouterState: true,
    argumentUrl: "https://pay.ci.clean-pay.dev/cabinet",
    beforeHistoryLength: 5,
    beforeNextAppRouterState: false,
    beforeUrl: "https://pay.ci.clean-pay.dev/cabinet",
    historyLength: 5,
    kind: "replaceState",
    operationSequence: 1,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const sameDocumentNavigation = {
    frameId: "main-frame-1",
    kind: "same-document-navigation",
    navigationType: "historyApi",
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const finalFrame = {
    frameId: "main-frame-1",
    loaderId: "cabinet-loader-2",
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const history = finalizeProviderOverlapHistoryContract([
    checkpoint,
    documentNavigation,
    replaceState,
    sameDocumentNavigation,
  ], finalFrame);
  expect(finalizeChatwootPhaseHistoryContract([
    checkpoint,
    documentNavigation,
    sameDocumentNavigation,
    replaceState,
  ], "initial", finalFrame)).toEqual(history);
});

test("writes all raw process replicas and a create-only sanitized artifact manifest", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-proof-"));
  try {
    const outputDirectory = path.join(temporaryParent, "evidence");
    const state = await prepareChatwootPhaseEvidenceDirectory({
      outputDirectory,
      repositoryRoot: process.cwd(),
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Reflect.set(state, "directory", path.join(temporaryParent, "escape"))).toBe(false);
    const reports = pairReports();
    await writeEvidencePngs(state, reports);
    const proof = createChatwootPhaseProof(reports);
    for (const [label, mutate] of [
      ["sparse execution", (value: DeepMutable<typeof proof>) => {
        value.pairs[0].execution.events = new Array(8) as never;
      }],
      ["sparse cleanup", (value: DeepMutable<typeof proof>) => {
        value.pairs[0].cleanup.stacks = new Array(2) as never;
      }],
    ] as const) {
      const sparseProof = structuredClone(proof) as DeepMutable<typeof proof>;
      mutate(sparseProof);
      await expect(finalizeChatwootPhaseEvidence({
        state,
        proof: sparseProof,
      }), label).rejects.toThrow(/incomplete/);
    }
    const finalized = await finalizeChatwootPhaseEvidence({ state, proof });
    expect(finalized).toMatchObject({ artifactCount: 19 });
    expect(finalized.proofSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(finalized.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    const manifest = JSON.parse(await readFile(
      path.join(outputDirectory, "artifact-manifest.json"),
      "utf8",
    ));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: "clean-pay-chatwoot-phase-proof-artifact-manifest",
      artifactCount: 19,
      aggregateSha256: finalized.aggregateSha256,
    });
    expect(manifest.entries.map((entry: { path: string }) => entry.path))
      .toEqual(["proof.json", ...expectedChatwootScreenshotPaths()].sort());
    expect(JSON.stringify(manifest)).not.toContain(temporaryParent);
    await expect(writeRawChatwootPhaseScreenshot({
      state,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: pngFixture("duplicate"),
    })).rejects.toThrow(/finalized/);
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("cleans only its exact partial evidence root after create failures", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-cleanup-"));
  try {
    for (const [name, hooks] of [
      ["root", { failAfterRawCreate: false, failAfterRootCreate: true }],
      ["raw", { failAfterRawCreate: true, failAfterRootCreate: false }],
    ] as const) {
      const outputDirectory = path.join(temporaryParent, name);
      await expect(prepareChatwootPhaseEvidenceDirectoryForTest({
        outputDirectory,
        repositoryRoot: process.cwd(),
      }, hooks)).rejects.toThrow(/Injected failure/);
      await expect(lstat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readdir(temporaryParent)).toEqual([]);
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("passes no ambient credential material to the private ACL helper", () => {
  const sentinel = "CLEAN_PAY_CHATWOOT_SENTINEL_SECRET";
  const prior = process.env[sentinel];
  process.env[sentinel] = "must-not-cross-process-boundary";
  try {
    const environment = chatwootWindowsPowerShellEnvironmentForTest({
      CLEAN_PAY_CHATWOOT_EVIDENCE_KIND: "file",
      CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET: path.join(tmpdir(), "chatwoot-private-output"),
    });
    expect(environment).not.toHaveProperty(sentinel);
    expect(environment).not.toHaveProperty("PSModulePath");
    expect(Object.keys(environment).every((name) => new Set([
      "CLEAN_PAY_CHATWOOT_EVIDENCE_KIND",
      "CLEAN_PAY_CHATWOOT_EVIDENCE_TARGET",
      "ComSpec",
      "SystemDrive",
      "SystemRoot",
      "TEMP",
      "TMP",
      "WINDIR",
    ]).has(name))).toBe(true);
  } finally {
    if (prior === undefined) delete process.env[sentinel];
    else process.env[sentinel] = prior;
  }
});

test("aborts only identity-bound evidence after late create-only publication failures", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-abort-"));
  try {
    for (const [name, hooks] of [
      ["proof", { failAfterManifestWrite: false, failAfterProofWrite: true }],
      ["manifest", { failAfterManifestWrite: true, failAfterProofWrite: false }],
    ] as const) {
      const outputDirectory = path.join(temporaryParent, name);
      const state = await prepareChatwootPhaseEvidenceDirectory({
        outputDirectory,
        repositoryRoot: process.cwd(),
      });
      const reports = pairReports();
      await writeEvidencePngs(state, reports);
      await expect(finalizeChatwootPhaseEvidenceForTest({
        state,
        proof: createChatwootPhaseProof(reports),
      }, hooks)).rejects.toThrow(/Injected failure/);
      await expect(abortChatwootPhaseEvidence({ state })).resolves.toEqual({
        status: "exact-owned-evidence-root-aborted",
      });
      await expect(lstat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    }

    const unknownDirectory = path.join(temporaryParent, "unknown");
    const unknownState = await prepareChatwootPhaseEvidenceDirectory({
      outputDirectory: unknownDirectory,
      repositoryRoot: process.cwd(),
    });
    const unknownPath = path.join(unknownDirectory, "proof.json");
    await writeFile(unknownPath, "foreign", { flag: "wx" });
    await expect(abortChatwootPhaseEvidence({ state: unknownState }))
      .rejects.toThrow(/identity changed/);
    await expect(readFile(unknownPath, "utf8")).resolves.toBe("foreign");

    const swappedDirectory = path.join(temporaryParent, "swapped");
    const swappedState = await prepareChatwootPhaseEvidenceDirectory({
      outputDirectory: swappedDirectory,
      repositoryRoot: process.cwd(),
    });
    await writeRawChatwootPhaseScreenshot({
      state: swappedState,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: pngFixture("owned-before-swap"),
    });
    const swappedPath = path.join(swappedState.rawDirectory, "pair-1-baseline-gap.png");
    const displacedPath = path.join(temporaryParent, "displaced-owned.png");
    await rename(swappedPath, displacedPath);
    await writeFile(swappedPath, pngFixture("foreign-after-swap"), { flag: "wx" });
    await expect(abortChatwootPhaseEvidence({ state: swappedState }))
      .rejects.toThrow(/identity changed/);
    await expect(readFile(swappedPath)).resolves.toEqual(pngFixture("foreign-after-swap"));
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("re-reads the exact raw PNG inventory before writing proof or manifest", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-reread-"));
  try {
    const corruptState = await prepareChatwootPhaseEvidenceDirectory({
      outputDirectory: path.join(temporaryParent, "corrupt"),
      repositoryRoot: process.cwd(),
    });
    const corruptReports = pairReports();
    await writeEvidencePngs(corruptState, corruptReports);
    await writeFile(
      path.join(corruptState.rawDirectory, "pair-1-baseline-gap.png"),
      pngFixture("changed-after-write"),
    );
    await expect(finalizeChatwootPhaseEvidence({
      state: corruptState,
      proof: createChatwootPhaseProof(corruptReports),
    })).rejects.toThrow(/changed after|does not match/);

    const extraState = await prepareChatwootPhaseEvidenceDirectory({
      outputDirectory: path.join(temporaryParent, "extra"),
      repositoryRoot: process.cwd(),
    });
    const extraReports = pairReports();
    await writeEvidencePngs(extraState, extraReports);
    await writeFile(path.join(extraState.rawDirectory, "adjacent.txt"), "forbidden", { flag: "wx" });
    await expect(finalizeChatwootPhaseEvidence({
      state: extraState,
      proof: createChatwootPhaseProof(extraReports),
    })).rejects.toThrow(/identity changed|inventory is not exact/);
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("rejects evidence paths, PNGs, and incomplete inventories near the boundary", async () => {
  const temporaryParent = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-proof-near-miss-"));
  try {
    await expect(prepareChatwootPhaseEvidenceDirectory({
      outputDirectory: path.join(process.cwd(), "test-results", "forbidden-chatwoot-proof"),
      repositoryRoot: process.cwd(),
    })).rejects.toThrow(/outside the repository/);
    const outputDirectory = path.join(temporaryParent, "evidence");
    const state = await prepareChatwootPhaseEvidenceDirectory({
      outputDirectory,
      repositoryRoot: process.cwd(),
    });
    await expect(writeRawChatwootPhaseScreenshot({
      state,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: Buffer.from("not-a-png"),
    })).rejects.toThrow(/PNG byte contract/);
    await expect(writeRawChatwootPhaseScreenshot({
      state,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: Buffer.alloc((5 * 1024 * 1024) + 1),
    })).rejects.toThrow(/bounded PNG byte contract/);
    await expect(writeRawChatwootPhaseScreenshot({
      state,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: pngFixtureWithInvalidRaster(),
    })).rejects.toThrow(/decodable bounded raster/);
    await expect(writeRawChatwootPhaseScreenshot({
      state,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: pngFixture("wrong-dimensions", 1, 1),
    })).rejects.toThrow(/exact 1440x900 viewport/);
    await expect(writeRawChatwootPhaseScreenshot({
      state,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: pngFixture("metadata", 1440, 900, true),
    })).rejects.toThrow(/non-whitelisted or metadata chunk/);
    await writeRawChatwootPhaseScreenshot({
      state,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: pngFixture("one"),
    });
    await expect(finalizeChatwootPhaseEvidence({
      state,
      proof: createChatwootPhaseProof(pairReports()),
    })).rejects.toThrow(/all eighteen/);
    await expect(prepareChatwootPhaseEvidenceDirectory({
      outputDirectory,
      repositoryRoot: process.cwd(),
    })).rejects.toThrow(/already exists/);

    const swappedState = await prepareChatwootPhaseEvidenceDirectory({
      outputDirectory: path.join(temporaryParent, "swapped-evidence"),
      repositoryRoot: process.cwd(),
    });
    const displacedRaw = `${swappedState.rawDirectory}-displaced`;
    await rename(swappedState.rawDirectory, displacedRaw);
    await mkdir(swappedState.rawDirectory);
    await expect(writeRawChatwootPhaseScreenshot({
      state: swappedState,
      pairIndex: 1,
      role: "baseline",
      phase: "gap",
      bytes: pngFixture("directory-swap"),
    })).rejects.toThrow(/identity changed/);
  } finally {
    await rm(temporaryParent, { recursive: true, force: false });
  }
});

test("keeps the sidecar contract separate from baselines, projection, and fixture mutation", async () => {
  const directory = path.resolve(__dirname);
  const [
    contractSource,
    sealerSource,
    writerSource,
    cliSource,
    schemaSource,
    documentation,
  ] = await Promise.all([
    readFile(path.join(directory, "chatwoot-phase-proof-contract.mjs"), "utf8"),
    readFile(path.join(directory, "chatwoot-phase-evidence-sealer.mjs"), "utf8"),
    readFile(path.join(directory, "chatwoot-phase-evidence-writer.mjs"), "utf8"),
    readFile(path.join(directory, "prove-chatwoot-phase-stability.mjs"), "utf8"),
    readFile(path.join(directory, "chatwoot-phase-proof.schema.json"), "utf8"),
    readFile(path.join(directory, "CHATWOOT_PHASE_PROOF.md"), "utf8"),
  ]);
  const schema = JSON.parse(schemaSource);
  expect(schema).toMatchObject({
    $schema: "http://json-schema.org/draft-07/schema#",
    additionalProperties: false,
    properties: {
      schemaVersion: { const: 1 },
      kind: { const: CHATWOOT_PHASE_PROOF_KIND },
    },
  });
  expect(schema.required).toEqual([
    "schemaVersion",
    "kind",
    "scenario",
    "execution",
    "pairs",
    "quorum",
    "comparison",
    "lifecycle",
  ]);
  expect(schema.properties.pairs).toMatchObject({ minItems: 3, maxItems: 3 });
  expect(schema.properties.quorum.properties).toMatchObject({
    independentPairCount: { const: 3 },
    requiredByteIdenticalProcesses: { const: 2 },
    semanticAgreementRequired: { const: 6 },
  });
  expect(schema.properties.lifecycle.properties).toMatchObject({
    automaticCleanup: { const: true },
    cleanupMode: { const: "exact-owned-project-v1" },
    expectedStackCount: { const: 6 },
    cleanedStackCount: { const: 6 },
  });
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const schemaProof = createChatwootPhaseProof(pairReports());
  const containerdSchemaProof = createChatwootPhaseProof(containerdPairReports());
  type MutableSchemaProof = DeepMutable<typeof schemaProof>;
  expect(validate(schemaProof), JSON.stringify(validate.errors)).toBe(true);
  expect(validate(containerdSchemaProof), JSON.stringify(validate.errors)).toBe(true);
  const containerdRootNamedConfig = structuredClone(containerdSchemaProof) as unknown as {
    pairs: ContainerdPairReport[];
  };
  Object.assign(containerdRootNamedConfig.pairs[0].stacks.baseline.migrationImage, {
    configDigest: containerdRootNamedConfig.pairs[0].stacks.baseline.migrationImage.assetImageDigest,
  });
  expect(validate(containerdRootNamedConfig), "containerd root named as config").toBe(false);
  const mixedModeSchemaProof = structuredClone(containerdSchemaProof) as unknown as {
    pairs: ContainerdPairReport[];
  };
  Reflect.set(
    mixedModeSchemaProof.pairs[0].stacks.baseline,
    "migrationImage",
    structuredClone(schemaProof.pairs[0].stacks.baseline.migrationImage),
  );
  expect(validate(mixedModeSchemaProof), "mixed image selection modes").toBe(false);
  const crossStackMixedModeSchemaProof = structuredClone(containerdSchemaProof) as unknown as {
    pairs: ContainerdPairReport[];
  };
  Reflect.set(
    crossStackMixedModeSchemaProof.pairs[0].stacks,
    "baseline",
    structuredClone(schemaProof.pairs[0].stacks.baseline),
  );
  expect(validate(crossStackMixedModeSchemaProof), "cross-stack mixed selection modes")
    .toBe(false);
  for (const [label, mutate] of [
    ["stack pair index", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.pairIndex = 2;
    }],
    ["scenario digest", (value: MutableSchemaProof) => {
      value.scenario.sha256 = "0".repeat(64);
    }],
    ["empty evidence", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.phases.gap.evidenceCounts.dom = 0;
    }],
    ["missing execution", (value: MutableSchemaProof) => {
      delete (value as Partial<MutableSchemaProof>).execution;
    }],
    ["gap user-cookie HMAC", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.phases.gap.hashes.userCookieHmacSha256 = "1".repeat(64);
    }],
    ["cookie descriptor overflow", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.phases.gap.cookieDescriptorCount = 33;
    }],
    ["unsafe integer", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.phases.gap.cookieDescriptorByteLength =
        Number.MAX_SAFE_INTEGER + 1;
    }],
    ["CONNECT rejection", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.connectProxy.counters.rejected = 1;
    }],
    ["missing identity-confirmed causality", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.phases.recreated.recreationCausality
        .cabinetIdentityConfirmedCount = 0;
    }],
    ["missing static provenance", (value: MutableSchemaProof) => {
      delete (value.pairs[0].stacks.baseline.browser as Partial<
        MutableSchemaProof["pairs"][number]["stacks"]["baseline"]["browser"]
      >).staticProvenance;
    }],
    ["initial static generation cardinality", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence).documentGenerationCount = 2;
    }],
    ["recreated static generation cardinality", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.recreated as unknown as
        MutableStaticGenerationEvidence).documentGenerationCount = 3;
    }],
    ["initial static document order", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence).staticLoadGraph.documentLoadLedger[0].documentKey =
          "app-profile-document";
    }],
    ["initial response declaration document order", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence).responseDeclarationLedger[0].documentKey =
          "app-profile-document";
    }],
    ["missing response declaration digest", (value: MutableSchemaProof) => {
      delete (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        Partial<MutableStaticGenerationEvidence>).responseDeclarationContractSha256;
    }],
    ["initial response declaration context", (value: MutableSchemaProof) => {
      const provenance = value.pairs[0].stacks.baseline.browser.staticProvenance as unknown as {
        initial: MutableStaticGenerationEvidence;
        recreated: MutableStaticGenerationEvidence;
      };
      provenance.initial.responseDeclarationLedger = structuredClone(
        provenance.recreated.responseDeclarationLedger,
      );
    }],
    ["recreated response declaration cardinality", (value: MutableSchemaProof) => {
      const initial = value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence;
      const recreated = value.pairs[0].stacks.baseline.browser.staticProvenance.recreated as unknown as
        MutableStaticGenerationEvidence;
      recreated.responseDeclarationLedger.push(structuredClone(
        initial.responseDeclarationLedger[1],
      ));
    }],
    ["response declaration path bound", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence).responseDeclarationLedger[0].pathSha256s = Array.from(
          { length: 257 },
          (_, index) => sha256(`schema-response-declaration-${index}`),
        ).sort();
    }],
    ["static media cardinality", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence).staticLoadGraph.documentLoadLedger[0]
        .expectedMediaPathSha256s.pop();
    }],
    ["static route declaration bound", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence).staticLoadGraph.documentLoadLedger[0]
        .routeDeclaredPathSha256s = Array.from(
          { length: 65 },
          (_, index) => sha256(`schema-route-${index}`),
        );
    }],
    ["static CSS occurrence order", (value: MutableSchemaProof) => {
      (value.pairs[0].stacks.baseline.browser.staticProvenance.initial as unknown as
        MutableStaticGenerationEvidence).staticLoadGraph.cssMediaReferenceLedger[0]
        .occurrence = 2;
    }],
    ["late browser evidence", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.browser.eventSeal.lateEventCount = 1;
    }],
    ["sparse execution events", (value: MutableSchemaProof) => {
      value.pairs[0].execution.events = new Array(8) as never;
    }],
    ["sparse cleanup stacks", (value: MutableSchemaProof) => {
      value.pairs[0].cleanup.stacks = new Array(2) as never;
    }],
    ["missing provider source digest", (value: MutableSchemaProof) => {
      value.pairs[0].stacks.baseline.browser.eventSeal.sourceDigestsPresent.provider = false;
    }],
  ] as const) {
    const nearMiss = structuredClone(schemaProof) as MutableSchemaProof;
    mutate(nearMiss);
    expect(validate(nearMiss), label).toBe(false);
    expect(() => assertChatwootPhaseProof(structuredClone(nearMiss)), label).toThrow();
  }
  for (const [label, mutate, error] of [
    ["all-six cookie descriptor bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        pair.stacks.baseline.phases.gap.cookieDescriptorCount = 33;
        pair.stacks.candidate.phases.gap.cookieDescriptorCount = 33;
      }
    }, /cookieDescriptorCount is outside its producer bound/],
    ["all-six event source bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        pair.stacks.baseline.browser.eventSeal.sourceCounts.network = 16_385;
        pair.stacks.candidate.browser.eventSeal.sourceCounts.network = 16_385;
      }
    }, /network count is outside/],
    ["all-six event aggregate bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        for (const stack of [pair.stacks.baseline, pair.stacks.candidate]) {
          stack.browser.eventSeal.eventCount = 4_097;
          stack.browser.eventSeal.sourceCounts.network = 4_085;
        }
      }
    }, /aggregate event count is outside its capture bound/],
    ["all-six cleared fixture storage bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        for (const stack of [pair.stacks.baseline, pair.stacks.candidate]) {
          stack.phases.cleared.preservedFixtureStorageByteLength = (64 * 1024) + 1;
        }
      }
    }, /cleared fixture bytes are outside the sealer bound/],
    ["all-six screenshot writer bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        for (const stack of [pair.stacks.baseline, pair.stacks.candidate]) {
          stack.phases.gap.screenshot.byteLength = (5 * 1024 * 1024) + 1;
        }
      }
    }, /screenshot bytes are outside the writer bound/],
    ["all-six boundary producer and sealer bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        for (const stack of [pair.stacks.baseline, pair.stacks.candidate]) {
          stack.phases.gap.boundaryCallCount = 1_001;
          stack.phases.gap.evidenceCounts.boundaryCalls = 1_001;
        }
      }
    }, /boundaryCallCount is outside its producer bound/],
    ["all-six interactive sealer bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        pair.stacks.baseline.phases.gap.evidenceCounts.interactive = 5_001;
        pair.stacks.candidate.phases.gap.evidenceCounts.interactive = 5_001;
      }
    }, /interactive evidence count is outside its sealer bound/],
    ["all-six unsafe integer bound", (value: MutableSchemaProof) => {
      for (const pair of value.pairs) {
        pair.stacks.baseline.phases.gap.cookieDescriptorByteLength =
          Number.MAX_SAFE_INTEGER + 1;
        pair.stacks.candidate.phases.gap.cookieDescriptorByteLength =
          Number.MAX_SAFE_INTEGER + 1;
      }
    }, /non-negative integer/],
  ] as const) {
    const nearMiss = structuredClone(schemaProof) as MutableSchemaProof;
    mutate(nearMiss);
    expect(validate(nearMiss), `${label} schema`).toBe(false);
    expect(() => assertChatwootPhaseProof(nearMiss), `${label} JS`).toThrow(error);
  }
  for (const source of [contractSource, schemaSource, documentation]) {
    expect(source).not.toContain("journey-comparison-projection");
    expect(source).not.toContain("CLEAN_PAY_UPDATE_BASELINE");
    expect(source).not.toContain("pixelmatch");
    expect(source).not.toContain("tolerance");
  }
  expect(contractSource).toContain("CHATWOOT_PHASE_PROOF_PAIR_COUNT = 3");
  expect(contractSource).toContain("CHATWOOT_PHASE_SCREENSHOT_QUORUM = 2");
  expect(sealerSource).toContain("createHmac");
  expect(sealerSource).toContain("randomBytes(32)");
  expect(sealerSource).not.toContain(".sort(");
  expect(writerSource).toContain("writeJourneySanitizedOutput");
  expect(writerSource).toContain("0o600");
  expect(writerSource).toContain("artifact-manifest.json");
  expect(cliSource).toContain("MAXIMUM_PLAN_BYTES = 256 * 1024");
  expect(cliSource).toContain("messageSha256: sha256(");
  expect(cliSource).not.toContain("message: String(error");
  expect(cliSource).not.toContain("stack: error");
  expect(documentation).toContain("context.route");
  expect(documentation).toContain("cw_conversation");
  expect(documentation).toContain("3 baseline + 3 candidate");
});

function pairReports() {
  const sealer = createChatwootPhaseEvidenceSealer();
  return Array.from({ length: CHATWOOT_PHASE_PROOF_PAIR_COUNT }, (_, index) => {
    const pairIndex = index + 1;
    const stacks = {
      baseline: stackReport("baseline", pairIndex, sealer),
      candidate: stackReport("candidate", pairIndex, sealer),
    };
    const cleanup = {
      status: "verifier-owned-stack-pair-cleaned",
      stacks: [stacks.baseline.cleanup, stacks.candidate.cleanup],
    } as const;
    return {
      pairIndex,
      cleanup,
      execution: executionEvidence(pairIndex, stacks, cleanup),
      stacks,
    };
  });
}

type ClassicStackReport = DeepMutable<ReturnType<typeof stackReport>>;
type ContainerdApplicationImage = ClassicStackReport["applicationImage"] & {
  imageSelectionMode: "containerd-root-manifest";
};
type ContainerdMigrationImage = Omit<ClassicStackReport["migrationImage"], "configDigest"> & {
  imageSelectionMode: "containerd-root-manifest";
  manifestDigest: string;
};
type ContainerdInputReceipt = Omit<
  ClassicStackReport["inputReceipt"],
  "migrationImageConfigDigest"
> & {
  applicationImageManifestDigest: string;
  applicationImageRuntimeDigest: string;
  imageSelectionMode: "containerd-root-manifest";
  migrationImageManifestDigest: string;
  migrationImageRuntimeDigest: string;
};
type ContainerdRuntimeAttestation = ClassicStackReport["runtimeAttestation"] & {
  applicationManifestDigest: string;
  imageSelectionMode: "containerd-root-manifest";
  migrationManifestDigest: string;
};
type ContainerdStackReport = Omit<
  ClassicStackReport,
  "applicationImage" | "inputReceipt" | "migrationImage" | "runtimeAttestation"
> & {
  applicationImage: ContainerdApplicationImage;
  inputReceipt: ContainerdInputReceipt;
  migrationImage: ContainerdMigrationImage;
  runtimeAttestation: ContainerdRuntimeAttestation;
};
type ClassicPairReport = DeepMutable<ReturnType<typeof pairReports>[number]>;
type ChatwootExecutionEvidence = ReturnType<typeof createChatwootExecutionEvidenceForTest>;
type ContainerdPairReport = Omit<ClassicPairReport, "execution" | "stacks"> & {
  execution: ChatwootExecutionEvidence;
  stacks: Record<"baseline" | "candidate", ContainerdStackReport>;
};

function containerdPairReports(): ContainerdPairReport[] {
  const pairs = structuredClone(pairReports()) as unknown as ContainerdPairReport[];
  for (const pair of pairs) {
    for (const role of ["baseline", "candidate"] as const) {
      const stack = pair.stacks[role];
      const application = stack.applicationImage;
      const migration = stack.migrationImage;
      const migrationManifestDigest = `sha256:${role === "baseline" ? "d" : "e"}`.padEnd(
        71,
        role === "baseline" ? "d" : "e",
      );
      application.imageSelectionMode = "containerd-root-manifest";
      application.runtimeImageDigest = application.assetImageDigest;
      application.repoDigestContractSha256 = stack.runtimeAttestation
        .applicationRepoDigestContractSha256;
      const applicationBindingContractSha256 = sha256(JSON.stringify({
        assetImageDigest: application.assetImageDigest,
        configDigest: application.configDigest,
        imageSelectionMode: application.imageSelectionMode,
        manifestDigest: application.manifestDigest,
        referenceSha256: application.referenceSha256,
        repoDigests: [application.assetImageDigest, application.manifestDigest].sort(),
        role: "application",
        runtimeImageDigest: application.runtimeImageDigest,
      }));
      Reflect.deleteProperty(migration, "configDigest");
      migration.imageSelectionMode = "containerd-root-manifest";
      migration.manifestDigest = migrationManifestDigest;
      migration.runtimeImageDigest = migration.assetImageDigest;
      migration.bindingContractSha256 = sha256(JSON.stringify({
        assetImageDigest: migration.assetImageDigest,
        imageSelectionMode: migration.imageSelectionMode,
        manifestDigest: migration.manifestDigest,
        referenceSha256: migration.referenceSha256,
        repoDigests: [migration.assetImageDigest],
        role: "migration",
        runtimeImageDigest: migration.runtimeImageDigest,
      }));

      const receipt = stack.inputReceipt;
      Reflect.deleteProperty(receipt, "migrationImageConfigDigest");
      receipt.applicationImageBindingContractSha256 = applicationBindingContractSha256;
      receipt.applicationImageManifestDigest = application.manifestDigest;
      receipt.applicationImageRuntimeDigest = application.runtimeImageDigest;
      receipt.imageSelectionMode = "containerd-root-manifest";
      receipt.migrationImageBindingContractSha256 = migration.bindingContractSha256;
      receipt.migrationImageManifestDigest = migration.manifestDigest;
      receipt.migrationImageRuntimeDigest = migration.runtimeImageDigest;

      const runtime = stack.runtimeAttestation;
      runtime.applicationImageBindingContractSha256 = applicationBindingContractSha256;
      runtime.applicationManifestDigest = application.manifestDigest;
      runtime.applicationRuntimeImageDigest = application.runtimeImageDigest;
      runtime.imageSelectionMode = "containerd-root-manifest";
      runtime.migrationImageBindingContractSha256 = migration.bindingContractSha256;
      runtime.migrationManifestDigest = migration.manifestDigest;
      runtime.migrationRuntimeImageDigest = migration.runtimeImageDigest;

      stack.runtimeBinding.applicationImageBindingContractSha256 =
        applicationBindingContractSha256;
      stack.runtimeBinding.migrationImageBindingContractSha256 = migration.bindingContractSha256;
      stack.runtimeBinding.ownedInputReceiptSha256 = sha256(JSON.stringify(receipt));
    }
    pair.execution = executionEvidence(
      pair.pairIndex,
      pair.stacks,
      pair.cleanup,
    );
  }
  return pairs;
}

function rebindContainerdMigrationImage(stack: ContainerdStackReport) {
  const migration = stack.migrationImage;
  migration.bindingContractSha256 = sha256(JSON.stringify({
    assetImageDigest: migration.assetImageDigest,
    imageSelectionMode: migration.imageSelectionMode,
    manifestDigest: migration.manifestDigest,
    referenceSha256: migration.referenceSha256,
    repoDigests: [migration.assetImageDigest],
    role: "migration",
    runtimeImageDigest: migration.runtimeImageDigest,
  }));
  stack.inputReceipt.migrationImageBindingContractSha256 = migration.bindingContractSha256;
  stack.inputReceipt.migrationImageManifestDigest = migration.manifestDigest;
  stack.inputReceipt.migrationImageRuntimeDigest = migration.runtimeImageDigest;
  stack.runtimeAttestation.migrationImageBindingContractSha256 = migration.bindingContractSha256;
  stack.runtimeAttestation.migrationManifestDigest = migration.manifestDigest;
  stack.runtimeAttestation.migrationRuntimeImageDigest = migration.runtimeImageDigest;
  stack.runtimeBinding.migrationAssetImageDigest = migration.assetImageDigest;
  stack.runtimeBinding.migrationImageBindingContractSha256 = migration.bindingContractSha256;
  stack.runtimeBinding.ownedInputReceiptSha256 = sha256(JSON.stringify(stack.inputReceipt));
}

function executionEvidence(
  pairIndex: number,
  stacks: Record<
    "baseline" | "candidate",
    ReturnType<typeof stackReport> | ContainerdStackReport
  >,
  cleanup: {
    readonly status: "verifier-owned-stack-pair-cleaned";
    readonly stacks: readonly unknown[];
  },
) {
  const roleNames = ["baseline", "candidate"] as const;
  const inputReceiptContractSha256s = roleNames.map((role) => (
    sha256(JSON.stringify(stacks[role].inputReceipt))
  ));
  const projects = roleNames.map((role) => stacks[role].runtimeBinding.projectSha256);
  const barrierSha256 = sha256(JSON.stringify({
    inputReceiptContractSha256s,
    projects,
    version: 1,
  }));
  const launch = {
    barrierSha256,
    coexistence: {
      observations: roleNames.map((role) => {
        const services = [...JOURNEY_COMPOSE_SERVICE_NAMES].sort().map((service) => ({
          containerIdSha256: sha256(`${role}:${pairIndex}:container:${service}`),
          service,
          state: (JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES as Readonly<Record<string, string>>)[
            service
          ],
        }));
        return {
          containerSetSha256: sha256(JSON.stringify(services)),
          projectSha256: stacks[role].runtimeBinding.projectSha256,
          serviceCount: services.length,
          services,
        };
      }),
      status: "both-project-container-sets-coexisted",
    },
    dispatches: roleNames.map((role, ordinal) => ({
      barrierSha256,
      ordinal,
      projectSha256: stacks[role].runtimeBinding.projectSha256,
    })),
    inputReceiptContractSha256s,
    lifecycleNotBefore: `2026-08-28T00:00:0${pairIndex}.000Z`,
    status: "dual-compose-up-dispatched-after-shared-barrier",
  };
  const finalInputChecks = Object.fromEntries(roleNames.map((role) => [role, {
    assetFileSha256: stacks[role].runtimeBinding.staticAssetSourceFileSha256,
    contractFileSha256: stacks[role].runtimeBinding.journeyContractSha256,
    status: "post-capture-inputs-unchanged",
  }]));
  const captures = Object.fromEntries(roleNames.map((role) => [role, {
    browser: stacks[role].browser,
    runScopeSha256: stacks[role].runScopeSha256,
  }]));
  const resets = Object.fromEntries(roleNames.map((role) => [role, stacks[role].reset]));
  return createChatwootExecutionEvidenceForTest({
    captures,
    cleanup,
    finalInputChecks,
    launch,
    pairIndex,
    resets,
    stacks,
  });
}

function stackReport(
  role: "baseline" | "candidate",
  pairIndex: number,
  sealer: ReturnType<typeof createChatwootPhaseEvidenceSealer>,
) {
  const projectSha256 = sha256(`${role}:project:${pairIndex}`);
  const runScope = sha256(`${role}:run-scope:${pairIndex}`);
  const connectProxyBindingSha256 = sha256(`${role}:connect:${pairIndex}`);
  const generatedEnvironmentDirectorySha256 = sha256(`${role}:environment-dir:${pairIndex}`);
  const applicationImageConfigDigest = `sha256:${role === "baseline" ? "5" : "6"}`.padEnd(
    71,
    role === "baseline" ? "5" : "6",
  );
  const migrationImageConfigDigest = `sha256:${role === "baseline" ? "7" : "8"}`.padEnd(
    71,
    role === "baseline" ? "7" : "8",
  );
  const applicationAssetImageDigest = `sha256:${role === "baseline" ? "1" : "2"}`.padEnd(
    71,
    role === "baseline" ? "1" : "2",
  );
  const migrationAssetImageDigest = `sha256:${role === "baseline" ? "3" : "4"}`.padEnd(
    71,
    role === "baseline" ? "3" : "4",
  );
  const applicationManifestDigest = `sha256:${role === "baseline" ? "9" : "a"}`.padEnd(
    71,
    role === "baseline" ? "9" : "a",
  );
  const applicationReferenceSha256 = sha256(`${role}:application-image-reference`);
  const migrationReferenceSha256 = sha256(`${role}:migration-image-reference`);
  const applicationImageBindingContractSha256 = sha256(JSON.stringify({
    assetImageDigest: applicationAssetImageDigest,
    configDigest: applicationImageConfigDigest,
    referenceSha256: applicationReferenceSha256,
    repoDigests: [applicationAssetImageDigest, applicationManifestDigest].sort(),
    role: "application",
  }));
  const migrationImageBindingContractSha256 = sha256(JSON.stringify({
    assetImageDigest: migrationAssetImageDigest,
    configDigest: migrationImageConfigDigest,
    referenceSha256: migrationReferenceSha256,
    repoDigests: [migrationAssetImageDigest],
    role: "migration",
  }));
  const fixtureStaticAssetContract = createChatwootPhaseStaticAssetContract(
    staticAssetAttestation(role),
  );
  const staticProvenance = staticProvenanceFixture(fixtureStaticAssetContract);
  const fixtureMountContractSha256 = sha256("shared:fixture-mounts");
  const fixtureBindingContractSha256 = sha256(JSON.stringify({
    globalFixtureContractSha256: fixtureContractSha256,
    mountSubsetContractSha256: fixtureMountContractSha256,
  }));
  const inputReceipt = {
    applicationImageConfigDigest,
    composeSourceSha256: sha256("shared:compose-source"),
    applicationImageBindingContractSha256,
    fixtureBindingContractSha256,
    fixtureMountSubsetContractSha256: fixtureMountContractSha256,
    fixtureSourceContractSha256: fixtureMountContractSha256,
    generatedEnvironmentDirectorySha256,
    globalFixtureContractSha256: fixtureContractSha256,
    migrationImageBindingContractSha256,
    migrationImageConfigDigest,
    imageProbeOwnershipContractSha256: sha256(`${role}:image-probes:${pairIndex}`),
    projectSha256,
    renderedComposeSha256: sha256(`${role}:rendered-compose:${pairIndex}`),
    roleEnvironmentContractSha256: sha256(`${role}:role-environment:${pairIndex}`),
    roleEnvironmentPolicySha256: sha256("shared:role-environment-policy"),
  };
  const runtimeAttestation = {
    applicationRuntimeImageDigest: applicationImageConfigDigest,
    applicationRepoDigestContractSha256: sha256(`${role}:app-repo-digests`),
    composeSourceSha256: inputReceipt.composeSourceSha256,
    composeRuntimeContractSha256: sha256(`${role}:compose-runtime:${pairIndex}`),
    fixtureMountContractSha256,
    fixtureExecutionContractSha256: sha256(`${role}:fixture-execution:${pairIndex}`),
    applicationImageBindingContractSha256:
      inputReceipt.applicationImageBindingContractSha256,
    migrationImageBindingContractSha256:
      inputReceipt.migrationImageBindingContractSha256,
    migrationRuntimeImageDigest: migrationImageConfigDigest,
    serviceIdentitySha256: sha256(`${role}:services:${pairIndex}`),
    networkSha256: sha256(`${role}:network:${pairIndex}`),
    oneShotLifecycleContractSha256: sha256(`${role}:one-shot:${pairIndex}`),
    renderedComposeSha256: inputReceipt.renderedComposeSha256,
    syntheticRoleEnvironmentContractSha256: inputReceipt.roleEnvironmentContractSha256,
    syntheticRoleEnvironmentPolicySha256: inputReceipt.roleEnvironmentPolicySha256,
  };
  return {
    role,
    pairIndex,
    proofHmacScopeSha256: sealer.proofHmacScopeSha256,
    runScopeSha256: runScope,
    applicationImage: {
      assetImageDigest: applicationAssetImageDigest,
      configDigest: applicationImageConfigDigest,
      manifestDigest: applicationManifestDigest,
      publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
      referenceSha256: applicationReferenceSha256,
      repoDigestContractSha256: runtimeAttestation.applicationRepoDigestContractSha256,
      revision: role === "baseline" ? baselineRevision : candidateRevision,
      role: "app",
      runtimeImageDigest: applicationImageConfigDigest,
    },
    migrationImage: {
      assetImageDigest: migrationAssetImageDigest,
      bindingContractSha256: migrationImageBindingContractSha256,
      configDigest: migrationImageConfigDigest,
      referenceSha256: migrationReferenceSha256,
      revision: role === "baseline" ? baselineRevision : candidateRevision,
      role: "migration",
      runtimeImageDigest: migrationImageConfigDigest,
    },
    fixtureContract: { version: "journey-v5", sha256: fixtureContractSha256 },
    publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
    inputReceipt,
    runtimeAttestation,
    runtimeBinding: {
      status: "verifier-owned-runtime-bound",
      projectSha256,
      connectProxyBindingSha256,
      journeyContractSha256: sha256(`${role}:contract:${pairIndex}`),
      migrationAssetImageDigest,
      networkSha256: runtimeAttestation.networkSha256,
      publicationsSha256: sha256(`${role}:publications:${pairIndex}`),
      serviceIdentitySha256: runtimeAttestation.serviceIdentitySha256,
      generatedEnvironmentDirectorySha256,
      fixtureMountContractSha256,
      fixtureExecutionContractSha256: runtimeAttestation.fixtureExecutionContractSha256,
      fixtureBindingContractSha256,
      globalFixtureContractSha256: fixtureContractSha256,
      composeSourceSha256: inputReceipt.composeSourceSha256,
      renderedComposeSha256: inputReceipt.renderedComposeSha256,
      composeRuntimeContractSha256: runtimeAttestation.composeRuntimeContractSha256,
      oneShotLifecycleContractSha256: runtimeAttestation.oneShotLifecycleContractSha256,
      ownedInputReceiptSha256: sha256(JSON.stringify(inputReceipt)),
      syntheticRoleEnvironmentContractSha256: inputReceipt.roleEnvironmentContractSha256,
      syntheticRoleEnvironmentPolicySha256: inputReceipt.roleEnvironmentPolicySha256,
      staticAssetAttestationSha256:
        fixtureStaticAssetContract.providerContract.attestationSha256,
      staticAssetConfigDigest: applicationImageConfigDigest,
      staticAssetImageDigest: applicationAssetImageDigest,
      staticAssetInventorySha256:
        fixtureStaticAssetContract.providerContract.inventorySha256,
      staticAssetInventoryProjectionSha256:
        fixtureStaticAssetContract.providerContract.inventoryLedgerContractSha256,
      staticAssetRouteGraphSha256:
        fixtureStaticAssetContract.providerContract.routeDeclaredPathContractSha256,
      staticAssetManifestDigest: applicationManifestDigest,
      staticAssetSourceFileSha256: sha256(`${role}:asset-source-file`),
      applicationImageBindingContractSha256:
        runtimeAttestation.applicationImageBindingContractSha256,
      applicationRepoDigestContractSha256:
        runtimeAttestation.applicationRepoDigestContractSha256,
      migrationImageBindingContractSha256:
        runtimeAttestation.migrationImageBindingContractSha256,
    },
    reset: {
      scenarioSha256: sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
      seedSha256: sha256(`clean-pay-browser-journey-v1:${CHATWOOT_PHASE_PROOF_SCENARIO}`),
      database: {
        scopeSha256: projectSha256,
        schemaSha256: sha256("shared:database-schema"),
        tableCount: 20,
        sequenceCount: 0,
        resetSequence: 1,
        transaction: "truncate-public-application-tables-cascade-no-sequences",
        redis: "flush-owned-db-0",
      },
    },
    browser: {
      playwrightVersion: "1.62.1",
      chromiumVersion: "151.0.7922.34",
      userAgentSha256: sha256("shared:user-agent"),
      processScopeSha256: sha256(`${role}:chromium-process:${pairIndex}`),
      contextScopeSha256: sha256(`${role}:chromium-context:${pairIndex}`),
      launchScopeSha256: sha256(`${role}:chromium-launch:${pairIndex}`),
      launchPolicySha256: sha256("shared:chromium-launch-policy"),
      projectBindingSha256: projectSha256,
      connectProxyBindingSha256,
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      colorScheme: "light",
      serviceWorkers: "block",
      eventSeal: {
        eventCount: 14,
        lateEventCount: 0,
        sourceCounts: {
          boundary: 2,
          browserRequests: 2,
          browserResponses: 2,
          diagnostics: 2,
          history: 2,
          network: 2,
          provider: 2,
        },
        sourceDigestsPresent: {
          boundary: true,
          browserRequests: true,
          browserResponses: true,
          diagnostics: true,
          history: true,
          network: true,
          provider: true,
        },
        stateSha256: sha256(`${role}:event-seal:${pairIndex}`),
        status: "sealed-clean",
      },
      historySemantics: {
        contractSha256: sha256("shared:history-semantics"),
        entryCount: 8,
        generationBoundaryCount: 1,
        initialEntryCount: 4,
        recreatedEntryCount: 4,
      },
      staticProvenance,
      unexpectedRequestCount: 0,
      unexpectedConsoleCount: 0,
      unexpectedPageErrorCount: 0,
      unexpectedPageCount: 0,
    },
    phases: phaseEvidence(role, pairIndex, runScope, sealer),
    connectProxy: {
      authorityLedgerCount: 4,
      authorityLedgerSha256: sha256(JSON.stringify([
        "challenges.cloudflare.com:443",
        "chatwoot.browser.clean-pay.dev:443",
        "oauth.telegram.org:443",
        "pay.ci.clean-pay.dev:443",
      ])),
      bindingSha256: connectProxyBindingSha256,
      counters: {
        accepted: 4,
        rejected: 0,
        upstreamAttempts: 4,
        upstreamConnected: 4,
        upstreamFailures: 0,
      },
      listenSha256: sha256(`${role}:connect-listen:${pairIndex}`),
      targetSha256: sha256(`${role}:connect-target:${pairIndex}`),
    },
    cleanup: {
      status: "verifier-owned-stack-cleaned",
      role,
      projectSha256,
      generatedEnvironmentDirectorySha256,
    },
  };
}

function staticProvenanceFixture(
  contract: ReturnType<typeof createChatwootPhaseStaticAssetContract>,
) {
  const initialGraph = staticLoadGraphFixture(contract, [
    "app-login-document",
    "app-profile-document",
    "app-cabinet-document",
  ]);
  const initial = finalizeChatwootPhaseBrowserContract(
    initialBrowserRecords(contract),
    {
      cssMediaReferences: initialGraph.cssMediaReferences,
      generation: "initial",
      referenceStaticContract: null,
      responseDeclarationsByDocument: initialGraph.responseDeclarationsByDocument,
      staticAssetContract: contract,
    },
  );
  const recreatedGraph = staticLoadGraphFixture(contract, [
    "app-login-document",
    "app-cabinet-document",
  ]);
  const recreated = finalizeChatwootPhaseBrowserContract(
    directCabinetBrowserRecords(contract),
    {
      cssMediaReferences: recreatedGraph.cssMediaReferences,
      generation: "recreated",
      referenceStaticContract: initial,
      responseDeclarationsByDocument: recreatedGraph.responseDeclarationsByDocument,
      staticAssetContract: contract,
    },
  );
  const generation = (
    value: typeof initial,
    documentGenerationCount: 2 | 3,
  ) => ({
    documentGenerationCount,
    requestCount: value.requestCount,
    requestContractSha256: value.requestContractSha256,
    requestOrderContractSha256: value.requestOrderContractSha256,
    requestOrderLedger: value.requestOrderLedger,
    responseDeclarationContractSha256: value.responseDeclarationContractSha256,
    responseDeclarationLedger: value.responseDeclarationLedger,
    semanticRequestLedger: value.semanticRequestLedger,
    staticLoadGraph: value.staticLoadGraph,
    staticLoadGraphContractSha256: value.staticLoadGraphContractSha256,
    staticRequestContractSha256: value.staticRequestContractSha256,
    staticRequestCount: value.staticRequestCount,
    staticRequestLedger: value.staticRequestLedger,
    staticResponseByteLength: (value.staticRequestLedger as ReadonlyArray<{
      assetBytes: number;
    }>).reduce(
      (total, entry) => total + entry.assetBytes,
      0,
    ),
  });
  return {
    assetAttestationSha256: contract.providerContract.attestationSha256,
    assetInventorySha256: contract.providerContract.inventorySha256,
    assetInventoryProjectionSha256:
      contract.providerContract.inventoryLedgerContractSha256,
    assetRouteGraphSha256: contract.providerContract.routeDeclaredPathContractSha256,
    initial: generation(initial, 3),
    recreated: generation(recreated as typeof initial, 2),
  };
}

function phaseEvidence(
  role: "baseline" | "candidate",
  pairIndex: number,
  runScope: string,
  sealer: ReturnType<typeof createChatwootPhaseEvidenceSealer>,
) {
  const conversation = `${runScope}:conversation`;
  const userCookie = `${runScope}:user-cookie`;
  const screenshot = (phase: "gap" | "stable" | "recreated") => {
    const majority = sha256(`selected:${phase}`);
    const dissent = sha256(`dissent:${role}:${phase}:${pairIndex}`);
    return {
      byteLength: pairIndex <= 2 ? 50_000 + phase.length : 51_000 + phase.length,
      sha256: pairIndex <= 2 ? majority : dissent,
    };
  };
  const gapSeal = sealer.sealPhase({
    cookies: cookieFixture("gap", runScope),
    phase: "gap",
    orderedEvidence: orderedEvidence("gap", 5, 1, 1, 1),
    conversationValue: conversation,
    userCookieValue: null,
  });
  const stableSeal = sealer.sealPhase({
    cookies: cookieFixture("stable", runScope),
    phase: "stable",
    orderedEvidence: orderedEvidence("stable", 8, 1, 1, 1),
    conversationValue: conversation,
    userCookieValue: userCookie,
  });
  const recreatedSeal = sealer.sealPhase({
    cookies: cookieFixture("recreated", runScope),
    phase: "recreated",
    orderedEvidence: orderedEvidence("recreated", 8, 1, 2, 2),
    conversationValue: conversation,
    userCookieValue: userCookie,
  });
  const clearedFixtureSeal = sealer.sealClearedFixtureStorage({
    beforeValue: "synthetic-preserved-turnstile-ledger",
    afterValue: "synthetic-preserved-turnstile-ledger",
  });
  const common = {
    authorized: true,
    conversationCookieCount: 1,
    conversationCookieByteLength: 25,
    rejectedContactProbeCount: 0,
    finalCabinetRoute: true,
    newSetUserObserved: true,
  };
  return {
    gap: {
      ...common,
      replacementRequestHeld: true,
      replacementRequestReleased: false,
      pendingWaitingForFrame: true,
      pendingAbsent: false,
      userCookieCount: 0,
      userCookieByteLength: 0,
      totalCookieCount: 3,
      localStorageKeyCount: 1,
      sessionStorageKeyCount: 1,
      serverActionCount: 1,
      storedIdentityPresent: false,
      storedOwnershipPresent: true,
      conversationEqualsInMemoryOwnership: true,
      ownershipFingerprintMatchesConversation: true,
      sdkIdentifierPresent: false,
      conversationEqualsSdkIdentifier: false,
      conversationSameAsPriorPhase: false,
      userCookieSameAsPriorSettledPhase: false,
      setUserCount: 1,
      frameLoadedCount: 1,
      identityConfirmedCount: 0,
      boundaryCallCount: 5,
      contactProbeCount: 1,
      ...mutablePhaseSeal(gapSeal),
      recreationCausality: null,
      screenshot: screenshot("gap"),
    },
    stable: {
      ...common,
      replacementRequestHeld: false,
      replacementRequestReleased: true,
      pendingWaitingForFrame: false,
      pendingAbsent: true,
      userCookieCount: 1,
      userCookieByteLength: 23,
      totalCookieCount: 4,
      localStorageKeyCount: 1,
      sessionStorageKeyCount: 1,
      serverActionCount: 1,
      storedIdentityPresent: true,
      storedOwnershipPresent: false,
      conversationEqualsInMemoryOwnership: true,
      ownershipFingerprintMatchesConversation: false,
      sdkIdentifierPresent: true,
      conversationEqualsSdkIdentifier: true,
      conversationSameAsPriorPhase: true,
      userCookieSameAsPriorSettledPhase: false,
      setUserCount: 2,
      frameLoadedCount: 2,
      identityConfirmedCount: 1,
      boundaryCallCount: 8,
      contactProbeCount: 1,
      ...mutablePhaseSeal(stableSeal),
      recreationCausality: null,
      screenshot: screenshot("stable"),
    },
    cleared: {
      exactApplicationOrigin: true,
      beforeCookieCount: 5,
      beforeLocalStorageKeyCount: 1,
      beforeSessionStorageKeyCount: 1,
      afterCookieCount: 0,
      afterLocalStorageKeyCount: 0,
      afterSessionStorageKeyCount: 1,
      conversationCookieAbsent: true,
      userCookieAbsent: true,
      preservedFixtureStorageByteExact:
        clearedFixtureSeal.preservedFixtureStorageByteExact as boolean,
      preservedFixtureStorageByteLength:
        clearedFixtureSeal.preservedFixtureStorageByteLength,
      preservedFixtureStorageHmacSha256:
        clearedFixtureSeal.preservedFixtureStorageHmacSha256,
    },
    recreated: {
      ...common,
      replacementRequestHeld: false,
      replacementRequestReleased: true,
      pendingWaitingForFrame: false,
      pendingAbsent: true,
      userCookieCount: 1,
      userCookieByteLength: 23,
      totalCookieCount: 4,
      localStorageKeyCount: 1,
      sessionStorageKeyCount: 1,
      serverActionCount: 1,
      storedIdentityPresent: true,
      storedOwnershipPresent: false,
      conversationEqualsInMemoryOwnership: true,
      ownershipFingerprintMatchesConversation: false,
      sdkIdentifierPresent: true,
      conversationEqualsSdkIdentifier: true,
      conversationSameAsPriorPhase: true,
      userCookieSameAsPriorSettledPhase: true,
      setUserCount: 1,
      frameLoadedCount: 2,
      identityConfirmedCount: 1,
      boundaryCallCount: 8,
      contactProbeCount: 2,
      ...mutablePhaseSeal(recreatedSeal),
      recreationCausality: {
        postClearLoginCount: 1,
        postClearCabinetNavigationCount: 1,
        negativeLoginSetUserCount: 0,
        negativeLoginConversationCookieAbsent: true,
        negativeLoginUserCookieAbsent: true,
        firstCabinetSetUserBeforeConversationCookiePresent: true,
        firstCabinetSetUserBeforeUserCookieAbsent: true,
        cabinetIdentityConfirmedObservedAfterSetUser: true,
        cabinetIdentityConfirmedConversationCookiePresent: true,
        cabinetIdentityConfirmedUserCookiePresent: true,
        cabinetConversationCookieObservedAfterSetUser: true,
        cabinetUserCookieObservedAfterSetUser: true,
        finalCookiePairPresent: true,
        postClearSetUserCount: 1,
        cabinetSetUserCount: 1,
        cabinetIdentityConfirmedCount: 1,
        eventOrdinals: {
          clearVerified: 1,
          loginDocumentReached: 2,
          negativeLoginCheckpoint: 3,
          cabinetDocumentReached: 4,
          cabinetSetUserObserved: 5,
          cabinetIdentityConfirmedObserved: 6,
          cabinetCookiePairObserved: 7,
          cabinetCompleted: 8,
          finalCookiePairObserved: 9,
        },
      },
      screenshot: screenshot("recreated"),
    },
  };
}

function mutablePhaseSeal(
  seal: ReturnType<ReturnType<typeof createChatwootPhaseEvidenceSealer>["sealPhase"]>,
) {
  return {
    cookieDescriptorByteLength: seal.cookieDescriptorByteLength,
    cookieDescriptorCount: seal.cookieDescriptorCount,
    cookieValueByteLength: seal.cookieValueByteLength,
    hashes: { ...seal.hashes } as Record<string, string | null>,
    evidenceCounts: { ...seal.evidenceCounts } as Record<string, number>,
    evidenceRanges: Object.fromEntries(Object.entries(seal.evidenceRanges).map(
      ([category, range]) => [category, { ...range }],
    )) as Record<string, { firstHmacSha256: string; lastHmacSha256: string }>,
  };
}

function orderedEvidence(
  phase: "gap" | "stable" | "recreated",
  boundaryCallCount: number,
  serverActionCount: number,
  providerLedgerCount: number,
  providerEffectCount: number,
) {
  const entries = (category: string, count: number) => (
    Array.from({ length: count }, (_, index) => `${phase}:${category}:${index}`)
  );
  return {
    accessibility: entries("accessibility", 3),
    boundaryCalls: entries("boundary", boundaryCallCount),
    computedStyles: entries("styles", 3),
    dom: entries("dom", 3),
    interactive: entries("interactive", 2),
    providerEffects: entries("provider-effects", providerEffectCount),
    providerLedger: entries("provider-ledger", providerLedgerCount),
    requestSequence: entries("request", 8),
    serverActions: entries("server-action", serverActionCount),
    storage: entries("storage", 2),
  };
}

function inputDocument(parent = path.join(path.parse(process.cwd()).root, "external-chatwoot-proof")) {
  return {
    schemaVersion: 1,
    kind: "clean-pay-chatwoot-phase-proof-input",
    pairs: Array.from({ length: 3 }, (_, index) => ({
      pairIndex: index + 1,
      baseline: stackInput("baseline", index + 1, parent),
      candidate: stackInput("candidate", index + 1, parent),
    })),
  };
}

function canonicalEvidenceInput(dynamicDigest: string) {
  const actionIdentifier = { bytes: 64, sha256: dynamicDigest };
  const actionPayload = { bytes: 96, sha256: dynamicDigest };
  const actionUrl = {
    origin: "<app-origin>",
    pathname: "/cabinet",
    query: [],
    fragment: null,
  };
  const providerEntry = (sequence: number, effect: string) => ({
    sequence,
    service: "remnashop",
    method: "POST",
    pathname: "/api/v1/public/auth/telegram",
    query_keys: [],
    body_bytes: 80,
    body_sha256: dynamicDigest,
    body_contract: {
      actor: {
        kind: "dynamic",
        format: "telegram-id",
        bytes: 9,
        sha256: dynamicDigest,
      },
    },
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: {
      authorization_scheme: "Bearer",
      cookie_names: [],
      header_names: ["authorization"],
    },
    effect,
  });
  return {
    accessibility: "- document\n  - heading \"Личный кабинет\" [level=1]",
    browserRequests: [{
      classification: { key: "app-cabinet-action", disposition: "continue" },
      redirectEdge: null,
      responseContentType: "text/x-component",
      responseStatus: 200,
    }],
    boundaryCalls: [{ method: "setUser", identifierBytes: 64 }],
    computedStyles: [{ path: "html > body", visible: true }],
    dom: { type: "element", tag: "html", attributes: [], children: [] },
    fixtureContractSha256,
    interactive: [{ path: "html > body > button", disabled: false, loading: false }],
    network: {
      requests: [{
        index: 0,
        method: "POST",
        url: actionUrl,
        scope: "application",
        resourceType: "fetch",
        navigation: false,
        serverAction: { present: true, identifier: actionIdentifier },
        requestHeaders: [{ name: "next-action", value: actionIdentifier }],
        postData: actionPayload,
        redirectedFrom: null,
        response: { status: 200 },
        failure: null,
        externalTransport: null,
      }],
      serverActionCount: 1,
      serverActions: [{
        order: 0,
        requestIndex: 0,
        method: "POST",
        url: actionUrl,
        identifier: actionIdentifier,
        payload: actionPayload,
        status: 200,
      }],
    },
    providerEffects: {
      entries: [
        providerEntry(1, "session_created"),
        providerEntry(2, "contact_identity_probed"),
      ],
      database: { tableCount: 20, rowCount: 3 },
    },
    storage: { local: [], session: [], cacheNames: [], serviceWorkerScopes: [] },
  };
}

type ProviderFixturePhase = "gap" | "stable" | "recreated";

const initialProviderEffects = [
  "challenge_verified",
  "authorization_code_issued",
  "token_exchanged",
  "auth_session_issued",
  "read_profile",
  "read_profile",
  "read_profile",
  "read_referral_program",
  "read_subscription",
  "read_offers",
  "read_devices",
  "read_user_by_uuid",
  "read_profile",
  "read_subscription",
  "contact_identity_probed",
] as const;

const recreatedProviderEffects = [
  ...initialProviderEffects,
  "challenge_verified",
  "authorization_code_issued",
  "token_exchanged",
  "auth_session_issued",
  "read_profile",
  "read_profile",
  "read_profile",
  "read_referral_program",
  "read_subscription",
  "read_offers",
  "read_devices",
  "read_user_by_uuid",
  "contact_identity_probed",
] as const;

function strictProviderFixture(phase: ProviderFixturePhase) {
  const effects = phase === "recreated" ? recreatedProviderEffects : initialProviderEffects;
  return {
    entries: effects.map((effect, index) => providerFixtureEntry(effect, index + 1)),
    database: {
      schemaSha256: sha256("strict-provider-schema"),
      sequenceCount: 0,
      tables: [
        { name: "Session", count: 1 },
        { name: "User", count: 1 },
      ],
    },
  };
}

function providerFixtureEntry(effect: string, sequence: number) {
  const endpoint = providerFixtureEndpoint(effect);
  const bodyContract = providerFixtureBody(effect, sequence);
  return {
    sequence,
    service: endpoint.service,
    method: endpoint.method,
    pathname: endpoint.pathname,
    query_keys: endpoint.queryKeys,
    body_bytes: endpoint.method === "GET" ? 0 : 128 + sequence,
    body_sha256: endpoint.method === "GET" ? sha256("") : sha256(`${effect}:${sequence}:body`),
    body_contract: bodyContract,
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: endpoint.credentials,
    effect,
  };
}

function providerFixtureEndpoint(effect: string) {
  const none = { authorization_scheme: null, cookie_names: [], header_names: [] };
  const accessToken = {
    authorization_scheme: null,
    cookie_names: ["access_token"],
    header_names: [],
  };
  const endpoints: Record<string, {
    credentials: {
      authorization_scheme: string | null;
      cookie_names: string[];
      header_names: string[];
    };
    method: string;
    pathname: string;
    queryKeys: string[];
    service: string;
  }> = {
    challenge_verified: {
      service: "turnstile",
      method: "POST",
      pathname: "/turnstile/v0/siteverify",
      queryKeys: [],
      credentials: none,
    },
    authorization_code_issued: {
      service: "telegram-oidc",
      method: "GET",
      pathname: "/auth",
      queryKeys: [
        "client_id", "code_challenge", "code_challenge_method", "nonce", "redirect_uri",
        "response_type", "scope", "state",
      ],
      credentials: none,
    },
    token_exchanged: {
      service: "telegram-oidc",
      method: "POST",
      pathname: "/token",
      queryKeys: [],
      credentials: {
        authorization_scheme: "Basic",
        cookie_names: [],
        header_names: ["authorization"],
      },
    },
    auth_session_issued: {
      service: "remnashop",
      method: "POST",
      pathname: "/api/v1/public/auth/telegram",
      queryKeys: [],
      credentials: {
        authorization_scheme: null,
        cookie_names: [],
        header_names: ["x-remnashop-auth-service-key"],
      },
    },
    read_profile: {
      service: "remnashop",
      method: "GET",
      pathname: "/api/v1/public/auth/me",
      queryKeys: [],
      credentials: {
        authorization_scheme: null,
        cookie_names: ["access_token"],
        header_names: ["x-remnashop-auth-service-key"],
      },
    },
    read_referral_program: {
      service: "remnashop",
      method: "GET",
      pathname: "/api/v1/public/referral/program",
      queryKeys: [],
      credentials: accessToken,
    },
    read_subscription: {
      service: "remnashop",
      method: "GET",
      pathname: "/api/v1/public/subscription/current",
      queryKeys: [],
      credentials: accessToken,
    },
    read_offers: {
      service: "remnashop",
      method: "GET",
      pathname: "/api/v1/public/subscription/offers",
      queryKeys: [],
      credentials: accessToken,
    },
    read_devices: {
      service: "remnashop",
      method: "GET",
      pathname: "/api/v1/public/subscription/devices",
      queryKeys: [],
      credentials: accessToken,
    },
    read_user_by_uuid: {
      service: "remnawave",
      method: "GET",
      pathname: "/api/users/rw-browser-1",
      queryKeys: [],
      credentials: {
        authorization_scheme: "Bearer",
        cookie_names: [],
        header_names: ["authorization"],
      },
    },
    contact_identity_probed: {
      service: "chatwoot",
      method: "GET",
      pathname: "/api/v1/widget/contact",
      queryKeys: ["website_token"],
      credentials: {
        authorization_scheme: null,
        cookie_names: [],
        header_names: ["x-auth-token"],
      },
    },
  };
  const endpoint = endpoints[effect];
  if (!endpoint) throw new Error(`Missing provider fixture endpoint for ${effect}.`);
  return endpoint;
}

function providerFixtureBody(effect: string, sequence: number): unknown {
  const digest = (kind: string, format: string, bytes: number, name: string) => ({
    kind,
    format,
    bytes,
    sha256: sha256(`${effect}:${sequence}:${name}`),
  });
  const callbackUrl = {
    kind: "url",
    origin: "https://pay.ci.clean-pay.dev",
    path: ["", "auth", "telegram", "callback"],
    query: [],
    fragment: null,
  };
  if (effect === "challenge_verified") return {
    encoding: "urlencoded",
    fields: [
      {
        name: "response",
        value: `synthetic-turnstile-token:auth_login:synthetic-turnstile-1:${sequence}`,
      },
      { name: "secret", value: digest("redacted", "secret", 64, "secret") },
    ],
  };
  if (effect === "authorization_code_issued") return {
    encoding: "query",
    fields: [
      { name: "client_id", value: digest("redacted", "oidc-client-id", 10, "client") },
      {
        name: "code_challenge",
        value: digest("dynamic", "oidc-code-challenge", 43, "challenge"),
      },
      { name: "code_challenge_method", value: "S256" },
      { name: "nonce", value: digest("dynamic", "oidc-nonce", 43, "nonce") },
      { name: "redirect_uri", value: callbackUrl },
      { name: "response_type", value: "code" },
      { name: "scope", value: "openid profile" },
      { name: "state", value: digest("dynamic", "oidc-state", 43, "state") },
    ],
  };
  if (effect === "token_exchanged") return {
    encoding: "urlencoded",
    fields: [
      { name: "client_id", value: digest("redacted", "oidc-client-id", 10, "client") },
      { name: "code", value: digest("dynamic", "oidc-code", 48, "code") },
      {
        name: "code_verifier",
        value: digest("dynamic", "oidc-code-verifier", 86, "verifier"),
      },
      { name: "grant_type", value: "authorization_code" },
      { name: "redirect_uri", value: callbackUrl },
    ],
  };
  if (effect === "auth_session_issued") return {
    encoding: "json",
    value: {
      auth_date: digest("dynamic", "unix-seconds", 10, "auth-date"),
      first_name: digest("redacted", "synthetic-profile-field", 9, "first-name"),
      hash: digest("dynamic", "telegram-signature", 64, "hash"),
      id: digest("redacted", "synthetic-identity", 9, "id"),
      last_name: digest("redacted", "synthetic-profile-field", 12, "last-name"),
      photo_url: {
        kind: "url",
        origin: "<external-origin>",
        path: ["", "avatar.png"],
        query: [],
        fragment: null,
      },
      username: digest("redacted", "synthetic-profile-field", 22, "username"),
    },
  };
  return null;
}

function stackInput(role: "baseline" | "candidate", pairIndex: number, parent: string) {
  const ordinal = (pairIndex - 1) * 2 + (role === "baseline" ? 0 : 1);
  const generatedEnvironmentPath = path.join(parent, `pair-${pairIndex}-${role}`);
  return {
    assetAttestationPath: path.join(
      parent,
      `production-image-assets-${role}-${pairIndex}.json`,
    ),
    contractPath: path.join(generatedEnvironmentPath, "browser-journey-contract.json"),
    generatedEnvironmentPath,
    controlUrl: `http://127.0.0.1:${15100 + ordinal}/`,
    resolverIp: `127.0.0.${20 + ordinal}`,
    imageDigest: `sha256:${role === "baseline" ? "1" : "2"}`.padEnd(
      71,
      role === "baseline" ? "1" : "2",
    ),
    migrationImageDigest: `sha256:${role === "baseline" ? "3" : "4"}`.padEnd(
      71,
      role === "baseline" ? "3" : "4",
    ),
  };
}

function journeyContract(role: "baseline" | "candidate", pairIndex: number) {
  const ordinal = (pairIndex - 1) * 2 + (role === "baseline" ? 0 : 1);
  return {
    schemaVersion: 1,
    kind: "self-contained-synthetic-browser-journey",
    project: createChatwootPhaseComposeProjectName(
      role,
      pairIndex,
      (role === "baseline" ? "1" : "2").repeat(12),
    ),
    revision: role === "baseline" ? baselineRevision : candidateRevision,
    images: {
      application: `clean-pay:${role}`,
      migration: "clean-pay-migration:shared",
    },
    publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
    fixtureContract: {
      domain: "clean-pay-browser-journey-fixture-v5",
      sha256: fixtureContractSha256,
    },
    publications: {
      app: `127.0.0.1:${14100 + ordinal}`,
      providerControl: `127.0.0.1:${15100 + ordinal}`,
      connectProxy: `127.0.0.1:${16100 + ordinal}`,
      browserTls: `127.0.0.${20 + ordinal}:443`,
    },
    secretSource: "deterministic synthetic fixture labels; no external env or credential file",
    ownedStateReset: {
      postgres: "transactional truncate of public application tables; migrations retained; schema has no sequences",
      redis: "flush DB 0 on the project-local redis service",
      scope: "exact COMPOSE_PROJECT_NAME label and internal service DNS only",
    },
  };
}

function resetEvidence(project: string) {
  return {
    status: "reset",
    scenario_sha256: sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
    seed_sha256: sha256(`clean-pay-browser-journey-v1:${CHATWOOT_PHASE_PROOF_SCENARIO}`),
    state: {
      access_owners: 0,
      consumed_turnstile_tokens: 0,
      ledger: 0,
      owner_profiles: 0,
      payment_disconnect_injection_armed: false,
      payment_idempotency: 0,
      payment_rate_limit_injection_armed: false,
      payment_sequence: 0,
      payments: 0,
      profiles: 0,
      refresh_owners: 0,
      registered_emails: 0,
      remnawave_users: 1,
      scenario_telegram_id_format: "9-digit-synthetic",
      sequence: 0,
      subscriptionless_owners: 0,
      telegram_owner_aliases: 0,
    },
    oidc: {
      status: "reset",
      codes: 0,
      authorize_sequence: 0,
      event_count: 0,
      key_id: "clean-pay-browser-journey-oidc-key",
      seed_sha256: sha256("clean-pay-browser-journey-v1"),
      scenario_sha256: sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
      subject_format: "9-digit-synthetic",
    },
    database: {
      status: "reset",
      scopeContract: "exact-compose-project-label",
      scopeSha256: sha256(project),
      schemaSha256: sha256("shared:database-schema"),
      tableCount: 20,
      sequenceCount: 0,
      resetSequence: 1,
      transaction: "truncate-public-application-tables-cascade-no-sequences",
      redis: "flush-owned-db-0",
    },
  };
}

async function writeEvidencePngs(
  state: Awaited<ReturnType<typeof prepareChatwootPhaseEvidenceDirectory>>,
  reports: ReturnType<typeof pairReports>,
) {
  for (const pair of reports) {
    for (const role of ["baseline", "candidate"] as const) {
      for (const phase of ["gap", "stable", "recreated"] as const) {
        const variant = pair.pairIndex <= 2 ? "selected" : `${role}-dissent`;
        const bytes = pngFixture(`${phase}:${variant}`);
        pair.stacks[role].phases[phase].screenshot = {
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        };
        await writeRawChatwootPhaseScreenshot({
          state,
          pairIndex: pair.pairIndex,
          role,
          phase,
          bytes,
        });
      }
    }
  }
}

function cookieFixture(phase: "gap" | "stable" | "recreated", scope: string) {
  const cookie = (
    name: string,
    value: string,
    domain: string,
    httpOnly: boolean,
  ) => ({
    domain,
    expires: -1,
    httpOnly,
    name,
    path: "/",
    sameSite: "Lax" as const,
    secure: true,
    value,
  });
  const cookies = [
    cookie("access_token", `${scope}:access`, "pay.ci.clean-pay.dev", true),
    cookie("refresh_token", `${scope}:refresh`, "pay.ci.clean-pay.dev", true),
    cookie("cw_conversation", `${scope}:conversation`, "pay.ci.clean-pay.dev", false),
    cookie("provider_session", `${scope}:provider`, "chatwoot.browser.clean-pay.dev", true),
  ];
  if (phase !== "gap") {
    cookies.push(cookie(
      `cw_user_${sha256("synthetic-user").slice(0, 16)}`,
      `${scope}:user`,
      "pay.ci.clean-pay.dev",
      false,
    ));
  }
  return cookies;
}

function staticAssetAttestation(role?: "baseline" | "candidate") {
  const variant = role ?? "generic";
  const bodies = staticAssetBodyFixture(variant);
  const fixturePaths = staticFixturePaths(variant);
  const paths = Object.keys(bodies).sort();
  const clientReferences = [
    ["/cabinet/page", "app-cabinet-document"],
    ["/login/page", "app-login-document"],
    ["/profile/page", "app-profile-document"],
  ].map(([route, documentKey]) => ({
    route,
    declaredStaticChunks: fixturePaths.routeChunksByDocument[documentKey].slice().sort(),
  }));
  return {
    attestationSha256: sha256(role ? `${role}:asset-attestation` : "static-attestation"),
    source: {
      configDigest: role
        ? `sha256:${role === "baseline" ? "5".repeat(64) : "6".repeat(64)}`
        : `sha256:${"1".repeat(64)}`,
      imageDigest: role
        ? `sha256:${role === "baseline" ? "1".repeat(64) : "2".repeat(64)}`
        : `sha256:${"2".repeat(64)}`,
      manifestDigest: role
        ? `sha256:${role === "baseline" ? "9".repeat(64) : "a".repeat(64)}`
        : `sha256:${"3".repeat(64)}`,
    },
    inventory: {
      inventorySha256: sha256(role ? `${role}:asset-inventory` : "static-inventory"),
      staticChunks: paths.map((servedPath) => ({
        imagePath: servedPath.replace("/_next/", "/app/.next/"),
        servedPath,
        sha256: sha256(bodies[servedPath]),
        size: Buffer.byteLength(bodies[servedPath], "utf8"),
      })),
      clientReferences,
    },
  };
}

function staticFixturePaths(variant: "baseline" | "candidate" | "generic") {
  const chunk = (name: string) => `/_next/static/chunks/${name}-${variant}.js`;
  const media = (name: string, extension: string) => (
    `/_next/static/media/${name}-${variant}.${extension}`
  );
  const app = chunk("app");
  const routeChunksByDocument: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
    "app-cabinet-document": Object.freeze([app, chunk("cabinet")].sort()),
    "app-login-document": Object.freeze([app, chunk("login")].sort()),
    "app-profile-document": Object.freeze([app, chunk("profile")].sort()),
  });
  return Object.freeze({
    css: `/_next/static/chunks/styles-${variant}.css`,
    layout: chunk("layout"),
    media: Object.freeze({
      brand: media("brand", "svg"),
      interWoff2: media("inter", "woff2"),
      primeiconsEot: media("primeicons", "eot"),
      primeiconsTtf: media("primeicons", "ttf"),
      primeiconsWoff: media("primeicons", "woff"),
      primeiconsWoff2: media("primeicons", "woff2"),
    }),
    routeChunksByDocument,
  });
}

function staticAssetBodyFixture(
  variant: "baseline" | "candidate" | "generic" = "generic",
): Readonly<Record<string, string>> {
  const paths = staticFixturePaths(variant);
  return Object.freeze({
    [paths.routeChunksByDocument["app-login-document"][0]]:
      `self.__cleanPay='chatwoot-phase-${variant}';\n`,
    [paths.routeChunksByDocument["app-login-document"][1]]:
      `self.__cleanPayLogin='${variant}';\n`,
    [paths.routeChunksByDocument["app-profile-document"][1]]:
      `self.__cleanPayProfile='${variant}';\n`,
    [paths.routeChunksByDocument["app-cabinet-document"][1]]:
      `self.__cleanPayCabinet='${variant}';\n`,
    [paths.layout]: `self.__cleanPayLayout='${variant}';\n`,
    [paths.css]:
      `@font-face{src:url(../media/primeicons-${variant}.eot);`
      + `src:url(../media/primeicons-${variant}.eot),url(../media/inter-${variant}.woff2),`
      + `url(../media/primeicons-${variant}.woff),url(../media/primeicons-${variant}.ttf),`
      + `url(../media/brand-${variant}.svg)}`
      + `@font-face{src:url(../media/inter-${variant}.woff2)}`
      + `@font-face{src:url(../media/primeicons-${variant}.woff2)}\n`,
    [paths.media.brand]: `<svg xmlns="http://www.w3.org/2000/svg" data-role="${variant}"/>\n`,
    [paths.media.interWoff2]: `synthetic-inter-woff2-${variant}`,
    [paths.media.primeiconsEot]: `synthetic-eot-${variant}`,
    [paths.media.primeiconsTtf]: `synthetic-ttf-${variant}`,
    [paths.media.primeiconsWoff]: `synthetic-woff-${variant}`,
    [paths.media.primeiconsWoff2]: `synthetic-primeicons-woff2-${variant}`,
  });
}

function staticFixtureVariantForContract(
  contract: ReturnType<typeof createChatwootPhaseStaticAssetContract>,
): "baseline" | "candidate" | "generic" {
  for (const variant of ["baseline", "candidate", "generic"] as const) {
    if (Object.hasOwn(contract.providerContract.inventoryByPath, staticFixturePaths(variant).css)) {
      return variant;
    }
  }
  throw new Error("Static fixture contract has no exact role-specific path partition.");
}

function staticContentType(servedPath: string) {
  if (servedPath.endsWith(".js")) return "application/javascript";
  if (servedPath.endsWith(".css")) return "text/css";
  if (servedPath.endsWith(".eot")) return "application/vnd.ms-fontobject";
  if (servedPath.endsWith(".ttf")) return "font/ttf";
  if (servedPath.endsWith(".woff")) return "font/woff";
  if (servedPath.endsWith(".woff2")) return "font/woff2";
  if (servedPath.endsWith(".svg")) return "image/svg+xml";
  throw new Error("Static fixture content type is unknown.");
}

function staticLoadGraphFixture(
  contract: ReturnType<typeof createChatwootPhaseStaticAssetContract>,
  documentKeys: ReadonlyArray<
    "app-login-document" | "app-profile-document" | "app-cabinet-document"
  >,
) {
  const variant = staticFixtureVariantForContract(contract);
  const bodies = staticAssetBodyFixture(variant);
  const paths = staticFixturePaths(variant);
  const responseOnlyPaths = [
    paths.layout,
    paths.css,
    ...Object.values(paths.media),
  ];
  return {
    cssMediaReferences: extractProviderOverlapCssMediaReferences(
      Buffer.from(bodies[paths.css], "utf8"),
      paths.css,
      contract.providerContract,
    ),
    responseDeclarationsByDocument: documentKeys.map((documentKey) => ({
      documentKey,
      paths: [
        ...paths.routeChunksByDocument[documentKey],
        ...responseOnlyPaths,
      ].sort(),
    })),
    staticAssetContract: contract.providerContract,
  };
}

function staticRecordsForDocument(
  contract: ReturnType<typeof createChatwootPhaseStaticAssetContract>,
  documentKey: "app-login-document" | "app-profile-document" | "app-cabinet-document",
) {
  const variant = staticFixtureVariantForContract(contract);
  const paths = staticFixturePaths(variant);
  const observedPaths = [
    ...paths.routeChunksByDocument[documentKey],
    paths.layout,
    paths.css,
    paths.media.interWoff2,
    paths.media.primeiconsWoff2,
  ];
  const bodies = staticAssetBodyFixture(variant);
  return observedPaths.map((staticPath) => ({
    classification: {
      disposition: "continue",
      expectedStatuses: [200],
      key: staticPath.endsWith(".js") ? "next-static-js"
        : staticPath.endsWith(".css") ? "next-static-css" : "next-static-font",
      navigation: false,
      staticAssetSha256: (contract.providerContract.inventoryByPath as Readonly<
        Record<string, string>
      >)[staticPath],
      staticPath,
    },
    documentKey,
    redirectEdge: null,
    responseContentType: staticContentType(staticPath),
    responseFailureSha256: null,
    responseStatus: 200,
    staticResponseBytes: Buffer.byteLength(bodies[staticPath], "utf8"),
    staticResponseSha256: sha256(bodies[staticPath]),
  }));
}

function initialBrowserRecords(
  contract: ReturnType<typeof createChatwootPhaseStaticAssetContract>,
) {
  const record = browserRecordFixture(contract);
  return [
    record("app-login-document", "app-login-document", 200, "text/html", {
      navigation: true,
    }),
    ...staticRecordsForDocument(contract, "app-login-document"),
    record("turnstile-widget-script", "app-login-document", 200, "application/javascript"),
    record("chatwoot-sdk-script", "app-login-document", 200, "application/javascript"),
    record("chatwoot-widget-frame", "app-login-document", 200, "text/html"),
    record("app-telegram-start", "app-login-document", 307, "application/octet-stream", {
      navigation: true,
    }),
    record("telegram-oidc-authorize", "app-login-document", 302, null, {
      edge: "app-telegram-start:307->telegram-oidc-authorize",
      navigation: true,
    }),
    record("app-telegram-callback", "app-login-document", 307, "application/octet-stream", {
      edge: "telegram-oidc-authorize:302->app-telegram-callback",
      navigation: true,
    }),
    record("app-profile-document", "app-profile-document", 200, "text/html", {
      edge: "app-telegram-callback:307->app-profile-document",
      navigation: true,
    }),
    ...staticRecordsForDocument(contract, "app-profile-document"),
    record("app-cabinet-document", "app-cabinet-document", 200, "text/html", {
      navigation: true,
    }),
    ...staticRecordsForDocument(contract, "app-cabinet-document"),
  ];
}

function browserRecordFixture(
  contract: ReturnType<typeof createChatwootPhaseStaticAssetContract>,
) {
  return (
    key: string,
    documentKey: "app-login-document" | "app-profile-document" | "app-cabinet-document",
    status: number,
    contentType: string | null,
    options: { edge?: string; navigation?: boolean; staticPath?: string } = {},
  ) => ({
    classification: {
      disposition: "continue",
      expectedStatuses: [status],
      key,
      navigation: options.navigation ?? false,
      staticAssetSha256: options.staticPath
        ? (contract.providerContract.inventoryByPath as Readonly<Record<string, string>>)[
            options.staticPath
          ]
        : null,
      staticPath: options.staticPath ?? null,
    },
    documentKey,
    redirectEdge: options.edge ?? null,
    responseContentType: contentType,
    responseFailureSha256: null,
    responseStatus: status,
    staticResponseBytes: null,
    staticResponseSha256: null,
  });
}

function directCabinetBrowserRecords(
  contract: ReturnType<typeof createChatwootPhaseStaticAssetContract>,
) {
  const record = browserRecordFixture(contract);
  return [
    record("app-login-document", "app-login-document", 200, "text/html", {
      navigation: true,
    }),
    ...staticRecordsForDocument(contract, "app-login-document"),
    record("turnstile-widget-script", "app-login-document", 200, "application/javascript"),
    record("app-telegram-start", "app-login-document", 307, "application/octet-stream", {
      navigation: true,
    }),
    record("telegram-oidc-authorize", "app-login-document", 302, null, {
      edge: "app-telegram-start:307->telegram-oidc-authorize",
      navigation: true,
    }),
    record("app-telegram-callback", "app-login-document", 307, "application/octet-stream", {
      edge: "telegram-oidc-authorize:302->app-telegram-callback",
      navigation: true,
    }),
    record("app-cabinet-document", "app-cabinet-document", 200, "text/html", {
      edge: "app-telegram-callback:307->app-cabinet-document",
      navigation: true,
    }),
    ...staticRecordsForDocument(contract, "app-cabinet-document"),
    record("chatwoot-sdk-script", "app-cabinet-document", 200, "application/javascript"),
    record("chatwoot-widget-frame", "app-cabinet-document", 200, "text/html"),
  ];
}

function pngFixture(label: string, width = 1440, height = 900, includeMetadata = false) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const color = Buffer.from(sha256(label).slice(0, 6), "hex");
  const rowBytes = (width * 4) + 1;
  const raster = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * rowBytes;
    raster[offset] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + (column * 4);
      raster[pixel] = color[0];
      raster[pixel + 1] = color[1];
      raster[pixel + 2] = color[2];
      raster[pixel + 3] = 255;
    }
  }
  const image = deflateSync(raster);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    ...(includeMetadata ? [pngChunk("tEXt", Buffer.from("forbidden\0metadata", "utf8"))] : []),
    pngChunk("IDAT", image),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngFixtureWithInvalidRaster() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1440, 0);
  header.writeUInt32BE(900, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.from("not-deflate", "ascii")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
