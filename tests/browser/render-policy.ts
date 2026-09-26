import {
  DETERMINISTIC_CHROMIUM_LAUNCH_ARGS as runtimeLaunchArgs,
  LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS as runtimeLiveOverlapLaunchArgs,
} from "./render-policy.mjs";

export const DETERMINISTIC_CHROMIUM_LAUNCH_ARGS = runtimeLaunchArgs as readonly string[];
export const LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS = runtimeLiveOverlapLaunchArgs as readonly string[];
