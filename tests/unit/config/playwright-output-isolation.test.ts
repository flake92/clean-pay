import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { projectScopedPlaywrightOutputDirectory } from "../../../tests/browser/playwright-output-scope";

const rootConfig = readFileSync("playwright.config.ts", "utf8");
const journeyConfig = readFileSync(
  "tests/browser/journeys/playwright.config.ts",
  "utf8",
);
const productionImageRunner = readFileSync(
  "tests/browser/journeys/run-production-image-journey.mjs",
  "utf8",
);
const fixtureManifest = readFileSync(
  "tests/browser/journeys/journey-fixture-manifest.mjs",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("production-image Playwright output isolation", () => {
  it("preserves both default output directories when no project scope is provided", () => {
    expect(projectScopedPlaywrightOutputDirectory(
      "test-results/browser",
      undefined,
    )).toBe("test-results/browser");
    expect(projectScopedPlaywrightOutputDirectory(
      "../../../test-results/browser-journeys",
      undefined,
    )).toBe("../../../test-results/browser-journeys");
  });

  it("derives distinct contained output directories for concurrent baseline and candidate projects", () => {
    const baselineProject = "clean-pay-browser-journey-baseline-final-53e6770";
    const candidateProject = "clean-pay-browser-journey-candidate-final-53e6770";
    const baseline = createHash("sha256").update(baselineProject).digest("hex").slice(0, 16);
    const candidate = createHash("sha256").update(candidateProject).digest("hex").slice(0, 16);
    const outputRoot = "test-results/browser";
    const baselineOutput = projectScopedPlaywrightOutputDirectory(outputRoot, baseline);
    const candidateOutput = projectScopedPlaywrightOutputDirectory(outputRoot, candidate);

    expect(baseline).toBe("6f74ff72d029c878");
    expect(candidate).toBe("61a29554ad0c5883");
    expect(baselineOutput).toBe(path.join(outputRoot, baseline));
    expect(candidateOutput).toBe(path.join(outputRoot, candidate));
    expect(baselineOutput).not.toBe(candidateOutput);
    for (const output of [baselineOutput, candidateOutput]) {
      const relative = path.relative(path.resolve(outputRoot), path.resolve(output));
      expect(relative).not.toMatch(/^\.\.(?:[/\\]|$)/u);
      expect(path.isAbsolute(relative)).toBe(false);
    }
  });

  it("rejects traversal, separators, absolute paths and non-project caller values", () => {
    for (const scope of [
      "",
      ".",
      "..",
      "../candidate",
      "clean-pay-browser-journey-candidate/trace",
      "clean-pay-browser-journey-candidate\\trace",
      "/tmp/candidate",
      "C:\\tmp\\candidate",
      " candidate ",
      "candidate",
      "ABCDEF0123456789",
      "abcdef012345678",
      "abcdef01234567890",
    ]) {
      expect(
        () => projectScopedPlaywrightOutputDirectory("test-results/browser", scope),
        scope,
      ).toThrow(/OUTPUT_SCOPE is invalid/u);
    }
  });

  it("overrides caller scope with the validated Compose project and binds both configs", () => {
    const spread = productionImageRunner.indexOf("...process.env,");
    const derivedScope = productionImageRunner.indexOf(
      "CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE: digest(project).slice(0, 16),",
    );
    expect(spread).toBeGreaterThanOrEqual(0);
    expect(derivedScope).toBeGreaterThan(spread);
    expect(productionImageRunner).not.toContain(
      'required("CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE"',
    );

    for (const config of [rootConfig, journeyConfig]) {
      expect(config).toContain("projectScopedPlaywrightOutputDirectory(");
      expect(config).toContain(
        "process.env.CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE",
      );
      expect(config).not.toContain("CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_DIR");
    }
    expect(fixtureManifest).toContain('"../playwright-output-scope.ts"');
    expect(fixtureManifest).toContain('"../../../playwright.config.ts"');
  });

  it("preserves failure evidence from both Playwright phases and the sanitized contract", () => {
    const artifactStep = ciWorkflow.slice(
      ciWorkflow.indexOf("Preserve sanitized browser journey evidence"),
      ciWorkflow.indexOf("Clean up only the owned browser journey project"),
    );

    expect(artifactStep).toContain("test-results/browser\n");
    expect(artifactStep).toContain("test-results/browser-journeys\n");
    expect(artifactStep).toContain("test-results/browser-journey-contract-evidence\n");
  });
});
