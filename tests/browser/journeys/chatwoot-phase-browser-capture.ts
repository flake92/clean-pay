import { createHash, randomBytes } from "node:crypto";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
  type Request,
  type Response,
  type Route,
} from "playwright";

import {
  browserStorage,
  canonicalDom,
  interactiveState,
  sanitizeAriaUrls,
  selectedComputedStyles,
} from "../page-characterization";
import {
  type NetworkManifestEntry,
  recordNetwork,
} from "../network-recorder";
import { canonicalChatwootPhaseEvidence } from "./chatwoot-phase-canonical-evidence";
import { createChatwootPhaseCausalContract } from "./chatwoot-phase-causal-contract.mjs";
import {
  assertChatwootPhaseRedirect,
  classifyChatwootPhaseBrowserRequest,
  finalizeChatwootPhaseBrowserContract,
  finalizeChatwootPhaseHistoryContract,
} from "./chatwoot-phase-browser-contract.mjs";
import {
  createJourneyBrowserRequestEnvelope,
  extractProviderOverlapCssMediaReferences,
  extractProviderOverlapResponseStaticDeclarations,
  installProviderOverlapHistoryInstrumentation,
  readProviderOverlapStaticResponseEvidence,
} from "./provider-overlap-browser-contract.mjs";
import { createChatwootPhaseEventLedger } from "./chatwoot-phase-event-ledger.mjs";
import {
  journeyChromiumLaunchArgs,
  journeyConnectProxy,
  journeyProvenanceLaunchArgs,
} from "./journey-browser-policy.mjs";
import {
  SYNTHETIC_APPLICATION_ORIGIN,
  SYNTHETIC_TURNSTILE_STORAGE_KEY,
  clearSyntheticLogoutState,
} from "./synthetic-logout-storage";

const MAXIMUM_EVENTS = 32;
const MAXIMUM_REQUESTS = 256;
const MAXIMUM_CONTROL_BYTES = 2 * 1024 * 1024;
const MAXIMUM_SERVER_ACTIONS = 200;
const MAXIMUM_STORAGE_KEYS = 128;
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const EMPTY_BODY_SHA256 = sha256Text("");
const providerEndpointContracts = Object.freeze([
  providerEndpoint("chatwoot", "GET", "/api/v1/widget/contact", ["website_token"],
    "contact_identity_probed", "none", ["x-auth-token"], null, []),
  providerEndpoint("turnstile", "POST", "/turnstile/v0/siteverify", [],
    "challenge_verified", ["urlencoded", ["response", "secret"]], [], null, []),
  providerEndpoint("telegram-oidc", "GET", "/auth", [
    "client_id", "code_challenge", "code_challenge_method", "nonce", "redirect_uri",
    "response_type", "scope", "state",
  ], "authorization_code_issued", ["query", [
    "client_id", "code_challenge", "code_challenge_method", "nonce", "redirect_uri",
    "response_type", "scope", "state",
  ]], [], null, []),
  providerEndpoint("telegram-oidc", "POST", "/token", [], "token_exchanged", [
    "urlencoded", ["client_id", "code", "code_verifier", "grant_type", "redirect_uri"],
  ], ["authorization"], "Basic", []),
  providerEndpoint("telegram-oidc", "GET", "/.well-known/jwks.json", [],
    "jwks_read", "none", [], null, []),
  providerEndpoint("remnashop", "POST", "/api/v1/public/auth/telegram", [],
    "auth_session_issued", ["json", [
      "auth_date", "first_name", "hash", "id", "last_name", "photo_url", "username",
    ]], ["x-remnashop-auth-service-key"], null, []),
  providerEndpoint("remnashop", "GET", "/api/v1/public/auth/me", [],
    "read_profile", "none", ["x-remnashop-auth-service-key"], null, ["access_token"]),
  providerEndpoint("remnashop", "GET", "/api/v1/public/referral/program", [],
    "read_referral_program", "none", [], null, ["access_token"]),
  providerEndpoint("remnashop", "GET", "/api/v1/public/subscription/current", [],
    "read_subscription", "none", [], null, ["access_token"]),
  providerEndpoint("remnashop", "GET", "/api/v1/public/subscription/offers", [],
    "read_offers", "none", [], null, ["access_token"]),
  providerEndpoint("remnashop", "GET", "/api/v1/public/subscription/devices", [],
    "read_devices", "none", [], null, ["access_token"]),
  providerEndpoint("remnashop", "GET", "/api/v1/public/auth/notification-preferences", [],
    "read_notification_preferences", "none", ["x-remnashop-auth-service-key"], null,
    ["access_token"]),
  providerEndpoint("remnawave", "GET", "/api/users/rw-browser-1", [],
    "read_user_by_uuid", "none", ["authorization"], "Bearer", []),
]);
const initialProviderEffectSequence = Object.freeze([
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
]);
const recreatedProviderEffectSequence = Object.freeze([
  ...initialProviderEffectSequence,
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
]);
type Phase = "gap" | "stable" | "recreated";
type Role = "baseline" | "candidate";

type StaticAssetContract = Readonly<{
  directCabinetRouteDeclaredPaths: readonly string[];
  providerContract: Readonly<{
    attestationSha256: string;
    configDigest: string;
    documentRouteContracts: readonly Readonly<{
      documentKey: string;
      routeDeclaredPaths: readonly string[];
    }>[];
    imageDigest: string;
    inventoryByPath: Readonly<Record<string, string>>;
    inventoryLedgerContractSha256: string;
    inventoryMetadataByPath: Readonly<Record<string, Readonly<{
      assetBytes: number;
      extension: string;
    }>>>;
    inventorySha256: string;
    manifestDigest: string;
    routeDeclaredPaths: readonly string[];
    routeDeclaredPathContractSha256: string;
  }>;
}>;

type EvidenceSealer = Readonly<{
  proofHmacScopeSha256: string;
  sealClearedFixtureStorage(input: {
    beforeValue: string;
    afterValue: string;
  }): Readonly<{
    preservedFixtureStorageByteExact: true;
    preservedFixtureStorageByteLength: number;
    preservedFixtureStorageHmacSha256: string;
  }>;
  sealPhase(input: {
    cookies: Array<Readonly<{
      domain: string;
      expires: number;
      httpOnly: boolean;
      name: string;
      path: string;
      sameSite: "Strict" | "Lax" | "None";
      secure: boolean;
      value: string;
    }>>;
    phase: Phase;
    orderedEvidence: ReturnType<typeof canonicalChatwootPhaseEvidence>;
    conversationValue: string;
    userCookieValue: string | null;
  }): Readonly<{
    evidenceCounts: Readonly<Record<string, number>>;
    evidenceRanges: Readonly<Record<string, Readonly<{
      firstHmacSha256: string;
      lastHmacSha256: string;
    }>>>;
    cookieDescriptorByteLength: number;
    cookieDescriptorCount: number;
    cookieValueByteLength: number;
    hashes: Readonly<Record<string, string | null>>;
  }>;
}>;

type CaptureInput = Readonly<{
  connectProxyBindingSha256: string;
  connectProxyUrl: string;
  controlUrl: string;
  fixtureContractSha256: string;
  pairIndex: number;
  playwrightVersion: string;
  projectSha256: string;
  resolverIp: string;
  role: Role;
  sealer: EvidenceSealer;
  staticAssetContract: StaticAssetContract;
}>;

type StrictRequestEntry = {
  classification: Readonly<{
    disposition: "abort" | "continue";
    expectedStatuses: readonly number[];
    key: string;
    navigation: boolean;
    staticAssetSha256: string | null;
    staticPath: string | null;
  }>;
  documentKey: "app-cabinet-document" | "app-login-document" | "app-profile-document";
  request: Request;
};

type BrowserRequestLedger = {
  entries: StrictRequestEntry[];
  byIdentity: Map<Request, StrictRequestEntry>;
  currentDocumentKey: StrictRequestEntry["documentKey"] | null;
  responseByIdentity: Map<Request, Response>;
};

type InitialCabinetBarrierInput = Readonly<{
  barrierConsumed: boolean;
  classificationKey: string;
  currentDocumentKey: BrowserRequestLedger["currentDocumentKey"];
  generation: "initial" | "recreated";
  initialCabinetFreshWidgetCount: number;
  isNavigationRequest: boolean;
  ownerIsMainFrame: boolean;
  ownerUrl: string | null;
}>;

type InitialCabinetBarrierDecision = Readonly<{
  action: "abort-unexpected" | "continue" | "hold";
  initialCabinetFreshWidgetCount: number;
}>;

type ProviderLedger = {
  database: unknown;
  entries: Array<Record<string, unknown>>;
};

type PhaseRawState = {
  authorized: boolean;
  boundaryCalls: unknown[];
  conversation: string | null;
  conversationEqualsInMemoryOwnership: boolean;
  conversationEqualsSdkIdentifier: boolean;
  finalCabinetRoute: boolean;
  localStorageKeyCount: number;
  ownershipFingerprintMatchesConversation: boolean;
  pendingPhase: string | null;
  sdkIdentifierPresent: boolean;
  sessionStorageKeyCount: number;
  storedIdentityPresent: boolean;
  storedOwnershipPresent: boolean;
  userCookie: string | null;
};

type Barrier = ReturnType<typeof createReplacementBarrier>;
type EventLedger = ReturnType<typeof createChatwootPhaseEventLedger>;
type CaptureStage =
  | "browser-context"
  | "initial-setup"
  | "initial-profile-login"
  | "initial-cabinet-navigation"
  | "gap-barrier"
  | "gap-snapshot"
  | "stable-transition"
  | "stable-snapshot"
  | "logout-clear"
  | "recreated-login"
  | "recreated-snapshot"
  | "final-reread";
type CookiePresence = Readonly<{
  conversationCookiePresent: boolean;
  userCookiePresent: boolean;
}>;

export async function captureChatwootPhaseStack(input: CaptureInput) {
  assertCaptureInput(input);
  const runNonce = randomBytes(32);
  const runScopeSha256 = sha256Bytes(Buffer.concat([
    Buffer.from("clean-pay-chatwoot-run-v1\0", "utf8"),
    runNonce,
  ]));
  const launchArgs = journeyChromiumLaunchArgs(input.resolverIp);
  const proxy = journeyConnectProxy(input.connectProxyUrl);
  const launchPolicySha256 = sha256Json({
    args: journeyProvenanceLaunchArgs(),
    context: {
      colorScheme: "light",
      ignoreHTTPSErrors: true,
      locale: "ru-RU",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      timezoneId: "Europe/Moscow",
      viewport: VIEWPORT,
    },
    proxy: { bypass: proxy.bypass, server: "<isolated-loopback>" },
  });
  const browserServer = await chromium.launchServer({
    headless: true,
    args: launchArgs,
    proxy,
  });
  const processId = browserServer.process().pid;
  if (typeof processId !== "number" || !Number.isSafeInteger(processId) || processId <= 0) {
    await browserServer.close();
    throw new Error("Chatwoot proof did not obtain a fresh Chromium process identity.");
  }
  const processScopeSha256 = sha256Json({ processId, runScopeSha256 });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let captureError: unknown;
  let captureStage: CaptureStage = "browser-context";
  const barrier = createReplacementBarrier();
  try {
    browser = await chromium.connect(browserServer.wsEndpoint());
    context = await browser.newContext({
      viewport: VIEWPORT,
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      colorScheme: "light",
      reducedMotion: "reduce",
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
    });
    captureStage = "initial-setup";
    const contextScopeSha256 = sha256Json({
      kind: "fresh-chatwoot-context",
      runScopeSha256,
      sequence: 1,
    });
    const launchScopeSha256 = sha256Json({
      kind: "fresh-chatwoot-launch",
      processScopeSha256,
      runScopeSha256,
    });
    const captured = await exerciseChatwootPhases({
      ...input,
      barrier,
      context,
    }, (stage) => { captureStage = stage; });
    return Object.freeze({
      runScopeSha256,
      browser: Object.freeze({
        playwrightVersion: input.playwrightVersion,
        chromiumVersion: browser.version(),
        connectProxyBindingSha256: input.connectProxyBindingSha256,
        contextScopeSha256,
        launchPolicySha256,
        launchScopeSha256,
        processScopeSha256,
        projectBindingSha256: input.projectSha256,
        userAgentSha256: captured.userAgentSha256,
        viewport: VIEWPORT,
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
        colorScheme: "light",
        serviceWorkers: "block",
        historySemantics: captured.historySemantics,
        staticProvenance: captured.staticProvenance,
        eventSeal: captured.eventSeal,
        unexpectedRequestCount: 0,
        unexpectedConsoleCount: 0,
        unexpectedPageErrorCount: 0,
        unexpectedPageCount: 0,
      }),
      phases: captured.phases,
      screenshots: captured.screenshots,
    });
  } catch (error) {
    captureError = new Error(
      `Chatwoot browser capture failed during ${captureStage}.`,
      { cause: error },
    );
    throw captureError;
  } finally {
    barrier.cancel();
    const cleanupErrors: unknown[] = [];
    const openContext = context;
    const openBrowser = browser;
    for (const operation of [
      openContext ? () => openContext.close() : undefined,
      openBrowser ? () => openBrowser.close() : undefined,
      () => browserServer.close(),
    ]) {
      if (!operation) continue;
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        captureError === undefined ? cleanupErrors : [captureError, ...cleanupErrors],
        "Chatwoot capture and exact Chromium cleanup did not both complete.",
      );
    }
  }
}

