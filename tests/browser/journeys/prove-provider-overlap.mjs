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
  journeyDockerCliEnvironment,
  runJourneyDockerCommand,
  withJourneyOwnedStackPair,
  writeJourneySanitizedOutput,
} from "./journey-owned-stack-orchestrator.mjs";
import {
  assertProviderOverlapRedirect,
  classifyProviderOverlapBrowserRequest,
  createProviderOverlapEventSeal,
  createProviderOverlapStaticAssetContract,
  extractProviderOverlapCssMediaReferences,
  finalizeProviderOverlapBrowserContract,
  finalizeProviderOverlapEventLifecycle,
  finalizeProviderOverlapHistoryContract,
  installProviderOverlapHistoryInstrumentation,
  readProviderOverlapStaticResponseEvidence,
} from "./provider-overlap-browser-contract.mjs";
import {
  PROVIDER_OVERLAP_ACTION,
  PROVIDER_OVERLAP_BROWSER_PROJECT,
  assertApplicationImageIdentity,
  assertDeterministicReset,
  assertJourneyStackContract,
  assertLoopbackControlUrl,
  assertLoopbackResolver,
  createDualProviderOverlapProof,
  createProviderOverlapStackReport,
  extractProviderOverlapProof,
  resolveProviderOverlapOutputPath,
  sha256,
} from "./provider-overlap-proof-contract.mjs";

const repositoryRoot = path.resolve(process.cwd());
const providerStaticDocumentKeys = Object.freeze([
  "app-login-document",
  "app-profile-document",
  "app-cabinet-document",
]);
const providerOverlapConnectAuthorityLedger = Object.freeze([
  "challenges.cloudflare.com:443",
  "chatwoot.browser.clean-pay.dev:443",
  "oauth.telegram.org:443",
  "pay.ci.clean-pay.dev:443",
].sort());
let argumentsByName;
let scenario;
let outputPath;

