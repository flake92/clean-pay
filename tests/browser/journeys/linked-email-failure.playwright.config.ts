import { defineConfig } from "@playwright/test";

import { projectScopedPlaywrightOutputDirectory } from "../playwright-output-scope";
import {
  journeyChromiumLaunchArgs,
  journeyConnectProxy,
} from "./journey-browser-policy";

const configuredBaseUrl = process.env.CLEAN_PAY_BROWSER_BASE_URL?.trim();
const resolverIp = process.env.CLEAN_PAY_BROWSER_HOST_RESOLVER_IP?.trim();
const connectProxy = process.env.CLEAN_PAY_BROWSER_CONNECT_PROXY?.trim();
const outputScope = process.env.CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE?.trim();

if (configuredBaseUrl !== "https://pay.ci.clean-pay.dev"
  || !/^127\.0\.0\.\d{1,3}$/.test(resolverIp ?? "")
  || !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(connectProxy ?? "")
  || !/^[a-f0-9]{16}$/.test(outputScope ?? "")) {
  throw new Error("Candidate linked e-mail failure Playwright configuration is invalid.");
}

export default defineConfig({
  testDir: ".",
  testMatch: "linked-email-failure.candidate.spec.ts",
  outputDir: projectScopedPlaywrightOutputDirectory(
    "../../../test-results/browser-journeys",
    outputScope,
  ),
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    baseURL: configuredBaseUrl,
    browserName: "chromium",
    launchOptions: {
      args: journeyChromiumLaunchArgs(resolverIp),
    },
    proxy: journeyConnectProxy(connectProxy),
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
  projects: [{
    name: "candidate-linked-email-failure-1440x900",
    use: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
    },
  }],
});