async function exerciseChatwootPhases(input: CaptureInput & {
  barrier: Barrier;
  context: BrowserContext;
}, onStage: (stage: CaptureStage) => void) {
  const eventLedger = createChatwootPhaseEventLedger();
  const diagnostics = installDiagnostics(input.context, eventLedger);
  const history = await installHistoryLedger(input.context, eventLedger);
  const initialProviderHistory = await installInitialProviderHistoryLedger(
    input.context,
    eventLedger,
  );
  const recreatedCausality = await installChatwootCausalLedger(input.context, eventLedger);
  await input.context.addInitScript(() => {
    if (window.top !== window) return;
    Object.defineProperty(window, "__cleanPayChatwootFixtureReadiness", {
      configurable: false,
      enumerable: false,
      value: "eager",
      writable: false,
    });
  });
  const page = await input.context.newPage();
  diagnostics.bindPrimaryPage(page);
  history.bindPrimaryPage(page);
  await initialProviderHistory.bindPrimaryPage(page);
  recreatedCausality.bindPrimaryPage(page);

  const ledgers = {
    initial: createBrowserRequestLedger(),
    recreated: createBrowserRequestLedger(),
  };
  let generation: keyof typeof ledgers = "initial";
  let cabinetDocumentAllowed = false;
  let initialCabinetFreshWidgetCount = 0;
  await input.context.routeWebSocket("**/*", async (webSocket) => {
    diagnostics.recordUnexpectedWebSocket();
    await webSocket.close({ code: 1008, reason: "chatwoot-phase-contract" });
  });
  input.context.on("serviceworker", () => diagnostics.recordUnexpectedServiceWorker());
  await input.context.route("**/*", async (route) => {
    const request = route.request();
    let requestPage: Page | undefined;
    try {
      requestPage = request.frame().page();
    } catch {
      requestPage = undefined;
    }
    if (requestPage !== page) {
      diagnostics.recordUnexpectedRequest(request.url());
      await route.abort("blockedbyclient");
      return;
    }
    let classification: StrictRequestEntry["classification"];
    try {
      classification = assertStrictClassification(classifyChatwootPhaseBrowserRequest(
        createJourneyBrowserRequestEnvelope(request, page.mainFrame()), {
        cabinetDocumentAllowed,
        generation,
        staticAssetContract: input.staticAssetContract,
      }));
    } catch {
      diagnostics.recordUnexpectedRequest(request.url());
      await route.abort("blockedbyclient");
      return;
    }
    const ledger = ledgers[generation];
    if (new Set([
      "app-cabinet-document",
      "app-login-document",
      "app-profile-document",
    ]).has(classification.key)) {
      ledger.currentDocumentKey = classification.key as StrictRequestEntry["documentKey"];
    }
    if (ledger.currentDocumentKey === null) {
      diagnostics.recordUnexpectedRequest(request.url());
      await route.abort("blockedbyclient");
      return;
    }
    const entry = {
      classification,
      documentKey: ledger.currentDocumentKey,
      request,
    };
    ledger.entries.push(entry);
    ledger.byIdentity.set(request, entry);
    if (ledger.entries.length > MAXIMUM_REQUESTS) {
      diagnostics.recordUnexpectedRequest(request.url());
      await route.abort("blockedbyclient");
      return;
    }
    let isNavigationRequest = false;
    let ownerIsMainFrame = false;
    let ownerUrl: string | null = null;
    if (new Set([
      "chatwoot-widget-conversation-frame",
      "chatwoot-widget-frame",
    ]).has(classification.key)) {
      try {
        const ownerFrame = request.frame().parentFrame();
        isNavigationRequest = request.isNavigationRequest();
        ownerIsMainFrame = ownerFrame === page.mainFrame();
        ownerUrl = ownerFrame?.url() ?? null;
      } catch {
        diagnostics.recordUnexpectedRequest(request.url());
        await route.abort("blockedbyclient");
        return;
      }
    }
    const barrierConsumed = classification.key === "chatwoot-widget-conversation-frame"
      ? input.barrier.wasConsumed()
      : false;
    const barrierDecision = advanceInitialCabinetBarrierForTest({
      barrierConsumed,
      classificationKey: classification.key,
      currentDocumentKey: ledger.currentDocumentKey,
      generation,
      initialCabinetFreshWidgetCount,
      isNavigationRequest,
      ownerIsMainFrame,
      ownerUrl,
    });
    if (
      generation === "initial"
      && ledger.currentDocumentKey === "app-cabinet-document"
      && classification.key === "chatwoot-widget-frame"
    ) {
      initialCabinetFreshWidgetCount = barrierDecision.initialCabinetFreshWidgetCount;
    }
    if (classification.disposition === "abort") {
      await route.abort("blockedbyclient");
      return;
    }
    if (
      generation === "initial"
      && ledger.currentDocumentKey === "app-cabinet-document"
      && classification.key === "chatwoot-widget-conversation-frame"
      && barrierDecision.action !== "continue"
      && !barrierConsumed
    ) {
      if (initialCabinetFreshWidgetCount < 1) {
        diagnostics.recordUnexpectedRequest(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      if (barrierDecision.action !== "hold") {
        diagnostics.recordUnexpectedRequest(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      await input.barrier.hold(route);
      return;
    }
    await route.continue();
  });
  page.on("response", (response) => {
    for (const ledger of Object.values(ledgers)) {
      if (ledger.byIdentity.has(response.request())) {
        ledger.responseByIdentity.set(response.request(), response);
        break;
      }
    }
  });
  const requestLifecycle = installChatwootCommonRequestLifecycleForTest(page, eventLedger);

  onStage("initial-profile-login");
  const gapRecorder = recordNetwork(page, SYNTHETIC_APPLICATION_ORIGIN);
  const stableRecorder = recordNetwork(page, SYNTHETIC_APPLICATION_ORIGIN);
  await loginToProfile(page);
  await waitForInitialProfileSupportContext(page);
  await history.captureInitialProfile(page);
  await initialProviderHistory.captureProfile(page);
  cabinetDocumentAllowed = true;
  onStage("initial-cabinet-navigation");
  const initialCabinetResponse = await navigateToCabinet(page);
  await history.captureInitialCabinet(page);
  await initialProviderHistory.captureCabinet(
    page,
    initialCabinetResponse,
    ledgers.initial,
  );
  onStage("gap-barrier");
  await input.barrier.ready();
  await waitForPhaseState(page, "waiting_for_frame");
  const gapNetwork = networkEvidence(await gapRecorder.finish());
  const gapHistory = initialProviderHistory.snapshot();
  const gapBrowserRequests = [
    historyEvidence(gapHistory),
    ...provisionalBrowserRecords(ledgers.initial),
  ];
  onStage("gap-snapshot");
  const gap = await captureVisiblePhase({
    phase: "gap",
    page,
    input,
    network: gapNetwork,
    browserRequests: gapBrowserRequests,
    replacementRequestHeld: true,
    replacementRequestReleased: false,
    previousConversation: null,
    previousUserCookie: null,
    recreationCausality: null,
    requestLifecycle,
    eventLedger,
    historyEvidence: historyEvidence(gapHistory),
  });

  onStage("stable-transition");
  input.barrier.release();
  await input.barrier.completed();
  await waitForPhaseState(page, null);
  const stableNetwork = networkEvidence(await stableRecorder.finish());
  const initialBrowserContract = await finishBrowserRequestContract(
    ledgers.initial,
    input.staticAssetContract,
    "initial",
  );
  const initialHistory = initialProviderHistory.snapshot();
  onStage("stable-snapshot");
  const stable = await captureVisiblePhase({
    phase: "stable",
    page,
    input,
    network: stableNetwork,
    browserRequests: [historyEvidence(initialHistory), ...initialBrowserContract.records],
    replacementRequestHeld: false,
    replacementRequestReleased: true,
    previousConversation: gap.raw.conversation,
    previousUserCookie: null,
    recreationCausality: null,
    requestLifecycle,
    eventLedger,
    historyEvidence: historyEvidence(initialHistory),
  });
  initialBrowserContract.assertComplete();
  if (initialHistory.historyCount !== 4) {
    throw new Error("Chatwoot initial browser history contract is incomplete.");
  }
  await initialProviderHistory.sealAndDetach(page);

  onStage("logout-clear");
  const clearBefore = await exactClearSnapshot(page);
  const preservedBefore = await page.evaluate((storageKey) => (
    sessionStorage.getItem(storageKey)
  ), SYNTHETIC_TURNSTILE_STORAGE_KEY);
  if (typeof preservedBefore !== "string") {
    throw new Error("Chatwoot proof cannot read the validated Turnstile ledger before clear.");
  }
  await history.sealPreClearGeneration(page);
  await recreatedCausality.sealPreClearGeneration(page);
  await clearSyntheticLogoutState(page);
  const preservedAfter = await page.evaluate((storageKey) => (
    sessionStorage.getItem(storageKey)
  ), SYNTHETIC_TURNSTILE_STORAGE_KEY);
  if (typeof preservedAfter !== "string") {
    throw new Error("Chatwoot proof cannot read the validated Turnstile ledger after clear.");
  }
  const clearAfter = await exactClearSnapshot(page);
  const clearSeal = input.sealer.sealClearedFixtureStorage({
    beforeValue: preservedBefore,
    afterValue: preservedAfter,
  });
  await recreatedCausality.markPostClear(page);
  const cleared = Object.freeze({
    exactApplicationOrigin: clearBefore.origin === SYNTHETIC_APPLICATION_ORIGIN
      && clearAfter.origin === SYNTHETIC_APPLICATION_ORIGIN,
    beforeCookieCount: clearBefore.fullCookieCount,
    beforeLocalStorageKeyCount: clearBefore.localStorageKeyCount,
    beforeSessionStorageKeyCount: clearBefore.sessionStorageKeyCount,
    afterCookieCount: clearAfter.fullCookieCount,
    afterLocalStorageKeyCount: clearAfter.localStorageKeyCount,
    afterSessionStorageKeyCount: clearAfter.sessionStorageKeyCount,
    conversationCookieAbsent: clearAfter.conversationCookieCount === 0,
    userCookieAbsent: clearAfter.userCookieCount === 0,
    ...clearSeal,
  });

  generation = "recreated";
  cabinetDocumentAllowed = false;
  const beforeRecreatedHistory = initialProviderHistory.snapshot();
  if (stableJson(beforeRecreatedHistory) !== stableJson(initialHistory)) {
    throw new Error("Chatwoot history changed between Stable and exact logout clear.");
  }
  await history.markGeneration(page);
  const recreatedRecorder = recordNetwork(page, SYNTHETIC_APPLICATION_ORIGIN);
  onStage("recreated-login");
  const telegram = await openLogin(page, "/cabinet");
  await history.captureRecreatedLogin(page);
  await recreatedCausality.assertNegativeLoginCheckpoint(page);
  cabinetDocumentAllowed = true;
  await completeTelegramLogin(page, telegram, "/cabinet");
  await recreatedCausality.waitForCabinetDocument();
  await history.captureRecreatedCabinet(page);
  await recreatedCausality.waitForCabinetSetUser();
  await recreatedCausality.waitForCabinetIdentityConfirmed();
  await recreatedCausality.observeCabinetCookiePair(page);
  await waitForBoundaryMethod(page, "setUser");
  await waitForPhaseState(page, null);
  recreatedCausality.markCabinetCompleted();
  const cookiePair = await readChatwootRawState(page);
  if (cookiePair.conversation === null || cookiePair.userCookie === null) {
    throw new Error("Chatwoot recreated cookie pair was not observed after setUser.");
  }
  const causalEvidence = recreatedCausality.finish(cookiePair);
  const recreatedNetwork = networkEvidence(await recreatedRecorder.finish());
  const recreatedBrowserContract = await finishBrowserRequestContract(
    ledgers.recreated,
    input.staticAssetContract,
    "recreated",
    initialBrowserContract.staticReference,
  );
  const recreatedHistory = finalizeChatwootPhaseHistoryContract(
    history.generationSnapshot(),
    "recreated",
  );
  if (recreatedHistory.historyCount < 2) {
    throw new Error("Chatwoot recreated browser history contract is incomplete.");
  }
  onStage("recreated-snapshot");
  const recreated = await captureVisiblePhase({
    phase: "recreated",
    page,
    input,
    network: recreatedNetwork,
    browserRequests: [historyEvidence(recreatedHistory), ...recreatedBrowserContract.records],
    replacementRequestHeld: false,
    replacementRequestReleased: true,
    previousConversation: stable.raw.conversation,
    previousUserCookie: stable.raw.userCookie,
    recreationCausality: Object.freeze({
      postClearLoginCount: countClassification(ledgers.recreated, "app-login-document"),
      postClearCabinetNavigationCount: countClassification(
        ledgers.recreated,
        "app-cabinet-document",
      ),
      ...causalEvidence,
    }),
    requestLifecycle,
    eventLedger,
    historyEvidence: historyEvidence(recreatedHistory),
  });
  recreatedBrowserContract.assertComplete();
  assertChatwootProviderPhaseRelations({
    gap: gap.provider,
    recreated: recreated.provider,
    stable: stable.provider,
  });

  onStage("final-reread");
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await recreatedCausality.drainCurrentDocument(page);
  await history.drainCurrentDocument(page);
  const preCloseFinalSources = Object.freeze({
    boundary: recreatedCausality.boundarySnapshot(),
    diagnostics: diagnostics.snapshot(),
    history: history.lifecycleSnapshot(),
    network: requestLifecycle.snapshot(),
    provider: recreated.provider,
  });
  if (stableJson(preCloseFinalSources.boundary) !== stableJson(recreated.raw.boundaryCalls)) {
    throw new Error("Chatwoot cross-document boundary collector differs from Recreated raw state.");
  }
  if (stableJson(preCloseFinalSources.network) !== stableJson(recreated.networkLifecycle)) {
    throw new Error("Chatwoot network changed after the Recreated atomic evidence boundary.");
  }
  history.assertNoTransientMutations();
  await page.close({ runBeforeUnload: false });
  const stoppedInitialBrowserContract = await finishBrowserRequestContract(
    ledgers.initial,
    input.staticAssetContract,
    "initial",
  );
  const stoppedRecreatedBrowserContract = await finishBrowserRequestContract(
    ledgers.recreated,
    input.staticAssetContract,
    "recreated",
    stoppedInitialBrowserContract.staticReference,
  );
  for (const [label, before, after] of [
    ["initial browser contract", initialBrowserContract, stoppedInitialBrowserContract],
    ["recreated browser contract", recreatedBrowserContract, stoppedRecreatedBrowserContract],
  ] as const) {
    if (stableJson({ records: before.records, provenance: before.provenance })
      !== stableJson({ records: after.records, provenance: after.provenance })) {
      throw new Error(`Chatwoot ${label} changed after its evidence boundary.`);
    }
  }
  stoppedInitialBrowserContract.assertComplete();
  stoppedRecreatedBrowserContract.assertComplete();
  const stoppedRecreatedHistory = finalizeChatwootPhaseHistoryContract(
    history.generationSnapshot(),
    "recreated",
  );
  if (stableJson(stoppedRecreatedHistory) !== stableJson(recreatedHistory)) {
    throw new Error("Chatwoot history changed after the Recreated evidence boundary.");
  }
  const stoppedProvider = assertProviderLedger(
    await controlJson(input.controlUrl, "/__ledger", MAXIMUM_CONTROL_BYTES),
    "recreated",
  );
  const stoppedFinalSources = Object.freeze({
    boundary: recreatedCausality.boundarySnapshot(),
    diagnostics: diagnostics.snapshot(),
    history: history.lifecycleSnapshot(),
    network: requestLifecycle.snapshot(),
    provider: stoppedProvider,
  });
  assertChatwootFinalSourceReread({
    after: stoppedFinalSources,
    before: preCloseFinalSources,
  });
  const stoppedBrowserEvidence = [
    historyEvidence(stoppedRecreatedHistory),
    ...stoppedRecreatedBrowserContract.records,
  ];
  eventLedger.observe("browserRequests", sha256Json(stoppedBrowserEvidence));
  eventLedger.observe("browserResponses", sha256Json(browserResponseEvidence(
    stoppedBrowserEvidence,
  )));
  eventLedger.observe("boundary", sha256Json(stoppedFinalSources.boundary));
  eventLedger.observe("diagnostics", sha256Json(stoppedFinalSources.diagnostics));
  eventLedger.observe("history", sha256Json(stoppedFinalSources.history));
  eventLedger.observe("network", sha256Json(stoppedFinalSources.network));
  eventLedger.observe("provider", sha256Json(stoppedProvider));
  await eventLedger.drainAndSeal(() => requestLifecycle.isIdle(), {
    pollMs: 10,
    quietMs: 200,
    timeoutMs: 5_000,
  });
  const afterSealProvider = assertProviderLedger(
    await controlJson(input.controlUrl, "/__ledger", MAXIMUM_CONTROL_BYTES),
    "recreated",
  );
  const afterSealSources = Object.freeze({
    boundary: recreatedCausality.boundarySnapshot(),
    diagnostics: diagnostics.snapshot(),
    history: history.lifecycleSnapshot(),
    network: requestLifecycle.snapshot(),
    provider: afterSealProvider,
  });
  assertChatwootFinalSourceReread({
    after: afterSealSources,
    before: stoppedFinalSources,
  });
  eventLedger.observe("boundary", sha256Json(afterSealSources.boundary));
  eventLedger.observe("diagnostics", sha256Json(afterSealSources.diagnostics));
  eventLedger.observe("history", sha256Json(afterSealSources.history));
  eventLedger.observe("network", sha256Json(afterSealSources.network));
  eventLedger.observe("provider", sha256Json(afterSealSources.provider));
  const rawEventSeal = eventLedger.assertClean();
  const historySemantics = canonicalChatwootHistorySemantics(
    afterSealSources.history,
  );
  const eventSeal = Object.freeze({
    eventCount: rawEventSeal.eventCount,
    lateEventCount: rawEventSeal.lateEventCount,
    sourceCounts: rawEventSeal.sourceCounts,
    sourceDigestsPresent: rawEventSeal.sourceDigestsPresent,
    stateSha256: rawEventSeal.stateSha256,
    status: rawEventSeal.status,
  });
  diagnostics.assertClean();
  const phaseReports = Object.freeze({
    gap: gap.report,
    stable: stable.report,
    cleared,
    recreated: recreated.report,
  });
  const screenshots = Object.freeze({
    gap: gap.screenshot,
    stable: stable.screenshot,
    recreated: recreated.screenshot,
  });
  return Object.freeze({
    phases: phaseReports,
    screenshots,
    staticProvenance: Object.freeze({
      assetAttestationSha256: input.staticAssetContract.providerContract.attestationSha256,
      assetInventorySha256: input.staticAssetContract.providerContract.inventorySha256,
      assetInventoryProjectionSha256:
        input.staticAssetContract.providerContract.inventoryLedgerContractSha256,
      assetRouteGraphSha256:
        input.staticAssetContract.providerContract.routeDeclaredPathContractSha256,
      initial: initialBrowserContract.provenance,
      recreated: recreatedBrowserContract.provenance,
    }),
    eventSeal,
    historySemantics,
    userAgentSha256: sha256Text(userAgent),
  });
}

async function captureVisiblePhase(input: {
  browserRequests: unknown[];
  eventLedger: EventLedger;
  historyEvidence: unknown;
  input: CaptureInput;
  network: ReturnType<typeof networkEvidence>;
  page: Page;
  phase: Phase;
  previousConversation: string | null;
  previousUserCookie: string | null;
  recreationCausality: unknown;
  requestLifecycle: ReturnType<typeof installChatwootCommonRequestLifecycleForTest>;
  replacementRequestHeld: boolean;
  replacementRequestReleased: boolean;
}) {
  if (input.phase !== "gap") {
    await waitForRequestLifecycleIdle(input.requestLifecycle);
  }
  await settleExactRender(input.page);
  const beforeNetworkLifecycle = input.requestLifecycle.snapshot();
  const beforeRaw = await readChatwootRawState(input.page);
  const beforeProvider = await waitForExactProviderLedger(
    input.input.controlUrl,
    input.phase,
  );
  observePhaseSourceDigests(input, beforeRaw, beforeProvider);
  const checkpoint = input.eventLedger.checkpoint(`${input.phase}-snapshot`);
  const [
    screenshot,
    dom,
    computedStyles,
    interactive,
    ariaSnapshot,
    storage,
    raw,
    providerEffects,
    cookies,
  ] = await Promise.all([
    input.page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: false,
      type: "png",
    }),
    canonicalDom(input.page),
    selectedComputedStyles(input.page),
    interactiveState(input.page),
    input.page.locator("body").ariaSnapshot(),
    browserStorage(input.page),
    readChatwootRawState(input.page),
    controlJson(input.input.controlUrl, "/__ledger", MAXIMUM_CONTROL_BYTES),
    input.page.context().cookies(),
  ]);
  const provider = assertProviderLedger(providerEffects, input.phase);
  assertChatwootPhaseBoundaryLedger(raw.boundaryCalls, input.phase);
  const [
    secondDom,
    secondComputedStyles,
    secondInteractive,
    secondAriaSnapshot,
    secondStorage,
    secondRaw,
    secondProviderEffects,
    secondCookies,
  ] = await Promise.all([
    canonicalDom(input.page),
    selectedComputedStyles(input.page),
    interactiveState(input.page),
    input.page.locator("body").ariaSnapshot(),
    browserStorage(input.page),
    readChatwootRawState(input.page),
    controlJson(input.input.controlUrl, "/__ledger", MAXIMUM_CONTROL_BYTES),
    input.page.context().cookies(),
  ]);
  const secondProvider = assertProviderLedger(secondProviderEffects, input.phase);
  assertChatwootPhaseBoundaryLedger(secondRaw.boundaryCalls, input.phase);
  assertChatwootAtomicPhaseRead({
    beforeProvider,
    beforeRaw,
    first: {
      accessibility: ariaSnapshot,
      computedStyles,
      cookies,
      dom,
      interactive,
      provider,
      raw,
      storage,
      networkLifecycle: beforeNetworkLifecycle,
    },
    phase: input.phase,
    second: {
      accessibility: secondAriaSnapshot,
      computedStyles: secondComputedStyles,
      cookies: secondCookies,
      dom: secondDom,
      interactive: secondInteractive,
      provider: secondProvider,
      raw: secondRaw,
      storage: secondStorage,
      networkLifecycle: input.requestLifecycle.snapshot(),
    },
  });
  observePhaseSourceDigests(input, secondRaw, secondProvider);
  input.eventLedger.assertStable(checkpoint);
  if (raw.conversation === null) {
    throw new Error(`Chatwoot ${input.phase} phase has no conversation cookie.`);
  }
  if (input.phase === "gap" && raw.userCookie !== null) {
    throw new Error("Chatwoot Gap phase unexpectedly observed a user cookie.");
  }
  if (input.phase !== "gap" && raw.userCookie === null) {
    throw new Error(`Chatwoot ${input.phase} phase has no user cookie.`);
  }
  const orderedEvidence = canonicalChatwootPhaseEvidence({
    accessibility: sanitizeAriaUrls(
      ariaSnapshot,
      SYNTHETIC_APPLICATION_ORIGIN,
      input.page.url(),
    ),
    browserRequests: input.browserRequests,
    boundaryCalls: raw.boundaryCalls,
    computedStyles,
    dom,
    fixtureContractSha256: input.input.fixtureContractSha256,
    interactive,
    network: input.network,
    providerEffects: provider,
    storage,
  });
  const sealed = input.input.sealer.sealPhase({
    cookies,
    phase: input.phase,
    orderedEvidence,
    conversationValue: raw.conversation,
    userCookieValue: raw.userCookie,
  });
  const scopedCookies = await input.page.context().cookies(
    `${SYNTHETIC_APPLICATION_ORIGIN}/cabinet`,
  );
  const conversationCookies = scopedCookies.filter(({ name }) => name === "cw_conversation");
  const userCookies = scopedCookies.filter(({ name }) => name.startsWith("cw_user_"));
  const setUserCount = countBoundaryMethod(raw.boundaryCalls, "setUser");
  const frameLoadedCount = countBoundaryMethod(raw.boundaryCalls, "frame.loaded");
  const identityConfirmedCount = countBoundaryMethod(raw.boundaryCalls, "identity.confirmed");
  const contactProbeCount = provider.entries.filter(
    ({ effect }) => effect === "contact_identity_probed",
  ).length;
  const rejectedContactProbeCount = provider.entries.filter(
    ({ effect }) => effect === "contact_identity_probe_rejected",
  ).length;
  const report = Object.freeze({
    authorized: raw.authorized,
    boundaryCallCount: raw.boundaryCalls.length,
    contactProbeCount,
    cookieDescriptorByteLength: sealed.cookieDescriptorByteLength,
    cookieDescriptorCount: sealed.cookieDescriptorCount,
    cookieValueByteLength: sealed.cookieValueByteLength,
    conversationCookieByteLength: Buffer.byteLength(raw.conversation, "utf8"),
    conversationCookieCount: conversationCookies.length,
    conversationEqualsInMemoryOwnership: raw.conversationEqualsInMemoryOwnership,
    conversationEqualsSdkIdentifier: raw.conversationEqualsSdkIdentifier,
    conversationSameAsPriorPhase: input.previousConversation !== null
      && input.previousConversation === raw.conversation,
    evidenceCounts: sealed.evidenceCounts,
    evidenceRanges: sealed.evidenceRanges,
    finalCabinetRoute: raw.finalCabinetRoute,
    frameLoadedCount,
    hashes: sealed.hashes,
    identityConfirmedCount,
    localStorageKeyCount: raw.localStorageKeyCount,
    newSetUserObserved: setUserCount > 0,
    ownershipFingerprintMatchesConversation: raw.ownershipFingerprintMatchesConversation,
    pendingAbsent: raw.pendingPhase === null,
    pendingWaitingForFrame: raw.pendingPhase === "waiting_for_frame",
    rejectedContactProbeCount,
    replacementRequestHeld: input.replacementRequestHeld,
    replacementRequestReleased: input.replacementRequestReleased,
    recreationCausality: input.recreationCausality,
    screenshot: Object.freeze({
      byteLength: screenshot.byteLength,
      sha256: sha256Bytes(screenshot),
    }),
    sdkIdentifierPresent: raw.sdkIdentifierPresent,
    sessionStorageKeyCount: raw.sessionStorageKeyCount,
    serverActionCount: input.network.serverActionCount,
    setUserCount,
    storedIdentityPresent: raw.storedIdentityPresent,
    storedOwnershipPresent: raw.storedOwnershipPresent,
    totalCookieCount: scopedCookies.length,
    userCookieByteLength: raw.userCookie === null
      ? 0
      : Buffer.byteLength(raw.userCookie, "utf8"),
    userCookieCount: userCookies.length,
    userCookieSameAsPriorSettledPhase: input.previousUserCookie !== null
      && input.previousUserCookie === raw.userCookie,
  });
  return Object.freeze({
    networkLifecycle: input.requestLifecycle.snapshot(),
    provider,
    raw: Object.freeze({
      boundaryCalls: structuredClone(raw.boundaryCalls),
      conversation: raw.conversation,
      userCookie: raw.userCookie,
    }),
    report,
    screenshot: Buffer.from(screenshot),
  });
}

async function waitForExactProviderLedger(controlUrl: string, phase: Phase) {
  const expectedEntryCount = phase === "recreated"
    ? recreatedProviderEffectSequence.length
    : initialProviderEffectSequence.length;
  const deadline = Date.now() + 5_000;
  while (true) {
    const value = await controlJson(controlUrl, "/__ledger", MAXIMUM_CONTROL_BYTES);
    if (!isRecord(value) || !Array.isArray(value.entries)) {
      return assertProviderLedger(value, phase);
    }
    if (value.entries.length >= expectedEntryCount) {
      return assertProviderLedger(value, phase);
    }
    if (Date.now() >= deadline) {
      return assertProviderLedger(value, phase);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function assertChatwootFinalSourceReread(value: unknown) {
  exactKeys(value, ["after", "before"], "Chatwoot final source reread");
  const reread = value as Record<string, unknown>;
  const names = ["boundary", "diagnostics", "history", "network", "provider"];
  exactKeys(reread.before, names, "Chatwoot final source pre-close snapshot");
  exactKeys(reread.after, names, "Chatwoot final source post-close snapshot");
  const before = reread.before as Record<string, unknown>;
  const after = reread.after as Record<string, unknown>;
  for (const name of names) {
    if (stableJson(before[name]) !== stableJson(after[name])) {
      throw new Error(`Chatwoot final ${name} source changed across its immutable reread.`);
    }
  }
  return Object.freeze({ sourceCount: names.length, status: "exact-final-source-reread" });
}

export function assertChatwootHistoryLifecycle(value: unknown) {
  if (!isDenseArray(value) || value.length < 1 || value.length > MAXIMUM_REQUESTS) {
    throw new Error("Chatwoot history lifecycle is incomplete or outside its exact bound.");
  }
  const kinds = new Set([
    "checkpoint",
    "framenavigated",
    "generation-boundary",
    "hashchange",
    "popstate",
    "pushState",
    "replaceState",
  ]);
  const projected = value.map((rawEntry, index) => {
    exactKeys(
      rawEntry,
      ["generation", "historyLength", "kind", "url"],
      `Chatwoot history lifecycle entry ${index}`,
    );
    const entry = rawEntry as Record<string, unknown>;
    if (!new Set(["initial", "recreated"]).has(String(entry.generation))
      || !kinds.has(String(entry.kind))
      || !(entry.historyLength === null || (Number.isSafeInteger(entry.historyLength)
        && Number(entry.historyLength) >= 0 && Number(entry.historyLength) <= 64))) {
      throw new Error(`Chatwoot history lifecycle entry ${index} is invalid.`);
    }
    if (entry.kind === "generation-boundary") {
      if (entry.generation !== "recreated" || entry.historyLength !== null || entry.url !== null) {
        throw new Error("Chatwoot history generation boundary is not exact.");
      }
    } else {
      assertSafeUrlProjection(entry.url, `Chatwoot history lifecycle URL ${index}`);
    }
    return Object.freeze(structuredClone(entry));
  });
  if (!projected.some(({ kind }) => kind === "checkpoint")
    || !projected.some(({ kind }) => kind === "framenavigated")) {
    throw new Error("Chatwoot history lifecycle lacks an observed navigation boundary.");
  }
  return Object.freeze(projected);
}

export function canonicalChatwootHistorySemantics(value: unknown) {
  const lifecycle = assertChatwootHistoryLifecycle(value);
  const initialEntryCount = lifecycle.filter(({ generation }) => generation === "initial").length;
  const recreatedEntryCount = lifecycle.filter(
    ({ generation }) => generation === "recreated",
  ).length;
  const generationBoundaryCount = lifecycle.filter(
    ({ kind }) => kind === "generation-boundary",
  ).length;
  if (initialEntryCount < 1 || recreatedEntryCount < 1 || generationBoundaryCount !== 1) {
    throw new Error("Chatwoot history semantic lifecycle is incomplete.");
  }
  return Object.freeze({
    contractSha256: sha256Json(lifecycle),
    entryCount: lifecycle.length,
    generationBoundaryCount,
    initialEntryCount,
    recreatedEntryCount,
  });
}

export function assertChatwootAtomicPhaseRead(value: {
  beforeProvider: unknown;
  beforeRaw: unknown;
  first: Record<string, unknown>;
  phase: Phase;
  second: Record<string, unknown>;
}) {
  exactKeys(value, ["beforeProvider", "beforeRaw", "first", "phase", "second"],
    "Chatwoot atomic phase read");
  if (!new Set<Phase>(["gap", "stable", "recreated"]).has(value.phase)) {
    throw new Error("Chatwoot atomic phase label is invalid.");
  }
  const keys = [
    "accessibility",
    "computedStyles",
    "cookies",
    "dom",
    "interactive",
    "networkLifecycle",
    "provider",
    "raw",
    "storage",
  ];
  exactKeys(value.first, keys, `Chatwoot ${value.phase} first atomic read`);
  exactKeys(value.second, keys, `Chatwoot ${value.phase} second atomic read`);
  for (const key of keys) {
    if (stableJson(value.first[key]) !== stableJson(value.second[key])) {
      throw new Error(`Chatwoot ${value.phase} ${key} changed during its atomic snapshot.`);
    }
  }
  if (stableJson(value.beforeRaw) !== stableJson(value.first.raw)
    || stableJson(value.beforeProvider) !== stableJson(value.first.provider)) {
    throw new Error(`Chatwoot ${value.phase} evidence changed before its atomic snapshot.`);
  }
  return Object.freeze({ phase: value.phase, status: "atomic-phase-read-exact" });
}

function observePhaseSourceDigests(
  input: {
    browserRequests: unknown[];
    eventLedger: EventLedger;
    historyEvidence: unknown;
    network: ReturnType<typeof networkEvidence>;
  },
  raw: PhaseRawState,
  provider: ProviderLedger,
) {
  input.eventLedger.observe("boundary", sha256Json(raw.boundaryCalls));
  input.eventLedger.observe("browserRequests", sha256Json(input.browserRequests));
  input.eventLedger.observe("browserResponses", sha256Json(browserResponseEvidence(
    input.browserRequests,
  )));
  input.eventLedger.observe("history", sha256Json(input.historyEvidence));
  input.eventLedger.observe("network", sha256Json(input.network));
  input.eventLedger.observe("provider", sha256Json(provider));
}

function browserResponseEvidence(entries: unknown[]) {
  return entries.map((entry) => {
    if (!isRecord(entry)) return entry;
    return {
      responseContentType: entry.responseContentType ?? null,
      responseStatus: entry.responseStatus ?? null,
      redirectEdge: entry.redirectEdge ?? null,
    };
  });
}

async function loginToProfile(page: Page) {
  const telegram = await openLogin(page, "/profile");
  await completeTelegramNavigation(page, telegram, "/profile");
}

async function openLogin(page: Page, redirectPath: "/profile" | "/cabinet") {
  const redirectQuery = redirectPath === "/profile" ? "%2Fprofile" : "%2Fcabinet";
  await page.goto(`${SYNTHETIC_APPLICATION_ORIGIN}/login?redirect_to=${redirectQuery}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const telegram = page.getByRole("button", { name: "Войти через Telegram" });
  await telegram.waitFor({ state: "visible", timeout: 15_000 });
  return telegram;
}

async function completeTelegramLogin(
  page: Page,
  telegram: Locator,
  redirectPath: "/cabinet",
) {
  await completeTelegramNavigation(page, telegram, redirectPath);
  await waitForPhaseState(page, null);
}

async function completeTelegramNavigation(
  page: Page,
  telegram: Locator,
  redirectPath: "/profile" | "/cabinet",
) {
  await telegram.click();
  await page.waitForURL(
    (url) => url.href === `${SYNTHETIC_APPLICATION_ORIGIN}${redirectPath}`,
    { timeout: 30_000 },
  );
  await page.getByRole("heading", {
    name: redirectPath === "/profile" ? "Профиль" : "Личный кабинет",
    level: 1,
  })
    .waitFor({ state: "visible", timeout: 15_000 });
}

async function navigateToCabinet(page: Page) {
  const response = await page.goto(`${SYNTHETIC_APPLICATION_ORIGIN}/cabinet`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForURL(
    (url) => url.href === `${SYNTHETIC_APPLICATION_ORIGIN}/cabinet`,
    { timeout: 30_000 },
  );
  await page.getByRole("heading", { name: "Личный кабинет", level: 1 })
    .waitFor({ state: "visible", timeout: 15_000 });
  return response;
}

async function waitForInitialProfileSupportContext(page: Page) {
  await page.waitForFunction(() => {
    const windowValue = window as unknown as {
      $chatwoot?: {
        user?: {
          custom_attributes?: { payment_context_status?: unknown };
        };
      };
      __cleanPayChatwootBoundaryCalls?: Array<{
        label?: unknown;
        method?: unknown;
      }>;
      cleanPayChatwootPendingIdentity?: { phase?: unknown };
    };
    const calls = windowValue.__cleanPayChatwootBoundaryCalls;
    const pending = windowValue.cleanPayChatwootPendingIdentity;
    const identitySettled = pending === undefined
      || pending.phase === "ownership_confirmed";
    const removedLabels = new Set(
      Array.isArray(calls)
        ? calls
          .filter(({ method }) => method === "removeLabel")
          .map(({ label }) => label)
        : [],
    );
    const paymentLabelCalls = Array.isArray(calls)
      ? calls.filter(({ label, method }) => (
        label === "payment_problem"
        && (method === "removeLabel" || method === "setLabel")
      ))
      : [];
    const paymentContextStatus = windowValue.$chatwoot
      ?.user?.custom_attributes?.payment_context_status;
    // A reset disposable DB has no PaymentHistorySyncState. In that exact
    // fail-closed state production intentionally omits payment label writes;
    // accepting it requires both the signed payload's explicit stale marker
    // and proof that neither label mutation was attempted.
    const paymentLabelSettled = removedLabels.has("payment_problem")
      || (paymentContextStatus === "stale" && paymentLabelCalls.length === 0);
    return identitySettled
      && paymentLabelSettled
      && removedLabels.has("subscription_expired");
  }, undefined, { timeout: 30_000 });
}

async function waitForPhaseState(page: Page, pendingPhase: string | null) {
  await page.waitForFunction((expected) => {
    const state = (window as unknown as {
      cleanPayChatwootPendingIdentity?: { phase?: unknown };
    }).cleanPayChatwootPendingIdentity;
    const phase = typeof state?.phase === "string" ? state.phase : null;
    const calls = (window as unknown as {
      __cleanPayChatwootBoundaryCalls?: Array<{ method?: unknown }>;
    }).__cleanPayChatwootBoundaryCalls;
    return phase === expected
      && Array.isArray(calls)
      && calls.some(({ method }) => method === "setUser");
  }, pendingPhase, { timeout: 30_000 });
}

async function waitForBoundaryMethod(page: Page, method: string) {
  await page.waitForFunction((expected) => {
    const calls = (window as unknown as {
      __cleanPayChatwootBoundaryCalls?: Array<{ method?: unknown }>;
    }).__cleanPayChatwootBoundaryCalls;
    return Array.isArray(calls) && calls.some((entry) => entry.method === expected);
  }, method, { timeout: 30_000 });
}

async function readChatwootRawState(page: Page): Promise<PhaseRawState> {
  const browser = await page.evaluate(() => {
    const windowValue = window as unknown as {
      $chatwoot?: { identifier?: unknown };
      __cleanPayChatwootBoundaryCalls?: unknown[];
      cleanPayChatwootAuthorized?: unknown;
      cleanPayChatwootIdentity?: unknown;
      cleanPayChatwootOwnership?: { conversation?: unknown };
      cleanPayChatwootPendingIdentity?: { phase?: unknown };
    };
    const cookieValue = (name: string) => {
      const encoded = `${encodeURIComponent(name)}=`;
      const match = document.cookie.split(";").find((entry) => (
        entry.trim().startsWith(encoded)
      ));
      if (!match) return null;
      const value = match.trim().slice(encoded.length);
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };
    const userCookieNames = document.cookie.split(";")
      .map((entry) => entry.trim().split("=", 1)[0])
      .filter((name) => name.startsWith("cw_user_"));
    const conversation = cookieValue("cw_conversation");
    const userCookie = userCookieNames.length === 1
      ? cookieValue(userCookieNames[0])
      : null;
    const fingerprint = (value: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return `${value.length}:${(hash >>> 0).toString(16)}`;
    };
    let storedOwnership: unknown;
    try {
      storedOwnership = JSON.parse(
        localStorage.getItem("clean-pay:chatwoot-ownership:v1") ?? "null",
      );
    } catch {
      storedOwnership = null;
    }
    const storedOwnershipRecord = storedOwnership
      && typeof storedOwnership === "object"
      && !Array.isArray(storedOwnership)
      ? storedOwnership as Record<string, unknown>
      : null;
    const sdkIdentifier = windowValue.$chatwoot?.identifier;
    return {
      authorized: windowValue.cleanPayChatwootAuthorized === true,
      boundaryCalls: Array.isArray(windowValue.__cleanPayChatwootBoundaryCalls)
        ? structuredClone(windowValue.__cleanPayChatwootBoundaryCalls)
        : [],
      conversation,
      conversationEqualsInMemoryOwnership: conversation !== null
        && windowValue.cleanPayChatwootOwnership?.conversation === conversation,
      conversationEqualsSdkIdentifier: conversation !== null
        && String(sdkIdentifier ?? "") === conversation,
      finalCabinetRoute: location.href === "https://pay.ci.clean-pay.dev/cabinet",
      localStorageKeyCount: localStorage.length,
      ownershipFingerprintMatchesConversation: conversation !== null
        && storedOwnershipRecord?.conversation === fingerprint(conversation),
      pendingPhase: typeof windowValue.cleanPayChatwootPendingIdentity?.phase === "string"
        ? windowValue.cleanPayChatwootPendingIdentity.phase
        : null,
      sdkIdentifierPresent: typeof sdkIdentifier === "string"
        || typeof sdkIdentifier === "number",
      sessionStorageKeyCount: sessionStorage.length,
      storedIdentityPresent: localStorage.getItem("clean-pay:chatwoot-identity:v1") !== null,
      storedOwnershipPresent: localStorage.getItem("clean-pay:chatwoot-ownership:v1") !== null,
      userCookie,
      userCookieNameCount: userCookieNames.length,
    };
  });
  exactKeys(browser, [
    "authorized",
    "boundaryCalls",
    "conversation",
    "conversationEqualsInMemoryOwnership",
    "conversationEqualsSdkIdentifier",
    "finalCabinetRoute",
    "localStorageKeyCount",
    "ownershipFingerprintMatchesConversation",
    "pendingPhase",
    "sdkIdentifierPresent",
    "sessionStorageKeyCount",
    "storedIdentityPresent",
    "storedOwnershipPresent",
    "userCookie",
    "userCookieNameCount",
  ], "Chatwoot raw browser state");
  if (browser.userCookieNameCount > 1) {
    throw new Error("Chatwoot browser state contains multiple user-cookie names.");
  }
  for (const name of ["localStorageKeyCount", "sessionStorageKeyCount"] as const) {
    if (!Number.isSafeInteger(browser[name])
      || browser[name] < 0 || browser[name] > MAXIMUM_STORAGE_KEYS) {
      throw new Error(`Chatwoot browser ${name} is outside its exact producer bound.`);
    }
  }
  return {
    authorized: browser.authorized,
    boundaryCalls: browser.boundaryCalls,
    conversation: browser.conversation,
    conversationEqualsInMemoryOwnership: browser.conversationEqualsInMemoryOwnership,
    conversationEqualsSdkIdentifier: browser.conversationEqualsSdkIdentifier,
    finalCabinetRoute: browser.finalCabinetRoute,
    localStorageKeyCount: browser.localStorageKeyCount,
    ownershipFingerprintMatchesConversation: browser.ownershipFingerprintMatchesConversation,
    pendingPhase: browser.pendingPhase,
    sdkIdentifierPresent: browser.sdkIdentifierPresent,
    sessionStorageKeyCount: browser.sessionStorageKeyCount,
    storedIdentityPresent: browser.storedIdentityPresent,
    storedOwnershipPresent: browser.storedOwnershipPresent,
    userCookie: browser.userCookie,
  };
}

function countBoundaryMethod(calls: unknown[], method: string) {
  return calls.filter((entry) => (
    isRecord(entry) && entry.method === method
  )).length;
}

async function exactClearSnapshot(page: Page) {
  const storage = await page.evaluate(() => ({
    localStorageKeyCount: localStorage.length,
    origin: location.origin,
    sessionStorageKeyCount: sessionStorage.length,
  }));
  const cookies = await page.context().cookies();
  return Object.freeze({
    ...storage,
    fullCookieCount: cookies.length,
    conversationCookieCount: cookies.filter(({ name }) => name === "cw_conversation").length,
    userCookieCount: cookies.filter(({ name }) => name.startsWith("cw_user_")).length,
  });
}

function networkEvidence(entries: NetworkManifestEntry[]) {
  const requests = structuredClone(entries);
  const serverActions = requests
    .filter((entry) => entry.serverAction.present)
    .map((entry, order) => ({
      order,
      requestIndex: entry.index,
      method: entry.method,
      url: entry.url,
      identifier: entry.serverAction.identifier,
      payload: entry.postData,
      status: entry.response?.status ?? null,
    }));
  if (requests.length === 0 || requests.length > MAXIMUM_REQUESTS
    || serverActions.length === 0 || serverActions.length > MAXIMUM_SERVER_ACTIONS) {
    throw new Error("Chatwoot phase network or Server Action ledger is incomplete.");
  }
  return Object.freeze({
    requests,
    serverActionCount: serverActions.length,
    serverActions,
  });
}

function createBrowserRequestLedger(): BrowserRequestLedger {
  return {
    entries: [],
    byIdentity: new Map(),
    currentDocumentKey: null,
    responseByIdentity: new Map(),
  };
}

export function advanceInitialCabinetBarrierForTest(
  input: InitialCabinetBarrierInput,
): InitialCabinetBarrierDecision {
  if (!Number.isSafeInteger(input.initialCabinetFreshWidgetCount)
    || input.initialCabinetFreshWidgetCount < 0) {
    throw new Error("Chatwoot initial cabinet widget count is invalid.");
  }
  const cabinetOwnedFrame = input.generation === "initial"
    && input.currentDocumentKey === "app-cabinet-document"
    && input.isNavigationRequest
    && input.ownerIsMainFrame
    && input.ownerUrl === `${SYNTHETIC_APPLICATION_ORIGIN}/cabinet`;
  const initialCabinetFreshWidgetCount = cabinetOwnedFrame
    && input.classificationKey === "chatwoot-widget-frame"
    ? input.initialCabinetFreshWidgetCount + 1
    : input.initialCabinetFreshWidgetCount;
  let action: InitialCabinetBarrierDecision["action"] = "continue";
  if (cabinetOwnedFrame
    && input.classificationKey === "chatwoot-widget-conversation-frame"
    && !input.barrierConsumed) {
    action = initialCabinetFreshWidgetCount < 1 ? "abort-unexpected" : "hold";
  }
  return Object.freeze({
    action,
    initialCabinetFreshWidgetCount,
  });
}

function provisionalBrowserRecords(ledger: BrowserRequestLedger) {
  if (ledger.entries.length === 0 || ledger.entries.length > MAXIMUM_REQUESTS) {
    throw new Error("Chatwoot provisional browser request ledger is incomplete.");
  }
  return ledger.entries.map(({
    classification,
    request,
  }, order) => {
    const response = ledger.responseByIdentity.get(request);
    return semanticBrowserRecord({
      order,
      classification,
      responseContentType: response
        ? normalizeResponseContentType(response.headers()["content-type"])
        : null,
      responseStatus: response?.status() ?? null,
      redirectEdge: null,
    });
  });
}

async function finishBrowserRequestContract(
  ledger: BrowserRequestLedger,
  staticAssetContract: StaticAssetContract,
  generation: "initial" | "recreated",
  referenceStaticContract: unknown = null,
) {
  const records: Array<{
    classification: StrictRequestEntry["classification"];
    documentKey: StrictRequestEntry["documentKey"];
    redirectEdge: string | null;
    responseContentType: string | null;
    responseFailureSha256: string | null;
    responseStatus: number | null;
    staticResponseBytes: number | null;
    staticResponseSha256: string | null;
  }> = [];
  const canonicalRecords = [];
  const redirectedSources = new Set<Request>();
  const documentKeys: StrictRequestEntry["documentKey"][] = generation === "initial"
    ? ["app-login-document", "app-profile-document", "app-cabinet-document"]
    : ["app-login-document", "app-cabinet-document"];
  const responseDeclarationsByDocument = new Map(documentKeys.map((documentKey) => [
    documentKey,
    new Set<string>(),
  ]));
  const cssMediaReferencesBySource = new Map<string, ReadonlyArray<Readonly<{
    sourcePath: string;
    targetPath: string;
  }>>>();
  let declarationBytes = 0;
  let staticResponseBytes = 0;
  for (const [order, { classification, documentKey, request }] of ledger.entries.entries()) {
    const response = await boundedChatwootBrowserOperation(
      request.response(),
      5_000,
      "Chatwoot request response",
    );
    const observedResponse = ledger.responseByIdentity.get(request);
    if ((response === null) !== (observedResponse === undefined)
      || (response !== null && observedResponse !== response)) {
      throw new Error("Chatwoot completed response identity differs from its request ledger.");
    }
    const redirectedFrom = request.redirectedFrom();
    let redirectEdge = null;
    if (redirectedFrom) {
      const source = ledger.byIdentity.get(redirectedFrom);
      const sourceResponse = await boundedChatwootBrowserOperation(
        redirectedFrom.response(),
        5_000,
        "Chatwoot redirect source response",
      );
      const location = sourceResponse?.headers().location;
      if (!source || !sourceResponse || typeof location !== "string") {
        throw new Error("Chatwoot strict browser redirect chain is incomplete.");
      }
      redirectEdge = assertChatwootPhaseRedirect({
        from: { classification: source.classification, url: redirectedFrom.url() },
        to: { classification, url: request.url() },
        status: sourceResponse.status(),
        location,
      }, generation);
      redirectedSources.add(redirectedFrom);
    }
    const responseContentType = response
      ? normalizeResponseContentType(response.headers()["content-type"])
      : null;
    let staticObservation = {
      staticResponseBytes: null as number | null,
      staticResponseSha256: null as string | null,
    };
    if (classification.staticPath !== null) {
      const staticEvidence = await readProviderOverlapStaticResponseEvidence({
        classification,
        response,
        responseContentType,
      }, staticAssetContract.providerContract);
      const staticEvidenceReread = await readProviderOverlapStaticResponseEvidence({
        classification,
        response,
        responseContentType,
      }, staticAssetContract.providerContract);
      if (staticEvidence.body.byteLength !== staticEvidenceReread.body.byteLength
        || !staticEvidence.body.equals(staticEvidenceReread.body)
        || stableJson(staticEvidence.observation)
          !== stableJson(staticEvidenceReread.observation)) {
        throw new Error("Chatwoot completed static response changed across its exact reread.");
      }
      staticResponseBytes += staticEvidence.body.byteLength;
      if (!Number.isSafeInteger(staticResponseBytes)
        || staticResponseBytes > 1024 * 1024 * 1024) {
        throw new Error("Chatwoot static response bytes exceeded their aggregate bound.");
      }
      staticObservation = staticEvidence.observation;
      if (responseContentType === "text/css") {
        declarationBytes += staticEvidence.body.byteLength;
        if (staticEvidence.body.byteLength > 2 * 1024 * 1024
          || declarationBytes > 8 * 1024 * 1024) {
          throw new Error("Chatwoot static declaration graph exceeded its bounded body contract.");
        }
        const references = extractProviderOverlapCssMediaReferences(
          staticEvidence.body,
          classification.staticPath,
          staticAssetContract.providerContract,
        );
        const priorReferences = cssMediaReferencesBySource.get(classification.staticPath);
        if (priorReferences !== undefined
          && stableJson(priorReferences) !== stableJson(references)) {
          throw new Error("Repeated Chatwoot CSS changed its exact media reference closure.");
        }
        if (priorReferences === undefined) {
          cssMediaReferencesBySource.set(classification.staticPath, references);
        }
        const declarations = responseDeclarationsByDocument.get(documentKey);
        if (!declarations) {
          throw new Error("Chatwoot CSS response escaped its document generation.");
        }
        for (const reference of references) declarations.add(reference.targetPath);
      }
    }
    if (
      response
      && response.status() === 200
      && new Set(["text/html", "text/x-component"])
        .has(responseContentType ?? "")
    ) {
      const body = await boundedChatwootBrowserOperation(
        response.body(),
        5_000,
        "Chatwoot static declaration body",
      );
      const bodyReread = await boundedChatwootBrowserOperation(
        response.body(),
        5_000,
        "Chatwoot static declaration body reread",
      );
      if (!body.equals(bodyReread)) {
        throw new Error("Chatwoot static declaration source changed across its exact reread.");
      }
      declarationBytes += body.byteLength;
      if (body.byteLength > 2 * 1024 * 1024 || declarationBytes > 8 * 1024 * 1024) {
        throw new Error("Chatwoot static response graph exceeded its bounded body contract.");
      }
      const declarations = responseDeclarationsByDocument.get(documentKey);
      if (!declarations) {
        throw new Error("Chatwoot static declaration escaped its document generation.");
      }
      for (const servedPath of extractProviderOverlapResponseStaticDeclarations(
        body,
        staticAssetContract.providerContract,
      )) {
        declarations.add(servedPath);
      }
    }
    const record = {
      classification,
      documentKey,
      redirectEdge,
      responseContentType,
      responseFailureSha256: null,
      responseStatus: response?.status() ?? null,
      ...staticObservation,
    };
    records.push(record);
    canonicalRecords.push(semanticBrowserRecord({ order, ...record }));
  }
  for (const { classification, request } of ledger.entries) {
    const response = await boundedChatwootBrowserOperation(
      request.response(),
      5_000,
      "Chatwoot redirect completion response",
    );
    if (
      response
      && response.status() >= 300
      && response.status() <= 399
      && !redirectedSources.has(request)
      && classification.disposition !== "abort"
    ) {
      throw new Error("Chatwoot strict browser redirect has no exact successor.");
    }
  }
  const sharedLoadGraph = Object.freeze({
    cssMediaReferences: Object.freeze([...cssMediaReferencesBySource.values()].flat()),
    responseDeclarationsByDocument: Object.freeze(documentKeys.map((documentKey) => (
      Object.freeze({
        documentKey,
        paths: Object.freeze([...responseDeclarationsByDocument.get(documentKey)!].sort()),
      })
    ))),
  });
  const finalized = finalizeChatwootPhaseBrowserContract(records, {
    ...sharedLoadGraph,
    generation,
    referenceStaticContract,
    staticAssetContract,
  });
  return Object.freeze({
    records: Object.freeze([
      Object.freeze({
        kind: "strict-browser-semantic-contract",
        requestCount: finalized.requestCount,
        semanticRequestContractSha256: finalized.requestContractSha256,
        staticRequestCount: finalized.staticRequestCount,
      }),
      ...canonicalRecords,
    ]),
    provenance: Object.freeze({
      documentGenerationCount: generation === "initial" ? 3 : 2,
      requestCount: finalized.requestCount,
      requestContractSha256: finalized.requestContractSha256,
      requestOrderContractSha256: finalized.requestOrderContractSha256,
      requestOrderLedger: finalized.requestOrderLedger,
      responseDeclarationContractSha256: finalized.responseDeclarationContractSha256,
      responseDeclarationLedger: finalized.responseDeclarationLedger,
      semanticRequestLedger: finalized.semanticRequestLedger,
      staticLoadGraph: finalized.staticLoadGraph,
      staticLoadGraphContractSha256: finalized.staticLoadGraphContractSha256,
      staticRequestContractSha256: finalized.staticRequestContractSha256,
      staticRequestCount: finalized.staticRequestCount,
      staticRequestLedger: finalized.staticRequestLedger,
      staticResponseByteLength: (finalized.staticRequestLedger as ReadonlyArray<{
        assetBytes: number;
      }>).reduce(
        (total, entry) => total + entry.assetBytes,
        0,
      ),
    }),
    staticReference: finalized,
    assertComplete() {
      if (
        ledger.entries.length !== records.length
        || ledger.responseByIdentity.size !== records.filter((record) => (
          record.responseStatus !== null
        )).length
        || finalized.requestCount !== records.length
        || finalized.staticLoadGraph.assetAttestationSha256
          !== staticAssetContract.providerContract.attestationSha256
      ) {
        throw new Error("Chatwoot strict browser/static load graph is incomplete.");
      }
    },
  });
}

function historyEvidence(
  history: ReturnType<typeof finalizeChatwootPhaseHistoryContract>,
) {
  return Object.freeze({
    kind: "main-frame-history-contract",
    historyContractSha256: history.historyContractSha256,
    historyCount: history.historyCount,
    historyLedger: history.historyLedger,
  });
}

function semanticBrowserRecord(record: {
  classification: StrictRequestEntry["classification"];
  order: number;
  redirectEdge: string | null;
  responseContentType: string | null;
  responseStatus: number | null;
}) {
  return Object.freeze({
    order: record.order,
    classification: Object.freeze({
      disposition: record.classification.disposition,
      expectedStatuses: Object.freeze([...record.classification.expectedStatuses]),
      key: record.classification.key,
      navigation: record.classification.navigation,
      staticClass: record.classification.staticPath === null
        ? null
        : record.classification.key,
    }),
    redirectEdge: record.redirectEdge,
    responseContentType: record.responseContentType,
    responseStatus: record.responseStatus,
  });
}

function normalizeResponseContentType(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = String(value).split(";", 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)) {
    throw new Error("Chatwoot browser response content type is invalid.");
  }
  return normalized;
}

export async function boundedChatwootBrowserOperationForTest<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label = "Chatwoot test browser operation",
) {
  return boundedChatwootBrowserOperation(operation, timeoutMs, label);
}

async function boundedChatwootBrowserOperation<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
) {
  if (!operation || typeof operation.then !== "function"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000
    || typeof label !== "string" || label.length < 1 || label.length > 128) {
    throw new Error("Chatwoot browser evidence operation bound is invalid.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded its bounded lifecycle.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function countClassification(ledger: BrowserRequestLedger, key: string) {
  return ledger.entries.filter(({ classification }) => classification.key === key).length;
}

function createReplacementBarrier() {
  let readyResolve!: () => void;
  let releaseResolve!: () => void;
  let completedResolve!: () => void;
  const readyPromise = new Promise<void>((resolve) => { readyResolve = resolve; });
  const releasePromise = new Promise<void>((resolve) => { releaseResolve = resolve; });
  const completedPromise = new Promise<void>((resolve) => { completedResolve = resolve; });
  let consumed = false;
  let released = false;
  let cancelled = false;
  return Object.freeze({
    async hold(route: Route) {
      if (consumed) throw new Error("Chatwoot replacement barrier was consumed twice.");
      consumed = true;
      readyResolve();
      await releasePromise;
      try {
        if (cancelled) await route.abort("blockedbyclient");
        else await route.continue();
      } finally {
        completedResolve();
      }
    },
    ready() {
      return boundedPromise(readyPromise, 30_000, "replacement request hold");
    },
    release() {
      if (!consumed || released || cancelled) {
        throw new Error("Chatwoot replacement barrier release is out of order.");
      }
      released = true;
      releaseResolve();
    },
    completed() {
      return boundedPromise(completedPromise, 30_000, "replacement request release");
    },
    cancel() {
      cancelled = true;
      releaseResolve();
      readyResolve();
    },
    wasConsumed() {
      return consumed;
    },
  });
}

export function installChatwootCommonRequestLifecycleForTest(
  page: Page,
  eventLedger: EventLedger,
) {
  type LifecycleRecord = {
    headerNames: string[];
    index: number;
    isNavigation: boolean;
    method: string;
    postDataByteLength: number;
    redirectedFromIndex: number | null;
    resourceType: string;
    responseContentType: string | null;
    responseStatus: number | null;
    serverActionPresent: boolean;
    terminal: "failed" | "finished" | null;
    url: ReturnType<typeof safeUrlProjection>;
  };
  const records: LifecycleRecord[] = [];
  const byRequest = new Map<Request, LifecycleRecord>();
  const pending = new Set<Request>();
  let lifecycleError: unknown;
  const operation = (source: "browserRequests" | "browserResponses" | "network",
    callback: () => void) => {
    let finish: (() => void) | undefined;
    try {
      finish = eventLedger.begin(source);
      callback();
    } catch (error) {
      lifecycleError ??= error;
    } finally {
      finish?.();
    }
  };
  page.on("request", (request) => operation("browserRequests", () => {
    if (byRequest.has(request) || records.length >= MAXIMUM_REQUESTS) {
      throw new Error("Chatwoot common request lifecycle overflowed or reused an identity.");
    }
    const postData = request.postDataBuffer() ?? Buffer.alloc(0);
    const headers = request.headers();
    const headerNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    if (postData.byteLength > MAXIMUM_CONTROL_BYTES || headerNames.length > 128
      || headerNames.some((name) => !/^[a-z0-9!#$%&'*+.^_`|~-]{1,100}$/.test(name))) {
      throw new Error("Chatwoot common request metadata exceeded its safe exact bound.");
    }
    const redirectedFrom = request.redirectedFrom();
    const redirectedFromRecord = redirectedFrom ? byRequest.get(redirectedFrom) : undefined;
    if (redirectedFrom && !redirectedFromRecord) {
      throw new Error("Chatwoot common request lifecycle lost a redirect predecessor.");
    }
    const record: LifecycleRecord = {
      headerNames,
      index: records.length,
      isNavigation: request.isNavigationRequest(),
      method: request.method(),
      postDataByteLength: postData.byteLength,
      redirectedFromIndex: redirectedFromRecord?.index ?? null,
      resourceType: request.resourceType(),
      responseContentType: null,
      responseStatus: null,
      serverActionPresent: typeof headers["next-action"] === "string",
      terminal: null,
      url: safeUrlProjection(request.url()),
    };
    records.push(record);
    byRequest.set(request, record);
    pending.add(request);
  }));
  page.on("response", (response) => operation("browserResponses", () => {
    const record = byRequest.get(response.request());
    if (!record || record.responseStatus !== null) {
      throw new Error("Chatwoot common response lifecycle is missing or duplicated.");
    }
    const status = response.status();
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
      throw new Error("Chatwoot common response status is invalid.");
    }
    record.responseStatus = status;
    record.responseContentType = normalizeResponseContentType(
      response.headers()["content-type"],
    );
  }));
  const terminate = (request: Request, terminal: "failed" | "finished") => {
    operation("network", () => {
      const record = byRequest.get(request);
      if (!record || !pending.delete(request) || record.terminal !== null) {
        throw new Error("Chatwoot common request terminal lifecycle is missing or duplicated.");
      }
      record.terminal = terminal;
    });
  };
  page.on("requestfinished", (request) => terminate(request, "finished"));
  page.on("requestfailed", (request) => terminate(request, "failed"));
  return Object.freeze({
    isIdle() {
      return lifecycleError === undefined && pending.size === 0;
    },
    snapshot() {
      if (lifecycleError !== undefined) throw lifecycleError;
      return Object.freeze({
        pendingRequestIndexes: Object.freeze([...pending].map((request) => {
          const record = byRequest.get(request);
          if (!record) throw new Error("Chatwoot pending request lost its lifecycle record.");
          return record.index;
        }).sort((left, right) => left - right)),
        records: Object.freeze(structuredClone(records)),
      });
    },
  });
}

