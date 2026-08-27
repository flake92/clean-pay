import {
  expect,
  test as playwrightTest,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type ConsoleMessage,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  consoleDiagnostic,
  pageErrorDiagnostic,
} from "./network-recorder";
import {
  installCharacterizationReplayGuard,
  type CharacterizationReplayGuard,
  type CharacterizationReplayGuardEvidence,
} from "./characterization-replay-policy";
import { requireBrowserBaseUrl } from "./redaction";
import {
  acceptNormalizedStaticCspDiagnostic,
  acceptJourneyOfflineFallbackConsoleDiagnostic,
  acceptExpectedConsoleDiagnostic,
  initializeConsolePolicy,
  reconcileRegisteredBaselineArtifacts,
} from "./console-policy";
import { DETERMINISTIC_CHROMIUM_LAUNCH_ARGS } from "./render-policy";
import { EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT } from "./screenshot-majority";
import { installDeterministicTurnstileStub } from "./turnstile-stub";

export type CharacterizationGuardedPage = {
  page: Page;
  replayGuard: CharacterizationReplayGuard;
};

export type CharacterizationPageQuorum = readonly [
  CharacterizationGuardedPage,
  CharacterizationGuardedPage,
  CharacterizationGuardedPage,
];

type BrowserFixtures = {
  guardedPage: Page;
  guardedPageQuorum: CharacterizationPageQuorum;
};

type BrowserWorkerFixtures = {
  independentChromiumBrowsers: readonly [Browser, Browser, Browser];
};

type PageGuard = {
  consoleMessages: ReturnType<typeof consoleDiagnostic>[];
  detach: () => void;
  pageErrors: ReturnType<typeof pageErrorDiagnostic>[];
};

const CONTEXT_CLOSE_TIMEOUT_MS = 10_000;
const BROWSER_CLOSE_TIMEOUT_MS = 15_000;

