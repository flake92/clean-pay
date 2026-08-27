import { defineConfig } from "@playwright/test";

import { DETERMINISTIC_CHROMIUM_LAUNCH_ARGS } from "./tests/browser/render-policy";

const configuredBaseUrl = process.env.CLEAN_PAY_BROWSER_BASE_URL?.trim();

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/journeys/**",
  outputDir: "test-results/browser",
  // Pixel and blocked-resource capture is intentionally serial. Chromium's
  // parallel GPU raster can vary antialiasing channels by 1-2 values.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [["line"]],
  use: {
    baseURL: configuredBaseUrl || "http://127.0.0.1:1",
    browserName: "chromium",
    launchOptions: {
      // Hardware and out-of-process raster produced rare cross-process 1-2
      // channel Skia variance. The canonical v5 uses this exact local policy.
      args: [...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS],
    },
    colorScheme: "light",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    contextOptions: {
      reducedMotion: "reduce",
    },
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "chromium-390x844",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "chromium-768x1024",
      use: {
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "chromium-1440x900",
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      },
    },
  ],
});