function installDiagnostics(context: BrowserContext, eventLedger: EventLedger) {
  let primaryPage: Page | undefined;
  const unexpectedPages: string[] = [];
  const unexpectedConsole: string[] = [];
  const unexpectedPageErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  let unexpectedWebSocketCount = 0;
  let unexpectedServiceWorkerCount = 0;
  const record = (callback: () => void) => {
    const finish = eventLedger.begin("diagnostics");
    try {
      callback();
    } finally {
      finish();
    }
  };
  context.on("page", (page) => record(() => {
    if (!primaryPage || page === primaryPage) return;
    pushBounded(unexpectedPages, sha256Text(page.url()));
  }));
  const snapshot = () => Object.freeze({
    unexpectedConsole: Object.freeze([...unexpectedConsole]),
    unexpectedPageErrors: Object.freeze([...unexpectedPageErrors]),
    unexpectedPages: Object.freeze([...unexpectedPages]),
    unexpectedRequests: Object.freeze([...unexpectedRequests]),
    unexpectedServiceWorkerCount,
    unexpectedWebSocketCount,
  });
  return Object.freeze({
    bindPrimaryPage(page: Page) {
      if (primaryPage) throw new Error("Chatwoot diagnostics primary page is already bound.");
      primaryPage = page;
      page.on("console", (message) => record(() => pushBounded(
        unexpectedConsole,
        sha256Json({ type: message.type(), text: message.text() }),
      )));
      page.on("pageerror", (error) => record(() => pushBounded(
        unexpectedPageErrors,
        sha256Text(String(error?.message ?? error)),
      )));
    },
    recordUnexpectedRequest(url: string) {
      record(() => pushBounded(unexpectedRequests, sha256Text(url)));
    },
    recordUnexpectedWebSocket() {
      record(() => {
        unexpectedWebSocketCount = Math.min(unexpectedWebSocketCount + 1, MAXIMUM_EVENTS + 1);
      });
    },
    recordUnexpectedServiceWorker() {
      record(() => {
        unexpectedServiceWorkerCount = Math.min(
          unexpectedServiceWorkerCount + 1,
          MAXIMUM_EVENTS + 1,
        );
      });
    },
    snapshot,
    assertClean() {
      const observed = snapshot();
      if (
        observed.unexpectedPages.length > 0
        || observed.unexpectedConsole.length > 0
        || observed.unexpectedPageErrors.length > 0
        || observed.unexpectedRequests.length > 0
        || observed.unexpectedWebSocketCount > 0
        || observed.unexpectedServiceWorkerCount > 0
      ) {
        throw new Error("Chatwoot browser emitted an unexpected bounded diagnostic.");
      }
    },
  });
}

