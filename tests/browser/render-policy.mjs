export const DETERMINISTIC_CHROMIUM_LAUNCH_ARGS = Object.freeze([
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-gpu-rasterization",
  "--disable-skia-runtime-opts",
  "--disable-lcd-text",
  "--disable-font-subpixel-positioning",
  "--font-render-hinting=none",
  "--disable-oop-rasterization",
]);

/**
 * The immutable v5 baseline keeps the exact renderer above. Live paired A/B
 * capture adds a single raster worker to remove the remaining cross-process
 * scheduling degree of freedom without applying tolerance or touching the
 * frozen baseline artifacts.
 */
export const LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS = Object.freeze([
  ...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
  "--num-raster-threads=1",
]);
