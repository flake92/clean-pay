import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Frame, Page, Route } from "@playwright/test";

import { test as guardedTest } from "../fixtures";
import {
  journeyOfflineFallbackConsoleEvidence,
  registerBaselineReconciliation,
  staticCspConsoleSidecarEvidence,
} from "../console-policy";
import { recordNetwork } from "../network-recorder";
import {
  canonicalizeUrl,
  digestValue,
  requireBrowserBaseUrl,
  sanitizeStorageKey,
  shortDigest,
} from "../redaction";
import { BEHAVIORAL_BASELINE_COMMIT, sha256 } from "../baseline-policy";
import {
  browserStorage,
  canonicalDom,
  interactiveState,
  sanitizeAriaUrls,
  selectedComputedStyles,
} from "../page-characterization";
import { captureByteIdenticalScreenshotMajority } from "../screenshot-majority";
import { authenticatedJourneyLivePairCaptureEnabled } from "./authenticated-journey-capture-mode";
import {
  assertJourneyWriteAuthorized,
  journeyProbeRequested,
  reconcileJourneyBaseline,
} from "./journey-baseline-policy";
import { createSanitizedHarContract } from "./sanitized-har";
import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-contract";
import { sanitizeJourneyBoundary } from "./journey-boundary-contract";
import {
  JOURNEY_SYNTHETIC_HOSTNAMES,
  JOURNEY_SYNTHETIC_TLS_POLICY,
  isJourneyBrowserRequestAllowed,
  journeyProvenanceLaunchArgs,
  type JourneyRendererPolicy,
} from "./journey-browser-policy";

const SYNTHETIC_CHECKOUT_ORIGIN = "https://checkout.browser.clean-pay.dev";

type CapturedCheckpoint = Awaited<ReturnType<typeof captureCheckpoint>>;
type JourneyCheckpoint = CapturedCheckpoint["evidence"];

type JourneyProbe = {
  page: Page;
  checkpoint(label: string): Promise<JourneyCheckpoint>;
  boundary(label: string, value: unknown): void;
  effects(): Promise<unknown>;
  injectPaymentDisconnectOnce(): Promise<void>;
  injectPaymentRateLimitOnce(): Promise<void>;
};

