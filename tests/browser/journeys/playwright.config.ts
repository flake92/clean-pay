import { defineConfig } from "@playwright/test";

import { projectScopedPlaywrightOutputDirectory } from "../playwright-output-scope";
import { authenticatedJourneyLivePairCaptureEnabled } from "./authenticated-journey-capture-mode";
import {
  journeyChromiumLaunchArgs,
  journeyConnectProxy,
  type JourneyRendererPolicy,
} from "./journey-browser-policy";

const configuredBaseUrl = process.env.CLEAN_PAY_BROWSER_BASE_URL?.trim();
const resolverIp = process.env.CLEAN_PAY_BROWSER_HOST_RESOLVER_IP?.trim() || "127.0.0.2";
const connectProxy = journeyConnectProxy(
  process.env.CLEAN_PAY_BROWSER_CONNECT_PROXY?.trim() || "http://127.0.0.1:14444",
);
const rendererPolicy: JourneyRendererPolicy = authenticatedJourneyLivePairCaptureEnabled(
  process.env,
)
  ? "live-overlap"
  : "canonical";

export default defineConfig({
  testDir: ".",
  globalSetup: "./journey-global-setup.ts",
  globalTeardown: "./journey-global-teardown.ts",
  outputDir: projectScopedPlaywrightOutputDirectory(
    "../../../test-results/browser-journeys",
    process.env.CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE,
  ),
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  // The local fallback bridge opens a short-lived, isolated Docker exec
  // stream per TCP connection. CI host publications are faster, but both
  // paths use the same bounded journey contract.
  timeout: 180_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    baseURL: configuredBaseUrl || "https://pay.ci.clean-pay.dev",
    browserName: "chromium",
    launchOptions: {
      args: journeyChromiumLaunchArgs(resolverIp, rendererPolicy),
    },
    proxy: connectProxy,
    colorScheme: "light",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    contextOptions: { reducedMotion: "reduce" },
    ignoreHTTPSErrors: true,
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "journey-contract",
      testMatch: "**/*.contract.spec.ts",
    },
    {
      name: "journey-390x844",
      dependencies: ["journey-contract"],
      testMatch: "**/*.journey.spec.ts",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "journey-768x1024",
      dependencies: ["journey-contract"],
      testMatch: "**/*.journey.spec.ts",
      use: {
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "journey-1440x900",
      dependencies: ["journey-contract"],
      testMatch: "**/*.journey.spec.ts",
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      },
    },
  ],
});