try {
  argumentsByName = parseArguments(process.argv.slice(2));
  scenario = requiredArgument(argumentsByName, "--scenario", /^provider-overlap-v1$/);
  outputPath = resolveProviderOverlapOutputPath(
    requiredArgument(argumentsByName, "--output", /.+/),
  );
  await assertRepositoryRoot();
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
      throw new Error("Both dual-image preflights must settle before verifier-owned cleanup.");
    }
    const [baselinePreflight, candidatePreflight] = preflightSettlements
      .map(({ value }) => value);
    assertDualPreflight(baselinePreflight, candidatePreflight);
    const proxyHandles = await startBothConnectProxies([baselineInput, candidateInput]);
    let runSettlements;
    let proxySummaries;
    try {
      runSettlements = await Promise.all([
        settleEvidence(proveStack(baselineInput, baselinePreflight, playwrightVersion)),
        settleEvidence(proveStack(candidateInput, candidatePreflight, playwrightVersion)),
      ]);
    } finally {
      proxySummaries = await stopBothConnectProxies(proxyHandles);
    }
    if (runSettlements.some(({ status }) => status === "rejected")) {
      throw new Error("Both concurrent dual-image proofs must settle before exact cleanup.");
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
  process.stderr.write(`${JSON.stringify({
    status: "dual_image_provider_overlap_failed",
    errorClass: error?.constructor?.name ?? "Error",
    messageSha256: sha256(String(error?.message ?? "unknown")),
  })}\n`);
  process.exitCode = 1;
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
  const assetAttestation = validateProductionImageAssetAttestation(
    assetAttestationDocument,
    {
      fixtureContract: {
        version: "journey-v5",
        sha256: contract.fixtureContract.sha256,
      },
      imageDigest: expectedAssetImageDigest,
      platform: parseAssetPlatform(assetAttestationDocument),
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
    expectedApplicationRepoDigests: Object.freeze([...new Set([
      assetAttestation.source.imageDigest,
      assetAttestation.source.manifestDigest,
    ])].sort()),
    expectedMigrationAssetImageDigest,
    assetAttestationPath,
    staticAssetContract: createProviderOverlapStaticAssetContract(assetAttestation),
    contractPath,
    journeyContractSha256: sha256(contractBytes),
  };
}

async function proveStack(input, preflight, playwrightVersion) {
  const reset = assertDeterministicReset(
    await controlJson(input.controlUrl, "/__reset", {
      method: "POST",
      body: { scenario },
    }),
    scenario,
    input.contract.project,
    input.role,
  );
  const browserRun = await exerciseCabinet(
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
  const providerOverlap = extractProviderOverlapProof(
    await controlJson(input.controlUrl, "/__concurrency"),
    await controlJson(input.controlUrl, "/__ledger", {}, 2 * 1024 * 1024),
    input.role,
  );
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
  resolverIp,
  connectProxyUrl,
  playwrightVersion,
  staticAssetContract,
  armOverlap,
) {
  const maximumUnexpectedEvents = 32;
  const browser = await chromium.launch({
    headless: true,
    args: journeyChromiumLaunchArgs(resolverIp),
    proxy: journeyConnectProxy(connectProxyUrl),
  });
  let browserClosed = false;
  try {
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
    // request plus four history events, so 1,024 retains a bounded safety margin
    // above the maximum valid 772-event ledger.
    const eventSeal = createProviderOverlapEventSeal(1_024);
    const historyRecords = [];
    let historyOverflow = false;
    let historyCaptureActive = false;
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
    await context.addInitScript(installProviderOverlapHistoryInstrumentation);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
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
    const unexpectedConsole = [];
    const unexpectedPageErrors = [];
    let unexpectedPageOverflow = false;
    let unexpectedConsoleOverflow = false;
    let unexpectedPageErrorOverflow = false;
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
      if (unexpectedConsole.length < maximumUnexpectedEvents) {
        unexpectedConsole.push({ type: message.type(), sha256: sha256(message.text()) });
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
    let currentStaticDocumentKey = null;
    let cabinetDocumentAllowed = false;
    let cabinetDocumentConsumed = false;
    let unexpectedWebSocketCount = 0;
    let unexpectedServiceWorkerCount = 0;
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
    const pendingRequests = new Set();
    context.on("request", (request) => {
      eventSeal.record();
      pendingRequests.add(request);
    });
    const completeRequest = (request) => {
      eventSeal.record();
      pendingRequests.delete(request);
    };
    context.on("requestfinished", completeRequest);
    context.on("requestfailed", completeRequest);
    await context.route("**/*", async (route) => {
      const finishRoute = eventSeal.begin();
      try {
      const request = route.request();
      const rawUrl = request.url();
      let requestPage;
      try {
        requestPage = request.frame().page();
      } catch {
        requestPage = undefined;
      }
      if (requestPage !== page) {
        if (unexpectedRequests.length < maximumUnexpectedEvents) {
          unexpectedRequests.push(sha256(rawUrl));
        } else {
          unexpectedRequestOverflow = true;
        }
        await route.abort("blockedbyclient");
        return;
      }
      try {
        const classification = classifyProviderOverlapBrowserRequest({
          url: rawUrl,
          method: request.method(),
          resourceType: request.resourceType(),
          isNavigation: request.isNavigationRequest(),
          isMainFrame: request.frame() === page.mainFrame(),
        }, { cabinetDocumentAllowed, staticAssetContract });
        if (classification.key === "app-cabinet-document") {
          if (cabinetDocumentConsumed) {
            throw new Error("Synthetic browser requested the cabinet document more than once.");
          }
          cabinetDocumentConsumed = true;
        }
        if (providerStaticDocumentKeys.includes(classification.key)) {
          currentStaticDocumentKey = classification.key;
        }
        const entry = { classification, documentKey: currentStaticDocumentKey, request };
        browserRequests.push(entry);
        browserRequestByIdentity.set(request, entry);
        if (browserRequests.length > 256) {
          throw new Error("Synthetic browser request ledger exceeded its bounded contract.");
        }
        if (classification.disposition === "abort") {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
        return;
      } catch {
        // The emitted report never contains the rejected URL. Retain only its
        // digest for bounded local failure diagnosis.
        if (unexpectedRequests.length < maximumUnexpectedEvents) {
          unexpectedRequests.push(sha256(rawUrl));
        } else {
          unexpectedRequestOverflow = true;
        }
        await route.abort("blockedbyclient");
        return;
      }
      } finally {
        finishRoute();
      }
    });
    await page.goto(
      "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile",
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    const telegram = page.getByRole("button", { name: "Войти через Telegram" });
    await telegram.waitFor({ state: "visible", timeout: 15_000 });
    await waitUntil(async () => telegram.isEnabled(), 15_000);
    await telegram.click();
    await page.waitForURL(
      (url) => url.href === "https://pay.ci.clean-pay.dev/profile",
      { timeout: 30_000 },
    );
    await page.getByRole("heading", { name: "Профиль", level: 1 })
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await drainProviderOverlapHistoryBindings(page);
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
    await armOverlap();
    cabinetDocumentAllowed = true;
    const cabinetResponse = await page.goto("https://pay.ci.clean-pay.dev/cabinet", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const cabinetRequest = cabinetResponse?.request();
    if (!cabinetRequest
      || browserRequestByIdentity.get(cabinetRequest)?.classification.key
        !== "app-cabinet-document") {
      throw new Error("Cabinet navigation response is not bound to its exact browser request.");
    }
    await page.waitForURL(
      (url) => url.href === "https://pay.ci.clean-pay.dev/cabinet",
      { timeout: 30_000 },
    );
    const heading = page.getByRole("heading", { name: "Личный кабинет", level: 1 });
    await heading.waitFor({ state: "visible", timeout: 15_000 });
    await drainProviderOverlapHistoryBindings(page);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const chromiumVersion = browser.version();
    const mutableSourceContractSha256 = () => sha256(JSON.stringify({
      browserRequestClassifications: browserRequests.map(({ classification, documentKey }) => ({
        classification,
        documentKey,
      })),
      browserRequestIdentityCount: browserRequestByIdentity.size,
      cabinetDocumentAllowed,
      cabinetDocumentConsumed,
      historyOverflow,
      historyRecords,
      pendingRequestCount: pendingRequests.size,
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
    const finalized = await finalizeProviderOverlapEventLifecycle({
      assertUnchanged: (snapshot) => {
        if (mutableSourceContractSha256() !== snapshot.mutableSourceContractSha256) {
          throw new Error("Synthetic browser source ledger changed across close.");
        }
      },
      close: async () => {
        await browser.close();
        browserClosed = true;
      },
      detach: async () => {
        cdp.removeListener("Page.frameNavigated", handleFrameNavigated);
        cdp.removeListener("Page.navigatedWithinDocument", handleNavigatedWithinDocument);
        await page.removeAllListeners();
        await context.removeAllListeners();
      },
      eventSeal,
      finish: () => finishBrowserRequestContract(
        browserRequests,
        browserRequestByIdentity,
        staticAssetContract,
      ),
      isIdle: () => pendingRequests.size === 0,
      snapshot: async () => {
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
        if (unexpectedConsole.length > 0
          || unexpectedPageErrors.length > 0
          || unexpectedPages.length > 0
          || unexpectedPageOverflow
          || unexpectedConsoleOverflow
          || unexpectedPageErrorOverflow) {
          throw new Error("Synthetic browser emitted unexpected console or pageerror diagnostics.");
        }
        if (pendingRequests.size !== 0) {
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
    if (requestContract.requestCount !== browserRequests.length
      || browserRequestByIdentity.size !== browserRequests.length) {
      throw new Error("Sealed browser projection differs from its final raw request ledger.");
    }
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

  const syntheticEnvironmentContractSha256 = await assertSyntheticApplicationEnvironment(
    containers.app.Config.Env,
    input.contract,
    input.role,
    input.contractPath,
    {
      application: inputReceipt.applicationImageConfigDigest,
      migration: inputReceipt.migrationImageConfigDigest,
    },
  );
  const imageIdentity = assertApplicationImageIdentity(
    await inspectRunningApplicationImage(
      input.contract,
      containers.app,
      input.staticAssetContract,
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
  const expectedKeys = [
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
    || receipt.applicationImageConfigDigest !== runtime.applicationRuntimeImageDigest
    || receipt.migrationImageConfigDigest !== runtime.migrationRuntimeImageDigest
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

async function inspectRunningApplicationImage(contract, appContainer, assetIdentity) {
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
  if (runtimeImageDigest !== assetIdentity.configDigest
    || localImage.Id !== assetIdentity.configDigest) {
    throw new Error("Running container and referenced local image digests differ.");
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

async function finishBrowserRequestContract(requests, requestByIdentity, staticAssetContract) {
  const records = [];
  const redirectedSources = new Set();
  const responseDeclarationsByDocument = new Map(providerStaticDocumentKeys.map((documentKey) => [
    documentKey,
    new Set(),
  ]));
  const cssMediaReferencesBySource = new Map();
  let declarationBytes = 0;
  let staticResponseBytes = 0;
  for (const { classification, documentKey, request } of requests) {
    const response = await boundedBrowserEvidenceOperation(
      request.response(),
      2_000,
      "browser response lookup",
    );
    const redirectedFrom = request.redirectedFrom();
    let redirectEdge = null;
    if (redirectedFrom) {
      const source = requestByIdentity.get(redirectedFrom);
      const sourceResponse = await boundedBrowserEvidenceOperation(
        redirectedFrom.response(),
        2_000,
        "redirect source response lookup",
      );
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
    const responseContentType = response
      ? normalizeResponseContentType(response.headers()["content-type"])
      : null;
    let responseBody;
    let staticObservation = {
      staticResponseBytes: null,
      staticResponseSha256: null,
    };
    if (classification.staticPath !== null) {
      const staticEvidence = await readProviderOverlapStaticResponseEvidence({
        classification,
        response,
        responseContentType,
      }, staticAssetContract);
      responseBody = staticEvidence.body;
      staticResponseBytes += responseBody.byteLength;
      if (!Number.isSafeInteger(staticResponseBytes)
        || staticResponseBytes > 1024 * 1024 * 1024) {
        throw new Error("Static browser response bytes exceeded their aggregate bound.");
      }
      staticObservation = staticEvidence.observation;
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
    if (response && response.status() === 200
      && new Set(["text/html", "text/x-component"]).has(responseContentType)) {
      const body = await boundedBrowserEvidenceOperation(
        response.body(),
        5_000,
        "static declaration response body",
      );
      declarationBytes += body.byteLength;
      if (body.byteLength > 2 * 1024 * 1024 || declarationBytes > 8 * 1024 * 1024) {
        throw new Error("Static response declaration graph exceeded its bounded body contract.");
      }
      const source = new TextDecoder("utf-8", { fatal: true }).decode(body);
      const documentDeclarations = responseDeclarationsByDocument.get(documentKey);
      for (const match of source.matchAll(
        /\/_next\/static\/(?:chunks(?:\/[A-Za-z0-9._-]{1,100}){0,5}\/[A-Za-z0-9._-]{1,200}\.(?:css|js)|media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2))/g,
      )) {
        if (!documentDeclarations) {
          throw new Error("Static response declaration escaped its exact document generation.");
        }
        documentDeclarations.add(match[0]);
      }
    }
    records.push({
      classification,
      documentKey,
      redirectEdge,
      responseContentType,
      responseStatus: response?.status() ?? null,
      ...staticObservation,
    });
  }
  for (const { classification, request } of requests) {
    const response = await boundedBrowserEvidenceOperation(
      request.response(),
      2_000,
      "redirect terminal response lookup",
    );
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
  return finalizeProviderOverlapBrowserContract(records, {
    cssMediaReferences: [...cssMediaReferencesBySource.values()].flat(),
    responseDeclarationsByDocument: providerStaticDocumentKeys.map((documentKey) => ({
      documentKey,
      paths: [...responseDeclarationsByDocument.get(documentKey)].sort(),
    })),
    staticAssetContract,
  });
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

function normalizeResponseContentType(value) {
  if (value === undefined) return null;
  const normalized = String(value).split(";", 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)) {
    throw new Error("Synthetic browser response content type is invalid.");
  }
  return normalized;
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
  } catch {
    return { status: "rejected" };
  }
}

function assertDistinctStackInputs(baseline, candidate) {
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
    await Promise.allSettled(handles.map((handle) => stopJourneyConnectProxy(handle)));
    throw new Error("Both isolated CONNECT proxies must become ready before browser actions.");
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
    expectedApplicationRepoDigests: input.expectedApplicationRepoDigests,
    expectedMigrationAssetImageDigest: input.expectedMigrationAssetImageDigest,
    runDocker: docker,
  };
}

async function stopBothConnectProxies(handles) {
  const settled = await Promise.allSettled(handles.map((handle) => stopJourneyConnectProxy(handle)));
  if (settled.some(({ status }) => status === "rejected")) {
    throw new Error("Both isolated CONNECT proxies must stop with exact sanitized summaries.");
  }
  const summaries = [];
  for (const result of settled) {
    if (result.status === "fulfilled") summaries.push(result.value);
  }
  return summaries;
}

function docker(args, maximumBytes = 64 * 1024, environment = journeyDockerCliEnvironment()) {
  return runJourneyDockerCommand(args, maximumBytes, environment, { repositoryRoot });
}

function splitLines(value) {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Synthetic browser state did not become ready within its bounded timeout.");
}
