export const DETERMINISTIC_CHROMIUM_LAUNCH_ARGS = [
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-gpu-rasterization",
  "--disable-skia-runtime-opts",
  "--disable-lcd-text",
  "--disable-font-subpixel-positioning",
  "--font-render-hinting=none",
  "--disable-oop-rasterization",
] as const;