export const test = guardedTest.extend<{ journey: JourneyProbe }>({
  journey: async ({ guardedPage: page }, provide, testInfo) => {
    const probeOnly = journeyProbeRequested();
    const livePairCapture = authenticatedJourneyLivePairCaptureEnabled(process.env);
    const rendererPolicy: JourneyRendererPolicy = livePairCapture
      ? "live-overlap"
      : "canonical";
    if (probeOnly) await assertJourneyWriteAuthorized();
    const controlUrl = requiredControlUrl();
    const resolvedJourneyId = journeyId(testInfo.titlePath);
    const syntheticReset = await resetSyntheticProviders(
      controlUrl,
      `${testInfo.project.name}:${resolvedJourneyId}`,
    );
    const baseUrl = requireBrowserBaseUrl();
    const blockedRequests: Array<{ protocol: string; hostnameSha256: string }> = [];
    const enforceSyntheticNetwork = async (route: Route) => {
      const rawUrl = route.request().url();
      if (isJourneyBrowserRequestAllowed(rawUrl)) {
        await route.continue();
        return;
      }
      let protocol = "<invalid-url>";
      let hostname = rawUrl;
      try {
        const parsed = new URL(rawUrl);
        protocol = parsed.protocol;
        hostname = parsed.hostname;
      } catch {
        // The raw value is retained only as a digest below.
      }
      blockedRequests.push({ protocol, hostnameSha256: sha256(hostname) });
      await route.abort("blockedbyclient");
    };
    await page.route("**/*", enforceSyntheticNetwork);
    const recorder = recordNetwork(page, baseUrl.origin, {
      serverActionGenerationQuietMs: livePairCapture ? 1_000 : 0,
      serverActionSupersedingNavigationOrigins: livePairCapture
        ? [SYNTHETIC_CHECKOUT_ORIGIN]
        : [],
    });
    const source = await journeySourceProvenance(page, rendererPolicy);
    const checkpoints: JourneyCheckpoint[] = [];
    const screenshots: Array<{ label: string; bytes: Buffer }> = [];
    const boundaries: Array<{ label: string; value: unknown }> = [];
    const navigations: Array<ReturnType<typeof canonicalizeUrl>> = [];
    const onNavigation = (frame: Frame) => {
      if (frame === page.mainFrame()) {
        navigations.push(canonicalizeUrl(frame.url(), baseUrl.origin));
      }
    };
    page.on("framenavigated", onNavigation);

    await provide({
      page,
      async checkpoint(label) {
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(label)) {
          throw new Error(`Unsafe journey checkpoint label: ${JSON.stringify(label)}`);
        }
        if (screenshots.some((screenshot) => screenshot.label === label)) {
          throw new Error(`Duplicate journey checkpoint label: ${JSON.stringify(label)}`);
        }
        const captured = await captureCheckpoint(
          page,
          label,
          baseUrl.origin,
          recorder.captureStableServerActionCheckpoint,
        );
        checkpoints.push(captured.evidence);
        screenshots.push({ label, bytes: captured.screenshot });
        return captured.evidence;
      },
      boundary(label, value) {
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(label)) {
          throw new Error(`Unsafe journey boundary label: ${JSON.stringify(label)}`);
        }
        if (boundaries.some((boundary) => boundary.label === label)) {
          throw new Error(`Duplicate journey boundary label: ${JSON.stringify(label)}`);
        }
        boundaries.push({ label, value: sanitizeJourneyBoundary(label, value) });
      },
      effects() {
        return fetchControlJson(controlUrl, "/__ledger");
      },
      async injectPaymentDisconnectOnce() {
        const response = await fetch(new URL("/__inject", controlUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "payment_commit_disconnect_once" }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
          throw new Error(`Synthetic payment injection failed with HTTP ${response.status}.`);
        }
        const value: unknown = await response.json();
        if (
          !value
          || typeof value !== "object"
          || Array.isArray(value)
          || (value as Record<string, unknown>).status !== "armed"
          || (value as Record<string, unknown>).action !== "payment_commit_disconnect_once"
        ) {
          throw new Error("Synthetic payment injection returned an invalid contract.");
        }
      },
      async injectPaymentRateLimitOnce() {
        const response = await fetch(new URL("/__inject", controlUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "payment_commit_rate_limit_once" }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
          throw new Error(`Synthetic payment injection failed with HTTP ${response.status}.`);
        }
        const value: unknown = await response.json();
        if (
          !value
          || typeof value !== "object"
          || Array.isArray(value)
          || (value as Record<string, unknown>).status !== "armed"
          || (value as Record<string, unknown>).action !== "payment_commit_rate_limit_once"
        ) {
          throw new Error("Synthetic payment injection returned an invalid contract.");
        }
      },
    });

    await page.unroute("**/*", enforceSyntheticNetwork);
    if (blockedRequests.length > 0) {
      throw new Error(
        `Journey browser network isolation blocked ${blockedRequests.length} unexpected request(s): `
        + JSON.stringify(blockedRequests),
      );
    }
    page.off("framenavigated", onNavigation);
    const network = await recorder.finish();
    const providerLedger = await fetchControlJson(controlUrl, "/__ledger");
    const serverActions = network
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
    const evidence = {
      schemaVersion: 2,
      baselineCommit: BEHAVIORAL_BASELINE_COMMIT,
      source,
      syntheticReset,
      project: testInfo.project.name,
      journey: resolvedJourneyId,
      checkpoints,
      navigations,
      boundaries,
      console: {
        normalizedStaticCspViolations: staticCspConsoleSidecarEvidence(page),
        offlineFallbackResourceFailures: journeyOfflineFallbackConsoleEvidence(page),
      },
      network: {
        requests: network,
        serverActionCount: serverActions.length,
        serverActions,
      },
      providerEffects: providerLedger,
    };
    const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
    const networkEvidence = Buffer.from(`${JSON.stringify(
      createSanitizedHarContract({
      source,
      project: evidence.project,
      journey: evidence.journey,
      navigations,
      network: evidence.network,
      providerEffects: providerLedger,
      }),
      null,
      2,
    )}\n`);
    const actualPath = testInfo.outputPath("journey.actual.json");
    const networkActualPath = testInfo.outputPath("network.actual.har.json");
    await mkdir(path.dirname(actualPath), { recursive: true });
    await Promise.all([
      writeFile(actualPath, bytes),
      writeFile(networkActualPath, networkEvidence),
      ...screenshots.map((screenshot) => writeFile(
        testInfo.outputPath(`screenshot.${screenshot.label}.actual.png`),
        screenshot.bytes,
      )),
    ]);
    await testInfo.attach("journey.json", {
      path: actualPath,
      contentType: "application/json",
    });
    await testInfo.attach("network.har.json", {
      path: networkActualPath,
      contentType: "application/json",
    });
    for (const screenshot of screenshots) {
      await testInfo.attach(`screenshot.${screenshot.label}.png`, {
        path: testInfo.outputPath(`screenshot.${screenshot.label}.actual.png`),
        contentType: "image/png",
      });
    }

    if (testInfo.status === testInfo.expectedStatus && !probeOnly) {
      registerBaselineReconciliation(page, async () => {
        await reconcileJourneyBaseline({
          project: testInfo.project.name,
          journeyId: evidence.journey,
          networkEvidence,
          rawEvidence: bytes,
          screenshots,
        });
      });
    }
  },
});

