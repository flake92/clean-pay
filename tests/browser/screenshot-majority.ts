import type { Page } from "@playwright/test";

export const EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT = 3;

/**
 * Captures three settled-state PNGs and returns only a byte-identical 2/3
 * majority. No pixel tolerance, channel normalization, or baseline lookup is
 * involved; an unstable all-different raster fails closed.
 */
export async function captureByteIdenticalScreenshotMajority(page: Page) {
  const screenshots: Buffer[] = [];
  for (let index = 0; index < EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT; index += 1) {
    screenshots.push(await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: false,
      type: "png",
    }));
  }
  return selectByteIdenticalMajority(screenshots);
}

export function selectByteIdenticalMajority(values: readonly Uint8Array[]) {
  if (values.length !== EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT) {
    throw new Error(
      `Screenshot majority requires exactly ${EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT} PNGs.`,
    );
  }
  const buffers = values.map((value) => Buffer.from(value));
  for (let left = 0; left < buffers.length; left += 1) {
    for (let right = left + 1; right < buffers.length; right += 1) {
      if (buffers[left]?.equals(buffers[right] as Buffer)) {
        return buffers[left] as Buffer;
      }
    }
  }
  throw new Error(
    "Settled-state screenshot capture produced three byte-different PNGs; "
    + "the browser raster is not stable enough for an immutable baseline comparison.",
  );
}