export function createChatwootHistoryClearGateForTest(input: Readonly<{
  assertClean(): void;
  markDocumentPostClear(): Promise<void>;
  markNodeGeneration(): void;
  sealDocumentPreClear(): Promise<void>;
}>) {
  let preClearSealed = false;
  let postClearMarked = false;
  return Object.freeze({
    assertClean() {
      input.assertClean();
    },
    async sealPreClearGeneration() {
      if (preClearSealed || postClearMarked) {
        throw new Error("Chatwoot history pre-clear gate was sealed more than once.");
      }
      await input.sealDocumentPreClear();
      input.assertClean();
      preClearSealed = true;
    },
    async markPostClearGeneration() {
      if (!preClearSealed || postClearMarked) {
        throw new Error("Chatwoot history post-clear gate is out of order.");
      }
      await input.markDocumentPostClear();
      input.assertClean();
      input.markNodeGeneration();
      postClearMarked = true;
    },
  });
}

async function installInitialProviderHistoryLedger(
  context: BrowserContext,
  eventLedger: EventLedger,
) {
  const records: unknown[] = [];
  let active = false;
  let cdp: CDPSession | undefined;
  let finalized: ReturnType<typeof finalizeChatwootPhaseHistoryContract> | undefined;
  let historyError: unknown;
  let primaryPage: Page | undefined;
  let sealed = false;
  const record = (value: unknown) => {
    const finish = eventLedger.begin("history");
    try {
      if (!active) return;
      if (sealed) throw new Error("Chatwoot initial provider history received a late event.");
      if (records.length >= 128) {
        throw new Error("Chatwoot initial provider history exceeded its exact bound.");
      }
      records.push(value);
    } catch (error) {
      historyError ??= error;
    } finally {
      finish();
    }
  };
  await context.exposeBinding("__cleanPayProviderHistory", ({ frame }, value) => {
    if (primaryPage && frame !== primaryPage.mainFrame()) {
      historyError ??= new Error("Chatwoot provider history escaped the primary frame.");
      return;
    }
    record(value);
  });
  await context.addInitScript(installProviderOverlapHistoryInstrumentation);
  const handleFrameNavigated = (event: {
    frame: { id: string; loaderId: string; parentId?: string; url: string };
    type: string;
  }) => {
    if (!active || event.frame.parentId !== undefined) return;
    record({
      frameId: event.frame.id,
      kind: "document-navigation",
      loaderId: event.frame.loaderId,
      navigationType: event.type,
      url: event.frame.url,
    });
  };
  const handleNavigatedWithinDocument = (event: {
    frameId: string;
    navigationType: string;
    url: string;
  }) => {
    if (!active) return;
    record({
      frameId: event.frameId,
      kind: "same-document-navigation",
      navigationType: event.navigationType,
      url: event.url,
    });
  };
  const assertClean = () => {
    if (historyError !== undefined) throw historyError;
  };
  const frameReceipt = async () => {
    if (!cdp) throw new Error("Chatwoot provider history CDP session is absent.");
    const tree = await cdp.send("Page.getFrameTree") as {
      frameTree?: { frame?: { id?: unknown; loaderId?: unknown; url?: unknown } };
    };
    const frame = tree.frameTree?.frame;
    if (typeof frame?.id !== "string" || typeof frame.loaderId !== "string"
      || typeof frame.url !== "string") {
      throw new Error("Chatwoot provider history frame tree is invalid.");
    }
    return Object.freeze({ frameId: frame.id, loaderId: frame.loaderId, url: frame.url });
  };
  return Object.freeze({
    async bindPrimaryPage(page: Page) {
      if (primaryPage || cdp) {
        throw new Error("Chatwoot provider history primary page is already bound.");
      }
      primaryPage = page;
      cdp = await context.newCDPSession(page);
      await cdp.send("Page.enable");
      cdp.on("Page.frameNavigated", handleFrameNavigated);
      cdp.on("Page.navigatedWithinDocument", handleNavigatedWithinDocument);
    },
    async captureProfile(page: Page) {
      if (page !== primaryPage || active || finalized || sealed || records.length !== 0) {
        throw new Error("Chatwoot provider profile history checkpoint is out of order.");
      }
      await drainProviderHistoryBindings(page);
      const frame = await frameReceipt();
      const historyLength = await page.evaluate(() => history.length);
      records.push({
        frameId: frame.frameId,
        historyLength,
        kind: "checkpoint",
        loaderId: frame.loaderId,
        url: frame.url,
      });
      active = true;
      assertClean();
    },
    async captureCabinet(page: Page, response: Response | null, ledger: BrowserRequestLedger) {
      if (page !== primaryPage || !active || finalized || sealed
        || !response
        || ledger.byIdentity.get(response.request())?.classification.key
          !== "app-cabinet-document") {
        throw new Error("Chatwoot cabinet history is not bound to its exact document response.");
      }
      await drainProviderHistoryBindings(page);
      const finalFrame = await frameReceipt();
      assertClean();
      finalized = finalizeChatwootPhaseHistoryContract(records, "initial", finalFrame);
    },
    snapshot() {
      assertClean();
      if (!finalized) throw new Error("Chatwoot provider history was not finalized.");
      return structuredClone(finalized);
    },
    async sealAndDetach(page: Page) {
      if (page !== primaryPage || !active || !finalized || sealed || !cdp) {
        throw new Error("Chatwoot provider history seal is out of order.");
      }
      await drainProviderHistoryBindings(page);
      const finalFrame = await frameReceipt();
      const reread = finalizeChatwootPhaseHistoryContract(records, "initial", finalFrame);
      if (stableJson(reread) !== stableJson(finalized)) {
        throw new Error("Chatwoot provider history changed before its seal barrier.");
      }
      assertClean();
      sealed = true;
      cdp.removeListener("Page.frameNavigated", handleFrameNavigated);
      cdp.removeListener("Page.navigatedWithinDocument", handleNavigatedWithinDocument);
      await cdp.detach();
      active = false;
      cdp = undefined;
      assertClean();
    },
  });
}

