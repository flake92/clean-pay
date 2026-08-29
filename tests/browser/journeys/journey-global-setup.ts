import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import { authenticatedJourneyLivePairCaptureEnabled } from "./authenticated-journey-capture-mode";
import { journeyBaselineRoot, journeyBaselineUpdateRequested } from "./journey-baseline-policy";
import { assertJourneyLivePairCaptureReady } from "./journey-live-pair-evidence";

export default async function journeyGlobalSetup() {
  if (authenticatedJourneyLivePairCaptureEnabled(process.env)) {
    await assertJourneyLivePairCaptureReady();
    return;
  }
  if (!journeyBaselineUpdateRequested()) return;

  await prepareJourneyCaptureStaging();
}

export async function prepareJourneyCaptureStaging(options: {
  environment?: Record<string, string | undefined>;
  canonicalRoot?: string;
  stagingParent?: string;
} = {}) {
  const environment = options.environment ?? process.env;

  const captureId = environment.CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID?.trim();
  if (!captureId || !/^[a-f0-9]{16}$/.test(captureId)) {
    throw new Error(
      "CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID must be a unique 16-hex value for baseline capture.",
    );
  }
  const canonicalRoot = options.canonicalRoot ?? journeyBaselineRoot;
  if (await exists(canonicalRoot)) {
    throw new Error(`Immutable journey baseline already exists: ${canonicalRoot}.`);
  }

  const stagingParent = options.stagingParent ?? path.resolve(
    process.cwd(),
    "test-results",
    "browser-journey-baseline-staging",
  );
  const stagingRoot = path.join(stagingParent, captureId);
  await mkdir(stagingParent, { recursive: true });
  try {
    await mkdir(stagingRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      `Journey capture staging already exists; use a new capture id and retain ${stagingRoot} as failed evidence.`,
    );
  }
}

async function exists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
