import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { validateProductionImageAssetAttestation } from "../../../scripts/security/prove-served-cabinet-assets.mjs";

import {
  journeyChromiumLaunchArgs,
  journeyConnectProxy,
} from "./journey-browser-policy.mjs";
import {
  assertJourneyConnectProxyGate,
  startJourneyConnectProxy,
  stopJourneyConnectProxy,
} from "./journey-connect-proxy-controller.mjs";
import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-manifest.mjs";
import {
  JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES,
  JOURNEY_COMPOSE_ONE_SHOT_SERVICE_NAMES,
  JOURNEY_COMPOSE_SERVICE_NAMES,
} from "./journey-compose-runtime-attestation.mjs";
import {
  collectJourneyDockerFailureEvidence,
  journeyDockerCliEnvironment,
  runJourneyDockerCommand,
  withJourneyOwnedStackPair,
  writeJourneySanitizedOutput,
} from "./journey-owned-stack-orchestrator.mjs";
import { createJourneySanitizedErrorEvidence } from "./journey-error-evidence.mjs";
import {
  attestProviderOverlapStaticResponse,
  assertProviderOverlapRedirect,
  captureProviderOverlapResponseEvidence,
  classifyProviderOverlapBrowserRequest,
  createProviderOverlapCdpResponseBodyCapture,
  createJourneyBrowserRequestEnvelope,
  createProviderOverlapEventSeal,
  createProviderOverlapPendingRequestEvidence,
  createProviderOverlapPendingRequestEvidenceDocument,
  createProviderOverlapPendingRequestSeal,
  createProviderOverlapRejectedRequestProvenance,
  createProviderOverlapRejectionProvenanceDocument,
  createProviderOverlapRepeatableStaticResponseUrls,
  createProviderOverlapStaticAssetContract,
  extractProviderOverlapCssMediaReferences,
  extractProviderOverlapResponseStaticDeclarations,
  finalizeProviderOverlapBrowserContract,
  finalizeProviderOverlapEventLifecycle,
  finalizeProviderOverlapHistoryContract,
  installProviderOverlapHistoryInstrumentation,
  isProviderOverlapPlaywrightBodyCdpResponse,
  normalizeProviderOverlapObservedResponseContentType,
  providerOverlapChatwootIdentityBoundarySettled,
  PROVIDER_OVERLAP_MAXIMUM_STATIC_RESPONSE_BYTES,
  PROVIDER_OVERLAP_REJECTION_PROVENANCE_MAX_PER_ROLE,
  resolveProviderOverlapResponseRequestEntry,
} from "./provider-overlap-browser-contract.mjs";
import {
  PROVIDER_OVERLAP_ACTION,
  PROVIDER_OVERLAP_BROWSER_PROJECT,
  assertApplicationImageIdentity,
  assertDeterministicReset,
  assertJourneyStackContract,
  assertLoopbackControlUrl,
  assertLoopbackResolver,
  assertProviderOverlapClassicImageDescriptor,
  assertProviderOverlapContainerdImageDescriptorChain,
  assertProviderOverlapImagePlatformParity,
  createDualProviderOverlapProof,
  createProviderOverlapStackReport,
  extractProviderOverlapProof,
  resolveProviderOverlapOutputPath,
  sha256,
} from "./provider-overlap-proof-contract.mjs";

const repositoryRoot = path.resolve(process.cwd());
const providerResponseDurableNetworkBufferBytes = 1024 * 1024 * 1024;
const providerResponseDurableResourceBufferBytes = 128 * 1024 * 1024;
const providerStaticDocumentKeys = Object.freeze([
  "app-login-document",
  "app-profile-document",
  "app-cabinet-document",
]);
const providerPlaywrightBodyKeys = Object.freeze([
  "app-cabinet-action",
  "app-login-root-rsc",
  "app-profile-action",
  "chatwoot-widget-conversation-frame",
  "chatwoot-widget-frame",
]);
const providerOverlapConnectAuthorityLedger = Object.freeze([
  "challenges.cloudflare.com:443",
  "chatwoot.browser.clean-pay.dev:443",
  "oauth.telegram.org:443",
  "pay.ci.clean-pay.dev:443",
].sort());
let argumentsByName;
let captureId;
let failureOutputPath;
let scenario;
let outputPath;
const providerRejectionProvenanceState = {
  baseline: { entries: [], truncated: false },
  candidate: { entries: [], truncated: false },
};
const providerFailurePhaseState = {
  baseline: null,
  candidate: null,
};
const providerPendingRequestEvidenceState = {
  baseline: { entries: new Map(), overflow: false },
  candidate: { entries: new Map(), overflow: false },
};
const providerResponseCaptureFailureState = {
  baseline: null,
  candidate: null,
};
const providerBrowserDiagnosticState = {
  baseline: null,
  candidate: null,
};

try {
  argumentsByName = parseArguments(process.argv.slice(2));
  captureId = requiredArgument(argumentsByName, "--capture-id", /^[a-f0-9]{16}$/);
  await assertRepositoryRoot();
  failureOutputPath = await exactProviderFailureOutputPath(
    process.env.CLEAN_PAY_PROVIDER_OVERLAP_FAILURE_OUTPUT,
    captureId,
  );
  scenario = requiredArgument(argumentsByName, "--scenario", /^provider-overlap-v1$/);
  outputPath = resolveProviderOverlapOutputPath(
    requiredArgument(argumentsByName, "--output", /.+/),
  );
  await assertNewPrivateOutput(outputPath);
  const fixtureContractSha256 = await currentJourneyFixtureContractSha256Async();
  const playwrightVersion = await installedPlaywrightVersion();
  const baselineInput = await readStackInput("baseline");
  const candidateInput = await readStackInput("candidate");
  assertDistinctStackInputs(baselineInput, candidateInput);
  const proofSession = await withJourneyOwnedStackPair({
    baseline: ownedStackInput(baselineInput),
    candidate: ownedStackInput(candidateInput),
  }, async (owned) => {
    const preflightSettlements = await Promise.all([
      settleEvidence(preflightStack(
        baselineInput,
        fixtureContractSha256,
        owned.baseline.runtime,
        owned.baseline.inputReceipt,
        owned.launch,
      )),
      settleEvidence(preflightStack(
        candidateInput,
        fixtureContractSha256,
        owned.candidate.runtime,
        owned.candidate.inputReceipt,
        owned.launch,
      )),
    ]);
    if (preflightSettlements.some(({ status }) => status === "rejected")) {
      throw new AggregateError(
        rejectionReasons(preflightSettlements),
        "Both dual-image preflights must settle before verifier-owned cleanup.",
      );
    }
    const [baselinePreflight, candidatePreflight] = preflightSettlements
      .map(({ value }) => value);
    assertDualPreflight(baselinePreflight, candidatePreflight);
    const proxyHandles = await startBothConnectProxies([baselineInput, candidateInput]);
    let runSettlements = [];
    let proofOperationFailure;
    let proxyCleanupFailure;
    let proxySummaries;
    try {
      runSettlements = await Promise.all([
        settleEvidence(proveStack(baselineInput, baselinePreflight, playwrightVersion)),
        settleEvidence(proveStack(candidateInput, candidatePreflight, playwrightVersion)),
      ]);
    } catch (reason) {
      proofOperationFailure = { reason };
    } finally {
      try {
        proxySummaries = await stopBothConnectProxies(proxyHandles);
      } catch (reason) {
        proxyCleanupFailure = { reason };
      }
    }
    const runErrors = proofOperationFailure === undefined
      ? rejectionReasons(runSettlements)
      : [proofOperationFailure.reason];
    if (proxyCleanupFailure !== undefined) {
      if (runErrors.length > 0) {
        throw new AggregateError(
          [...runErrors, proxyCleanupFailure.reason],
          "Dual-image proof and CONNECT cleanup both failed.",
        );
      }
      throw proxyCleanupFailure.reason;
    }
    if (runErrors.length > 0) {
      throw new AggregateError(
        runErrors,
        "Both concurrent dual-image proofs must settle before exact cleanup.",
      );
    }
    const runs = runSettlements.map(({ value }) => value);
    const proofInputs = [baselineInput, candidateInput];
    const [baseline, candidate] = runs.map((run, index) => {
      const proxyEvidence = assertJourneyConnectProxyGate(proxySummaries[index], {
        accepted: 4,
        authorityLedger: providerOverlapConnectAuthorityLedger,
        listen: proofInputs[index].contract.publications.connectProxy,
        target: `${proofInputs[index].resolverIp}:443`,
      });
      return createProviderOverlapStackReport({
        ...run,
        connectProxyAuthorityLedger: proxyEvidence.authorityLedger,
        connectProxyCounters: proxyEvidence.counters,
      });
    });
    return Object.freeze({ baseline, candidate });
  });
  const document = createDualProviderOverlapProof(
    proofSession.value.baseline,
    proofSession.value.candidate,
    proofSession.cleanup,
    proofSession.launch,
  );
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeJourneySanitizedOutput(outputPath, bytes);
  process.stdout.write(`${JSON.stringify({
    status: "dual_image_provider_overlap_proven",
    schemaVersion: document.schemaVersion,
    baselineImageDigest: document.stacks.baseline.applicationImage.assetImageDigest,
    candidateImageDigest: document.stacks.candidate.applicationImage.assetImageDigest,
    fixtureContractSha256,
    proofSha256: sha256(bytes),
  })}\n`);
} catch (error) {
  await emitProviderFailure(error);
  process.exitCode = 1;
}

async function emitProviderFailure(primaryError) {
  let failure = primaryError;
  let bytes = providerFailureBytes(failure);
  if (failureOutputPath !== undefined) {
    try {
      const receipt = await writeJourneySanitizedOutput(failureOutputPath, bytes);
      if (receipt.status !== "sanitized-create-only-output-written"
        || receipt.bytes !== bytes.byteLength
        || receipt.sha256 !== sha256(bytes)) {
        throw new Error("Provider overlap failure publication receipt is invalid.");
      }
    } catch (publicationError) {
      failure = new AggregateError(
        [primaryError, publicationError],
        "Provider overlap proof failed and its sanitized evidence was not sealed.",
      );
      bytes = providerFailureBytes(failure);
    }
  }
  process.stderr.write(bytes);
}

function providerFailureBytes(error) {
  const dockerFailures = collectJourneyDockerFailureEvidence(error);
  const pendingRequestEvidence = currentProviderPendingRequestEvidence();
  const rejectedRequestProvenance = currentProviderRejectionProvenance();
  const providerFailurePhases = currentProviderFailurePhases();
  const responseCaptureFailureEvidence = currentProviderResponseCaptureFailureEvidence();
  const browserDiagnosticEvidence = currentProviderBrowserDiagnosticEvidence();
  return Buffer.from(`${JSON.stringify({
    status: "dual_image_provider_overlap_failed",
    ...(dockerFailures.length === 0 ? {} : { dockerFailures }),
    ...(pendingRequestEvidence === undefined ? {} : { pendingRequestEvidence }),
    ...(rejectedRequestProvenance === undefined ? {} : { rejectedRequestProvenance }),
    ...(providerFailurePhases === undefined ? {} : { providerFailurePhases }),
    ...(responseCaptureFailureEvidence === undefined
      ? {} : { responseCaptureFailureEvidence }),
    ...(browserDiagnosticEvidence === undefined ? {} : { browserDiagnosticEvidence }),
    ...createJourneySanitizedErrorEvidence(error),
  })}\n`, "utf8");
}

function markProviderFailurePhase(role, phase) {
  if (!Object.hasOwn(providerFailurePhaseState, role)
    || typeof phase !== "string" || !/^[a-z0-9-]{1,64}$/.test(phase)) {
    throw new Error("Provider overlap failure phase is invalid.");
  }
  providerFailurePhaseState[role] = phase;
}

function currentProviderFailurePhases() {
  const phases = Object.freeze({
    baseline: providerFailurePhaseState.baseline,
    candidate: providerFailurePhaseState.candidate,
  });
  return Object.values(phases).some((phase) => phase !== null) ? phases : undefined;
}

function retainProviderResponseCaptureFailure(role, source, error, snapshot) {
  if (!Object.hasOwn(providerResponseCaptureFailureState, role)
    || !new Set([
      "cdp-event", "final-assert", "navigation-prior-requests", "request-terminal-evidence",
      "response-evidence",
    ]).has(source)) {
    return error;
  }
  if (providerResponseCaptureFailureState[role] === null) {
    const message = error instanceof Error ? error.message : String(error);
    let kind = "unclassified";
    let terminalEvidence;
    if (/^Durable browser response body read failed: failureSha256=[a-f0-9]{64}\.$/.test(message)) {
      kind = "durable-body-read";
    } else if (/^Durable browser response did not finish cleanly: failureSha256=[a-f0-9]{64}\.$/.test(message)) {
      kind = "durable-terminal";
    } else if (/^CDP response body capture failed: failureSha256=[a-f0-9]{64}\.$/.test(message)) {
      kind = "cdp-contract";
    } else if (/^Browser response did not finish cleanly: key=[a-z0-9-]{1,64}; status=[0-9]{3}; failureSha256=[a-f0-9]{64}\.$/.test(message)) {
      kind = "playwright-terminal";
      const match = /^Browser response did not finish cleanly: key=([a-z0-9-]{1,64}); status=([0-9]{3}); failureSha256=([a-f0-9]{64})\.$/.exec(message);
      if (match === null) throw new Error("Provider response terminal evidence is invalid.");
      terminalEvidence = Object.freeze({
        failureSha256: match[3],
        key: match[1],
        status: Number(match[2]),
      });
    } else if (/^[a-z0-9 -]{1,128} exceeded its bounded lifecycle\.$/i.test(message)) {
      kind = "bounded-lifecycle";
    }
    const safeSnapshot = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? Object.freeze({ ...snapshot })
      : null;
    providerResponseCaptureFailureState[role] = Object.freeze({
      kind,
      messageSha256: sha256(message),
      snapshot: safeSnapshot,
      source,
      ...(terminalEvidence === undefined ? {} : { terminalEvidence }),
    });
  }
  return error;
}

