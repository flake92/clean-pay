import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  BEHAVIORAL_BASELINE_COMMIT,
  BaselineMismatchError,
  sha256,
} from "../baseline-policy";
import { projectCharacterizationManifestBytesForComparison } from "../comparison-projection";
import {
  assertSanitizedHarContract,
  createSanitizedHarContract,
} from "./sanitized-har";
import { assertExactJourneyKeyboardSkipLinkScreenshot } from "./journey-skip-link-policy";

const execFileAsync = promisify(execFile);

export const JOURNEY_BASELINE_VERSION = "journey-v5";
export const journeyBaselineRoot = path.resolve(
  process.cwd(),
  "tests",
  "browser",
  "baselines",
  `${BEHAVIORAL_BASELINE_COMMIT}-${JOURNEY_BASELINE_VERSION}`,
);

export function journeyBaselineStagingRoot(
  environment: Record<string, string | undefined> = process.env,
) {
  const captureId = environment.CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID?.trim();
  if (!captureId || !/^[a-f0-9]{16}$/.test(captureId)) {
    throw new Error(
      "CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID must be a unique 16-hex value for baseline capture.",
    );
  }
  return path.resolve(
    process.cwd(),
    "test-results",
    "browser-journey-baseline-staging",
    captureId,
  );
}

export function journeyBaselineUpdateRequested(
  environment: Record<string, string | undefined> = process.env,
) {
  return environment.CLEAN_PAY_UPDATE_JOURNEY_BASELINE === "1";
}

export function journeyProbeRequested(
  environment: Record<string, string | undefined> = process.env,
) {
  return environment.CLEAN_PAY_BROWSER_JOURNEY_PROBE === "1";
}

export async function reconcileJourneyBaseline(options: {
  project: string;
  journeyId: string;
  networkEvidence: Uint8Array;
  rawEvidence: Uint8Array;
  screenshots: Array<{ label: string; bytes: Uint8Array }>;
  update?: boolean;
}) {
  const update = options.update ?? journeyBaselineUpdateRequested();
  const artifactRoot = update ? journeyBaselineStagingRoot() : journeyBaselineRoot;
  const destination = path.join(
    artifactRoot,
    safeSegment(options.project),
    safeSegment(options.journeyId),
    "journey.json",
  );
  const actualProjection = projectJourneyEvidenceBytes(options.rawEvidence);
  const networkDestination = path.join(path.dirname(destination), "network.har.json");
  const actualNetworkProjection = projectJourneyHarEvidenceBytes(options.networkEvidence);
  const screenshotDestinations = options.screenshots.map((screenshot) => ({
    ...screenshot,
    destination: path.join(
      path.dirname(destination),
      "screenshots",
      `${safeSegment(screenshot.label)}.png`,
    ),
  }));

  if (await exists(destination)) {
    if (update) {
      throw new Error(
        `Refusing to resume or overwrite a partial journey capture: ${destination}.`,
      );
    }
    const expectedRaw = await readFile(destination);
    const expectedProjection = projectJourneyEvidenceBytes(expectedRaw);
    if (!expectedProjection.equals(actualProjection)) {
      throw new BaselineMismatchError(
        destination,
        sha256(expectedProjection),
        sha256(actualProjection),
      );
    }
    if (!await exists(networkDestination)) {
      throw new Error(`Immutable journey baseline is incomplete: ${networkDestination} is missing.`);
    }
    const expectedNetworkProjection = projectJourneyHarEvidenceBytes(
      await readFile(networkDestination),
    );
    if (!expectedNetworkProjection.equals(actualNetworkProjection)) {
      throw new BaselineMismatchError(
        networkDestination,
        sha256(expectedNetworkProjection),
        sha256(actualNetworkProjection),
      );
    }
    for (const screenshot of screenshotDestinations) {
      if (!await exists(screenshot.destination)) {
        throw new Error(`Immutable journey baseline is incomplete: ${screenshot.destination} is missing.`);
      }
      const expectedScreenshot = await readFile(screenshot.destination);
      const exactMatch = expectedScreenshot.equals(Buffer.from(screenshot.bytes));
      const allowlistedSkipLink = !exactMatch && await assertExactJourneyKeyboardSkipLinkScreenshot({
        project: options.project,
        journeyId: options.journeyId,
        label: screenshot.label,
        expectedEvidence: expectedRaw,
        actualEvidence: options.rawEvidence,
        expectedPng: expectedScreenshot,
        actualPng: screenshot.bytes,
      });
      if (!exactMatch && !allowlistedSkipLink) {
        throw new BaselineMismatchError(
          screenshot.destination,
          sha256(expectedScreenshot),
          sha256(screenshot.bytes),
        );
      }
    }
    return { status: "matched" as const, destination };
  }

  if (!update) {
    throw new Error(
      `Missing immutable journey baseline ${destination}. `
      + "Capture is allowed only with CLEAN_PAY_UPDATE_JOURNEY_BASELINE=1 at the pinned commit.",
    );
  }
  await assertJourneyWriteAuthorized();
  if (await exists(journeyBaselineRoot)) {
    throw new Error(`Immutable journey baseline already exists: ${journeyBaselineRoot}.`);
  }
  const allDestinations = [
    destination,
    networkDestination,
    ...screenshotDestinations.map((screenshot) => screenshot.destination),
  ];
  const existing = [];
  for (const target of allDestinations) {
    if (await exists(target)) existing.push(target);
  }
  if (existing.length > 0) {
    throw new Error(
      "Refusing to complete a partially existing immutable journey baseline: "
      + existing.join(", "),
    );
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(path.join(path.dirname(destination), "screenshots"), { recursive: true });
  for (const screenshot of screenshotDestinations) {
    await writeFile(screenshot.destination, screenshot.bytes, { flag: "wx" });
  }
  await writeFile(networkDestination, options.networkEvidence, { flag: "wx" });
  // The JSON contract is the completion marker and is written last.
  await writeFile(destination, options.rawEvidence, { flag: "wx" });
  return { status: "created" as const, destination };
}

export function projectJourneyEvidenceBytes(value: Uint8Array) {
  return projectCharacterizationManifestBytesForComparison(value);
}

export function projectJourneyHarEvidenceBytes(value: Uint8Array) {
  const parsed: unknown = JSON.parse(Buffer.from(value).toString("utf8"));
  const rawSource = assertSanitizedHarContract(parsed);
  const projectedSource = JSON.parse(
    projectJourneyEvidenceBytes(Buffer.from(JSON.stringify(rawSource))).toString("utf8"),
  );
  return Buffer.from(`${JSON.stringify(createSanitizedHarContract(projectedSource), null, 2)}\n`);
}

export async function assertJourneyWriteAuthorized() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    windowsHide: true,
  });
  const revision = stdout.trim();
  if (revision !== BEHAVIORAL_BASELINE_COMMIT) {
    throw new Error(
      `Journey baseline capture is permitted only at commit ${BEHAVIORAL_BASELINE_COMMIT}; `
      + `current revision is ${revision || "<unknown>"}.`,
    );
  }
}

function safeSegment(value: string) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(value)) {
    throw new Error(`Unsafe journey baseline path segment: ${JSON.stringify(value)}`);
  }
  return value;
}

async function exists(target: string) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
