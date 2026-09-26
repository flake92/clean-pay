import type { Page } from "@playwright/test";

import type { consoleDiagnostic } from "./network-recorder";
import {
  normalizeStaticRouteCspConsole,
  type NormalizedStaticRouteCspViolation,
} from "./csp-console-normalizer";

type RedactedConsoleDiagnostic = ReturnType<typeof consoleDiagnostic>;

type ConsolePolicyState = {
  expectedFingerprints: string[];
  expectedFingerprintSet: Set<string>;
  observedExpected: RedactedConsoleDiagnostic[];
  normalizedStaticCsp: Array<NormalizedStaticRouteCspViolation & {
    order: number;
    location: RedactedConsoleDiagnostic["location"];
  }>;
  offlineFallback: {
    active: boolean;
    finished: boolean;
    observed: JourneyOfflineFallbackDiagnostic[];
  };
  pendingBaselineReconciliations: Array<() => Promise<void>>;
};

export type JourneyOfflineFallbackDiagnostic = {
  kind: "offline-resource-load-failure";
  order: number;
  resourceClass: "compiled-css" | "logo";
  diagnostic: RedactedConsoleDiagnostic;
};

const OFFLINE_RESOURCE_ERROR = "Failed to load resource: net::ERR_INTERNET_DISCONNECTED";
const OFFLINE_RESOURCE_ERROR_DIGEST = {
  bytes: 55,
  sha256: "9432f8effe23a68459f7aa20703ce905a61dcf53282cb8611c650798ff432126",
};
const OFFLINE_CSS_PATH = /^\/_next\/static\/chunks\/(?=[A-Za-z0-9_-]{8,}\.css$)(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+\.css$/;

const stateByPage = new WeakMap<Page, ConsolePolicyState>();

export function initializeConsolePolicy(page: Page) {
  const expectedFingerprints = configuredExpectedConsoleFingerprints();
  const state: ConsolePolicyState = {
    expectedFingerprints,
    expectedFingerprintSet: new Set(expectedFingerprints),
    observedExpected: [],
    normalizedStaticCsp: [],
    offlineFallback: { active: false, finished: false, observed: [] },
    pendingBaselineReconciliations: [],
  };
  stateByPage.set(page, state);
  return state;
}

export function beginJourneyOfflineFallbackConsoleCapture(page: Page) {
  const state = requiredState(page);
  if (
    state.offlineFallback.active
    || state.offlineFallback.finished
    || state.offlineFallback.observed.length !== 0
  ) {
    throw new Error("Journey offline fallback console capture may begin exactly once.");
  }
  state.offlineFallback.active = true;
}

export function acceptJourneyOfflineFallbackConsoleDiagnostic(options: {
  diagnostic: RedactedConsoleDiagnostic;
  page: Page;
  rawText: string;
}) {
  const state = requiredState(options.page);
  if (!state.offlineFallback.active || options.rawText !== OFFLINE_RESOURCE_ERROR) {
    return false;
  }
  const location = options.diagnostic.location;
  if (
    options.diagnostic.type !== "error"
    || options.diagnostic.message.bytes !== OFFLINE_RESOURCE_ERROR_DIGEST.bytes
    || options.diagnostic.message.sha256 !== OFFLINE_RESOURCE_ERROR_DIGEST.sha256
    || !location
    || typeof location.url === "string"
    || location.url.origin !== "<app-origin>"
    || location.url.query.length !== 0
    || location.url.fragment !== null
    || location.lineNumber !== 0
    || location.columnNumber !== 0
  ) {
    return false;
  }
  const resourceClass = OFFLINE_CSS_PATH.test(location.url.pathname)
    ? "compiled-css"
    : location.url.pathname === "/clean-pay-logo.png"
      ? "logo"
      : null;
  if (!resourceClass) return false;
  state.offlineFallback.observed.push({
    kind: "offline-resource-load-failure",
    order: state.offlineFallback.observed.length,
    resourceClass,
    diagnostic: options.diagnostic,
  });
  return true;
}

export function finishJourneyOfflineFallbackConsoleCapture(page: Page) {
  const state = requiredState(page);
  if (!state.offlineFallback.active || state.offlineFallback.finished) {
    throw new Error("Journey offline fallback console capture is not active.");
  }
  state.offlineFallback.active = false;
  assertJourneyOfflineFallbackConsoleContract(state.offlineFallback.observed);
  state.offlineFallback.finished = true;
}

export function journeyOfflineFallbackConsoleEvidence(page: Page) {
  const state = requiredState(page);
  if (state.offlineFallback.active) {
    throw new Error("Journey offline fallback console capture has not finished.");
  }
  return state.offlineFallback.observed.map((entry) => structuredClone(entry));
}

export function assertJourneyOfflineFallbackConsoleContract(
  evidence: JourneyOfflineFallbackDiagnostic[],
) {
  const expectedClasses = [
    "compiled-css",
    "compiled-css",
    "compiled-css",
    "compiled-css",
    "logo",
  ];
  if (
    evidence.length !== expectedClasses.length
    || evidence.some((entry, index) => (
      entry.kind !== "offline-resource-load-failure"
      || entry.order !== index
      || entry.resourceClass !== expectedClasses[index]
      || entry.diagnostic.type !== "error"
      || entry.diagnostic.message.bytes !== OFFLINE_RESOURCE_ERROR_DIGEST.bytes
      || entry.diagnostic.message.sha256 !== OFFLINE_RESOURCE_ERROR_DIGEST.sha256
      || !isExactOfflineLocation(entry, index < 4 ? "compiled-css" : "logo")
    ))
  ) {
    throw new Error(
      "Journey offline fallback must emit exactly four compiled CSS failures followed by one logo failure.",
    );
  }
}

function isExactOfflineLocation(
  entry: JourneyOfflineFallbackDiagnostic,
  resourceClass: "compiled-css" | "logo",
) {
  const location = entry.diagnostic.location;
  if (
    !location
    || typeof location.url === "string"
    || location.url.origin !== "<app-origin>"
    || location.url.query.length !== 0
    || location.url.fragment !== null
    || location.lineNumber !== 0
    || location.columnNumber !== 0
  ) {
    return false;
  }
  return resourceClass === "compiled-css"
    ? OFFLINE_CSS_PATH.test(location.url.pathname)
    : location.url.pathname === "/clean-pay-logo.png";
}

function requiredState(page: Page) {
  const state = stateByPage.get(page);
  if (!state) throw new Error("Console policy was not initialized for this page.");
  return state;
}

export function acceptNormalizedStaticCspDiagnostic(options: {
  applicationOrigin: string;
  diagnostic: RedactedConsoleDiagnostic;
  page: Page;
  rawText: string;
}) {
  const state = stateByPage.get(options.page);
  if (!state) {
    throw new Error("Console policy was not initialized for this page.");
  }
  const normalized = normalizeStaticRouteCspConsole({
    applicationOrigin: options.applicationOrigin,
    // Chromium can deliver CSP diagnostics after the next navigation has
    // started. Use the diagnostic's exact same-origin static-route location
    // when present; every other message remains bound to the live page URL.
    pageUrl: staticDiagnosticPageUrl(options.diagnostic, options.applicationOrigin)
      ?? options.page.url(),
    type: options.diagnostic.type,
    text: options.rawText,
  });
  if (!normalized) return false;
  state.normalizedStaticCsp.push({
    ...normalized,
    order: state.normalizedStaticCsp.length,
    location: options.diagnostic.location,
  });
  return true;
}

function staticDiagnosticPageUrl(
  diagnostic: RedactedConsoleDiagnostic,
  applicationOrigin: string,
): string | null {
  const url = diagnostic.location?.url;
  if (
    !url
    || typeof url === "string"
    || url.origin !== "<app-origin>"
    || (url.pathname !== "/install" && url.pathname !== "/offline")
  ) {
    return null;
  }
  return new URL(url.pathname, applicationOrigin).href;
}

export function acceptExpectedConsoleDiagnostic(
  page: Page,
  diagnostic: RedactedConsoleDiagnostic,
) {
  const state = stateByPage.get(page);
  if (!state) {
    throw new Error("Console policy was not initialized for this page.");
  }
  const fingerprint = `${diagnostic.type}:${diagnostic.message.sha256}`;
  if (!state.expectedFingerprintSet.has(fingerprint)) return false;
  state.observedExpected.push(diagnostic);
  return true;
}

export function consoleBaselineEvidence(page: Page) {
  const state = stateByPage.get(page);
  if (!state) {
    return { expectedFingerprints: [], observedExpected: [] };
  }
  return {
    expectedFingerprints: [...state.expectedFingerprints],
    observedExpected: [...state.observedExpected],
  };
}

export function staticCspConsoleSidecarEvidence(page: Page) {
  const state = stateByPage.get(page);
  return state ? [...state.normalizedStaticCsp] : [];
}

export function assertStaticCspSidecarContract(
  pathname: string,
  evidence: Array<{ kind: string; order: number }>,
) {
  const staticRoute = pathname === "/install" || pathname === "/offline";
  if (!staticRoute) {
    if (evidence.length !== 0) {
      throw new Error(`Unexpected static CSP evidence on ${pathname}.`);
    }
    return;
  }

  const expectedKinds = [
    ...Array<string>(12).fill("blocked-static-chunk"),
    ...Array<string>(2).fill("blocked-inline-script"),
  ];
  const exact = evidence.length === expectedKinds.length
    && evidence.every((entry, index) => (
      entry.order === index && entry.kind === expectedKinds[index]
    ));
  if (!exact) {
    throw new Error(
      `Static CSP evidence for ${pathname} must contain exactly 12 blocked `
      + "chunks followed by 2 blocked inline scripts in capture order.",
    );
  }
}

export function registerBaselineReconciliation(
  page: Page,
  reconciliation: () => Promise<void>,
) {
  const state = stateByPage.get(page);
  if (!state) {
    throw new Error("Console policy was not initialized for this page.");
  }
  state.pendingBaselineReconciliations.push(reconciliation);
}

export async function reconcileRegisteredBaselineArtifacts(page: Page) {
  const state = stateByPage.get(page);
  if (!state) {
    throw new Error("Console policy was not initialized for this page.");
  }
  for (const reconciliation of state.pendingBaselineReconciliations) {
    await reconciliation();
  }
}

export function configuredExpectedConsoleFingerprints(
  configuredValue?: string,
) {
  const raw = configuredValue === undefined
    ? process.env.CLEAN_PAY_BROWSER_EXPECTED_CONSOLE_SHA256?.trim() ?? ""
    : configuredValue.trim();
  if (!raw) return [];

  const fingerprints = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const fingerprint of fingerprints) {
    if (!/^(?:assert|debug|dir|error|info|log|table|trace|warning):[a-f0-9]{64}$/.test(fingerprint)) {
      throw new Error(
        "CLEAN_PAY_BROWSER_EXPECTED_CONSOLE_SHA256 must be a comma-separated "
        + "list of <console-type>:<64-character-sha256> fingerprints.",
      );
    }
  }
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new Error("CLEAN_PAY_BROWSER_EXPECTED_CONSOLE_SHA256 contains duplicates.");
  }
  return fingerprints.sort();
}