function currentProviderResponseCaptureFailureEvidence() {
  const roles = {};
  for (const role of ["baseline", "candidate"]) {
    const evidence = providerResponseCaptureFailureState[role];
    if (evidence !== null) roles[role] = evidence;
  }
  return Object.keys(roles).length === 0
    ? undefined
    : Object.freeze({ roles: Object.freeze(roles), schemaVersion: 1 });
}

function currentProviderBrowserDiagnosticEvidence() {
  const roles = {};
  for (const role of ["baseline", "candidate"]) {
    const state = providerBrowserDiagnosticState[role];
    if (state === null || (state.unexpectedConsole.length === 0
      && state.unexpectedPageErrors.length === 0
      && !state.unexpectedConsoleOverflow
      && !state.unexpectedPageErrorOverflow)) continue;
    roles[role] = Object.freeze({
      consoleEntries: Object.freeze(state.unexpectedConsole.map((entry) => Object.freeze({
        argumentCount: entry.argumentCount,
        columnNumber: entry.columnNumber,
        kind: entry.kind,
        lineNumber: entry.lineNumber,
        locationSha256: entry.locationSha256,
        markers: entry.markers,
        messageBytes: entry.messageBytes,
        messageShape: entry.messageShape,
        messageSha256: entry.sha256,
        source: entry.source,
        type: entry.type,
        wordLengths: entry.wordLengths,
      }))),
      consoleOverflow: state.unexpectedConsoleOverflow,
      pageErrorMessageSha256: Object.freeze([...state.unexpectedPageErrors]),
      pageErrorOverflow: state.unexpectedPageErrorOverflow,
    });
  }
  return Object.keys(roles).length === 0
    ? undefined
    : Object.freeze({ roles: Object.freeze(roles), schemaVersion: 1 });
}

function createProviderBrowserConsoleDiagnostic(message) {
  const text = message.text();
  const type = message.type();
  const location = message.location();
  const markerVocabulary = Object.freeze([
    "aria", "autocomplete", "cookie", "csp", "deprecated", "feature", "font", "form",
    "height", "iframe", "image", "network", "permissions", "preload", "resource", "sandbox",
    "scroll", "source map", "unique", "width",
  ]);
  const lowerText = text.toLowerCase();
  const markers = Object.freeze(markerVocabulary.filter((marker) => lowerText.includes(marker)));
  const messageStructure = providerBrowserConsoleMessageStructure(text);
  let kind = "unclassified";
  if (type === "warning"
    && /^The resource https:\/\/[^\s]+ was preloaded using link preload but not used within a few seconds from the window's load event\. Please make sure it has an appropriate `as` value and it is preloaded intentionally\.$/.test(text)) {
    kind = "chromium-unused-preload";
  } else if (type === "warning" && /^\[DOM\] Input elements should have autocomplete attributes /.test(text)) {
    kind = "chromium-dom-autocomplete";
  } else if (type === "warning" && /^\[DOM\] Multiple forms should be contained in their own form elements/.test(text)) {
    kind = "chromium-dom-multiple-forms";
  } else if (type === "warning" && text.startsWith("Skipping auto-scroll behavior due to")) {
    kind = "next-auto-scroll-skip";
  } else if (type === "warning" && text === "Service Worker registration blocked by Playwright") {
    kind = "playwright-service-worker-block";
  } else if (type === "warning" && /iframe.*allow-scripts.*allow-same-origin.*sandbox/i.test(text)) {
    kind = "chromium-iframe-sandbox";
  } else if (/^Refused to /.test(text)) {
    kind = "chromium-policy-refusal";
  } else if (/^Failed to load resource: /.test(text)) {
    kind = "chromium-resource-load";
  }
  let source = "empty";
  if (location.url) {
    try {
      const origin = new URL(location.url).origin;
      source = ({
        "https://challenges.cloudflare.com": "turnstile",
        "https://chatwoot.browser.clean-pay.dev": "chatwoot",
        "https://oauth.telegram.org": "telegram-oidc",
        "https://pay.ci.clean-pay.dev": "application",
      })[origin] ?? "other-url";
    } catch {
      source = "non-url";
    }
  }
  return Object.freeze({
    argumentCount: message.args().length,
    columnNumber: Number.isSafeInteger(location.columnNumber) ? location.columnNumber : 0,
    kind,
    lineNumber: Number.isSafeInteger(location.lineNumber) ? location.lineNumber : 0,
    locationSha256: sha256(location.url ?? ""),
    markers,
    messageBytes: Buffer.byteLength(text, "utf8"),
    messageShape: messageStructure.shape,
    sha256: sha256(text),
    source,
    type,
    wordLengths: messageStructure.wordLengths,
  });
}

function providerBrowserConsoleMessageStructure(value) {
  if (Buffer.byteLength(value, "utf8") > 256) {
    return Object.freeze({ shape: "oversized", wordLengths: Object.freeze([]) });
  }
  if (!/^[\x20-\x7e]*$/.test(value)) {
    return Object.freeze({ shape: "non-ascii", wordLengths: Object.freeze([]) });
  }
  return Object.freeze({
    shape: value.replace(/[A-Za-z]/g, "a").replace(/[0-9]/g, "0"),
    wordLengths: Object.freeze([...value.matchAll(/[A-Za-z0-9]+/g)].map(([word]) => word.length)),
  });
}

function isExpectedPlaywrightServiceWorkerBlockDiagnostic(value) {
  return value.argumentCount === 1
    && value.columnNumber === 86
    && value.kind === "playwright-service-worker-block"
    && value.lineNumber === 2
    && value.locationSha256 === sha256("")
    && value.markers.length === 0
    && value.messageBytes === 49
    && value.messageShape === "aaaaaaa aaaaaa aaaaaaaaaaaa aaaaaaa aa aaaaaaaaaa"
    && value.sha256 === "7c247915a6102bc050349adcfad2bb0e2ba2a7f711b03f33080b19d0c24fa03b"
    && value.source === "empty"
    && value.type === "warning"
    && JSON.stringify(value.wordLengths) === JSON.stringify([7, 6, 12, 7, 2, 10]);
}