async function drainProviderHistoryBindings(page: Page) {
  await page.evaluate(async () => {
    const drain = (globalThis as unknown as {
      __cleanPayProviderHistoryDrain?: () => Promise<void>;
    }).__cleanPayProviderHistoryDrain;
    if (typeof drain !== "function") {
      throw new Error("Chatwoot provider history binding drain is absent.");
    }
    await drain();
  });
}

async function installHistoryLedger(context: BrowserContext, eventLedger: EventLedger) {
  const initial: unknown[] = [];
  const recreated: unknown[] = [];
  const lifecycle: unknown[] = [];
  let generationMarked = false;
  let primaryPage: Page | undefined;
  let historyError: unknown;
  const recordLifecycle = (kind: string, observed: { historyLength: number | null; url: string | null }) => {
    if (lifecycle.length >= MAXIMUM_REQUESTS) {
      throw new Error("Chatwoot history lifecycle exceeded its exact bound.");
    }
    lifecycle.push(Object.freeze({
      generation: generationMarked ? "recreated" : "initial",
      historyLength: observed.historyLength,
      kind,
      url: observed.url === null ? null : safeUrlProjection(observed.url),
    }));
  };
  const operation = (callback: () => void) => {
    const finish = eventLedger.begin("history");
    try {
      callback();
    } catch (error) {
      historyError ??= error;
    } finally {
      finish();
    }
  };
  await context.exposeBinding("__cleanPayChatwootHistoryEvent", ({ frame }, value) => {
    operation(() => {
      if (!primaryPage || frame !== primaryPage.mainFrame()) {
        throw new Error("Chatwoot history event escaped the primary main frame.");
      }
      exactKeys(value, ["historyLength", "kind", "url"], "Chatwoot history event");
      const entry = value as Record<string, unknown>;
      if (!new Set(["hashchange", "popstate", "pushState", "replaceState"]).has(
        String(entry.kind),
      ) || !Number.isSafeInteger(entry.historyLength) || Number(entry.historyLength) < 0
        || Number(entry.historyLength) > 64 || typeof entry.url !== "string") {
        throw new Error("Chatwoot history event is outside its exact contract.");
      }
      const url = new URL(entry.url);
      if (url.origin !== SYNTHETIC_APPLICATION_ORIGIN) {
        throw new Error("Chatwoot history event escaped the application origin.");
      }
      recordLifecycle(String(entry.kind), {
        historyLength: Number(entry.historyLength),
        url: entry.url,
      });
    });
  });
  await context.addInitScript(() => {
    if (window !== window.top) return;
    const target = globalThis as unknown as {
      __cleanPayChatwootHistoryEvent(value: {
        historyLength: number;
        kind: string;
        url: string;
      }): Promise<void>;
    };
    const pending: Promise<void>[] = [];
    let historyGeneration: "open" | "post-clear-sealed" | "pre-clear-sealed" = "open";
    const enqueue = (kind: string) => {
      if (pending.length >= 128) {
        pending.push(Promise.reject(new Error("Chatwoot history document event overflow.")));
        return;
      }
      const operation = target.__cleanPayChatwootHistoryEvent({
        historyLength: history.length,
        kind: historyGeneration === "open" ? kind : "sealed-document-event",
        url: location.href,
      });
      pending.push(operation);
      void operation.catch(() => undefined);
    };
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const result = Reflect.apply(originalPushState, this, args);
      enqueue("pushState");
      return result;
    };
    history.replaceState = function (...args) {
      const result = Reflect.apply(originalReplaceState, this, args);
      enqueue("replaceState");
      return result;
    };
    addEventListener("popstate", () => enqueue("popstate"));
    addEventListener("hashchange", () => enqueue("hashchange"));
    Object.defineProperty(window, "__cleanPayChatwootHistoryDrain", {
      configurable: false,
      enumerable: false,
      value: async (mode: "drain" | "mark-post-clear" | "seal-pre-clear") => {
        if (!new Set(["drain", "mark-post-clear", "seal-pre-clear"]).has(mode)) {
          throw new Error("Chatwoot history document drain mode is invalid.");
        }
        if ((mode === "seal-pre-clear" && historyGeneration !== "open")
          || (mode === "mark-post-clear" && historyGeneration !== "pre-clear-sealed")) {
          throw new Error("Chatwoot history document generation transition is out of order.");
        }
        let consumed = 0;
        while (consumed < pending.length) {
          const next = pending.slice(consumed);
          consumed = pending.length;
          await Promise.all(next);
        }
        if (mode === "seal-pre-clear") historyGeneration = "pre-clear-sealed";
        if (mode === "mark-post-clear") historyGeneration = "post-clear-sealed";
        return { count: consumed, generation: historyGeneration };
      },
      writable: false,
    });
  });
  const checkpoint = async (page: Page) => page.evaluate(() => ({
    historyLength: history.length,
    url: location.href,
  }));
  const primaryPageOrThrow = () => {
    if (!primaryPage) throw new Error("Chatwoot history primary page is absent.");
    return primaryPage;
  };
  const historyGate = createChatwootHistoryClearGateForTest({
    assertClean: () => {
      if (historyError !== undefined) throw historyError;
    },
    markDocumentPostClear: async () => {
      const receipt = await transitionHistoryDocument(primaryPageOrThrow(), "mark-post-clear");
      if (receipt.generation !== "post-clear-sealed") {
        throw new Error("Chatwoot history post-clear transition is invalid.");
      }
    },
    markNodeGeneration: () => {
      generationMarked = true;
      operation(() => recordLifecycle("generation-boundary", {
        historyLength: null,
        url: null,
      }));
    },
    sealDocumentPreClear: async () => {
      const receipt = await transitionHistoryDocument(primaryPageOrThrow(), "seal-pre-clear");
      if (receipt.generation !== "pre-clear-sealed") {
        throw new Error("Chatwoot history pre-clear seal is invalid.");
      }
    },
  });
  return Object.freeze({
    bindPrimaryPage(page: Page) {
      if (primaryPage) throw new Error("Chatwoot history primary page is already bound.");
      primaryPage = page;
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        operation(() => recordLifecycle("framenavigated", {
          historyLength: null,
          url: frame.url(),
        }));
      });
    },
    async captureInitialProfile(page: Page) {
      if (historyError !== undefined || initial.length !== 0 || generationMarked) {
        throw new Error("Chatwoot initial profile history checkpoint is out of order.");
      }
      const observed = await checkpoint(page);
      initial.push({ kind: "checkpoint", url: observed.url });
      operation(() => recordLifecycle("checkpoint", observed));
    },
    async captureInitialCabinet(page: Page) {
      if (historyError !== undefined || initial.length !== 1 || generationMarked) {
        throw new Error("Chatwoot initial cabinet history checkpoint is out of order.");
      }
      const observed = await checkpoint(page);
      initial.push({ kind: "frame-navigation", url: observed.url });
      operation(() => recordLifecycle("checkpoint", observed));
    },
    async captureRecreatedLogin(page: Page) {
      if (historyError !== undefined || !generationMarked || recreated.length !== 0) {
        throw new Error("Chatwoot recreated login history checkpoint is out of order.");
      }
      const observed = await checkpoint(page);
      recreated.push({ ...observed, kind: "checkpoint" });
      operation(() => recordLifecycle("checkpoint", observed));
    },
    async captureRecreatedCabinet(page: Page) {
      if (historyError !== undefined || !generationMarked || recreated.length !== 1) {
        throw new Error("Chatwoot recreated cabinet history checkpoint is out of order.");
      }
      const observed = await checkpoint(page);
      recreated.push({ ...observed, kind: "checkpoint" });
      operation(() => recordLifecycle("checkpoint", observed));
    },
    snapshot() {
      return structuredClone(initial);
    },
    async sealPreClearGeneration(page: Page) {
      if (page !== primaryPageOrThrow()) {
        throw new Error("Chatwoot history seal escaped the primary page.");
      }
      await historyGate.sealPreClearGeneration();
    },
    async markGeneration(page: Page) {
      if (initial.length !== 2 || generationMarked || recreated.length !== 0) {
        throw new Error("Chatwoot history generation boundary is invalid.");
      }
      if (page !== primaryPageOrThrow()) {
        throw new Error("Chatwoot history generation escaped the primary page.");
      }
      await historyGate.markPostClearGeneration();
    },
    generationSnapshot() {
      return structuredClone(recreated);
    },
    async drainCurrentDocument(page: Page) {
      await transitionHistoryDocument(page, "drain");
      if (historyError !== undefined) throw historyError;
    },
    lifecycleSnapshot() {
      if (historyError !== undefined) throw historyError;
      return assertChatwootHistoryLifecycle(lifecycle);
    },
    assertNoTransientMutations() {
      if (historyError !== undefined) throw historyError;
      assertChatwootHistoryLifecycle(lifecycle);
    },
  });
}

