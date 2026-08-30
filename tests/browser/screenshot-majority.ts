import type { Page } from "@playwright/test";

export const EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT = 3;
export const EXACT_TERMINAL_SCREENSHOT_CAPTURE_COUNT = 3;

const exactScreenshotOptions = Object.freeze({
  animations: "disabled" as const,
  caret: "hide" as const,
  fullPage: false,
  type: "png" as const,
});

/**
 * Captures three settled-state PNGs and returns only a byte-identical 2/3
 * majority. No pixel tolerance, channel normalization, or baseline lookup is
 * involved; an unstable all-different raster fails closed.
 */
export async function captureByteIdenticalScreenshotMajority(page: Page) {
  const screenshots: Buffer[] = [];
  for (let index = 0; index < EXACT_SCREENSHOT_QUORUM_PROCESS_COUNT; index += 1) {
    screenshots.push(await page.screenshot(exactScreenshotOptions));
  }
  return selectByteIdenticalMajority(screenshots);
}

/**
 * Warms the compositor once, then returns only two consecutive byte-identical
 * terminal PNGs. The helper does not retry toward baseline bytes and never
 * applies pixel tolerance, masking, or normalization.
 */
export async function captureByteIdenticalTerminalScreenshot(page: Page) {
  const screenshots: Buffer[] = [await page.screenshot(exactScreenshotOptions)];
  for (let index = 1; index < EXACT_TERMINAL_SCREENSHOT_CAPTURE_COUNT; index += 1) {
    await settleLoadedViewportResources(page);
    screenshots.push(await page.screenshot(exactScreenshotOptions));
  }
  return selectByteIdenticalTerminalScreenshot(screenshots);
}

export function selectByteIdenticalTerminalScreenshot(
  values: readonly Uint8Array[],
) {
  if (values.length !== EXACT_TERMINAL_SCREENSHOT_CAPTURE_COUNT) {
    throw new Error(
      `Terminal screenshot proof requires exactly ${EXACT_TERMINAL_SCREENSHOT_CAPTURE_COUNT} PNGs.`,
    );
  }
  const firstEvidence = Buffer.from(values[1] as Uint8Array);
  const terminalEvidence = Buffer.from(values[2] as Uint8Array);
  if (firstEvidence.equals(terminalEvidence)) return terminalEvidence;
  throw new Error(
    "Terminal screenshot evidence is not byte-identical after compositor warm-up.",
  );
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

async function settleLoadedViewportResources(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const decodes: Promise<void>[] = [];
    for (const image of document.images) {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      const visibleInViewport = style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < innerHeight
        && rect.left < innerWidth;
      if (visibleInViewport && (
        !image.complete
        || (image.currentSrc !== "" && image.naturalWidth === 0)
      )) {
        throw new Error("A visible characterization image did not finish loading.");
      }
      if (image.complete && image.currentSrc !== "" && image.naturalWidth > 0) {
        decodes.push(image.decode());
      }
    }
    await Promise.all(decodes);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}