function recordProviderPendingRequest(role, request) {
  const state = providerPendingRequestEvidenceState[role];
  if (!state || !request || typeof request !== "object" || state.entries.has(request)) return;
  if (state.entries.size >= 256) {
    state.overflow = true;
    return;
  }
  let evidence;
  try {
    evidence = createProviderOverlapPendingRequestEvidence({
      isNavigation: request.isNavigationRequest(),
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  } catch {
    evidence = Object.freeze({
      isNavigation: false,
      methodSha256: sha256("UNAVAILABLE"),
      originSha256: sha256("https://unavailable.provider-overlap.invalid"),
      pathSha256: sha256("/"),
      resourceTypeSha256: sha256("other"),
    });
  }
  state.entries.set(request, evidence);
}

function completeProviderPendingRequest(role, request) {
  providerPendingRequestEvidenceState[role]?.entries.delete(request);
}

function currentProviderPendingRequestEvidence() {
  const maximumEntriesPerRole = 16;
  const roles = {};
  let hasEvidence = false;
  for (const role of ["baseline", "candidate"]) {
    const state = providerPendingRequestEvidenceState[role];
    const entries = [...state.entries.values()].slice(0, maximumEntriesPerRole);
    const trackedPendingCount = state.entries.size;
    const truncated = state.overflow || trackedPendingCount > maximumEntriesPerRole;
    hasEvidence ||= trackedPendingCount > 0 || truncated;
    roles[role] = Object.freeze({
      entries: Object.freeze(entries),
      trackedPendingCount,
      truncated,
    });
  }
  return hasEvidence ? createProviderOverlapPendingRequestEvidenceDocument(roles) : undefined;
}

function recordProviderRejectionProvenance(role, provenance) {
  const state = providerRejectionProvenanceState[role];
  if (!state) return;
  if (state.entries.length >= PROVIDER_OVERLAP_REJECTION_PROVENANCE_MAX_PER_ROLE) {
    state.truncated = true;
    return;
  }
  state.entries.push(provenance);
}

function currentProviderRejectionProvenance() {
  const hasEvidence = ["baseline", "candidate"].some((role) => {
    const state = providerRejectionProvenanceState[role];
    return state.entries.length > 0 || state.truncated;
  });
  return hasEvidence
    ? createProviderOverlapRejectionProvenanceDocument(providerRejectionProvenanceState)
    : undefined;
}

async function readStackInput(role) {
  const contractPath = await exactExternalFile(
    requiredArgument(argumentsByName, `--${role}-contract`, /.+/),
    `${role} contract`,
  );
  const contractBytes = await readBoundedBytes(contractPath, 64 * 1024, `${role} contract`);
  const contract = assertJourneyStackContract(parseJson(contractBytes, `${role} contract`), role);
  const controlUrl = assertLoopbackControlUrl(
    requiredArgument(argumentsByName, `--${role}-control-url`, /.+/),
    contract.publications.providerControl,
    `${role} control URL`,
  );
  const resolverIp = assertLoopbackResolver(
    requiredArgument(argumentsByName, `--${role}-resolver-ip`, /.+/),
    contract.publications.browserTls,
    `${role} resolver IP`,
  );
  const expectedAssetImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-asset-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  const expectedMigrationAssetImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-migration-asset-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  const assetAttestationPath = await exactExternalFile(
    requiredArgument(argumentsByName, `--${role}-asset-attestation`, /.+/),
    `${role} production image asset attestation`,
  );
  const assetAttestationDocument = await readBoundedJson(
    assetAttestationPath,
    32 * 1024 * 1024,
    `${role} production image asset attestation`,
  );
  const expectedPlatform = Object.freeze(parseAssetPlatform(assetAttestationDocument));
  const assetAttestation = validateProductionImageAssetAttestation(
    assetAttestationDocument,
    {
      fixtureContract: {
        version: "journey-v5",
        sha256: contract.fixtureContract.sha256,
      },
      imageDigest: expectedAssetImageDigest,
      platform: expectedPlatform,
      publicBuildContract: contract.publicBuildContract,
      revision: contract.revision,
    },
    role,
  );
  return {
    role,
    contract,
    controlUrl,
    resolverIp,
    expectedAssetImageDigest,
    expectedApplicationImageConfigDigest: assetAttestation.source.configDigest,
    expectedApplicationManifestDigest: assetAttestation.source.manifestDigest,
    expectedApplicationRepoDigests: Object.freeze([...new Set([
      assetAttestation.source.imageDigest,
      assetAttestation.source.manifestDigest,
    ])].sort()),
    expectedPlatform,
    expectedMigrationAssetImageDigest,
    assetAttestationPath,
    staticAssetContract: createProviderOverlapStaticAssetContract(assetAttestation),
    contractPath,
    journeyContractSha256: sha256(contractBytes),
  };
}

async function proveStack(input, preflight, playwrightVersion) {
  markProviderFailurePhase(input.role, "reset-provider-fixture");
  const reset = assertDeterministicReset(
    await controlJson(input.controlUrl, "/__reset", {
      method: "POST",
      body: { scenario },
    }),
    scenario,
    input.contract.project,
    input.role,
  );
  markProviderFailurePhase(input.role, "exercise-browser-cabinet");
  const browserRun = await exerciseCabinet(
    input.role,
    input.resolverIp,
    `http://${input.contract.publications.connectProxy}`,
    playwrightVersion,
    input.staticAssetContract,
    async () => {
      const armed = await controlJson(input.controlUrl, "/__inject", {
        method: "POST",
        body: { action: PROVIDER_OVERLAP_ACTION },
      });
      if (
        JSON.stringify(armed)
          !== JSON.stringify({ status: "armed", action: PROVIDER_OVERLAP_ACTION })
      ) {
        throw new Error(`${input.role} overlap barrier did not return its exact armed contract.`);
      }
    },
  );
  markProviderFailurePhase(input.role, "read-provider-concurrency-ledger");
  const providerOverlap = extractProviderOverlapProof(
    await controlJson(input.controlUrl, "/__concurrency"),
    await controlJson(input.controlUrl, "/__ledger", {}, 2 * 1024 * 1024),
    input.role,
  );
  markProviderFailurePhase(input.role, "complete-provider-proof");
  return {
    role: input.role,
    contract: input.contract,
    journeyContractSha256: input.journeyContractSha256,
    fixtureContractSha256: input.contract.fixtureContract.sha256,
    scenario,
    imageIdentity: preflight.imageIdentity,
    runtimeBinding: preflight.runtimeBinding,
    reset,
    browser: browserRun.browser,
    navigation: browserRun.navigation,
    providerOverlap,
  };
}

async function exerciseCabinet(
  role,
  resolverIp,
  connectProxyUrl,
  playwrightVersion,
  staticAssetContract,
  armOverlap,
) {
  const maximumUnexpectedEvents = 32;
  markProviderFailurePhase(role, "launch-browser");
  const browser = await chromium.launch({
    headless: true,
    args: journeyChromiumLaunchArgs(resolverIp),
    proxy: journeyConnectProxy(connectProxyUrl),
  });
  let browserClosed = false;
  try {
    markProviderFailurePhase(role, "create-browser-context");
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      colorScheme: "light",
      reducedMotion: "reduce",
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
    });
    // A successful 256-request proof records exactly three lifecycle events per
    // request, four history events and the one exact Playwright service-worker
    // warning, so 1,024 retains a bounded margin above the valid 773-event ledger.
    const eventSeal = createProviderOverlapEventSeal(1_024);
    const historyRecords = [];
    let historyOverflow = false;
    let historyCaptureActive = false;
    markProviderFailurePhase(role, "install-history-binding");
    await context.exposeBinding("__cleanPayProviderHistory", ({ frame }, record) => {
      if (!historyCaptureActive) return;
      eventSeal.record();
      if (frame !== frame.page().mainFrame()) {
        historyOverflow = true;
        return;
      }
      if (historyRecords.length >= 128) {
        historyOverflow = true;
        return;
      }
      historyRecords.push(record);
    });
    markProviderFailurePhase(role, "install-history-instrumentation");
    await context.addInitScript(installProviderOverlapHistoryInstrumentation);
    markProviderFailurePhase(role, "create-browser-page");
    const page = await context.newPage();
    markProviderFailurePhase(role, "create-cdp-session");
    const cdp = await context.newCDPSession(page);
    await Promise.all([
      cdp.send("Network.enable", {
        enableDurableMessages: true,
        maxResourceBufferSize: providerResponseDurableResourceBufferBytes,
        maxTotalBufferSize: providerResponseDurableNetworkBufferBytes,
      }),
      cdp.send("Page.enable"),
    ]);
    /**
     * @param {{frame: {id: string, loaderId: string, parentId?: string, url: string}, type: string}}
     * event
     */
    const handleFrameNavigated = ({ frame, type }) => {
      if (!historyCaptureActive || frame.parentId !== undefined) return;
      eventSeal.record();
      if (historyRecords.length >= 128) {
        historyOverflow = true;
        return;
      }
      historyRecords.push({
        frameId: frame.id,
        kind: "document-navigation",
        loaderId: frame.loaderId,
        navigationType: type,
        url: frame.url,
      });
    };
    /** @param {{frameId: string, navigationType: string, url: string}} event */
    const handleNavigatedWithinDocument = ({ frameId, navigationType, url }) => {
      if (!historyCaptureActive) return;
      eventSeal.record();
      if (historyRecords.length >= 128) {
        historyOverflow = true;
        return;
      }
      historyRecords.push({
        frameId,
        kind: "same-document-navigation",
        navigationType,
        url,
      });
    };
    cdp.on("Page.frameNavigated", handleFrameNavigated);
    cdp.on("Page.navigatedWithinDocument", handleNavigatedWithinDocument);
    const unexpectedPages = [];
    const expectedPlaywrightConsole = [];
    const unexpectedConsole = [];
    const unexpectedPageErrors = [];
    let unexpectedPageOverflow = false;
    let expectedPlaywrightConsoleOverflow = false;
    let unexpectedConsoleOverflow = false;
    let unexpectedPageErrorOverflow = false;
    providerBrowserDiagnosticState[role] = {
      get unexpectedConsoleOverflow() { return unexpectedConsoleOverflow; },
      get unexpectedPageErrorOverflow() { return unexpectedPageErrorOverflow; },
      unexpectedConsole,
      unexpectedPageErrors,
    };
    context.on("page", (candidate) => {
      eventSeal.record();
      if (candidate === page) return;
      if (unexpectedPages.length < maximumUnexpectedEvents) {
        unexpectedPages.push(sha256(candidate.url()));
      } else {
        unexpectedPageOverflow = true;
      }
    });
    page.on("console", (message) => {
      eventSeal.record();
      const diagnostic = createProviderBrowserConsoleDiagnostic(message);
      if (isExpectedPlaywrightServiceWorkerBlockDiagnostic(diagnostic)) {
        if (expectedPlaywrightConsole.length < maximumUnexpectedEvents) {
          expectedPlaywrightConsole.push(diagnostic);
        } else {
          expectedPlaywrightConsoleOverflow = true;
        }
      } else if (unexpectedConsole.length < maximumUnexpectedEvents) {
        unexpectedConsole.push(diagnostic);
      } else {
        unexpectedConsoleOverflow = true;
      }
    });
    page.on("pageerror", (error) => {
      eventSeal.record();
      if (unexpectedPageErrors.length < maximumUnexpectedEvents) {
        unexpectedPageErrors.push(sha256(String(error?.message ?? error)));
      } else {
        unexpectedPageErrorOverflow = true;
      }
    });
    const unexpectedRequests = [];
    let unexpectedRequestOverflow = false;
    const browserRequests = [];
    const browserRequestByIdentity = new Map();
    const browserRequestPreparationByIdentity = new Map();
    const browserResponseEvidenceByIdentity = new Map();
    const browserResponseTerminalByIdentity = new WeakMap();
    const browserTerminalRequestIdentities = new Set();
    let browserResponseCaptureFailure = null;
    const cdpResponseBodyCapture = createProviderOverlapCdpResponseBodyCapture({
      repeatableStaticResponseUrls:
        createProviderOverlapRepeatableStaticResponseUrls(staticAssetContract),
      send: (method, parameters) => cdp.send(method, parameters),
    });
    const assertCdpResponseBodyCaptureClean = () => {
      try {
        return cdpResponseBodyCapture.assertClean();
      } catch (error) {
        browserResponseCaptureFailure ??= retainProviderResponseCaptureFailure(
          role,
          "final-assert",
          error,
          cdpResponseBodyCapture.snapshot(),
        );
        throw browserResponseCaptureFailure;
      }
    };
    const observeCdpResponseBodyEvent = (observe, event) => {
      try {
        observe(event);
      } catch (error) {
        browserResponseCaptureFailure ??= retainProviderResponseCaptureFailure(
          role,
          "cdp-event",
          error,
          cdpResponseBodyCapture.snapshot(),
        );
      }
    };
    const handleCdpResponseReceived = (event) => {
      // Chatwoot widget documents may live in an OOPIF whose body cannot be
      // read from the page CDP session. Their two exact classifications retain
      // the bounded Playwright fallback; the same-origin SDK stays in CDP.
      if (isProviderOverlapPlaywrightBodyCdpResponse(event)) return;
      observeCdpResponseBodyEvent(cdpResponseBodyCapture.observeResponseReceived, event);
    };
    const handleCdpLoadingFinished = (event) => observeCdpResponseBodyEvent(
      cdpResponseBodyCapture.observeLoadingFinished,
      event,
    );
    const handleCdpLoadingFailed = (event) => observeCdpResponseBodyEvent(
      cdpResponseBodyCapture.observeLoadingFailed,
      event,
    );
    cdp.on("Network.responseReceived", handleCdpResponseReceived);
    cdp.on("Network.loadingFinished", handleCdpLoadingFinished);
    cdp.on("Network.loadingFailed", handleCdpLoadingFailed);
    let currentStaticDocumentKey = null;
    let cabinetDocumentAllowed = false;
    let cabinetDocumentConsumed = false;
    let unexpectedWebSocketCount = 0;
    let unexpectedServiceWorkerCount = 0;
    markProviderFailurePhase(role, "install-websocket-routing");
    await context.routeWebSocket("**/*", async (webSocket) => {
      const finishWebSocket = eventSeal.begin();
      try {
        unexpectedWebSocketCount = Math.min(
          unexpectedWebSocketCount + 1,
          maximumUnexpectedEvents + 1,
        );
        await webSocket.close({ code: 1008, reason: "provider-overlap-contract" });
      } finally {
        finishWebSocket();
      }
    });
    context.on("serviceworker", () => {
      eventSeal.record();
      unexpectedServiceWorkerCount = Math.min(
        unexpectedServiceWorkerCount + 1,
        maximumUnexpectedEvents + 1,
      );
    });
    const pendingRequestSeal = createProviderOverlapPendingRequestSeal(256);
    const waitForResponseCaptureQuiet = async () => {
      const checkpoint = await pendingRequestSeal.waitForQuiet({ timeoutMs: 15_000 });
      if (browserResponseCaptureFailure) throw browserResponseCaptureFailure;
      return checkpoint;
    };
    const recordUnexpectedRequest = (rawUrl) => {
      if (unexpectedRequests.length < maximumUnexpectedEvents) {
        unexpectedRequests.push(sha256(rawUrl));
      } else {
        unexpectedRequestOverflow = true;
      }
    };
    const createRejectedPreparation = (reasonCode, request, rawUrl, rejection) => {
      let provenance;
      try {
        const isNavigation = request.isNavigationRequest();
        let requestFrame;
        try {
          requestFrame = request.frame();
        } catch {
          requestFrame = undefined;
        }
        provenance = createProviderOverlapRejectedRequestProvenance({
          reasonCode,
          rejectionMessage: rejection instanceof Error ? rejection.message : reasonCode,
          requestEnvelope: {
            isMainFrame: isNavigation && requestFrame === page.mainFrame(),
            isNavigation,
            method: request.method(),
            resourceType: request.resourceType(),
            url: rawUrl,
          },
        });
      } catch {
        provenance = createProviderOverlapRejectedRequestProvenance({
          reasonCode,
          rejectionMessage: "provider-rejection-provenance-unavailable",
          requestEnvelope: {
            isMainFrame: false,
            isNavigation: false,
            method: "UNAVAILABLE",
            resourceType: "other",
            url: "https://unavailable.provider-overlap.invalid/",
          },
        });
      }
      recordProviderRejectionProvenance(role, provenance);
      return Object.freeze({
        disposition: "abort",
        entry: null,
        rejectionProvenance: provenance,
      });
    };
    const prepareBrowserRequest = (request) => {
      const existing = browserRequestPreparationByIdentity.get(request);
      if (existing) return existing;

      const rawUrl = request.url();
      let requestPage;
      let requestPageUnavailable = false;
      try {
        requestPage = request.frame().page();
      } catch {
        requestPageUnavailable = true;
        requestPage = undefined;
      }
      if (requestPage !== page) {
        recordUnexpectedRequest(rawUrl);
        const preparation = createRejectedPreparation(
          requestPageUnavailable ? "request-page-unavailable" : "request-page-mismatch",
          request,
          rawUrl,
        );
        browserRequestPreparationByIdentity.set(request, preparation);
        return preparation;
      }

      try {
        const classification = classifyProviderOverlapBrowserRequest(
          createJourneyBrowserRequestEnvelope(request, page.mainFrame()),
          { cabinetDocumentAllowed, staticAssetContract },
        );
        if (classification.key === "app-cabinet-document") {
          if (cabinetDocumentConsumed) {
            throw new Error("Synthetic browser requested the cabinet document more than once.");
          }
          cabinetDocumentConsumed = true;
        }
        if (providerStaticDocumentKeys.includes(classification.key)) {
          currentStaticDocumentKey = classification.key;
        }
        const entry = Object.freeze({
          classification,
          documentKey: currentStaticDocumentKey,
          request,
        });
        browserRequests.push(entry);
        browserRequestByIdentity.set(request, entry);
        if (browserRequests.length > 256) {
          throw new Error("Synthetic browser request ledger exceeded its bounded contract.");
        }
        const preparation = Object.freeze({
          disposition: classification.disposition,
          entry,
        });
        browserRequestPreparationByIdentity.set(request, preparation);
        return preparation;
      } catch (error) {
        // The emitted report never contains the rejected URL. Retain only its
        // digest for bounded local failure diagnosis.
        recordUnexpectedRequest(rawUrl);
        const preparation = createRejectedPreparation(
          "request-classification-rejected",
          request,
          rawUrl,
          error,
        );
        browserRequestPreparationByIdentity.set(request, preparation);
        return preparation;
      }
    };
    context.on("request", (request) => {
      eventSeal.record();
      pendingRequestSeal.observe(request);
      recordProviderPendingRequest(role, request);
      // Prepare synchronously on the normal request path. The response path
      // owns a fail-closed fallback for a response identity whose request
      // preparation was not observable through this listener.
      prepareBrowserRequest(request);
    });
    context.on("response", (response) => {
      let evidence;
      let request;
      try {
        if (!response || typeof response !== "object"
          || typeof response.request !== "function") {
          throw new Error("Synthetic browser response event identity is invalid.");
        }
        request = response.request();
        if (!request || typeof request !== "object") {
          throw new Error("Synthetic browser response request identity is invalid.");
        }
        pendingRequestSeal.observe(request);
        recordProviderPendingRequest(role, request);
        const entry = resolveProviderOverlapResponseRequestEntry({
          preparationByIdentity: browserRequestPreparationByIdentity,
          prepare: prepareBrowserRequest,
          request,
          requestByIdentity: browserRequestByIdentity,
        });
        if (browserRequestByIdentity.get(request) !== entry) {
          throw new Error("Synthetic browser response escaped its request identity ledger.");
        }
        if (browserResponseEvidenceByIdentity.has(request)) {
          throw new Error("Synthetic browser response evidence was registered more than once.");
        }
        let releaseTerminal;
        const terminal = new Promise((resolve) => {
          releaseTerminal = resolve;
        });
        browserResponseTerminalByIdentity.set(request, Object.freeze({
          release: releaseTerminal,
        }));
        // Register response capture immediately. Playwright resolves body()
        // only after request completion; the bounded quiet checkpoints below
        // must settle this promise before a later navigation can evict it.
        evidence = captureProviderOverlapResponseEvidence({
          classification: entry.classification,
          readBody: ({ maximumBodyBytes, readPlaywrightBody }) => {
            if (providerPlaywrightBodyKeys.includes(entry.classification.key)) {
              return maximumBodyBytes === null ? null : readPlaywrightBody();
            }
            const responseClaim = {
              resourceType: request.resourceType(),
              status: response.status(),
              url: request.url(),
            };
            return maximumBodyBytes === null
              ? cdpResponseBodyCapture.skipResponseBody(responseClaim)
              : cdpResponseBodyCapture.readBody({
                  maximumBodyBytes,
                  ...responseClaim,
                });
          },
          request,
          response,
          terminal,
        });
        browserResponseEvidenceByIdentity.set(request, evidence);
      } catch (error) {
        evidence = Promise.reject(error);
        if (request && typeof request === "object") {
          browserResponseEvidenceByIdentity.set(request, evidence);
        }
      }
      void evidence.then(
        () => undefined,
        (error) => {
          browserResponseCaptureFailure ??= retainProviderResponseCaptureFailure(
            role,
            "response-evidence",
            error,
            cdpResponseBodyCapture.snapshot(),
          );
        },
      );
    });
    const completeRequest = (request, finished) => {
      const finishRequest = eventSeal.begin();
      const entry = browserRequestByIdentity.get(request);
      let evidence = Promise.resolve(null);
      if (entry) {
        if (browserTerminalRequestIdentities.has(request)) {
          evidence = Promise.reject(
            new Error("Synthetic browser request reached a terminal event more than once."),
          );
        } else {
          browserTerminalRequestIdentities.add(request);
          evidence = browserResponseEvidenceByIdentity.get(request);
        }
        const terminal = browserResponseTerminalByIdentity.get(request);
        if (evidence && (!terminal || typeof terminal.release !== "function")) {
          evidence = Promise.resolve(evidence).then(
            () => {
              throw new Error("Completed synthetic browser response has no terminal capture gate.");
            },
            (error) => {
              throw error;
            },
          );
          browserResponseEvidenceByIdentity.set(request, evidence);
        } else if (terminal) {
          let failureText = null;
          if (!finished) {
            try {
              failureText = request.failure()?.errorText ?? "browser-request-failure-unavailable";
            } catch {
              failureText = "browser-request-failure-unavailable";
            }
          }
          terminal.release(Object.freeze({
            failureSha256: failureText === null ? null : sha256(failureText),
            finished,
          }));
        }
        if (!evidence && !finished) {
          evidence = Promise.resolve(Object.freeze({
            body: null,
            classification: entry.classification,
            request,
            response: null,
            responseContentType: null,
            responseFailureSha256: null,
            responseStatus: null,
          }));
          browserResponseEvidenceByIdentity.set(request, evidence);
        } else if (!evidence) {
          evidence = Promise.reject(
            new Error("Completed synthetic browser request has no prearmed response evidence."),
          );
          browserResponseEvidenceByIdentity.set(request, evidence);
        }
      }
      void evidence.then(
        () => {
          pendingRequestSeal.complete(request);
          completeProviderPendingRequest(role, request);
          finishRequest();
        },
        (error) => {
          browserResponseCaptureFailure ??= retainProviderResponseCaptureFailure(
            role,
            "request-terminal-evidence",
            error,
            cdpResponseBodyCapture.snapshot(),
          );
          pendingRequestSeal.complete(request);
          completeProviderPendingRequest(role, request);
          finishRequest();
        },
      );
    };
    context.on("requestfinished", (request) => completeRequest(request, true));
    context.on("requestfailed", (request) => completeRequest(request, false));
    markProviderFailurePhase(role, "install-request-routing");
    await context.route("**/*", async (route) => {
      const finishRoute = eventSeal.begin();
      try {
        const request = route.request();
        const preparation = browserRequestPreparationByIdentity.get(request);
        if (!preparation
          || (preparation.entry !== null && preparation.entry.request !== request)) {
          recordUnexpectedRequest(request.url());
          const rejectedPreparation = createRejectedPreparation(
            "route-preparation-missing",
            request,
            request.url(),
          );
          browserRequestPreparationByIdentity.set(
            request,
            rejectedPreparation,
          );
          await route.abort("blockedbyclient");
          return;
        }
        if (preparation.disposition === "abort") {
          await route.abort("blockedbyclient");
          return;
        }
        if (preparation.entry.classification.navigation) {
          try {
            await pendingRequestSeal.waitForPriorRequests(
              request,
              { timeoutMs: 15_000 },
            );
            if (browserResponseCaptureFailure) throw browserResponseCaptureFailure;
          } catch (error) {
            browserResponseCaptureFailure ??= retainProviderResponseCaptureFailure(
              role,
              "navigation-prior-requests",
              error,
              cdpResponseBodyCapture.snapshot(),
            );
            try {
              await route.abort("blockedbyclient");
            } catch {
              // The primary barrier failure stays authoritative. Returning
              // without continuing the route remains fail-closed, and the
              // controlled navigation call below rethrows that primary cause.
            }
            return;
          }
        }
        await route.continue();
      } finally {
        finishRoute();
      }
    });
    markProviderFailurePhase(role, "navigate-login");
    try {
      await page.goto(
        "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile",
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
    } catch (error) {
      if (browserResponseCaptureFailure) throw browserResponseCaptureFailure;
      throw error;
    }
    const telegram = page.getByRole("button", { name: "Войти через Telegram" });
    markProviderFailurePhase(role, "wait-telegram-visible");
    await telegram.waitFor({ state: "visible", timeout: 15_000 });
    markProviderFailurePhase(role, "wait-turnstile-token");
    await waitForProviderTurnstileToken(page);
    markProviderFailurePhase(role, "wait-telegram-enabled");
    await waitUntil(async () => telegram.isEnabled(), 15_000);
    markProviderFailurePhase(role, "drain-login-requests");
    await waitForResponseCaptureQuiet();
    markProviderFailurePhase(role, "navigate-profile");
    const profileNavigation = page.waitForURL(
      (url) => url.href === "https://pay.ci.clean-pay.dev/profile",
      { waitUntil: "load", timeout: 30_000 },
    ).catch((error) => {
      throw new Error("Provider profile navigation barrier failed.", { cause: error });
    });
    try {
      await Promise.all([
        profileNavigation,
        telegram.click(),
      ]);
    } catch (error) {
      if (browserResponseCaptureFailure) throw browserResponseCaptureFailure;
      throw error;
    }
    markProviderFailurePhase(role, "wait-profile-heading");
    await page.getByRole("heading", { name: "Профиль", level: 1 })
      .waitFor({ state: "visible", timeout: 15_000 });
    markProviderFailurePhase(role, "settle-profile-dom");
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    markProviderFailurePhase(role, "wait-profile-chatwoot-identity");
    try {
      await page.waitForFunction(
        providerOverlapChatwootIdentityBoundarySettled,
        undefined,
        { polling: 25, timeout: 15_000 },
      );
    } catch (error) {
      throw new Error("Provider profile Chatwoot identity barrier failed.", { cause: error });
    }
    markProviderFailurePhase(role, "drain-profile-history-before-idle");
    await drainProviderOverlapHistoryBindings(page);
    markProviderFailurePhase(role, "wait-profile-network-idle");
    try {
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
    } catch (error) {
      throw new Error("Provider profile network quiescence barrier failed.", { cause: error });
    }
    markProviderFailurePhase(role, "drain-profile-history-after-idle");
    await drainProviderOverlapHistoryBindings(page);
    markProviderFailurePhase(role, "drain-profile-requests");
    await waitForResponseCaptureQuiet();
    markProviderFailurePhase(role, "inspect-profile-frame");
    const profileFrameTree = await cdp.send("Page.getFrameTree");
    const profileFrame = profileFrameTree.frameTree.frame;
    const profileHistoryLength = await page.evaluate(() => history.length);
    historyRecords.length = 0;
    eventSeal.record();
    historyRecords.push({
      frameId: profileFrame.id,
      historyLength: profileHistoryLength,
      kind: "checkpoint",
      loaderId: profileFrame.loaderId,
      url: profileFrame.url,
    });
    historyCaptureActive = true;
    markProviderFailurePhase(role, "arm-provider-overlap");
    await armOverlap();
    cabinetDocumentAllowed = true;
    markProviderFailurePhase(role, "navigate-cabinet");
    let cabinetResponse;
    try {
      cabinetResponse = await page.goto("https://pay.ci.clean-pay.dev/cabinet", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch (error) {
      if (browserResponseCaptureFailure) throw browserResponseCaptureFailure;
      throw error;
    }
    const cabinetRequest = cabinetResponse?.request();
    if (!cabinetRequest
      || browserRequestByIdentity.get(cabinetRequest)?.classification.key
        !== "app-cabinet-document") {
      throw new Error("Cabinet navigation response is not bound to its exact browser request.");
    }
    markProviderFailurePhase(role, "wait-cabinet-navigation");
    await waitForProviderCabinetNavigation(page);
    const heading = page.getByRole("heading", { name: "Личный кабинет", level: 1 });
    markProviderFailurePhase(role, "wait-cabinet-heading");
    await heading.waitFor({ state: "visible", timeout: 15_000 });
    markProviderFailurePhase(role, "drain-cabinet-history");
    await drainProviderOverlapHistoryBindings(page);
    markProviderFailurePhase(role, "drain-cabinet-requests");
    await waitForResponseCaptureQuiet();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const chromiumVersion = browser.version();
    const mutableSourceContractSha256 = () => sha256(JSON.stringify({
      browserRequestClassifications: browserRequests.map(({ classification, documentKey }) => ({
        classification,
        documentKey,
      })),
      browserRequestIdentityCount: browserRequestByIdentity.size,
      browserRequestPreparationIdentityCount: browserRequestPreparationByIdentity.size,
      browserResponseEvidenceIdentityCount: browserResponseEvidenceByIdentity.size,
      cdpResponseBodyCapture: cdpResponseBodyCapture.snapshot(),
      browserTerminalRequestIdentityCount: browserTerminalRequestIdentities.size,
      cabinetDocumentAllowed,
      cabinetDocumentConsumed,
      expectedPlaywrightConsole,
      expectedPlaywrightConsoleOverflow,
      historyOverflow,
      historyRecords,
      pendingRequestCount: pendingRequestSeal.pendingCount(),
      unexpectedConsole,
      unexpectedConsoleOverflow,
      unexpectedPageErrorOverflow,
      unexpectedPageErrors,
      unexpectedPageOverflow,
      unexpectedPages,
      unexpectedRequestOverflow,
      unexpectedRequests,
      unexpectedServiceWorkerCount,
      unexpectedWebSocketCount,
    }));
    markProviderFailurePhase(role, "drain-pending-requests");
    const pendingRequestDrain = await pendingRequestSeal.drainAndSeal({ timeoutMs: 15_000 });
    markProviderFailurePhase(role, "verify-final-response-captures");
    if (browserResponseCaptureFailure) throw browserResponseCaptureFailure;
    cdpResponseBodyCapture.reconcileFinishedBodylessDuplicates();
    assertCdpResponseBodyCaptureClean();
    markProviderFailurePhase(role, "finalize-event-lifecycle");
    const finalizerEventSeal = Object.freeze({
      assertClean: () => {
        markProviderFailurePhase(role, "finalize-event-seal");
        return eventSeal.assertClean();
      },
      drainAndSeal: (...args) => {
        markProviderFailurePhase(role, "finalize-event-drain");
        return eventSeal.drainAndSeal(...args);
      },
    });
    const finalized = await finalizeProviderOverlapEventLifecycle({
      assertUnchanged: (snapshot) => {
        markProviderFailurePhase(role, "finalize-source-revalidation");
        if (browserResponseCaptureFailure) throw browserResponseCaptureFailure;
        cdpResponseBodyCapture.assertClean();
        pendingRequestSeal.assertClean();
        if (mutableSourceContractSha256() !== snapshot.mutableSourceContractSha256) {
          throw new Error("Synthetic browser source ledger changed across close.");
        }
      },
      close: async () => {
        markProviderFailurePhase(role, "finalize-browser-close");
        await browser.close();
        browserClosed = true;
      },
      detach: async () => {
        markProviderFailurePhase(role, "finalize-listener-detach");
        cdp.removeListener("Network.responseReceived", handleCdpResponseReceived);
        cdp.removeListener("Network.loadingFinished", handleCdpLoadingFinished);
        cdp.removeListener("Network.loadingFailed", handleCdpLoadingFailed);
        cdp.removeListener("Page.frameNavigated", handleFrameNavigated);
        cdp.removeListener("Page.navigatedWithinDocument", handleNavigatedWithinDocument);
        await page.removeAllListeners();
        await context.removeAllListeners();
      },
      eventSeal: finalizerEventSeal,
      finish: () => {
        if (browserResponseCaptureFailure) {
          markProviderFailurePhase(role, "finalize-response-capture");
          throw browserResponseCaptureFailure;
        }
        markProviderFailurePhase(role, "finalize-browser-projection");
        return finishBrowserRequestContract(
          browserRequests,
          browserRequestByIdentity,
          browserResponseEvidenceByIdentity,
          staticAssetContract,
        );
      },
      isIdle: () => pendingRequestSeal.pendingCount() === 0,
      snapshot: async () => {
        markProviderFailurePhase(role, "finalize-browser-snapshot");
        if (!cabinetDocumentConsumed) {
          throw new Error("Synthetic browser did not consume the exact cabinet proof navigation.");
        }
        if (unexpectedRequests.length > 0 || unexpectedRequestOverflow) {
          throw new Error("Synthetic browser isolation blocked an unexpected request.");
        }
        if (unexpectedWebSocketCount > 0 || unexpectedServiceWorkerCount > 0) {
          throw new Error("Synthetic browser opened an unexpected WebSocket or service worker.");
        }
        if (historyOverflow) throw new Error("Synthetic browser history ledger overflowed.");
        if (expectedPlaywrightConsole.length !== 1 || expectedPlaywrightConsoleOverflow) {
          throw new Error("Synthetic browser Playwright instrumentation console contract differs.");
        }
        if (unexpectedConsole.length > 0
          || unexpectedPageErrors.length > 0
          || unexpectedPages.length > 0
          || unexpectedPageOverflow
          || unexpectedConsoleOverflow
          || unexpectedPageErrorOverflow) {
          throw new Error("Synthetic browser emitted unexpected console or pageerror diagnostics.");
        }
        if (pendingRequestSeal.pendingCount() !== 0) {
          throw new Error("Synthetic browser retained pending requests at its seal barrier.");
        }
        const finalUrl = page.url();
        if (finalUrl !== "https://pay.ci.clean-pay.dev/cabinet") {
          throw new Error("Synthetic browser final URL changed before its close barrier.");
        }
        const headingVisible = await heading.isVisible();
        if (!headingVisible) {
          throw new Error("Synthetic cabinet heading changed before its close barrier.");
        }
        await drainProviderOverlapHistoryBindings(page);
        const finalFrameTree = await cdp.send("Page.getFrameTree");
        const finalFrame = finalFrameTree.frameTree.frame;
        return Object.freeze({
          finalUrl,
          headingVisible,
          historyContract: finalizeProviderOverlapHistoryContract(historyRecords, {
            frameId: finalFrame.id,
            loaderId: finalFrame.loaderId,
            url: finalFrame.url,
          }),
          mutableSourceContractSha256: mutableSourceContractSha256(),
        });
      },
    });
    const requestContract = finalized.value;
    const browserSnapshot = finalized.snapshot;
    markProviderFailurePhase(role, "validate-sealed-ledger");
    if (requestContract.requestCount !== browserRequests.length
      || pendingRequestDrain.observedRequestCount !== browserRequests.length
      || pendingRequestDrain.completedRequestCount !== browserRequests.length
      || browserRequestByIdentity.size !== browserRequests.length
      || browserRequestPreparationByIdentity.size !== browserRequests.length
      || browserResponseEvidenceByIdentity.size !== browserRequests.length
      || browserTerminalRequestIdentities.size !== browserRequests.length) {
      throw new Error("Sealed browser projection differs from its final raw request ledger.");
    }
    markProviderFailurePhase(role, "complete-browser-cabinet");
    return {
      browser: {
        project: PROVIDER_OVERLAP_BROWSER_PROJECT,
        playwrightVersion,
        chromiumVersion,
        userAgentSha256: sha256(userAgent),
        viewport: { width: 1440, height: 900 },
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
        colorScheme: "light",
      },
      navigation: {
        eventLifecycle: finalized.eventLifecycle,
        finalUrl: browserSnapshot.finalUrl,
        headingVisible: browserSnapshot.headingVisible,
        unexpectedRequestCount: unexpectedRequests.length,
        unexpectedConsoleCount: unexpectedConsole.length,
        unexpectedPageErrorCount: unexpectedPageErrors.length,
        requestCount: requestContract.requestCount,
        requestContractSha256: requestContract.requestContractSha256,
        requestOrderContractSha256: requestContract.requestOrderContractSha256,
        requestOrderLedger: requestContract.requestOrderLedger,
        semanticRequestLedger: requestContract.semanticRequestLedger,
        staticLoadGraph: requestContract.staticLoadGraph,
        staticLoadGraphContractSha256: requestContract.staticLoadGraphContractSha256,
        staticRequestContractSha256: requestContract.staticRequestContractSha256,
        staticRequestCount: requestContract.staticRequestCount,
        staticRequestLedger: requestContract.staticRequestLedger,
        historyContractSha256: browserSnapshot.historyContract.historyContractSha256,
        historyCount: browserSnapshot.historyContract.historyCount,
        historyLedger: browserSnapshot.historyContract.historyLedger,
      },
    };
  } finally {
    if (!browserClosed) await browser.close();
  }
}

async function preflightStack(
  input,
  fixtureContractSha256,
  composeRuntime,
  inputReceipt,
  launchReceipt,
) {
  if (
    input.contract.fixtureContract.domain !== "clean-pay-browser-journey-fixture-v5"
    || input.contract.fixtureContract.sha256 !== fixtureContractSha256
  ) {
    throw new Error(`${input.role} live stack contract is not bound to the current fixture bytes.`);
  }
  assertOwnedInputReceipt(
    composeRuntime,
    inputReceipt,
    input.role,
    input.contract.project,
    input.contract.fixtureContract.sha256,
  );
  const launchContractSha256 = assertOwnedPairLaunchReceipt(
    launchReceipt,
    input.role,
    input.contract.project,
    inputReceipt,
  );
  const serviceNames = [
    "app",
    "browser-provider-mock",
    "browser-proxy",
    "browser-oidc-mock",
    "browser-db-observer",
  ];
  const containers = Object.fromEntries(await Promise.all(serviceNames.map(async (service) => [
    service,
    await inspectProjectService(input.contract.project, service),
  ])));
  for (const [service, container] of Object.entries(containers)) {
    assertRunningService(container, input.contract.project, service, {
      healthRequired: service !== "browser-proxy",
    });
  }
  assertExactPublication(containers.app, "4000/tcp", input.contract.publications.app, input.role);
  assertExactPublication(
    containers["browser-provider-mock"],
    "3100/tcp",
    input.contract.publications.providerControl,
    input.role,
  );
  assertExactPublication(
    containers["browser-proxy"],
    "443/tcp",
    input.contract.publications.browserTls,
    input.role,
  );
  assertNoPublishedPorts(containers["browser-oidc-mock"], input.role);
  assertNoPublishedPorts(containers["browser-db-observer"], input.role);

  const launchImages = inputReceipt.imageSelectionMode === "containerd-root-manifest"
    ? {
      application: inputReceipt.applicationImageRuntimeDigest,
      migration: inputReceipt.migrationImageRuntimeDigest,
    }
    : {
      application: inputReceipt.applicationImageConfigDigest,
      migration: inputReceipt.migrationImageConfigDigest,
    };
  const syntheticEnvironmentContractSha256 = await assertSyntheticApplicationEnvironment(
    containers.app.Config.Env,
    input.contract,
    input.role,
    input.contractPath,
    launchImages,
  );
  const imageIdentity = assertApplicationImageIdentity(
    await inspectRunningApplicationImage(
      input.contract,
      containers.app,
      input.staticAssetContract,
      input.expectedPlatform,
    ),
    input.contract,
    {
      assetImageDigest: input.staticAssetContract.imageDigest,
      configDigest: input.staticAssetContract.configDigest,
      manifestDigest: input.staticAssetContract.manifestDigest,
    },
    input.role,
  );
  return Object.freeze({
    imageIdentity,
    runtimeBinding: Object.freeze({
      status: "preflight-proven",
      projectSha256: sha256(input.contract.project),
      applicationImageBindingContractSha256:
        composeRuntime.applicationImageBindingContractSha256,
      journeyContractSha256: input.journeyContractSha256,
      networkSha256: composeRuntime.networkSha256,
      publicationsSha256: sha256(JSON.stringify(input.contract.publications)),
      serviceIdentitySha256: composeRuntime.serviceIdentitySha256,
      fixtureExecutionContractSha256: composeRuntime.fixtureExecutionContractSha256,
      fixtureMountContractSha256: composeRuntime.fixtureMountContractSha256,
      fixtureBindingContractSha256: inputReceipt.fixtureBindingContractSha256,
      globalFixtureContractSha256: inputReceipt.globalFixtureContractSha256,
      generatedEnvironmentDirectorySha256:
        inputReceipt.generatedEnvironmentDirectorySha256,
      ownedInputReceiptSha256: sha256(JSON.stringify(inputReceipt)),
      syntheticEnvironmentContractSha256,
      composeRuntimeContractSha256: composeRuntime.composeRuntimeContractSha256,
      connectProxyTargetSha256: sha256(input.contract.publications.browserTls),
      oneShotLifecycleContractSha256: composeRuntime.oneShotLifecycleContractSha256,
      migrationImageBindingContractSha256:
        composeRuntime.migrationImageBindingContractSha256,
      pairCoexistenceContractSha256: sha256(JSON.stringify(launchReceipt.coexistence)),
      pairLaunchContractSha256: launchContractSha256,
      applicationRepoDigestContractSha256:
        composeRuntime.applicationRepoDigestContractSha256,
      staticAssetAttestationSha256: input.staticAssetContract.attestationSha256,
      staticAssetInventoryProjectionSha256:
        input.staticAssetContract.inventoryLedgerContractSha256,
      staticAssetInventorySha256: input.staticAssetContract.inventorySha256,
      staticAssetRouteGraphSha256:
        input.staticAssetContract.routeDeclaredPathContractSha256,
      syntheticRoleEnvironmentContractSha256:
        composeRuntime.syntheticRoleEnvironmentContractSha256,
      syntheticRoleEnvironmentPolicySha256:
        composeRuntime.syntheticRoleEnvironmentPolicySha256,
    }),
  });
}

function assertOwnedInputReceipt(runtime, receipt, role, project, fixtureContractSha256) {
  const legacyKeys = [
    "applicationImageConfigDigest",
    "applicationImageBindingContractSha256",
    "composeSourceSha256",
    "fixtureBindingContractSha256",
    "fixtureMountSubsetContractSha256",
    "fixtureSourceContractSha256",
    "generatedEnvironmentDirectorySha256",
    "globalFixtureContractSha256",
    "imageProbeOwnershipContractSha256",
    "migrationImageBindingContractSha256",
    "migrationImageConfigDigest",
    "projectSha256",
    "renderedComposeSha256",
    "roleEnvironmentContractSha256",
    "roleEnvironmentPolicySha256",
  ];
  const containerdKeys = [
    "applicationImageBindingContractSha256",
    "applicationImageConfigDigest",
    "applicationImageManifestDigest",
    "applicationImageRuntimeDigest",
    "composeSourceSha256",
    "fixtureBindingContractSha256",
    "fixtureMountSubsetContractSha256",
    "fixtureSourceContractSha256",
    "generatedEnvironmentDirectorySha256",
    "globalFixtureContractSha256",
    "imageProbeOwnershipContractSha256",
    "imageSelectionMode",
    "migrationImageBindingContractSha256",
    "migrationImageManifestDigest",
    "migrationImageRuntimeDigest",
    "projectSha256",
    "renderedComposeSha256",
    "roleEnvironmentContractSha256",
    "roleEnvironmentPolicySha256",
  ];
  const containerd = receipt?.imageSelectionMode === "containerd-root-manifest";
  const expectedKeys = containerd ? containerdKeys : legacyKeys;
  const runtimeIdentityMatches = containerd
    ? runtime.imageSelectionMode === "containerd-root-manifest"
      && receipt.applicationImageRuntimeDigest === runtime.applicationRuntimeImageDigest
      && receipt.applicationImageManifestDigest === runtime.applicationManifestDigest
      && receipt.migrationImageRuntimeDigest === runtime.migrationRuntimeImageDigest
      && receipt.migrationImageManifestDigest === runtime.migrationManifestDigest
    : receipt?.imageSelectionMode === undefined
      && runtime.imageSelectionMode === undefined
      && receipt.applicationImageConfigDigest === runtime.applicationRuntimeImageDigest
      && receipt.migrationImageConfigDigest === runtime.migrationRuntimeImageDigest;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expectedKeys.sort())
    || receipt.composeSourceSha256 !== runtime.composeSourceSha256
    || receipt.renderedComposeSha256 !== runtime.renderedComposeSha256
    || receipt.fixtureSourceContractSha256 !== runtime.fixtureMountContractSha256
    || receipt.fixtureMountSubsetContractSha256 !== runtime.fixtureMountContractSha256
    || receipt.globalFixtureContractSha256 !== fixtureContractSha256
    || receipt.fixtureBindingContractSha256 !== sha256(JSON.stringify({
      globalFixtureContractSha256: receipt.globalFixtureContractSha256,
      mountSubsetContractSha256: receipt.fixtureMountSubsetContractSha256,
    }))
    || receipt.roleEnvironmentContractSha256
      !== runtime.syntheticRoleEnvironmentContractSha256
    || receipt.roleEnvironmentPolicySha256
      !== runtime.syntheticRoleEnvironmentPolicySha256
    || !runtimeIdentityMatches
    || receipt.applicationImageBindingContractSha256
      !== runtime.applicationImageBindingContractSha256
    || receipt.migrationImageBindingContractSha256
      !== runtime.migrationImageBindingContractSha256
    || !/^[a-f0-9]{64}$/.test(receipt.generatedEnvironmentDirectorySha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(receipt.imageProbeOwnershipContractSha256 ?? "")
    || receipt.projectSha256 !== sha256(project)) {
    throw new Error(`${role} verifier-owned input receipt differs from live runtime attestation.`);
  }
}

function assertOwnedPairLaunchReceipt(receipt, role, project, inputReceipt) {
  const exactKeys = (value, keys) => Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
  if (!exactKeys(receipt, [
    "barrierSha256", "coexistence", "dispatches", "inputReceiptContractSha256s",
    "lifecycleNotBefore", "status",
  ])
    || receipt.status !== "dual-compose-up-dispatched-after-shared-barrier"
    || !/^[a-f0-9]{64}$/.test(receipt.barrierSha256 ?? "")
    || !Array.isArray(receipt.dispatches) || receipt.dispatches.length !== 2
    || !Array.isArray(receipt.inputReceiptContractSha256s)
    || receipt.inputReceiptContractSha256s.length !== 2
    || receipt.inputReceiptContractSha256s.some((digest) => !/^[a-f0-9]{64}$/.test(digest))
    || !exactKeys(receipt.coexistence, ["observations", "status"])
    || receipt.coexistence.status !== "both-project-container-sets-coexisted"
    || !Array.isArray(receipt.coexistence.observations)
    || receipt.coexistence.observations.length !== 2) {
    throw new Error(`${role} verifier-owned pair launch receipt is invalid.`);
  }
  const roleIndex = role === "baseline" ? 0 : 1;
  for (const [index, dispatch] of receipt.dispatches.entries()) {
    if (!exactKeys(dispatch, ["barrierSha256", "ordinal", "projectSha256"])
      || dispatch.barrierSha256 !== receipt.barrierSha256
      || dispatch.ordinal !== index
      || !/^[a-f0-9]{64}$/.test(dispatch.projectSha256 ?? "")) {
      throw new Error(`${role} verifier-owned pair dispatch ledger is invalid.`);
    }
  }
  if (receipt.barrierSha256 !== sha256(JSON.stringify({
    inputReceiptContractSha256s: receipt.inputReceiptContractSha256s,
    projects: receipt.dispatches.map(({ projectSha256 }) => projectSha256),
    version: 1,
  }))
    || receipt.inputReceiptContractSha256s[roleIndex]
      !== sha256(JSON.stringify(inputReceipt))) {
    throw new Error(`${role} verifier-owned launch barrier is not receipt-bound.`);
  }
  const crossProjectContainerIds = new Set();
  for (const observation of receipt.coexistence.observations) {
    if (!exactKeys(observation, [
      "containerSetSha256", "projectSha256", "serviceCount", "services",
    ])
      || !/^[a-f0-9]{64}$/.test(observation.containerSetSha256 ?? "")
      || !/^[a-f0-9]{64}$/.test(observation.projectSha256 ?? "")
      || observation.serviceCount !== 13
      || !Array.isArray(observation.services)
      || observation.services.length !== 13
      || observation.containerSetSha256 !== sha256(JSON.stringify(observation.services))) {
      throw new Error(`${role} verifier-owned coexistence observation is invalid.`);
    }
    const expectedServices = [...JOURNEY_COMPOSE_SERVICE_NAMES].sort();
    const containerIds = new Set();
    for (const [index, entry] of observation.services.entries()) {
      if (!exactKeys(entry, ["containerIdSha256", "service", "state"])
        || !/^[a-f0-9]{64}$/.test(entry.containerIdSha256 ?? "")
        || containerIds.has(entry.containerIdSha256)
        || crossProjectContainerIds.has(entry.containerIdSha256)
        || entry.service !== expectedServices[index]
        || (JOURNEY_COMPOSE_ONE_SHOT_SERVICE_NAMES.includes(entry.service)
          !== (JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[entry.service] === "exited-zero"))
        || entry.state !== JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[entry.service]) {
        throw new Error(`${role} verifier-owned coexistence service ledger is invalid.`);
      }
      containerIds.add(entry.containerIdSha256);
      crossProjectContainerIds.add(entry.containerIdSha256);
    }
  }
  const expectedProjectSha256 = sha256(project);
  if (receipt.dispatches[roleIndex].projectSha256 !== expectedProjectSha256
    || receipt.coexistence.observations[roleIndex].projectSha256 !== expectedProjectSha256
    || new Set(receipt.dispatches.map(({ projectSha256 }) => projectSha256)).size !== 2
    || new Set(receipt.coexistence.observations.map(({ containerSetSha256 }) => (
      containerSetSha256
    ))).size !== 2
    || crossProjectContainerIds.size !== JOURNEY_COMPOSE_SERVICE_NAMES.length * 2) {
    throw new Error(`${role} verifier-owned launch receipt project association differs.`);
  }
  return sha256(JSON.stringify(receipt));
}

function assertDualPreflight(baseline, candidate) {
  if (normalizedApplicationImageSelectionMode(baseline.imageIdentity, "baseline")
    !== normalizedApplicationImageSelectionMode(candidate.imageIdentity, "candidate")) {
    throw new Error("Dual provider proof application image selection modes differ.");
  }
  for (const name of [
    "applicationImageBindingContractSha256",
    "composeRuntimeContractSha256",
    "fixtureExecutionContractSha256",
    "generatedEnvironmentDirectorySha256",
    "networkSha256",
    "migrationImageBindingContractSha256",
    "oneShotLifecycleContractSha256",
    "ownedInputReceiptSha256",
    "projectSha256",
    "publicationsSha256",
    "serviceIdentitySha256",
    "staticAssetAttestationSha256",
    "syntheticRoleEnvironmentContractSha256",
  ]) {
    if (baseline.runtimeBinding[name] === candidate.runtimeBinding[name]) {
      throw new Error("Dual provider proof requires two distinct live runtime bindings.");
    }
  }
  if (
    baseline.runtimeBinding.fixtureMountContractSha256
      !== candidate.runtimeBinding.fixtureMountContractSha256
    || baseline.runtimeBinding.fixtureBindingContractSha256
      !== candidate.runtimeBinding.fixtureBindingContractSha256
    || baseline.runtimeBinding.globalFixtureContractSha256
      !== candidate.runtimeBinding.globalFixtureContractSha256
    || baseline.runtimeBinding.syntheticEnvironmentContractSha256
      !== candidate.runtimeBinding.syntheticEnvironmentContractSha256
    || baseline.runtimeBinding.syntheticRoleEnvironmentPolicySha256
      !== candidate.runtimeBinding.syntheticRoleEnvironmentPolicySha256
  ) {
    throw new Error("Dual provider proof live fixture and synthetic environment contracts differ.");
  }
}

function normalizedApplicationImageSelectionMode(identity, label) {
  if (identity?.imageSelectionMode === undefined) return "classic-config";
  if (identity.imageSelectionMode !== "containerd-root-manifest") {
    throw new Error(`${label} application image selection mode is invalid.`);
  }
  return identity.imageSelectionMode;
}

async function inspectProjectService(project, service) {
  const ids = splitLines(await docker([
    "ps",
    "--all",
    "--no-trunc",
    "--quiet",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", `label=com.docker.compose.service=${service}`,
  ]));
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0])) {
    throw new Error(`Expected exactly one project-owned ${service} container.`);
  }
  const inspected = parseJson(
    Buffer.from(await docker(["container", "inspect", ids[0]], 256 * 1024), "utf8"),
    `${service} Docker inspection`,
  );
  if (!Array.isArray(inspected) || inspected.length !== 1) {
    throw new Error(`${service} Docker inspection returned an invalid contract.`);
  }
  return inspected[0];
}