async function transitionHistoryDocument(
  page: Page,
  mode: "drain" | "mark-post-clear" | "seal-pre-clear",
) {
  const receipt = await page.evaluate(async (drainMode) => {
    const drain = (window as unknown as {
      __cleanPayChatwootHistoryDrain?: (mode: typeof drainMode) => Promise<{
        count: number;
        generation: "open" | "post-clear-sealed" | "pre-clear-sealed";
      }>;
    }).__cleanPayChatwootHistoryDrain;
    if (typeof drain !== "function") throw new Error("Chatwoot history drain is absent.");
    return drain(drainMode);
  }, mode);
  exactKeys(receipt, ["count", "generation"], "Chatwoot history drain receipt");
  if (!Number.isSafeInteger(receipt.count) || receipt.count < 0 || receipt.count > 128
    || !new Set(["open", "post-clear-sealed", "pre-clear-sealed"]).has(receipt.generation)) {
    throw new Error("Chatwoot history document drain receipt is invalid.");
  }
  return receipt;
}

export function createChatwootBoundaryLifecycleCollectorForTest() {
  let current: unknown[] = [];
  let activeDocumentToken: string | undefined;
  let activeDocumentSealed = false;
  return Object.freeze({
    bindDocument(documentToken: string) {
      assertDocumentToken(documentToken);
      if (documentToken === activeDocumentToken) {
        throw new Error("Chatwoot boundary document token was bound more than once.");
      }
      activeDocumentToken = documentToken;
      activeDocumentSealed = false;
      current = [];
    },
    sealDocument(documentToken: string) {
      assertDocumentToken(documentToken);
      if (documentToken !== activeDocumentToken || activeDocumentSealed) {
        throw new Error("Chatwoot boundary document seal is out of order.");
      }
      activeDocumentSealed = true;
    },
    observe(value: unknown) {
      exactKeys(
        value,
        ["documentToken", "entry", "kind"],
        "Chatwoot boundary lifecycle observation",
      );
      const observed = value as Record<string, unknown>;
      assertDocumentToken(observed.documentToken);
      if (observed.documentToken !== activeDocumentToken || activeDocumentSealed) {
        throw new Error("Chatwoot boundary event escaped its active unsealed document.");
      }
      if (observed.kind === "array" && observed.entry === null) {
        current = [];
      } else if (observed.kind === "entry") {
        if (current.length >= 64) {
          throw new Error("Chatwoot boundary lifecycle collector exceeded its exact bound.");
        }
        current.push(assertChatwootBoundaryEntry(observed.entry, current.length));
      } else {
        throw new Error("Chatwoot boundary lifecycle event kind is invalid.");
      }
    },
    snapshot() {
      if (current.length < 1 || current.length > 64) {
        throw new Error("Chatwoot cross-document boundary snapshot is incomplete.");
      }
      return Object.freeze(structuredClone(current));
    },
  });
}

export function createChatwootCausalClearGateForTest(input: Readonly<{
  assertClean(): void;
  causal: ReturnType<typeof createChatwootPhaseCausalContract>;
  markDocumentPostClear(): Promise<CookiePresence>;
  sealBoundaryDocument(): void;
  sealDocumentPreClear(): Promise<void>;
}>) {
  let preClearSealed = false;
  let postClearMarked = false;
  return Object.freeze({
    async sealPreClearGeneration() {
      if (preClearSealed || postClearMarked) {
        throw new Error("Chatwoot pre-clear causal gate was sealed more than once.");
      }
      await input.sealDocumentPreClear();
      input.assertClean();
      input.sealBoundaryDocument();
      input.causal.sealPreClearGeneration();
      preClearSealed = true;
    },
    async markPostClear() {
      if (!preClearSealed || postClearMarked) {
        throw new Error("Chatwoot post-clear causal gate is out of order.");
      }
      const presence = await input.markDocumentPostClear();
      input.assertClean();
      input.causal.markClear(presence);
      postClearMarked = true;
    },
  });
}

