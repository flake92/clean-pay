import {
  expect,
  test as playwrightTest,
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

type BrowserFixtures = {
  guardedPage: Page;
};

export const test = playwrightTest.extend<BrowserFixtures>({
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
});

export { expect };
