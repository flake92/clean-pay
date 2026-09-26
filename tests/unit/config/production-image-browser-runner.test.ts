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
  "tests/browser/journeys/journey-fixture-manifest.mjs",
  "utf8",
);
const generatedEnvironmentLifecycle = readFileSync(
  "tests/browser/journeys/journey-generated-environment-lifecycle.mjs",
  "utf8",
);

describe("production-image browser runner phases", () => {
  it("runs the public baseline before the authenticated journey with a pristine owned stack", () => {
    const configs = [...runner.matchAll(
      /await runPlaywright\(\s*"([^"]+)"/gu,
    )].map((match) => match[1]);

    expect(configs).toEqual([
      "config/playwright.config.ts",
      "tests/browser/journeys/playwright.config.ts",
    ]);

    const publicStack = runner.indexOf(
      "await startOwnedProject(envFile, publicCharacterizationComposeFiles);",
    );
    const publicRun = runner.indexOf(
      'await runPlaywright("config/playwright.config.ts", mainBrowserEnvironment);',
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

  it("does not leak outer publication overrides into nested contract probes", () => {
    for (const name of [
      "CLEAN_PAY_BROWSER_APP_PORT",
      "CLEAN_PAY_BROWSER_PROVIDER_PORT",
      "CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT",
      "CLEAN_PAY_BROWSER_PROXY_BIND",
      "CLEAN_PAY_BROWSER_TURNSTILE_SITE_KEY",
    ]) {
      expect(runner).toContain(`delete environment.${name};`);
    }
  });

  it("cleans only exact generated environment files and retains hash-only evidence", () => {
    expect(runner).toContain("prepareGeneratedEnvironmentDirectory({");
    expect(runner).toContain("writeSanitizedJourneyContractEvidence({");
    expect(runner).toContain("await cleanupGeneratedEnvironment(generatedEnvironmentState);");
    expect(runner).toContain("cleanupRetainedGeneratedEnvironment({");
    expect(runner).toContain('projectSha256: digest(project)');
    expect(runner).not.toContain("project,\n    publicBuildContractSha256");

    for (const filename of [
      ".env",
      ".env.app",
      ".env.browser-observer",
      ".env.browser-observer-provision",
      ".env.hold-operator",
      ".env.migration",
      ".env.postgres",
      ".env.provision",
      ".env.reconciliation",
      ".env.retention",
      "browser-journey-contract.json",
    ]) {
      expect(generatedEnvironmentLifecycle).toContain(`"${filename}"`);
    }
    const exactCleanup = generatedEnvironmentLifecycle.slice(
      generatedEnvironmentLifecycle.indexOf("async function removeExactGeneratedFiles"),
      generatedEnvironmentLifecycle.indexOf("function assertSyntheticJourneyContract"),
    );
    expect(exactCleanup).toContain("await unlink(path.join(directory, filename))");
    expect(exactCleanup).not.toContain("recursive");
    expect(exactCleanup).not.toContain("glob");
    expect(exactCleanup).not.toMatch(/\brm\s*\(/u);
    expect(generatedEnvironmentLifecycle).toContain(
      "if (state.directoryCreatedByRun) await rmdir(realDirectory);",
    );
    expect(generatedEnvironmentLifecycle).toContain(
      "Journey environment contains an unexpected entry; exact files were cleaned only.",
    );
  });
});
