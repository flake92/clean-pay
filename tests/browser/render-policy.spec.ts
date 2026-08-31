import { expect, test } from "@playwright/test";

import {
  assertExactLaunchOptions,
  assertExactLiveOverlapLaunchOptions,
  characterizationRendererPolicy,
} from "./fixtures";
import {
  DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
  LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS,
} from "./render-policy";

test.describe("browser renderer policy", () => {
  test("pins exact live A/B raster extensions without changing the immutable baseline policy", ({}, testInfo) => {
    expect(LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS).toEqual([
      ...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
      "--num-raster-threads=1",
      "--disable-partial-raster",
    ]);
    expect(Object.isFrozen(DETERMINISTIC_CHROMIUM_LAUNCH_ARGS)).toBe(true);
    expect(Object.isFrozen(LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS)).toBe(true);
    expect(DETERMINISTIC_CHROMIUM_LAUNCH_ARGS).not.toContain(
      "--disable-partial-raster",
    );

    expect(() => assertExactLiveOverlapLaunchOptions({
      args: [...LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS],
    })).not.toThrow();
    expect(() => assertExactLiveOverlapLaunchOptions({
      args: [...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS],
    })).toThrow(/not pinned/);
    expect(() => assertExactLaunchOptions({
      args: [...LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS],
    })).toThrow(/not pinned/);
    expect(() => assertExactLiveOverlapLaunchOptions({
      args: [
        ...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
        "--disable-partial-raster",
        "--num-raster-threads=1",
      ],
    })).toThrow(/not pinned/);
    expect(() => assertExactLiveOverlapLaunchOptions({
      args: LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS.slice(0, -1),
    })).toThrow(/not pinned/);
    expect(() => assertExactLiveOverlapLaunchOptions({
      args: [...LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS, "--unexpected-renderer-flag"],
    })).toThrow(/not pinned/);

    expect(characterizationRendererPolicy(testInfo.project.metadata)).toBe("canonical");
    expect(characterizationRendererPolicy({
      cleanPayRendererPolicy: "live-overlap",
    })).toBe("live-overlap");
    expect(() => characterizationRendererPolicy({})).toThrow(/keys do not match/);
    expect(() => characterizationRendererPolicy({
      cleanPayRendererPolicy: "live-overlap",
      unexpected: "value",
    })).toThrow(/keys do not match/);
  });
});