async function installChatwootCausalLedger(
  context: BrowserContext,
  eventLedger: EventLedger,
) {
  const causal = createChatwootPhaseCausalContract(MAXIMUM_EVENTS);
  let primaryPage: Page | undefined;
  let causalError: unknown;
  let boundaryError: unknown;
  let activeDocumentToken: string | undefined;
  const boundaryCollector = createChatwootBoundaryLifecycleCollectorForTest();
  const signals = Object.fromEntries([
    "login-document",
    "cabinet-document",
    "cabinet-set-user",
    "cabinet-identity-confirmed",
  ].map((name) => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return [name, { promise, resolve }];
  })) as Record<string, { promise: Promise<void>; resolve: () => void }>;

  await context.exposeBinding(
    "__cleanPayChatwootBoundaryEvent",
    ({ frame }, value) => {
      const finishEvent = eventLedger.begin("boundary");
      try {
        if (!primaryPage || frame !== primaryPage.mainFrame()) {
          throw new Error("Chatwoot boundary event escaped the primary main frame.");
        }
        exactKeys(
          value,
          ["documentToken", "entry", "kind", "url"],
          "Chatwoot boundary lifecycle event",
        );
        const observed = value as Record<string, unknown>;
        assertDocumentToken(observed.documentToken);
        if (typeof observed.url !== "string"
          || new URL(observed.url).origin !== SYNTHETIC_APPLICATION_ORIGIN) {
          throw new Error("Chatwoot boundary lifecycle event escaped the application origin.");
        }
        boundaryCollector.observe({
          documentToken: observed.documentToken,
          entry: observed.entry,
          kind: observed.kind,
        });
      } catch (error) {
        boundaryError ??= error;
        throw error;
      } finally {
        finishEvent();
      }
    },
  );

  await context.exposeBinding(
    "__cleanPayChatwootCausalEvent",
    ({ frame }, value) => {
      const finishEvent = eventLedger.begin("boundary");
      try {
        if (!primaryPage) return;
        if (frame !== primaryPage.mainFrame()) {
          throw new Error("Chatwoot causal event escaped the primary main frame.");
        }
        const entry = isRecord(value) ? value : {};
        exactKeys(
          entry,
          ["documentToken", "kind", "method", "presence", "url"],
          "Chatwoot causal event",
        );
        assertDocumentToken(entry.documentToken);
        if (typeof entry.url !== "string") throw new Error("Chatwoot causal event URL is invalid.");
        const url = new URL(entry.url);
        if (url.origin !== SYNTHETIC_APPLICATION_ORIGIN) {
          if (entry.kind === "document") return;
          throw new Error("Chatwoot boundary causal event escaped the application origin.");
        }
        let outcome: string | undefined;
        if (entry.kind === "document" && entry.method === null) {
          outcome = causal.observeDocument({
            presence: assertCookiePresence(entry.presence, "at document start"),
            url: entry.url,
          });
          activeDocumentToken = String(entry.documentToken);
          boundaryCollector.bindDocument(activeDocumentToken);
        } else if (entry.kind === "boundary" && typeof entry.method === "string") {
          if (entry.documentToken !== activeDocumentToken) {
            throw new Error("Chatwoot causal event escaped its active document token.");
          }
          outcome = causal.observeBoundary({
            method: entry.method,
            presence: assertCookiePresence(entry.presence, `before ${entry.method}`),
            url: entry.url,
          });
        } else {
          throw new Error("Chatwoot causal event kind or method is invalid.");
        }
        signals[outcome ?? ""]?.resolve();
      } catch (error) {
        causalError ??= error;
        for (const signal of Object.values(signals)) signal.resolve();
        throw error;
      } finally {
        finishEvent();
      }
    },
  );
  await context.addInitScript(() => {
    if (window !== window.top) return;
    const wrapped = new WeakSet<unknown[]>();
    const cookiePresence = () => {
      const names = document.cookie.split(";")
        .map((entry) => entry.trim().split("=", 1)[0])
        .filter(Boolean);
      return {
        conversationCookiePresent: names.includes("cw_conversation"),
        userCookiePresent: names.some((name) => name.startsWith("cw_user_")),
      };
    };
    const target = globalThis as unknown as {
      __cleanPayChatwootBoundaryEvent(value: {
        documentToken: string;
        entry: unknown;
        kind: "array" | "entry";
        url: string;
      }): Promise<void>;
      __cleanPayChatwootCausalEvent(value: {
        documentToken: string;
        kind: "boundary" | "document";
        method: string | null;
        presence: ReturnType<typeof cookiePresence>;
        url: string;
      }): Promise<void>;
    };
    const causalEmit = target.__cleanPayChatwootCausalEvent;
    const boundaryEmit = target.__cleanPayChatwootBoundaryEvent;
    const documentToken = crypto.randomUUID();
    const pendingEvidence: Promise<void>[] = [];
    let causalGeneration: "open" | "post-clear-marked" | "pre-clear-sealed" = "open";
    const enqueue = (operation: () => Promise<void>) => {
      if (pendingEvidence.length >= 128) {
        pendingEvidence.push(Promise.reject(
          new Error("Chatwoot boundary document event overflow."),
        ));
        return pendingEvidence[pendingEvidence.length - 1];
      }
      const tracked = causalGeneration === "open"
        ? operation()
        : causalEmit({
          documentToken,
          kind: "boundary",
          method: "sealed-document-event",
          presence: cookiePresence(),
          url: location.href,
        });
      pendingEvidence.push(tracked);
      void tracked.catch(() => undefined);
      return tracked;
    };
    const documentEvidence = enqueue(() => causalEmit({
      documentToken,
      kind: "document",
      method: null,
      presence: cookiePresence(),
      url: location.href,
    }));
    Object.defineProperty(window, "__cleanPayChatwootCausalDrain", {
      configurable: false,
      enumerable: false,
      value: async (mode: "drain" | "mark-post-clear" | "seal-pre-clear") => {
        if (!new Set(["drain", "mark-post-clear", "seal-pre-clear"]).has(mode)) {
          throw new Error("Chatwoot causal document drain mode is invalid.");
        }
        if ((mode === "seal-pre-clear" && causalGeneration !== "open")
          || (mode === "mark-post-clear" && causalGeneration !== "pre-clear-sealed")) {
          throw new Error("Chatwoot causal document generation transition is out of order.");
        }
        let consumed = 0;
        while (consumed < pendingEvidence.length) {
          const next = pendingEvidence.slice(consumed);
          consumed = pendingEvidence.length;
          await Promise.all(next);
        }
        if (mode === "seal-pre-clear") causalGeneration = "pre-clear-sealed";
        if (mode === "mark-post-clear") causalGeneration = "post-clear-marked";
        return {
          count: consumed,
          generation: causalGeneration,
          presence: mode === "mark-post-clear" ? cookiePresence() : null,
        };
      },
      writable: false,
    });
    let calls: unknown;
    Object.defineProperty(window, "__cleanPayChatwootBoundaryCalls", {
      configurable: true,
      enumerable: true,
      get: () => calls,
      set(value: unknown) {
        calls = value;
        if (!Array.isArray(value) || wrapped.has(value)) return;
        wrapped.add(value);
        let boundarySequence = enqueue(() => documentEvidence.then(() => boundaryEmit({
          documentToken,
          entry: null,
          kind: "array",
          url: location.href,
        })));
        for (const entry of value) {
          boundarySequence = enqueue(() => boundarySequence.then(() => boundaryEmit({
            documentToken,
            entry,
            kind: "entry",
            url: location.href,
          })));
        }
        const originalPush = value.push;
        Object.defineProperty(value, "push", {
          configurable: true,
          writable: true,
          value(...entries: unknown[]) {
            const before = entries
              .filter((entry) => (
                entry !== null
                && typeof entry === "object"
                && !Array.isArray(entry)
                && ["setUser", "identity.confirmed"].includes(String(
                  (entry as { method?: unknown }).method,
                ))
              ))
              .map((entry) => ({
                method: String((entry as { method: unknown }).method),
                presence: cookiePresence(),
              }));
            const result = Reflect.apply(originalPush, this, entries);
            for (const entry of entries) {
              boundarySequence = enqueue(() => boundarySequence.then(() => boundaryEmit({
                documentToken,
                entry,
                kind: "entry",
                url: location.href,
              })));
              const snapshot = before.find((candidate) => (
                candidate.method === String((entry as { method?: unknown })?.method)
              ));
              if (snapshot) {
                boundarySequence = enqueue(() => Promise.all([
                  documentEvidence,
                  boundarySequence,
                ]).then(() => causalEmit({
                  documentToken,
                  kind: "boundary",
                  method: snapshot.method,
                  presence: snapshot.presence,
                  url: location.href,
                })));
              }
            }
            return result;
          },
        });
      },
    });
  });

  const clearGate = createChatwootCausalClearGateForTest({
    assertClean: () => assertNoCausalError(causalError ?? boundaryError),
    causal,
    markDocumentPostClear: async () => markCausalDocumentPostClear(primaryPage),
    sealBoundaryDocument: () => {
      if (!activeDocumentToken) {
        throw new Error("Chatwoot active boundary document token is absent.");
      }
      boundaryCollector.sealDocument(activeDocumentToken);
    },
    sealDocumentPreClear: async () => sealCausalDocumentPreClear(primaryPage),
  });

  return Object.freeze({
    bindPrimaryPage(page: Page) {
      if (primaryPage) throw new Error("Chatwoot causal primary page is already bound.");
      primaryPage = page;
    },
    async sealPreClearGeneration(page: Page) {
      assertPrimaryPage(primaryPage, page);
      await clearGate.sealPreClearGeneration();
    },
    async markPostClear(page: Page) {
      assertPrimaryPage(primaryPage, page);
      await clearGate.markPostClear();
    },
    async assertNegativeLoginCheckpoint(page: Page) {
      await waitForCausalSignal(signals["login-document"], "post-clear login document");
      assertNoCausalError(causalError ?? boundaryError);
      const presence = await readCookiePresence(page);
      causal.markNegativeLoginCheckpoint({ presence, url: page.url() });
    },
    async waitForCabinetDocument() {
      await waitForCausalSignal(signals["cabinet-document"], "post-clear cabinet document");
      assertNoCausalError(causalError ?? boundaryError);
    },
    async waitForCabinetSetUser() {
      await waitForCausalSignal(signals["cabinet-set-user"], "post-clear cabinet setUser");
      assertNoCausalError(causalError ?? boundaryError);
    },
    async waitForCabinetIdentityConfirmed() {
      await waitForCausalSignal(
        signals["cabinet-identity-confirmed"],
        "post-clear cabinet identity confirmation",
      );
      assertNoCausalError(causalError ?? boundaryError);
    },
    async observeCabinetCookiePair(page: Page) {
      await waitForCookiePair(page);
      causal.observeCookiePair(await readCookiePresence(page));
    },
    markCabinetCompleted() {
      causal.markCabinetCompleted();
    },
    finish(raw: PhaseRawState) {
      assertNoCausalError(causalError ?? boundaryError);
      return causal.finish({
        conversationCookiePresent: raw.conversation !== null,
        userCookiePresent: raw.userCookie !== null,
      });
    },
    async drainCurrentDocument(page: Page) {
      await drainCausalDocument(page);
      assertNoCausalError(causalError ?? boundaryError);
    },
    boundarySnapshot() {
      assertNoCausalError(causalError ?? boundaryError);
      return boundaryCollector.snapshot();
    },
  });
}

async function drainCausalDocument(page: Page) {
  const result = await transitionCausalDocument(page, "drain");
  return result.count;
}

async function sealCausalDocumentPreClear(page: Page | undefined) {
  if (!page) throw new Error("Chatwoot causal primary page is absent.");
  const result = await transitionCausalDocument(page, "seal-pre-clear");
  if (result.generation !== "pre-clear-sealed" || result.presence !== null) {
    throw new Error("Chatwoot causal pre-clear document seal is invalid.");
  }
}

async function markCausalDocumentPostClear(page: Page | undefined) {
  if (!page) throw new Error("Chatwoot causal primary page is absent.");
  const result = await transitionCausalDocument(page, "mark-post-clear");
  if (result.generation !== "post-clear-marked" || result.presence === null) {
    throw new Error("Chatwoot causal post-clear document transition is invalid.");
  }
  return assertCookiePresence(result.presence, "at the post-clear document transition");
}

async function transitionCausalDocument(
  page: Page,
  mode: "drain" | "mark-post-clear" | "seal-pre-clear",
) {
  const result = await page.evaluate(async (drainMode) => {
    const drain = (window as unknown as {
      __cleanPayChatwootCausalDrain?: (mode: typeof drainMode) => Promise<{
        count: number;
        generation: "open" | "post-clear-marked" | "pre-clear-sealed";
        presence: CookiePresence | null;
      }>;
    }).__cleanPayChatwootCausalDrain;
    if (typeof drain !== "function") throw new Error("Chatwoot causal drain is absent.");
    return drain(drainMode);
  }, mode);
  exactKeys(result, ["count", "generation", "presence"], "Chatwoot causal drain receipt");
  if (!Number.isSafeInteger(result.count) || result.count < 1 || result.count > 128
    || !new Set(["open", "post-clear-marked", "pre-clear-sealed"]).has(result.generation)
    || !(result.presence === null || isRecord(result.presence))) {
    throw new Error("Chatwoot causal document drain count is invalid.");
  }
  return result;
}

function assertPrimaryPage(expected: Page | undefined, observed: Page) {
  if (!expected || observed !== expected) {
    throw new Error("Chatwoot causal operation escaped the primary page.");
  }
}

function assertDocumentToken(value: unknown): asserts value is string {
  if (typeof value !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) {
    throw new Error("Chatwoot browser document token is invalid.");
  }
}

async function waitForCausalSignal(
  signal: { promise: Promise<void> },
  label: string,
) {
  await boundedPromise(signal.promise, 30_000, label);
}

function assertNoCausalError(error: unknown) {
  if (error !== undefined) throw error;
}

async function waitForCookiePair(page: Page) {
  await page.waitForFunction(() => {
    const names = document.cookie.split(";")
      .map((entry) => entry.trim().split("=", 1)[0])
      .filter(Boolean);
    return names.includes("cw_conversation") && names.some((name) => name.startsWith("cw_user_"));
  }, undefined, { polling: 25, timeout: 5_000 });
}

function assertCookiePresence(value: unknown, label: string) {
  exactKeys(
    value,
    ["conversationCookiePresent", "userCookiePresent"],
    `Chatwoot ${label} cookie presence`,
  );
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.conversationCookiePresent !== "boolean"
    || typeof entry.userCookiePresent !== "boolean"
  ) {
    throw new Error(`Chatwoot ${label} cookie presence is invalid.`);
  }
  return Object.freeze({
    conversationCookiePresent: entry.conversationCookiePresent,
    userCookiePresent: entry.userCookiePresent,
  });
}

async function readCookiePresence(page: Page) {
  return page.evaluate(() => {
    const names = document.cookie.split(";")
      .map((entry) => entry.trim().split("=", 1)[0])
      .filter(Boolean);
    return {
      conversationCookiePresent: names.includes("cw_conversation"),
      userCookiePresent: names.some((name) => name.startsWith("cw_user_")),
    };
  });
}

