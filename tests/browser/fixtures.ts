import {
  expect,
  test as playwrightTest,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  consoleDiagnostic,
  pageErrorDiagnostic,
} from "./network-recorder";
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

export type CharacterizationPageQuorum = readonly [Page, Page, Page];

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
    const configuredArgs = launchOptions.args ?? [];
    if (
      configuredArgs.length !== DETERMINISTIC_CHROMIUM_LAUNCH_ARGS.length
      || configuredArgs.some((value, index) => (
        value !== DETERMINISTIC_CHROMIUM_LAUNCH_ARGS[index]
      ))
    ) {
      throw new Error(
        "Independent Chromium processes require the pinned deterministic launch policy.",
      );
    }

    const browsers: Browser[] = [];
    try {
      for (
        let processIndex = 0;
        processIndex < EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT;
        processIndex += 1
      ) {
        browsers.push(await playwright.chromium.launch(launchOptions));
      }
      await provide(browsers as [Browser, Browser, Browser]);
    } finally {
      await Promise.allSettled(browsers.map((browser) => browser.close()));
    }
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
    const contextOptions = characterizationContextOptions(testInfo.project.use);
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    const guards: PageGuard[] = [];
    try {
      for (const browser of independentChromiumBrowsers) {
        const context = await browser.newContext(contextOptions);
        contexts.push(context);
        const page = await context.newPage();
        pages.push(page);
        guards.push(guardPage(page, applicationOrigin));
      }
      await provide(pages as [Page, Page, Page]);

      for (const guard of guards) guard.detach();
      const unexpectedConsole = guards.flatMap((guard) => guard.consoleMessages);
      const unexpectedPageErrors = guards.flatMap((guard) => guard.pageErrors);
      if (unexpectedConsole.length || unexpectedPageErrors.length) {
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
      }
      expect(
        unexpectedConsole,
        "Unexpected browser console output in an independent Chromium process.",
      ).toEqual([]);
      expect(
        unexpectedPageErrors,
        "Unexpected pageerror in an independent Chromium process.",
      ).toEqual([]);
      await reconcileRegisteredBaselineArtifacts(pages[0] as Page);
    } finally {
      for (const guard of guards) guard.detach();
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
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

function characterizationContextOptions(
  configured: Record<string, unknown>,
): BrowserContextOptions {
  if (
    typeof configured.baseURL !== "string"
    || !isRecord(configured.viewport)
    || typeof configured.viewport.width !== "number"
    || typeof configured.viewport.height !== "number"
  ) {
    throw new Error("Public characterization context is missing its base URL or viewport.");
  }
  return {
    ...(isRecord(configured.contextOptions)
      ? configured.contextOptions as BrowserContextOptions
      : {}),
    baseURL: configured.baseURL,
    colorScheme: configured.colorScheme as BrowserContextOptions["colorScheme"],
    deviceScaleFactor: configured.deviceScaleFactor as number | undefined,
    hasTouch: configured.hasTouch as boolean | undefined,
    isMobile: configured.isMobile as boolean | undefined,
    locale: configured.locale as string | undefined,
    serviceWorkers: configured.serviceWorkers as BrowserContextOptions["serviceWorkers"],
    timezoneId: configured.timezoneId as string | undefined,
    viewport: {
      width: configured.viewport.width,
      height: configured.viewport.height,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { expect };
