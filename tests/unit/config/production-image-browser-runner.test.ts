import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const runner = readFileSync(
  "tests/browser/journeys/run-production-image-journey.mjs",
  "utf8",
);
const publicCharacterizationOverride = readFileSync(
  "tests/browser/journeys/docker-compose.public-characterization.yml",
  "utf8",
);
const fixtureContract = readFileSync(
  "tests/browser/journeys/journey-fixture-contract.ts",
  "utf8",
);

describe("production-image browser runner phases", () => {
  it("runs the public baseline before the authenticated journey with a pristine owned stack", () => {
    const configs = [...runner.matchAll(
      /await runPlaywright\(\s*"([^"]+)"/gu,
    )].map((match) => match[1]);

    expect(configs).toEqual([
      "playwright.config.ts",
      "tests/browser/journeys/playwright.config.ts",
    ]);

    const publicStack = runner.indexOf(
      "await startOwnedProject(envFile, publicCharacterizationComposeFiles);",
    );
    const publicRun = runner.indexOf(
      'await runPlaywright("playwright.config.ts", mainBrowserEnvironment);',
    );
    const interphaseCleanup = runner.indexOf(
      "await cleanupOwnedProject();",
      publicRun,
    );
    const absenceAssertion = runner.indexOf(
      "await assertProjectAbsent();",
      interphaseCleanup,
    );
    const journeyStack = runner.indexOf(
      "await startOwnedProject(envFile, journeyComposeFiles);",
      absenceAssertion,
    );
    const journeyRun = runner.indexOf(
      '"tests/browser/journeys/playwright.config.ts",',
      journeyStack,
    );

    expect(publicStack).toBeGreaterThanOrEqual(0);
    expect(publicRun).toBeGreaterThan(publicStack);
    expect(interphaseCleanup).toBeGreaterThan(publicRun);
    expect(absenceAssertion).toBeGreaterThan(interphaseCleanup);
    expect(journeyStack).toBeGreaterThan(absenceAssertion);
    expect(journeyRun).toBeGreaterThan(journeyStack);
    expect(runner.slice(publicRun, journeyRun)).not.toContain("Promise.all(");
  });

  it("uses the exact direct loopback publication and always cleans owned resources", () => {
    expect(runner).toContain(
      'CLEAN_PAY_BROWSER_BASE_URL: `http://${contract.publications.app}`',
    );
    expect(runner).toContain(
      '!/^127\\.0\\.0\\.1:\\d{4,5}$/.test(contract?.publications?.app ?? "")',
    );
    expect(runner).toContain(
      'path.join(repositoryRoot, "node_modules", "playwright", "cli.js")',
    );
    expect(runner).not.toContain("npx");

    const journeyRun = runner.indexOf(
      '"tests/browser/journeys/playwright.config.ts",',
    );
    const finalizer = runner.indexOf("finalize-journey-baseline.mjs", journeyRun);
    const commonFinally = runner.indexOf("} finally {", finalizer);
    const finalCleanup = runner.indexOf("await cleanupOwnedProject();", commonFinally);

    expect(finalizer).toBeGreaterThan(journeyRun);
    expect(commonFinally).toBeGreaterThan(finalizer);
    expect(finalCleanup).toBeGreaterThan(commonFinally);
    expect(runner).toContain('"down", "--volumes", "--timeout", "120"');
    expect(runner).toContain(
      "Owned journey project ${project} was not completely removed.",
    );
  });

  it("keeps the public-only override app-scoped and fixture-bound", () => {
    expect(publicCharacterizationOverride).toBe(`services:
  app:
    environment:
      SUPPORT_ENABLED: "false"
      SUPPORT_EMAIL: ""
      SUPPORT_TELEGRAM_USERNAME: ""
      SUPPORT_FAQ_URL: ""
      CHATWOOT_BASE_URL: ""
      CHATWOOT_WEBSITE_TOKEN: ""
      CHATWOOT_HMAC_TOKEN: ""
`);
    expect(fixtureContract).toContain(
      '"docker-compose.public-characterization.yml",',
    );
    expect(runner).toContain(
      '"docker-compose.public-characterization.yml",',
    );
  });
});