async function settleExactRender(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function controlJson(controlUrl: string, pathname: string, maximumBytes: number) {
  const response = await fetch(new URL(pathname, controlUrl), {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Chatwoot fixture control read failed with HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error("Chatwoot fixture control response has no body.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("Chatwoot fixture control response exceeded its bounded contract.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } catch {
    throw new Error("Chatwoot fixture control returned invalid JSON.");
  }
}

export function assertChatwootPhaseBoundaryLedger(value: unknown, phase: Phase) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64) {
    throw new Error("Chatwoot phase boundary ledger is outside its exact bound.");
  }
  const methods: string[] = [];
  for (const [index, entry] of value.entries()) {
    methods.push(String(assertChatwootBoundaryEntry(entry, index).method));
  }
  const count = (method: string) => methods.filter((value) => value === method).length;
  const setUserIndex = methods.indexOf("setUser");
  const identityIndex = methods.indexOf("identity.confirmed");
  if (count("run") !== 1 || count("setUser") < 1 || count("frame.loaded") < 1
    || setUserIndex <= methods.indexOf("run")) {
    throw new Error("Chatwoot phase boundary lifecycle is incomplete or out of order.");
  }
  if (phase === "gap") {
    if (count("identity.confirmed") !== 0) {
      throw new Error("Chatwoot Gap boundary contains a premature identity confirmation.");
    }
  } else if (count("identity.confirmed") !== 1 || identityIndex <= setUserIndex) {
    throw new Error(`Chatwoot ${phase} boundary lacks its ordered identity confirmation.`);
  }
  return Object.freeze(structuredClone(value));
}

function assertChatwootBoundaryEntry(value: unknown, index: number) {
  if (!isRecord(value) || typeof value.method !== "string") {
    throw new Error(`Chatwoot boundary entry ${index} is invalid.`);
  }
  const entry = value;
  const allowedAttributeKeys = new Set([
    "custom_attributes",
    "email",
    "identifier_hash",
    "name",
  ]);
  if (entry.method === "run") {
    exactKeys(entry, ["baseUrl", "method", "websiteTokenBytes"], "Chatwoot run call");
    if (entry.baseUrl !== "https://chatwoot.browser.clean-pay.dev"
      || entry.websiteTokenBytes !== 64) {
      throw new Error("Chatwoot run call escaped its exact fixture contract.");
    }
  } else if (["frame.loaded", "identity.confirmed", "reset"].includes(String(entry.method))) {
    exactKeys(entry, ["method"], `Chatwoot ${entry.method} call`);
  } else if (entry.method === "setUser") {
    exactKeys(entry, ["attributeKeys", "identifierBytes", "method"], "Chatwoot setUser call");
    if (!Number.isSafeInteger(entry.identifierBytes)
      || Number(entry.identifierBytes) < 20 || Number(entry.identifierBytes) > 80
      || !exactSortedStrings(entry.attributeKeys, 3, 4, allowedAttributeKeys)) {
      throw new Error("Chatwoot setUser call is outside its exact sanitized contract.");
    }
  } else if (entry.method === "setCustomAttributes") {
    exactKeys(entry, ["attributeKeys", "method"], "Chatwoot custom attributes call");
    if (!exactSortedStrings(entry.attributeKeys, 0, 32)) {
      throw new Error("Chatwoot custom attribute names are invalid.");
    }
  } else if (entry.method === "toggleBubbleVisibility") {
    exactKeys(entry, ["method", "value"], "Chatwoot bubble call");
    if (!new Set(["hide", "show"]).has(String(entry.value))) {
      throw new Error("Chatwoot bubble visibility value is invalid.");
    }
  } else if (entry.method === "toggle") {
    exactKeys(entry, ["method", "value"], "Chatwoot toggle call");
    if (typeof entry.value !== "boolean") throw new Error("Chatwoot toggle value is invalid.");
  } else if (["setLabel", "removeLabel"].includes(String(entry.method))) {
    exactKeys(entry, ["label", "method"], `Chatwoot ${entry.method} call`);
    if (!new Set(["payment_problem", "subscription_expired"]).has(String(entry.label))) {
      throw new Error("Chatwoot label is outside its exact allowlist.");
    }
  } else {
    throw new Error(`Chatwoot boundary method ${entry.method} is not allowed.`);
  }
  return Object.freeze(structuredClone(entry));
}

export function assertChatwootPhaseProviderLedger(
  value: unknown,
  phase: Phase,
): ProviderLedger {
  return assertProviderLedger(value, phase);
}

export function assertChatwootProviderPhaseRelations(value: unknown) {
  exactKeys(value, ["gap", "recreated", "stable"], "Chatwoot provider phase relation");
  const phases = value as Record<Phase, unknown>;
  const gap = assertProviderLedger(phases.gap, "gap");
  const stable = assertProviderLedger(phases.stable, "stable");
  const recreated = assertProviderLedger(phases.recreated, "recreated");
  assertProviderPrefix(gap.entries, stable.entries, "Gap to Stable");
  assertProviderPrefix(stable.entries, recreated.entries, "Stable to Recreated");
  return Object.freeze({
    gapEntryCount: gap.entries.length,
    recreatedEntryCount: recreated.entries.length,
    stableEntryCount: stable.entries.length,
    status: "exact-provider-phase-prefixes",
  });
}

function assertProviderLedger(value: unknown, phase: Phase): ProviderLedger {
  exactKeys(value, ["database", "entries"], "Chatwoot provider ledger");
  const ledger = value as Record<string, unknown>;
  const expectedEffects = phase === "recreated"
    ? recreatedProviderEffectSequence
    : initialProviderEffectSequence;
  if (!Array.isArray(ledger.entries)
    || ledger.entries.length !== expectedEffects.length) {
    throw new Error("Chatwoot provider ledger is incomplete or outside its bound.");
  }
  const database = assertProviderDatabase(ledger.database);
  const entries: Array<Record<string, unknown>> = [];
  for (const [index, rawEntry] of ledger.entries.entries()) {
    exactKeys(rawEntry, [
      "body_bytes",
      "body_contract",
      "body_sha256",
      "credential_contract",
      "effect",
      "idempotency_key_contract",
      "idempotency_key_present",
      "idempotency_key_sha256",
      "method",
      "pathname",
      "query_keys",
      "sequence",
      "service",
    ], `Chatwoot provider entry ${index}`);
    const entry = rawEntry as Record<string, unknown>;
    const endpoint = providerEndpointContracts.find((contract) => (
      contract.service === entry.service
      && contract.method === entry.method
      && contract.pathname === entry.pathname
      && contract.effect === entry.effect
    ));
    if (entry.sequence !== index + 1 || entry.effect !== expectedEffects[index] || !endpoint
      || !isDenseArray(entry.query_keys)
      || stableJson(entry.query_keys) !== stableJson(endpoint.queryKeys)
      || !Number.isSafeInteger(entry.body_bytes) || Number(entry.body_bytes) < 0
      || Number(entry.body_bytes) > MAXIMUM_CONTROL_BYTES
      || !/^[a-f0-9]{64}$/.test(String(entry.body_sha256))
      || (endpoint.method === "GET"
        && (entry.body_bytes !== 0 || entry.body_sha256 !== EMPTY_BODY_SHA256))) {
      throw new Error(`Chatwoot provider entry ${index} escaped its exact endpoint contract.`);
    }
    const credentials = assertCredentialContract(entry.credential_contract, index);
    if (stableJson(credentials) !== stableJson(endpoint.credentials)) {
      throw new Error(`Chatwoot provider entry ${index} credential projection is not exact.`);
    }
    const bodyContract = assertEndpointBodyContract(
      entry.body_contract,
      endpoint,
      index,
    );
    if (entry.idempotency_key_present !== false
      || entry.idempotency_key_sha256 !== null
      || entry.idempotency_key_contract !== null) {
      throw new Error(`Chatwoot provider entry ${index} unexpectedly used idempotency state.`);
    }
    entries.push(Object.freeze({
      body_bytes: entry.body_bytes,
      body_contract: bodyContract,
      body_sha256: entry.body_sha256,
      credential_contract: credentials,
      effect: endpoint.effect,
      idempotency_key_contract: null,
      idempotency_key_present: false,
      idempotency_key_sha256: null,
      method: endpoint.method,
      pathname: endpoint.pathname,
      query_keys: Object.freeze([...endpoint.queryKeys]),
      sequence: entry.sequence,
      service: endpoint.service,
    }));
  }
  const contactProbeCount = entries.filter(({ effect }) => effect === "contact_identity_probed").length;
  const expectedContactProbeCount = phase === "recreated" ? 2 : 1;
  if (contactProbeCount !== expectedContactProbeCount) {
    throw new Error(`Chatwoot ${phase} provider effects do not prove the expected contact lifecycle.`);
  }
  return Object.freeze({
    database,
    entries: Object.freeze(entries) as unknown as Array<Record<string, unknown>>,
  }) as ProviderLedger;
}

function assertProviderDatabase(value: unknown) {
  exactKeys(value, ["schemaSha256", "sequenceCount", "tables"], "Chatwoot provider database");
  const database = value as Record<string, unknown>;
  if (!/^[a-f0-9]{64}$/.test(String(database.schemaSha256))
    || database.sequenceCount !== 0 || !isDenseArray(database.tables)
    || database.tables.length < 1 || database.tables.length > 128) {
    throw new Error("Chatwoot provider database snapshot is invalid.");
  }
  let previousName = "";
  const tables = database.tables.map((rawTable, index) => {
    exactKeys(rawTable, ["count", "name"], `Chatwoot provider table ${index}`);
    const table = rawTable as Record<string, unknown>;
    if (typeof table.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(table.name)
      || table.name <= previousName || !Number.isSafeInteger(table.count)
      || Number(table.count) < 0 || Number(table.count) > 1_000_000) {
      throw new Error(`Chatwoot provider table ${index} is invalid or unordered.`);
    }
    previousName = table.name;
    return Object.freeze({ count: table.count, name: table.name });
  });
  return Object.freeze({
    schemaSha256: database.schemaSha256,
    sequenceCount: 0,
    tables: Object.freeze(tables),
  });
}

function assertCredentialContract(value: unknown, index: number) {
  exactKeys(
    value,
    ["authorization_scheme", "cookie_names", "header_names"],
    `Chatwoot provider credential contract ${index}`,
  );
  const credentials = value as Record<string, unknown>;
  if (!(credentials.authorization_scheme === null
      || new Set(["Basic", "Bearer"]).has(String(credentials.authorization_scheme)))
    || !exactSortedStrings(credentials.cookie_names, 0, 16)
    || !exactSortedStrings(credentials.header_names, 0, 16)) {
    throw new Error(`Chatwoot provider credential contract ${index} is invalid.`);
  }
  return Object.freeze({
    authorization_scheme: credentials.authorization_scheme,
    cookie_names: Object.freeze([...(credentials.cookie_names as string[])]),
    header_names: Object.freeze([...(credentials.header_names as string[])]),
  });
}

function assertEndpointBodyContract(
  value: unknown,
  endpoint: Readonly<{ bodyContract: unknown; effect: string }>,
  index: number,
) {
  const contract = endpoint.bodyContract;
  if (contract === "none") {
    if (value !== null) throw new Error(`Chatwoot provider body ${index} must be absent.`);
    return null;
  }
  if (!Array.isArray(contract) || contract.length !== 2
    || typeof contract[0] !== "string" || !Array.isArray(contract[1])) {
    throw new Error("Chatwoot internal endpoint body contract is invalid.");
  }
  const [encoding, expectedNames] = contract as [string, string[]];
  exactKeys(value, ["encoding", encoding === "json" ? "value" : "fields"],
    `Chatwoot provider body ${index}`);
  const body = value as Record<string, unknown>;
  if (body.encoding !== encoding) {
    throw new Error(`Chatwoot provider body ${index} encoding is not exact.`);
  }
  if (encoding === "json") {
    if (!isRecord(body.value)
      || stableJson(Object.keys(body.value).sort()) !== stableJson(expectedNames)) {
      throw new Error(`Chatwoot provider JSON body ${index} fields are not exact.`);
    }
    for (const name of expectedNames) {
      assertEndpointFieldValue(endpoint.effect, name, body.value[name], index);
    }
  } else {
    if (!Array.isArray(body.fields) || body.fields.length !== expectedNames.length) {
      throw new Error(`Chatwoot provider field body ${index} is not exact.`);
    }
    const names = body.fields.map((field, fieldIndex) => {
      exactKeys(field, ["name", "value"], `Chatwoot provider body ${index} field ${fieldIndex}`);
      return (field as Record<string, unknown>).name;
    });
    if (stableJson(names) !== stableJson(expectedNames)) {
      throw new Error(`Chatwoot provider body ${index} field order is not exact.`);
    }
    for (const field of body.fields) {
      const projected = field as Record<string, unknown>;
      assertEndpointFieldValue(
        endpoint.effect,
        String(projected.name),
        projected.value,
        index,
      );
    }
  }
  assertSafeSanitizedContract(value, `provider body ${index}`);
  return Object.freeze(structuredClone(value));
}

function assertEndpointFieldValue(
  effect: string,
  name: string,
  value: unknown,
  index: number,
) {
  const descriptor = (kind: string, format: string, bytes: number) => (
    assertProviderDigestDescriptor(value, { bytes, format, kind }, index, name)
  );
  if (effect === "challenge_verified") {
    if (name === "response") {
      if (typeof value !== "string"
        || !/^synthetic-turnstile-token:auth_login:synthetic-turnstile-[1-9]\d*:[1-9]\d*$/.test(value)) {
        throw new Error(`Chatwoot provider body ${index} Turnstile response is invalid.`);
      }
      return;
    }
    if (name === "secret") return descriptor("redacted", "secret", 64);
  }
  if (effect === "authorization_code_issued") {
    if (name === "client_id") return descriptor("redacted", "oidc-client-id", 10);
    if (name === "code_challenge") return descriptor("dynamic", "oidc-code-challenge", 43);
    if (name === "code_challenge_method") return assertExactProviderLiteral(value, "S256", index, name);
    if (name === "nonce") return descriptor("dynamic", "oidc-nonce", 43);
    if (name === "redirect_uri") return assertProviderUrlDescriptor(value, {
      origin: SYNTHETIC_APPLICATION_ORIGIN,
      path: ["", "auth", "telegram", "callback"],
    }, index, name);
    if (name === "response_type") return assertExactProviderLiteral(value, "code", index, name);
    if (name === "scope") return assertExactProviderLiteral(value, "openid profile", index, name);
    if (name === "state") return descriptor("dynamic", "oidc-state", 43);
  }
  if (effect === "token_exchanged") {
    if (name === "client_id") return descriptor("redacted", "oidc-client-id", 10);
    if (name === "code") return descriptor("dynamic", "oidc-code", 48);
    if (name === "code_verifier") return descriptor("dynamic", "oidc-code-verifier", 86);
    if (name === "grant_type") {
      return assertExactProviderLiteral(value, "authorization_code", index, name);
    }
    if (name === "redirect_uri") return assertProviderUrlDescriptor(value, {
      origin: SYNTHETIC_APPLICATION_ORIGIN,
      path: ["", "auth", "telegram", "callback"],
    }, index, name);
  }
  if (effect === "auth_session_issued") {
    if (name === "auth_date") return descriptor("dynamic", "unix-seconds", 10);
    if (name === "first_name") return descriptor("redacted", "synthetic-profile-field", 9);
    if (name === "hash") return descriptor("dynamic", "telegram-signature", 64);
    if (name === "id") return descriptor("redacted", "synthetic-identity", 9);
    if (name === "last_name") return descriptor("redacted", "synthetic-profile-field", 12);
    if (name === "photo_url") return assertProviderUrlDescriptor(value, {
      origin: "<external-origin>",
      path: ["", "avatar.png"],
    }, index, name);
    if (name === "username") return descriptor("redacted", "synthetic-profile-field", 22);
  }
  throw new Error(`Chatwoot provider body ${index} field ${name} lacks an exact decoder.`);
}

function assertProviderDigestDescriptor(
  value: unknown,
  expected: { bytes: number; format: string; kind: string },
  index: number,
  name: string,
) {
  exactKeys(value, ["bytes", "format", "kind", "sha256"],
    `Chatwoot provider body ${index} ${name} descriptor`);
  const descriptor = value as Record<string, unknown>;
  if (descriptor.bytes !== expected.bytes
    || descriptor.format !== expected.format
    || descriptor.kind !== expected.kind
    || !/^[a-f0-9]{64}$/.test(String(descriptor.sha256))) {
    throw new Error(`Chatwoot provider body ${index} ${name} descriptor is invalid.`);
  }
}

function assertProviderUrlDescriptor(
  value: unknown,
  expected: { origin: string; path: string[] },
  index: number,
  name: string,
) {
  exactKeys(value, ["fragment", "kind", "origin", "path", "query"],
    `Chatwoot provider body ${index} ${name} URL`);
  const descriptor = value as Record<string, unknown>;
  if (descriptor.kind !== "url" || descriptor.origin !== expected.origin
    || descriptor.fragment !== null
    || stableJson(descriptor.path) !== stableJson(expected.path)
    || stableJson(descriptor.query) !== "[]") {
    throw new Error(`Chatwoot provider body ${index} ${name} URL is invalid.`);
  }
}

function assertExactProviderLiteral(
  value: unknown,
  expected: string,
  index: number,
  name: string,
) {
  if (value !== expected) {
    throw new Error(`Chatwoot provider body ${index} ${name} literal is invalid.`);
  }
}

function assertProviderPrefix(
  prefix: Array<Record<string, unknown>>,
  complete: Array<Record<string, unknown>>,
  label: string,
) {
  if (complete.length < prefix.length
    || stableJson(complete.slice(0, prefix.length)) !== stableJson(prefix)) {
    throw new Error(`Chatwoot ${label} provider ledger is not an exact ordered prefix.`);
  }
}

function providerEndpoint(
  service: string,
  method: string,
  pathname: string,
  queryKeys: string[],
  effect: string,
  bodyContract: unknown,
  headerNames: string[],
  authorizationScheme: string | null,
  cookieNames: string[],
) {
  return Object.freeze({
    bodyContract,
    credentials: Object.freeze({
      authorization_scheme: authorizationScheme,
      cookie_names: Object.freeze([...cookieNames]),
      header_names: Object.freeze([...headerNames]),
    }),
    effect,
    method,
    pathname,
    queryKeys: Object.freeze([...queryKeys]),
    service,
  });
}

function assertSafeSanitizedContract(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
    throw new Error(`Chatwoot ${label} is outside its bounded sanitized contract.`);
  }
  let nodes = 0;
  const visit = (entry: unknown, depth: number) => {
    nodes += 1;
    if (nodes > 4_096 || depth > 16) {
      throw new Error(`Chatwoot ${label} is outside its bounded sanitized contract.`);
    }
    if (entry === null || typeof entry === "boolean") return;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new Error(`Chatwoot ${label} contains a non-finite number.`);
      return;
    }
    if (typeof entry === "string") {
      if (Buffer.byteLength(entry, "utf8") > 1_024 || /[\r\n@]/.test(entry)
        || /\bBearer\s+/i.test(entry)) {
        throw new Error(`Chatwoot ${label} contains unsafe unredacted text.`);
      }
      return;
    }
    if (Array.isArray(entry)) {
      if (entry.length > 128) throw new Error(`Chatwoot ${label} array is outside its bound.`);
      for (const child of entry) visit(child, depth + 1);
      return;
    }
    if (!isRecord(entry) || Object.keys(entry).length > 128) {
      throw new Error(`Chatwoot ${label} object is outside its bound.`);
    }
    for (const [key, child] of Object.entries(entry)) {
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key)) {
        throw new Error(`Chatwoot ${label} contains an invalid field name.`);
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function exactSortedStrings(
  value: unknown,
  minimum: number,
  maximum: number,
  allowlist?: ReadonlySet<string>,
) {
  if (!isDenseArray(value) || value.length < minimum || value.length > maximum
    || value.some((entry) => typeof entry !== "string"
      || !/^[A-Za-z0-9_.-]{1,100}$/.test(entry)
      || (allowlist !== undefined && !allowlist.has(entry)))) return false;
  return JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}

function assertCaptureInput(value: CaptureInput) {
  exactKeys(value, [
    "connectProxyBindingSha256",
    "connectProxyUrl",
    "controlUrl",
    "fixtureContractSha256",
    "pairIndex",
    "playwrightVersion",
    "projectSha256",
    "resolverIp",
    "role",
    "sealer",
    "staticAssetContract",
  ], "Chatwoot browser capture input");
  for (const name of [
    "connectProxyBindingSha256",
    "fixtureContractSha256",
    "projectSha256",
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value[name])) {
      throw new Error(`Chatwoot browser ${name} is invalid.`);
    }
  }
  if (!new Set<Role>(["baseline", "candidate"]).has(value.role)
    || !Number.isSafeInteger(value.pairIndex) || value.pairIndex < 1 || value.pairIndex > 3
    || !/^\d+\.\d+\.\d+$/.test(value.playwrightVersion)
    || !/^http:\/\/127\.0\.0\.1:\d{4,5}\/$/.test(value.controlUrl)
    || !/^[a-f0-9]{64}$/.test(value.sealer?.proofHmacScopeSha256 ?? "")) {
    throw new Error("Chatwoot browser capture identity is invalid.");
  }
}

export function assertChatwootStrictClassificationForTest(
  value: unknown,
): StrictRequestEntry["classification"] {
  return assertStrictClassification(value);
}

function assertStrictClassification(value: unknown): StrictRequestEntry["classification"] {
  exactKeys(value, [
    "disposition",
    "expectedStatuses",
    "key",
    "navigation",
    "staticAssetSha256",
    "staticPath",
  ], "Chatwoot strict browser classification");
  const classification = value as Record<string, unknown>;
  if (!new Set(["abort", "continue"]).has(String(classification.disposition))
    || !isDenseArray(classification.expectedStatuses)
    || classification.expectedStatuses.some((status) => (
      !Number.isSafeInteger(status) || Number(status) < 100 || Number(status) > 599
    ))
    || typeof classification.key !== "string"
    || typeof classification.navigation !== "boolean"
    || (classification.staticAssetSha256 !== null
      && !/^[a-f0-9]{64}$/.test(String(classification.staticAssetSha256)))
    || (classification.staticPath !== null
      && typeof classification.staticPath !== "string")) {
    throw new Error("Chatwoot strict browser classification is invalid.");
  }
  return classification as StrictRequestEntry["classification"];
}

function boundedPromise<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `Chatwoot ${label} exceeded its bounded timeout.`,
    )), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForRequestLifecycleIdle(
  lifecycle: ReturnType<typeof installChatwootCommonRequestLifecycleForTest>,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    lifecycle.snapshot();
    if (lifecycle.isIdle()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Chatwoot common request lifecycle did not reach its bounded idle boundary.");
}

function pushBounded(target: string[], value: string) {
  if (target.length < MAXIMUM_EVENTS) target.push(value);
  else if (target.length === MAXIMUM_EVENTS) target.push("<overflow>");
}

function safeUrlProjection(value: string) {
  const url = new URL(value);
  const queryKeys = [...new Set([...url.searchParams.keys()])].sort();
  if (queryKeys.length > 32 || queryKeys.some((key) => !/^[A-Za-z0-9_.-]{1,100}$/.test(key))) {
    throw new Error("Chatwoot URL projection contains invalid query names.");
  }
  return Object.freeze({
    fragmentPresent: url.hash.length > 0,
    originSha256: sha256Text(url.origin),
    pathnameSha256: sha256Text(url.pathname),
    queryKeys: Object.freeze(queryKeys),
  });
}

function assertSafeUrlProjection(value: unknown, label: string) {
  exactKeys(
    value,
    ["fragmentPresent", "originSha256", "pathnameSha256", "queryKeys"],
    label,
  );
  const projection = value as Record<string, unknown>;
  if (typeof projection.fragmentPresent !== "boolean"
    || !/^[a-f0-9]{64}$/.test(String(projection.originSha256))
    || !/^[a-f0-9]{64}$/.test(String(projection.pathnameSha256))
    || !exactSortedStrings(projection.queryKeys, 0, 32)) {
    throw new Error(`${label} is invalid.`);
  }
}

function sha256Json(value: unknown) {
  return sha256Text(stableJson(value));
}

function sha256Text(value: string) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function sha256Bytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  const rendered = JSON.stringify(value);
  if (rendered === undefined) throw new Error("Chatwoot stable JSON value is unsupported.");
  return rendered;
}

function exactKeys(value: unknown, keys: string[], label: string) {
  if (!isRecord(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}
