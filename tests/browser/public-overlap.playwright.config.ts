import { defineConfig } from "@playwright/test";
import path from "node:path";

import { projectScopedPlaywrightOutputDirectory } from "./playwright-output-scope";
import {
  PUBLIC_OVERLAP_PROJECTS,
  requirePublicOverlapEnvironment,
  requirePublicOverlapPairEnvironment,
} from "./public-overlap-evidence";
import { DETERMINISTIC_CHROMIUM_LAUNCH_ARGS } from "./render-policy";

const mode = process.env.CLEAN_PAY_PUBLIC_OVERLAP_MODE;
const validModes = ["capture", "cleanup", "compare", "prepare", "verify"] as const;
if (!validModes.includes(mode as (typeof validModes)[number])) {
  throw new Error("CLEAN_PAY_PUBLIC_OVERLAP_MODE is invalid.");
}
const overlapMode = mode as (typeof validModes)[number];

const captureId = process.env.CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID;
if (typeof captureId !== "string" || !/^[a-f0-9]{16}$/.test(captureId)) {
  throw new Error("CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID is invalid.");
}

const pairedCapture = overlapMode === "capture"
  && process.env.CLEAN_PAY_PUBLIC_OVERLAP_ROLE === "pair";
const captureEnvironment = overlapMode === "capture" && !pairedCapture
  ? requirePublicOverlapEnvironment()
  : undefined;
const pairEnvironment = pairedCapture ? requirePublicOverlapPairEnvironment() : undefined;
const outputRole = pairEnvironment?.role ?? captureEnvironment?.role ?? overlapMode;
const outputDir = projectScopedPlaywrightOutputDirectory(
  path.resolve(
    process.cwd(),
    "test-results",
    "browser-public-overlap-playwright",
    outputRole,
  ),
  captureId,
);

export default defineConfig({
  testDir: ".",
  testMatch: {
    capture: pairedCapture
      ? "public-overlap-pair-capture.live.ts"
      : "public-overlap-capture.live.ts",
    cleanup: "public-overlap-cleanup.live.ts",
    compare: "public-overlap-proof.live.ts",
    prepare: "public-overlap-prepare.live.ts",
    verify: "public-overlap-verify.live.ts",
  }[overlapMode],
  outputDir,
  globalTeardown: overlapMode === "capture" ? "./public-overlap-global-teardown.ts" : undefined,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: overlapMode === "capture" ? 45_000 : 120_000,
  expect: { timeout: 5_000 },
  reporter: [["line"]],
  use: {
    baseURL: captureEnvironment?.applicationOrigin
      ?? pairEnvironment?.roles.baseline.applicationOrigin
      ?? "http://127.0.0.1:1",
    browserName: "chromium",
    launchOptions: { args: [...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS] },
    colorScheme: "light",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    contextOptions: { reducedMotion: "reduce" },
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
    serviceWorkers: "allow",
  },
  projects: overlapMode === "capture"
    ? [
      {
        name: PUBLIC_OVERLAP_PROJECTS[0],
        use: {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 1,
          hasTouch: true,
          isMobile: true,
        },
      },
      {
        name: PUBLIC_OVERLAP_PROJECTS[1],
        use: {
          viewport: { width: 768, height: 1024 },
          deviceScaleFactor: 1,
          hasTouch: true,
          isMobile: true,
        },
      },
      {
        name: PUBLIC_OVERLAP_PROJECTS[2],
        use: {
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          hasTouch: false,
          isMobile: false,
        },
      },
    ]
    : [{ name: "public-overlap-pair-proof", use: { browserName: "chromium" } }],
});