export const test = playwrightTest.extend<BrowserFixtures, BrowserWorkerFixtures>({
  independentChromiumBrowsers: [async (
    { browserName, playwright },
    provide,
    workerInfo,
  ) => {
    if (browserName !== "chromium") {
      throw new Error("The public characterization quorum requires Chromium.");
    }
    const launchOptions = workerInfo.project.use.launchOptions ?? {};
    assertExactLaunchOptions(launchOptions);

    const browsers: Browser[] = [];
    const failures: unknown[] = [];
    try {
      for (
        let processIndex = 0;
        processIndex < EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT;
        processIndex += 1
      ) {
        browsers.push(await playwright.chromium.launch(launchOptions));
      }
      await provide(browsers as [Browser, Browser, Browser]);
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await closeOwnedResources({
          close: (browser) => browser.close({ reason: "Characterization worker ended." }),
          label: "independent Chromium browser",
          resources: browsers,
          timeoutMs: BROWSER_CLOSE_TIMEOUT_MS,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    throwCollectedFailures(failures, "Independent Chromium worker failed.");
  }, { scope: "worker" }],

  guardedPage: async ({ page }, provide, testInfo) => {
    const applicationOrigin = requireBrowserBaseUrl().origin;
    initializeConsolePolicy(page);
    const consoleMessages: ReturnType<typeof consoleDiagnostic>[] = [];
    const pageErrors: ReturnType<typeof pageErrorDiagnostic>[] = [];

    const onConsole = (message: ConsoleMessage) => {
      const location = message.location();
      const diagnostic = consoleDiagnostic({
        type: message.type(),
        text: message.text(),
        url: location.url,
        lineNumber: location.lineNumber,
        columnNumber: location.columnNumber,
        applicationOrigin,
      });
      if (acceptNormalizedStaticCspDiagnostic({
        applicationOrigin,
        diagnostic,
        page,
        rawText: message.text(),
      })) {
        return;
      }
      if (acceptJourneyOfflineFallbackConsoleDiagnostic({
        diagnostic,
        page,
        rawText: message.text(),
      })) {
        return;
      }
      if (!acceptExpectedConsoleDiagnostic(page, diagnostic)) {
        consoleMessages.push(diagnostic);
      }
    };
    const onPageError = (error: Error) => {
      pageErrors.push(pageErrorDiagnostic(error));
    };

    page.on("console", onConsole);
    page.on("pageerror", onPageError);

    await provide(page);

    page.off("console", onConsole);
    page.off("pageerror", onPageError);

    if (consoleMessages.length || pageErrors.length) {
      const diagnostics = Buffer.from(`${JSON.stringify({
        consoleMessages,
        pageErrors,
      }, null, 2)}\n`);
      const diagnosticPath = testInfo.outputPath("unexpected-browser-diagnostics.json");
      await mkdir(path.dirname(diagnosticPath), { recursive: true });
      await writeFile(diagnosticPath, diagnostics);
      await testInfo.attach("unexpected-browser-diagnostics.json", {
        path: diagnosticPath,
        contentType: "application/json",
      });
    }

    expect(
      consoleMessages,
      "Unexpected browser console output (redacted diagnostics are attached).",
    ).toEqual([]);
    expect(
      pageErrors,
      "Unexpected pageerror events (redacted diagnostics are attached).",
    ).toEqual([]);
    await reconcileRegisteredBaselineArtifacts(page);
  },

  guardedPageQuorum: async ({ independentChromiumBrowsers }, provide, testInfo) => {
    const applicationOrigin = requireBrowserBaseUrl().origin;
    const failures: unknown[] = [];
    const contexts: BrowserContext[] = [];
    const pages: CharacterizationGuardedPage[] = [];
    const guards: PageGuard[] = [];
    try {
      const contextOptions = characterizationContextOptions(testInfo.project.use);
      for (const browser of independentChromiumBrowsers) {
        const context = await browser.newContext(contextOptions);
        contexts.push(context);
        await installDeterministicTurnstileStub(context);
        const replayGuard = await installCharacterizationReplayGuard({
          applicationOrigin,
          context,
        });
        const page = await context.newPage();
        replayGuard.bindPrimaryPage(page);
        pages.push({ page, replayGuard });
        guards.push(guardPage(page, applicationOrigin));
      }
      await provide(pages as [
        CharacterizationGuardedPage,
        CharacterizationGuardedPage,
        CharacterizationGuardedPage,
      ]);
    } catch (error) {
      failures.push(error);
    }

    let contextsClosed = false;
    try {
      await closeOwnedResources({
        close: (context) => context.close({ reason: "Characterization test ended." }),
        label: "characterization browser context",
        resources: contexts,
        timeoutMs: CONTEXT_CLOSE_TIMEOUT_MS,
      });
      contextsClosed = true;
    } catch (error) {
      failures.push(error);
    }

    for (const guard of guards) guard.detach();
    const unexpectedConsole = guards.flatMap((guard) => guard.consoleMessages);
    const unexpectedPageErrors = guards.flatMap((guard) => guard.pageErrors);
    if (unexpectedConsole.length || unexpectedPageErrors.length) {
      try {
        const diagnostics = Buffer.from(`${JSON.stringify({
          processes: guards.map((guard, processIndex) => ({
            processIndex,
            consoleMessages: guard.consoleMessages,
            pageErrors: guard.pageErrors,
          })),
        }, null, 2)}\n`);
        const diagnosticPath = testInfo.outputPath(
          "unexpected-browser-process-quorum-diagnostics.json",
        );
        await mkdir(path.dirname(diagnosticPath), { recursive: true });
        await writeFile(diagnosticPath, diagnostics);
        await testInfo.attach("unexpected-browser-process-quorum-diagnostics.json", {
          path: diagnosticPath,
          contentType: "application/json",
        });
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      expect(
        unexpectedConsole,
        "Unexpected browser console output in an independent Chromium process.",
      ).toEqual([]);
    } catch (error) {
      failures.push(error);
    }
    try {
      expect(
        unexpectedPageErrors,
        "Unexpected pageerror in an independent Chromium process.",
      ).toEqual([]);
    } catch (error) {
      failures.push(error);
    }

    for (const [processIndex, entry] of pages.entries()) {
      if (contextsClosed) entry.replayGuard.markContextClosed();
      entry.replayGuard.detach();
      try {
        await persistReplayGuardEvidence({
          evidence: entry.replayGuard.evidence(),
          processIndex,
          testInfo,
        });
      } catch (error) {
        failures.push(error);
      }
      try {
        entry.replayGuard.assertNoViolations();
      } catch (error) {
        failures.push(error);
      }
    }

    throwCollectedFailures(failures, "Independent characterization fixture failed.");
    const primary = pages[0];
    if (!primary) {
      throw new Error("Independent characterization fixture created no primary page.");
    }
    await reconcileRegisteredBaselineArtifacts(primary.page);
  },
});

function guardPage(page: Page, applicationOrigin: string): PageGuard {
  initializeConsolePolicy(page);
  const consoleMessages: ReturnType<typeof consoleDiagnostic>[] = [];
  const pageErrors: ReturnType<typeof pageErrorDiagnostic>[] = [];
  const onConsole = (message: ConsoleMessage) => {
    const location = message.location();
    const diagnostic = consoleDiagnostic({
      type: message.type(),
      text: message.text(),
      url: location.url,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber,
      applicationOrigin,
    });
    if (acceptNormalizedStaticCspDiagnostic({
      applicationOrigin,
      diagnostic,
      page,
      rawText: message.text(),
    })) {
      return;
    }
    if (acceptJourneyOfflineFallbackConsoleDiagnostic({
      diagnostic,
      page,
      rawText: message.text(),
    })) {
      return;
    }
    if (!acceptExpectedConsoleDiagnostic(page, diagnostic)) {
      consoleMessages.push(diagnostic);
    }
  };
  const onPageError = (error: Error) => {
    pageErrors.push(pageErrorDiagnostic(error));
  };
  let attached = true;
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    consoleMessages,
    pageErrors,
    detach() {
      if (!attached) return;
      attached = false;
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

const EXACT_PROJECT_USE_KEYS = [
  "baseURL",
  "browserName",
  "colorScheme",
  "contextOptions",
  "deviceScaleFactor",
  "hasTouch",
  "isMobile",
  "launchOptions",
  "locale",
  "screenshot",
  "serviceWorkers",
  "timezoneId",
  "trace",
  "video",
  "viewport",
] as const;

export function characterizationContextOptions(
  configured: Record<string, unknown>,
): BrowserContextOptions {
  assertExactObjectKeys(configured, EXACT_PROJECT_USE_KEYS, "project.use");
  if (
    typeof configured.baseURL !== "string"
    || !isRecord(configured.viewport)
    || typeof configured.viewport.width !== "number"
    || typeof configured.viewport.height !== "number"
    || configured.browserName !== "chromium"
    || configured.colorScheme !== "light"
    || configured.deviceScaleFactor !== 1
    || typeof configured.hasTouch !== "boolean"
    || typeof configured.isMobile !== "boolean"
    || configured.locale !== "ru-RU"
    || configured.screenshot !== "off"
    || configured.serviceWorkers !== "allow"
    || configured.timezoneId !== "Europe/Moscow"
    || configured.trace !== "retain-on-failure"
    || configured.video !== "off"
  ) {
    throw new Error("Public characterization project.use does not match its pinned policy.");
  }
  assertExactObjectKeys(configured.viewport, ["height", "width"], "project.use.viewport");
  if (!isRecord(configured.contextOptions)) {
    throw new Error("Public characterization contextOptions are missing.");
  }
  assertExactObjectKeys(
    configured.contextOptions,
    ["reducedMotion"],
    "project.use.contextOptions",
  );
  if (configured.contextOptions.reducedMotion !== "reduce") {
    throw new Error("Public characterization reduced-motion policy must be reduce.");
  }
  assertExactLaunchOptions(configured.launchOptions);
  const viewport = {
    width: configured.viewport.width,
    height: configured.viewport.height,
  };
  const mobile = viewport.width === 390 && viewport.height === 844
    || viewport.width === 768 && viewport.height === 1024;
  const desktop = viewport.width === 1440 && viewport.height === 900;
  if (
    (!mobile && !desktop)
    || configured.hasTouch !== mobile
    || configured.isMobile !== mobile
  ) {
    throw new Error("Public characterization viewport/device policy is unsupported.");
  }
  return {
    acceptDownloads: true,
    baseURL: configured.baseURL,
    bypassCSP: false,
    colorScheme: "light",
    deviceScaleFactor: 1,
    hasTouch: mobile,
    ignoreHTTPSErrors: false,
    isMobile: mobile,
    javaScriptEnabled: true,
    locale: "ru-RU",
    offline: false,
    reducedMotion: "reduce",
    serviceWorkers: "allow",
    timezoneId: "Europe/Moscow",
    viewport,
  };
}

export function assertExactLaunchOptions(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Public characterization launchOptions are missing.");
  }
  assertExactObjectKeys(value, ["args"], "project.use.launchOptions");
  if (
    !Array.isArray(value.args)
    || value.args.length !== DETERMINISTIC_CHROMIUM_LAUNCH_ARGS.length
    || value.args.some((entry, index) => (
      entry !== DETERMINISTIC_CHROMIUM_LAUNCH_ARGS[index]
    ))
  ) {
    throw new Error("Public characterization launch arguments are not pinned.");
  }
}

export async function closeOwnedResources<T>(options: {
  close: (resource: T, index: number) => Promise<unknown>;
  label: string;
  resources: readonly T[];
  timeoutMs: number;
}) {
  const { close, label, resources, timeoutMs } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("Owned-resource close timeout must be an integer from 1 to 30000.");
  }
  const results = await Promise.allSettled(resources.map((resource, index) => (
    withTimeout(
      Promise.resolve().then(() => close(resource, index)),
      timeoutMs,
      `${label} ${index + 1}`,
    )
  )));
  const failures = results.flatMap((result, index) => (
    result.status === "rejected"
      ? [new Error(`${label} ${index + 1} failed to close.`, { cause: result.reason })]
      : []
  ));
  if (failures.length) {
    throw new AggregateError(
      failures,
      `${failures.length} of ${resources.length} owned ${label}(s) failed to close.`,
    );
  }
}

async function persistReplayGuardEvidence(options: {
  evidence: CharacterizationReplayGuardEvidence;
  processIndex: number;
  testInfo: TestInfo;
}) {
  const { evidence, processIndex, testInfo } = options;
  const evidencePath = testInfo.outputPath(
    "process-quorum",
    `process-${processIndex + 1}.replay-guard.raw.json`,
  );
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await testInfo.attach(`process-quorum/process-${processIndex + 1}/replay-guard.json`, {
    path: evidencePath,
    contentType: "application/json",
  });
}

function assertExactObjectKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} keys do not match the pinned characterization policy.`);
  }
}

function throwCollectedFailures(failures: unknown[], message: string) {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(
          new Error(`${label} did not close within ${timeoutMs}ms.`),
        ), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { expect };