export { expect } from "@playwright/test";

async function captureCheckpoint(
  page: Page,
  label: string,
  applicationOrigin: string,
  captureStableServerActionCheckpoint: <T>(
    capture: () => Promise<T>,
  ) => Promise<T>,
) {
  await settleJourneyCapture(page);
  return captureStableServerActionCheckpoint(async () => {
    await settleJourneyRender(page);
    return captureCheckpointState(page, label, applicationOrigin);
  });
}

async function captureCheckpointState(
  page: Page,
  label: string,
  applicationOrigin: string,
) {
  const screenshot = await captureByteIdenticalScreenshotMajority(page);
  await page.evaluate(() => document.fonts.ready);
  const [snapshot, dom, computedStyles, interactiveElements, ariaSnapshot, storage, cookies] = await Promise.all([
    page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) !== 0
          && rect.width > 0
          && rect.height > 0;
      };
      const elementName = (element: HTMLElement) => {
        if (element === document.body || element === document.documentElement) return "";
        const labelledBy = element.getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        return (
          element.getAttribute("aria-label")
          ?? labelledBy
          ?? element.textContent
          ?? ""
        ).replace(/\s+/g, " ").trim().slice(0, 200);
      };
      const active = document.activeElement as HTMLElement | null;
      return {
        title: document.title,
        focus: active ? {
          tag: active.tagName.toLowerCase(),
          role: active.getAttribute("role"),
          name: elementName(active),
        } : null,
        body: {
          overflow: getComputedStyle(document.body).overflow,
          classNames: [...document.body.classList].sort(),
        },
        dialogs: Array.from(document.querySelectorAll<HTMLElement>("[role=dialog],dialog"))
          .map((dialog) => ({ name: elementName(dialog), visible: visible(dialog) })),
      };
    }),
    canonicalDom(page),
    selectedComputedStyles(page),
    interactiveState(page),
    page.locator("body").ariaSnapshot(),
    browserStorage(page),
    page.context().cookies(),
  ]);

  const evidence = {
    label,
    url: canonicalizeUrl(page.url(), applicationOrigin),
    viewport: page.viewportSize(),
    title: snapshot.title,
    screenshot: {
      bytes: screenshot.byteLength,
      sha256: sha256(screenshot),
    },
    dom,
    computedStyles,
    interactiveElements,
    focus: snapshot.focus,
    body: snapshot.body,
    dialogs: snapshot.dialogs,
    ariaSnapshot: sanitizeAriaUrls(ariaSnapshot, applicationOrigin, page.url()),
    cookies: cookies.map((cookie) => ({
      name: /^[A-Za-z0-9_.-]{1,80}$/.test(cookie.name)
        ? cookie.name
        : `<sha256:${shortDigest(cookie.name)}>`,
      value: digestValue(cookie.value),
      domain: cookie.domain.replace(/^\./, "") === new URL(applicationOrigin).hostname
        ? "<app-host>"
        : `<external-domain:${shortDigest(cookie.domain)}>`,
      path: cookie.path,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    })).sort((left, right) => `${left.domain}:${left.path}:${left.name}`
      .localeCompare(`${right.domain}:${right.path}:${right.name}`)),
    storage: {
      local: storage.local.map((entry) => ({
        key: sanitizeStorageKey(entry.key),
        value: digestValue(entry.value),
      })),
      session: storage.session.map((entry) => ({
        key: sanitizeStorageKey(entry.key),
        value: digestValue(entry.value),
      })),
      cacheNames: storage.cacheNames.map(sanitizeStorageKey),
      serviceWorkerScopes: storage.serviceWorkerScopes
        .map((scope) => canonicalizeUrl(scope, applicationOrigin)),
    },
  };
  return { evidence, screenshot };
}