function assertRunningService(container, project, service, { healthRequired }) {
  if (
    container?.Id?.length !== 64
    || container.Config?.Labels?.["com.docker.compose.project"] !== project
    || container.Config?.Labels?.["com.docker.compose.service"] !== service
    || container.State?.Status !== "running"
    || container.HostConfig?.ReadonlyRootfs !== true
    || JSON.stringify(Object.keys(container.NetworkSettings?.Networks ?? {}))
      !== JSON.stringify([`${project}_default`])
    || (healthRequired && container.State?.Health?.Status !== "healthy")
  ) {
    throw new Error(`${service} does not match the exact project-owned running sandbox contract.`);
  }
}

function assertExactPublication(container, target, publication, label) {
  const [hostIp, hostPort] = publication.split(":");
  const published = Object.entries(container.NetworkSettings?.Ports ?? {})
    .flatMap(([containerPort, bindings]) => (bindings ?? []).map((binding) => ({
      containerPort,
      hostIp: binding.HostIp,
      hostPort: binding.HostPort,
    })));
  if (
    published.length !== 1
    || published[0].containerPort !== target
    || published[0].hostIp !== hostIp
    || published[0].hostPort !== hostPort
  ) {
    throw new Error(`${label} ${target} publication is not bound to its exact project service.`);
  }
}

function assertNoPublishedPorts(container, label) {
  const published = Object.values(container.NetworkSettings?.Ports ?? {})
    .flatMap((bindings) => bindings ?? []);
  if (published.length !== 0) {
    throw new Error(`${label} internal fixture service unexpectedly publishes a host port.`);
  }
}

async function assertSyntheticApplicationEnvironment(
  environment,
  contract,
  label,
  contractPath,
  liveImages,
) {
  if (!liveImages || typeof liveImages !== "object" || Array.isArray(liveImages)
    || JSON.stringify(Object.keys(liveImages).sort())
      !== JSON.stringify(["application", "migration"])
    || !/^sha256:[a-f0-9]{64}$/.test(liveImages.application ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(liveImages.migration ?? "")) {
    throw new Error(`${label} immutable live image environment is invalid.`);
  }
  const digest = (value) => sha256(value);
  const secret = (name) => `browser-journey-${name}-${digest(`secret:${name}`)}`;
  const roleSource = await exactExternalFile(
    path.join(path.dirname(contractPath), ".env.app"),
    `${label} synthetic application role source`,
  );
  const roleAssignments = parseExactEnvironmentAssignments(
    await readBoundedBytes(roleSource, 64 * 1024, `${label} synthetic application role source`),
    `${label} synthetic application role source`,
  );
  const turnstileSiteKey = roleAssignments.TURNSTILE_SITE_KEY;
  if (typeof turnstileSiteKey !== "string"
    || !/^[A-Za-z0-9_-]{20,100}$/.test(turnstileSiteKey)) {
    throw new Error(`${label} synthetic Turnstile site key is invalid.`);
  }
  const expected = {
    APP_URL: "https://pay.ci.clean-pay.dev",
    AUDIT_IP_HASH_SECRET: secret("audit-ip"),
    AUTH_CONCURRENCY_LIMIT: "64",
    AUTH_RATE_LIMIT_CAPACITY: "1000",
    CHATWOOT_BASE_URL: "https://chatwoot.browser.clean-pay.dev",
    CHATWOOT_HMAC_TOKEN: digest("clean-pay-browser-journey:chatwoot-hmac"),
    CHATWOOT_WEBSITE_TOKEN: digest("clean-pay-browser-journey:chatwoot-website"),
    CLEAN_PAY_DEPLOY_SOURCE: "build",
    CLEAN_PAY_IMAGE: contract.images.application,
    CLEAN_PAY_MIGRATION_IMAGE: contract.images.migration,
    CLEAN_PAY_READINESS_MAILPIT_URL: "",
    CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://panel.ci.clean-pay.dev",
    CLEAN_PAY_RELEASE: `browser-journey-${contract.revision.slice(0, 12)}`,
    CLEAN_PAY_REVISION: contract.revision,
    COOKIE_SAMESITE: "lax",
    COOKIE_SECURE: "true",
    DATABASE_CONNECTION_TIMEOUT_MS: "5000",
    DATABASE_IDLE_TIMEOUT_MS: "30000",
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "10000",
    DATABASE_LOCK_TIMEOUT_MS: "5000",
    DATABASE_POOL_MAX: "8",
    DATABASE_QUERY_TIMEOUT_MS: "15000",
    DATABASE_STATEMENT_TIMEOUT_MS: "15000",
    DATABASE_URL: `postgresql://clean_pay_app:${secret("database-application")}@postgres:5432/clean_pay?schema=public`,
    LOG_LEVEL: "error",
    NEXT_PUBLIC_APP_URL: "https://pay.ci.clean-pay.dev",
    NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
    NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
    PAYMENT_RECONCILIATION_BATCH_SIZE: "10",
    PAYMENT_RECONCILIATION_ENABLED: "false",
    PAYMENT_RECONCILIATION_INTERNAL_URL: "http://app:4000/api/internal/payments/reconcile",
    PAYMENT_RECONCILIATION_INTERVAL_SECONDS: "30",
    PAYMENT_RECONCILIATION_SECRET: "",
    PAYMENT_REDIRECT_ORIGINS: "https://checkout.browser.clean-pay.dev",
    RATE_LIMIT_IDENTITY_SECRET: secret("rate-limit"),
    READINESS_INTERNAL_SECRET: secret("readiness"),
    REDIS_URL: "redis://redis:6379/0",
    REMNASHOP_ADMIN_API_BASE_URL: "https://remnashop.browser.clean-pay.dev/api/v1/admin",
    REMNASHOP_API_BASE_URL: "https://remnashop.browser.clean-pay.dev/api/v1/public",
    REMNASHOP_API_KEY: digest("clean-pay-browser-journey:remnashop-api"),
    REMNASHOP_AUTH_SERVICE_KEY: digest("clean-pay-browser-journey:remnashop-auth"),
    REMNAWAVE_API_BASE_URL: "https://panel.ci.clean-pay.dev",
    REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://subscription.ci.clean-pay.dev",
    REMNAWAVE_TOKEN: digest("clean-pay-browser-journey:remnawave"),
    SUPPORT_EMAIL: "support@clean-pay.dev",
    SUPPORT_ENABLED: "true",
    SUPPORT_FAQ_URL: "https://pay.ci.clean-pay.dev/support",
    SUPPORT_TELEGRAM_USERNAME: "cleanpay_support",
    TELEGRAM_BOT_TOKEN: `7654321098:${digest("clean-pay-browser-journey:telegram-bot")}`,
    TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT: "https://oauth.telegram.org/auth",
    TELEGRAM_OIDC_CLIENT_ID: "7654321098",
    TELEGRAM_OIDC_CLIENT_SECRET: digest("clean-pay-browser-journey:telegram-oidc"),
    TELEGRAM_OIDC_ISSUER: "https://oauth.telegram.org",
    TELEGRAM_OIDC_JWKS_URI: "https://oauth.telegram.org/.well-known/jwks.json",
    TELEGRAM_OIDC_TOKEN_ENDPOINT: "https://oauth.telegram.org/token",
    TRUSTED_PROXY_HOPS: "1",
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SECRET_KEY: digest("clean-pay-browser-journey:turnstile"),
    TURNSTILE_SITE_KEY: turnstileSiteKey,
    TURNSTILE_VERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    WEB_JWT_SECRET: secret("web-jwt"),
    WEB_REFRESH_KEY_ID: "browser-journey-primary",
    WEB_REFRESH_SECRET: secret("web-refresh"),
  };
  assertRequiredEnvironmentProjection(environment, {
    ...expected,
    CLEAN_PAY_IMAGE: liveImages.application,
    CLEAN_PAY_MIGRATION_IMAGE: liveImages.migration,
    CLEAN_PAY_RUNTIME_ROLE: "application",
    NODE_ENV: "production",
  }, `${label} application`);
  const sortedExpected = Object.fromEntries(Object.entries(expected).sort(([left], [right]) => (
    left.localeCompare(right)
  )));
  if (JSON.stringify(roleAssignments) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} application role source is not the exact deterministic fixture.`);
  }
  const sharedProjection = Object.fromEntries(Object.entries(roleAssignments).filter(([name]) => ![
    "CLEAN_PAY_IMAGE",
    "CLEAN_PAY_MIGRATION_IMAGE",
    "CLEAN_PAY_RELEASE",
    "CLEAN_PAY_REVISION",
  ].includes(name)));
  return sha256(JSON.stringify(sharedProjection));
}

function parseExactEnvironmentAssignments(bytes, label) {
  const source = bytes.toString("utf8");
  if (!source.endsWith("\n") || source.includes("\r") || source.startsWith("\uFEFF")) {
    throw new Error(`${label} has non-canonical bytes.`);
  }
  const result = {};
  for (const line of source.slice(0, -1).split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(result, match[1])) {
      throw new Error(`${label} contains an invalid or duplicate assignment.`);
    }
    result[match[1]] = match[2];
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => (
    left.localeCompare(right)
  )));
}

function assertRequiredEnvironmentProjection(environment, expected, label) {
  const actual = new Map();
  for (const assignment of environment ?? []) {
    const separator = assignment.indexOf("=");
    const name = assignment.slice(0, separator);
    if (separator < 1 || actual.has(name)) {
      throw new Error(`${label} environment contains an invalid or duplicate assignment.`);
    }
    actual.set(name, assignment.slice(separator + 1));
  }
  if (Object.entries(expected).some(([name, value]) => actual.get(name) !== value)) {
    throw new Error(`${label} environment is not the deterministic synthetic contract.`);
  }
}

async function inspectRunningApplicationImage(
  contract,
  appContainer,
  assetIdentity,
  expectedPlatform,
) {
  const inspected = parseJson(
    Buffer.from(await docker([
      "image", "inspect", appContainer.Image,
    ], 512 * 1024), "utf8"),
    "application image Docker inspection",
  );
  if (!Array.isArray(inspected) || inspected.length !== 1) {
    throw new Error("Application image Docker inspection is invalid.");
  }
  const [localImage] = inspected;
  const labels = appContainer.Config.Labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("Application container labels are invalid.");
  }
  const runtimeImageDigest = appContainer.Image;
  const classic = runtimeImageDigest === assetIdentity.configDigest
    && localImage.Id === assetIdentity.configDigest
    && !Object.hasOwn(appContainer, "ImageManifestDescriptor");
  const containerd = runtimeImageDigest === assetIdentity.imageDigest
    && localImage.Id === assetIdentity.imageDigest;
  if (!classic && !containerd) {
    throw new Error("Running container and referenced local image identities are incoherent.");
  }
  if (classic && Object.hasOwn(localImage, "Descriptor")) {
    assertProviderOverlapClassicImageDescriptor(
      localImage.Descriptor,
      assetIdentity.imageDigest,
      "running application",
    );
  }
  if (containerd) {
    assertProviderOverlapContainerdImageDescriptorChain(
      localImage.Descriptor,
      appContainer.ImageManifestDescriptor,
      assetIdentity.imageDigest,
      assetIdentity.manifestDigest,
      expectedPlatform,
      "running application",
      assetIdentity.configDigest,
    );
  }
  const expectedRepoDigests = new Set([
    assetIdentity.imageDigest,
    assetIdentity.manifestDigest,
  ]);
  const repoDigests = localImage.RepoDigests ?? [];
  if (!Array.isArray(repoDigests) || repoDigests.length < 1 || repoDigests.length > 16) {
    throw new Error("Application image repository digests are invalid.");
  }
  const normalizedRepoDigests = repoDigests.map((entry) => {
    const match = /@(?<digest>sha256:[a-f0-9]{64})$/.exec(entry ?? "");
    if (!match || !expectedRepoDigests.has(match.groups.digest)) {
      throw new Error("Application image repository digest escaped its OCI attestation.");
    }
    return entry;
  }).sort();
  if (new Set(normalizedRepoDigests).size !== normalizedRepoDigests.length) {
    throw new Error("Application image repository digest is duplicated.");
  }
  if (
    labels["com.docker.compose.project"] !== contract.project
    || labels["com.docker.compose.service"] !== "app"
  ) {
    throw new Error("Application container ownership labels are invalid.");
  }
  return {
    assetImageDigest: assetIdentity.imageDigest,
    configDigest: assetIdentity.configDigest,
    ...(containerd ? { imageSelectionMode: "containerd-root-manifest" } : {}),
    manifestDigest: assetIdentity.manifestDigest,
    reference: contract.images.application,
    repoDigestContractSha256: sha256(JSON.stringify(normalizedRepoDigests)),
    runtimeImageDigest,
    revision: labels["org.opencontainers.image.revision"],
    role: labels["io.clean-pay.role"],
    publicBuildContract: {
      version: labels["io.clean-pay.public-build-contract-version"],
      sha256: labels["io.clean-pay.public-build-contract-sha256"],
    },
  };
}

async function controlJson(baseUrl, pathname, options = {}, maximumBytes = 1024 * 1024) {
  const url = new URL(pathname, baseUrl);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Fixture control rejected ${pathname}.`);
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error(`Fixture control returned an invalid content type for ${pathname}.`);
  }
  const bytes = await boundedResponseBytes(response, maximumBytes);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Fixture control returned invalid JSON for ${pathname}.`);
  }
}

async function drainProviderOverlapHistoryBindings(page) {
  await boundedBrowserEvidenceOperation(page.evaluate(async () => {
    const drain = globalThis.__cleanPayProviderHistoryDrain;
    if (typeof drain !== "function") {
      throw new Error("Synthetic history binding drain is unavailable.");
    }
    await drain();
  }), 2_000, "browser history binding drain");
}

async function boundedResponseBytes(response, maximumBytes) {
  if (!response.body) throw new Error("Fixture control response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("Fixture control response exceeds its bounded evidence limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function finishBrowserRequestContract(
  requests,
  requestByIdentity,
  responseEvidenceByIdentity,
  staticAssetContract,
) {
  if (!(responseEvidenceByIdentity instanceof Map)
    || responseEvidenceByIdentity.size !== requests.length) {
    throw new Error("Synthetic browser response evidence ledger is incomplete.");
  }
  const records = [];
  const redirectedSources = new Set();
  const capturedResponses = new Map();
  const responseDeclarationsByDocument = new Map(providerStaticDocumentKeys.map((documentKey) => [
    documentKey,
    new Set(),
  ]));
  const cssMediaReferencesBySource = new Map();
  let declarationBytes = 0;
  let staticResponseBytes = 0;
  for (const { classification, documentKey, request } of requests) {
    const captured = await readBrowserResponseCapture(
      responseEvidenceByIdentity,
      request,
      classification,
    );
    const {
      body: responseBody,
      response,
      responseContentType,
      responseFailureSha256,
      responseStatus,
    } = captured;
    capturedResponses.set(request, response);
    const redirectedFrom = request.redirectedFrom();
    let redirectEdge = null;
    if (redirectedFrom) {
      const source = requestByIdentity.get(redirectedFrom);
      const sourceResponse = capturedResponses.get(redirectedFrom);
      const location = sourceResponse?.headers()?.location;
      if (!source || !sourceResponse || typeof location !== "string") {
        throw new Error("Synthetic browser redirect chain is incomplete.");
      }
      redirectEdge = assertProviderOverlapRedirect({
        from: { classification: source.classification, url: redirectedFrom.url() },
        to: { classification, url: request.url() },
        status: sourceResponse.status(),
        location,
      });
      redirectedSources.add(redirectedFrom);
    }
    let staticObservation = {
      staticResponseBytes: null,
      staticResponseSha256: null,
    };
    if (classification.staticPath !== null) {
      if (!response || !(responseBody instanceof Uint8Array)) {
        throw new Error("Attested static browser request has no captured response body.");
      }
      staticResponseBytes += responseBody.byteLength;
      if (!Number.isSafeInteger(staticResponseBytes)
        || staticResponseBytes > PROVIDER_OVERLAP_MAXIMUM_STATIC_RESPONSE_BYTES) {
        throw new Error("Static browser response bytes exceeded their aggregate bound.");
      }
      staticObservation = attestProviderOverlapStaticResponse({
        body: responseBody,
        classification,
        responseContentType,
        responseStatus,
      }, staticAssetContract);
      if (responseContentType === "text/css") {
        declarationBytes += responseBody.byteLength;
        if (responseBody.byteLength > 2 * 1024 * 1024
          || declarationBytes > 8 * 1024 * 1024) {
          throw new Error("Static response declaration graph exceeded its bounded body contract.");
        }
        const references = extractProviderOverlapCssMediaReferences(
          responseBody,
          classification.staticPath,
          staticAssetContract,
        );
        const priorReferences = cssMediaReferencesBySource.get(classification.staticPath);
        if (priorReferences !== undefined
          && JSON.stringify(priorReferences) !== JSON.stringify(references)) {
          throw new Error("Repeated CSS response changed its exact media reference closure.");
        }
        if (priorReferences === undefined) {
          cssMediaReferencesBySource.set(classification.staticPath, references);
        }
        const documentDeclarations = responseDeclarationsByDocument.get(documentKey);
        if (!documentDeclarations) {
          throw new Error("CSS response escaped its exact document generation.");
        }
        for (const reference of references) {
          documentDeclarations.add(reference.targetPath);
        }
      }
    }
    if (response && responseFailureSha256 === null && responseStatus === 200
      && new Set(["text/html", "text/x-component"]).has(responseContentType)) {
      const body = responseBody;
      if (!(body instanceof Uint8Array)) {
        throw new Error("Browser declaration response has no captured body.");
      }
      declarationBytes += body.byteLength;
      if (body.byteLength > 2 * 1024 * 1024 || declarationBytes > 8 * 1024 * 1024) {
        throw new Error("Static response declaration graph exceeded its bounded body contract.");
      }
      const documentDeclarations = responseDeclarationsByDocument.get(documentKey);
      if (!documentDeclarations) {
        throw new Error("Static response declaration escaped its exact document generation.");
      }
      for (const servedPath of extractProviderOverlapResponseStaticDeclarations(
        body,
        staticAssetContract,
      )) {
        documentDeclarations.add(servedPath);
      }
    }
    records.push({
      classification,
      documentKey,
      redirectEdge,
      responseContentType,
      responseFailureSha256,
      responseStatus,
      ...staticObservation,
    });
  }
  for (const { classification, request } of requests) {
    const response = capturedResponses.get(request) ?? null;
    if (
      response
      && response.status() >= 300
      && response.status() <= 399
      && !redirectedSources.has(request)
      && classification.disposition !== "abort"
    ) {
      throw new Error("Synthetic browser redirect response has no exact successor.");
    }
  }
  if (capturedResponses.size !== requests.length
    || [...responseEvidenceByIdentity.keys()].some((request) => !requestByIdentity.has(request))) {
    throw new Error("Synthetic browser response evidence escaped its request identity ledger.");
  }
  return finalizeProviderOverlapBrowserContract(records, {
    cssMediaReferences: [...cssMediaReferencesBySource.values()].flat(),
    responseDeclarationsByDocument: providerStaticDocumentKeys.map((documentKey) => ({
      documentKey,
      paths: [...responseDeclarationsByDocument.get(documentKey)].sort(),
    })),
    staticAssetContract,
  });
}

async function readBrowserResponseCapture(registry, request, classification) {
  const capturePromise = registry.get(request);
  if (!capturePromise || typeof capturePromise.then !== "function") {
    throw new Error("Synthetic browser response evidence is missing for a request identity.");
  }
  const capture = await boundedBrowserEvidenceOperation(
    capturePromise,
    5_000,
    "browser response capture",
  );
  if (!capture || typeof capture !== "object" || Array.isArray(capture)
    || JSON.stringify(Object.keys(capture).sort()) !== JSON.stringify([
      "body", "classification", "request", "response", "responseContentType",
      "responseFailureSha256", "responseStatus",
    ])) {
    throw new Error("Synthetic browser response evidence has an invalid field set.");
  }
  if (capture.request !== request || capture.classification !== classification
    || (capture.body !== null && !(capture.body instanceof Uint8Array))) {
    throw new Error("Synthetic browser response evidence crossed a request identity.");
  }
  if (capture.response === null) {
    if (capture.body !== null || capture.responseContentType !== null
      || capture.responseFailureSha256 !== null || capture.responseStatus !== null) {
      throw new Error("Failed browser response evidence is not exact.");
    }
    return capture;
  }
  const currentContentType = typeof capture.response.headerValue === "function"
    ? await boundedBrowserEvidenceOperation(
        capture.response.headerValue("content-type"),
        5_000,
        "browser response metadata",
      )
    : capture.response.headers()["content-type"] ?? null;
  if (typeof capture.response.request !== "function"
    || capture.response.request() !== request
    || typeof capture.response.status !== "function"
    || capture.response.status() !== capture.responseStatus
    || (capture.responseFailureSha256 !== null
      && !/^[a-f0-9]{64}$/.test(capture.responseFailureSha256))
    || normalizeProviderOverlapObservedResponseContentType({
      key: classification.key,
      rawContentType: currentContentType,
      status: capture.responseStatus,
    }) !== capture.responseContentType) {
    throw new Error("Captured browser response metadata changed after its body barrier.");
  }
  return capture;
}

async function boundedBrowserEvidenceOperation(operation, timeoutMs, label) {
  if (!operation || typeof operation.then !== "function"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) {
    throw new Error("Browser evidence operation bound is invalid.");
  }
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded its bounded lifecycle.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function installedPlaywrightVersion() {
  const packageValue = await readBoundedJson(
    path.join(repositoryRoot, "node_modules", "playwright", "package.json"),
    64 * 1024,
    "installed Playwright package",
  );
  const rootPackage = await readBoundedJson(
    path.join(repositoryRoot, "package.json"),
    64 * 1024,
    "root package",
  );
  const expected = rootPackage?.devDependencies?.["@playwright/test"];
  if (
    typeof packageValue?.version !== "string"
    || packageValue.version !== expected
    || !/^\d+\.\d+\.\d+$/.test(packageValue.version)
  ) {
    throw new Error("Installed Playwright does not match the exact local lock contract.");
  }
  return packageValue.version;
}

async function assertRepositoryRoot() {
  const packageValue = await readBoundedJson(
    path.join(repositoryRoot, "package.json"),
    64 * 1024,
    "repository package",
  );
  if (packageValue?.name !== "clean-pay" || packageValue?.private !== true) {
    throw new Error("Provider overlap proof must run from the Clean Pay repository root.");
  }
}

async function exactProviderFailureOutputPath(rawPath, expectedCaptureId) {
  const expectedOutputParent = path.join(
    repositoryRoot,
    "test-results",
    "browser-live-pair-ci",
  );
  const expectedCaptureRoot = path.join(expectedOutputParent, expectedCaptureId);
  const expected = path.join(expectedCaptureRoot, "provider-overlap-failure.json");
  if (typeof rawPath !== "string" || !path.isAbsolute(rawPath)
    || path.resolve(rawPath) !== expected) {
    throw new Error("Provider overlap sanitized failure output path is invalid.");
  }
  const [
    repositoryDetails,
    repositoryResolved,
    outputParentDetails,
    outputParentResolved,
    captureRootDetails,
    captureRootResolved,
  ] = await Promise.all([
    lstat(repositoryRoot),
    realpath(repositoryRoot),
    lstat(expectedOutputParent),
    realpath(expectedOutputParent),
    lstat(expectedCaptureRoot),
    realpath(expectedCaptureRoot),
  ]);
  if (!repositoryDetails.isDirectory() || repositoryDetails.isSymbolicLink()
    || !outputParentDetails.isDirectory() || outputParentDetails.isSymbolicLink()
    || !captureRootDetails.isDirectory() || captureRootDetails.isSymbolicLink()
    || path.resolve(repositoryResolved) !== repositoryRoot
    || !isWithin(repositoryResolved, outputParentResolved)
    || path.resolve(outputParentResolved) !== expectedOutputParent
    || path.resolve(captureRootResolved) !== expectedCaptureRoot
    || path.dirname(path.resolve(captureRootResolved)) !== path.resolve(outputParentResolved)) {
    throw new Error("Provider overlap sanitized failure output root is not exact.");
  }
  try {
    await lstat(expected);
    throw new Error("Provider overlap sanitized failure output must be new.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return expected;
}

async function exactExternalFile(rawPath, label) {
  if (!path.isAbsolute(rawPath)) throw new Error(`${label} path must be absolute.`);
  const requestedMetadata = await lstat(rawPath);
  const resolved = await realpath(rawPath);
  if (isWithin(repositoryRoot, resolved)) {
    throw new Error(`${label} must stay outside the repository and immutable baselines.`);
  }
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || requestedMetadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return resolved;
}

async function assertNewPrivateOutput(target) {
  if (!path.isAbsolute(target) || isWithin(repositoryRoot, target)) {
    throw new Error("Proof output must be an absolute new path outside the repository.");
  }
  const parent = await realpath(path.dirname(target));
  if (isWithin(repositoryRoot, parent)) {
    throw new Error("Proof output parent must stay outside the repository.");
  }
  try {
    await stat(target);
    throw new Error("Proof output already exists; evidence is write-once.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readBoundedJson(target, maximumBytes, label) {
  return parseJson(await readBoundedBytes(target, maximumBytes, label), label);
}

async function readBoundedBytes(target, maximumBytes, label) {
  const before = await stat(target);
  if (!before.isFile() || before.size <= 0 || before.size > maximumBytes) {
    throw new Error(`${label} exceeds its bounded file contract.`);
  }
  const bytes = await readFile(target);
  const after = await stat(target);
  if (bytes.byteLength !== before.size || bytes.byteLength > maximumBytes
    || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error(`${label} changed while its bounded bytes were read.`);
  }
  return bytes;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function parseAssetPlatform(document) {
  const platform = document?.source?.platform;
  if (!platform || Object.keys(platform).sort().join(",") !== "architecture,os"
    || platform.os !== "linux" || !new Set(["amd64", "arm64"]).has(platform.architecture)) {
    throw new Error("Production image asset attestation platform is invalid.");
  }
  return { architecture: platform.architecture, os: platform.os };
}

function parseArguments(values) {
  if (values.length % 2 !== 0) throw new Error("Provider overlap proof requires exact flag/value pairs.");
  const allowed = new Set([
    "--baseline-contract",
    "--baseline-control-url",
    "--baseline-asset-attestation",
    "--baseline-asset-image-digest",
    "--baseline-migration-asset-image-digest",
    "--baseline-resolver-ip",
    "--candidate-contract",
    "--candidate-control-url",
    "--candidate-asset-attestation",
    "--candidate-asset-image-digest",
    "--candidate-migration-asset-image-digest",
    "--candidate-resolver-ip",
    "--capture-id",
    "--output",
    "--scenario",
  ]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || result.has(name) || !value || value.startsWith("--")) {
      throw new Error("Provider overlap proof arguments do not match the exact contract.");
    }
    result.set(name, value);
  }
  if (result.size !== allowed.size) {
    throw new Error("Provider overlap proof requires every exact input flag once.");
  }
  return result;
}

function requiredArgument(values, name, pattern) {
  const value = values.get(name);
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

async function settleEvidence(promise) {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { reason, status: "rejected" };
  }
}

function rejectionReasons(settlements) {
  return settlements
    .filter(({ status }) => status === "rejected")
    .map(({ reason }) => reason);
}

function assertDistinctStackInputs(baseline, candidate) {
  assertProviderOverlapImagePlatformParity(
    baseline.expectedPlatform,
    candidate.expectedPlatform,
  );
  const baselinePublications = Object.values(baseline.contract.publications);
  const candidatePublications = Object.values(candidate.contract.publications);
  if (
    baseline.contract.project === candidate.contract.project
    || baseline.controlUrl.href === candidate.controlUrl.href
    || baseline.resolverIp === candidate.resolverIp
    || baseline.expectedAssetImageDigest === candidate.expectedAssetImageDigest
    || baseline.expectedApplicationImageConfigDigest
      === candidate.expectedApplicationImageConfigDigest
    || baseline.expectedMigrationAssetImageDigest
      === candidate.expectedMigrationAssetImageDigest
    || baseline.contract.revision === candidate.contract.revision
    || baseline.contractPath === candidate.contractPath
    || baseline.assetAttestationPath === candidate.assetAttestationPath
    || baseline.staticAssetContract.attestationSha256
      === candidate.staticAssetContract.attestationSha256
    || baselinePublications.some((publication) => candidatePublications.includes(publication))
  ) {
    throw new Error("Baseline and candidate inputs must identify two distinct isolated image stacks.");
  }
  if (
    JSON.stringify(baseline.contract.publicBuildContract)
      !== JSON.stringify(candidate.contract.publicBuildContract)
  ) {
    throw new Error("Baseline and candidate public build contracts must be byte-identical.");
  }
  if (
    JSON.stringify(baseline.contract.fixtureContract)
      !== JSON.stringify(candidate.contract.fixtureContract)
  ) {
    throw new Error("Baseline and candidate fixture contracts must be byte-identical.");
  }
}

async function startBothConnectProxies(inputs) {
  const settled = await Promise.allSettled(inputs.map((input) => {
    const [listenHost, listenPort] = input.contract.publications.connectProxy.split(":");
    return startJourneyConnectProxy({
      environment: journeyDockerCliEnvironment(),
      listenHost,
      listenPort,
      repositoryRoot,
      targetHost: input.resolverIp,
      targetPort: "443",
    });
  }));
  const handles = [];
  for (const result of settled) {
    if (result.status === "fulfilled") handles.push(result.value);
  }
  if (settled.some(({ status }) => status === "rejected")) {
    const cleanup = await Promise.allSettled(
      handles.map((handle) => stopJourneyConnectProxy(handle)),
    );
    const preparationErrors = rejectionReasons(settled);
    const cleanupErrors = rejectionReasons(cleanup);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [...preparationErrors, ...cleanupErrors],
        "CONNECT proxy preparation and exact cleanup both failed.",
      );
    }
    throw new AggregateError(
      preparationErrors,
      "Both isolated CONNECT proxies must become ready before browser actions.",
    );
  }
  return handles;
}

function ownedStackInput(input) {
  return {
    repositoryRoot,
    contractPath: input.contractPath,
    contract: input.contract,
    expectedApplicationAssetImageDigest: input.expectedAssetImageDigest,
    expectedApplicationImageConfigDigest: input.expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest: input.expectedApplicationManifestDigest,
    expectedApplicationRepoDigests: input.expectedApplicationRepoDigests,
    expectedImagePlatform: input.expectedPlatform,
    expectedMigrationAssetImageDigest: input.expectedMigrationAssetImageDigest,
    runDocker: docker,
  };
}

async function stopBothConnectProxies(handles) {
  const settled = await Promise.allSettled(handles.map((handle) => stopJourneyConnectProxy(handle)));
  if (settled.some(({ status }) => status === "rejected")) {
    throw new AggregateError(
      rejectionReasons(settled),
      "Both isolated CONNECT proxies must stop with exact sanitized summaries.",
    );
  }
  const summaries = [];
  for (const result of settled) {
    if (result.status === "fulfilled") summaries.push(result.value);
  }
  return summaries;
}

function docker(
  args,
  maximumBytes = 64 * 1024,
  environment = journeyDockerCliEnvironment(),
  commandOptions = {},
) {
  if (!commandOptions || typeof commandOptions !== "object" || Array.isArray(commandOptions)
    || Object.keys(commandOptions).some((name) => name !== "timeoutMs")
    || (commandOptions.timeoutMs !== undefined
      && (!Number.isSafeInteger(commandOptions.timeoutMs)
        || commandOptions.timeoutMs < 1 || commandOptions.timeoutMs > 600_000))) {
    throw new Error("Provider overlap Docker command options are invalid.");
  }
  return runJourneyDockerCommand(args, maximumBytes, environment, {
    repositoryRoot,
    ...commandOptions,
  });
}

function splitLines(value) {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function waitForProviderCabinetNavigation(page) {
  try {
    await page.waitForURL(
      (url) => url.href === "https://pay.ci.clean-pay.dev/cabinet",
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
  } catch (error) {
    throw new Error("Provider cabinet navigation barrier failed.", { cause: error });
  }
}

async function waitForProviderTurnstileToken(page) {
  await page.waitForFunction(() => {
    const challenges = globalThis.__cleanPayTurnstileDocumentChallenges;
    if (!Array.isArray(challenges) || challenges.length !== 1) return false;
    const challenge = challenges[0];
    return challenge !== null
      && typeof challenge === "object"
      && Object.keys(challenge).sort().join(",") === "action,issue,widgetId"
      && challenge.action === "auth_login"
      && /^synthetic-turnstile-[1-9]\d*$/.test(challenge.widgetId)
      && Number.isSafeInteger(challenge.issue)
      && challenge.issue > 0;
  }, undefined, { timeout: 15_000 });
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Synthetic browser state did not become ready within its bounded timeout.");
}