async function journeySourceProvenance(
  page: Page,
  rendererPolicy: JourneyRendererPolicy,
) {
  const revision = requiredEnvironmentValue(
    "CLEAN_PAY_BROWSER_SOURCE_REVISION",
    /^[a-f0-9]{40}$/,
  );
  const imageDigest = requiredEnvironmentValue(
    "CLEAN_PAY_BROWSER_SOURCE_IMAGE_DIGEST",
    /^sha256:[a-f0-9]{64}$/,
  );
  const imageTag = requiredEnvironmentValue(
    "CLEAN_PAY_BROWSER_SOURCE_IMAGE_TAG",
    /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/,
  );
  const migrationImageDigest = requiredEnvironmentValue(
    "CLEAN_PAY_BROWSER_MIGRATION_IMAGE_DIGEST",
    /^sha256:[a-f0-9]{64}$/,
  );
  const migrationImageTag = requiredEnvironmentValue(
    "CLEAN_PAY_BROWSER_MIGRATION_IMAGE_TAG",
    /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/,
  );
  const publicBuildContractSha256 = requiredEnvironmentValue(
    "CLEAN_PAY_BROWSER_PUBLIC_BUILD_CONTRACT_SHA256",
    /^[a-f0-9]{64}$/,
  );
  const browser = page.context().browser();
  if (!browser) throw new Error("Journey provenance requires an attached browser.");
  return {
    revision,
    imageDigest,
    imageTag,
    migrationImageDigest,
    migrationImageTag,
    publicBuildContract: {
      version: "1",
      sha256: publicBuildContractSha256,
    },
    fixtureContract: {
      version: "journey-v5",
      sha256: await currentJourneyFixtureContractSha256Async(),
    },
    browser: {
      engine: "chromium",
      version: browser.version(),
      playwright: "1.62.1",
      launchArgs: journeyProvenanceLaunchArgs(rendererPolicy),
      syntheticHostnames: [...JOURNEY_SYNTHETIC_HOSTNAMES],
      tlsPolicy: { ...JOURNEY_SYNTHETIC_TLS_POLICY },
    },
  };
}

function requiredEnvironmentValue(name: string, pattern: RegExp) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) {
    throw new Error(`${name} is required and must match ${pattern}.`);
  }
  return value;
}

async function settleJourneyCapture(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(750);
  await settleJourneyRender(page);
}

async function settleJourneyRender(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function resetSyntheticProviders(controlUrl: URL, scenario: string) {
  if (!/^[a-z0-9][a-z0-9:-]{1,180}$/.test(scenario)) {
    throw new Error("Synthetic provider scenario is invalid.");
  }
  const response = await fetch(new URL("/__reset", controlUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Synthetic provider reset failed with HTTP ${response.status}.`);
  }
  const value: unknown = await response.json();
  const reset = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const databaseValue = reset.database;
  const database = databaseValue && typeof databaseValue === "object" && !Array.isArray(databaseValue)
    ? databaseValue as Record<string, unknown>
    : {};
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || reset.status !== "reset"
    || typeof reset.seed_sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(reset.seed_sha256)
    || typeof reset.scenario_sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(reset.scenario_sha256)
    || !hasExactKeys(database, [
      "redis",
      "resetSequence",
      "schemaSha256",
      "sequenceCount",
      "scopeContract",
      "scopeSha256",
      "status",
      "tableCount",
      "transaction",
    ])
    || database.status !== "reset"
    || database.scopeContract !== "exact-compose-project-label"
    || typeof database.scopeSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(database.scopeSha256)
    || typeof database.schemaSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(database.schemaSha256)
    || !Number.isSafeInteger(database.tableCount)
    || Number(database.tableCount) <= 0
    || database.sequenceCount !== 0
    || !Number.isSafeInteger(database.resetSequence)
    || Number(database.resetSequence) <= 0
    || database.transaction
      !== "truncate-public-application-tables-cascade-no-sequences"
    || database.redis !== "flush-owned-db-0"
  ) {
    throw new Error("Synthetic provider reset returned an invalid deterministic contract.");
  }
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

async function fetchControlJson(controlUrl: URL, pathname: string) {
  const response = await fetch(new URL(pathname, controlUrl), {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Synthetic provider control read failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function requiredControlUrl() {
  const value = process.env.CLEAN_PAY_BROWSER_PROVIDER_CONTROL_URL?.trim();
  if (!value) {
    throw new Error("CLEAN_PAY_BROWSER_PROVIDER_CONTROL_URL is required for journey tests.");
  }
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/") {
    throw new Error("Provider control URL must be a credential-free HTTP origin.");
  }
  return url;
}

function journeyId(titlePath: string[]) {
  const title = titlePath.at(-1) ?? "journey";
  const id = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!id) throw new Error(`Could not derive journey id from ${JSON.stringify(titlePath)}.`);
  return id;
}
