import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { prepareJourneyCaptureStaging } from "./journey-global-setup";

test("publishes no canonical baseline and refuses a reused capture staging directory", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "clean-pay-journey-staging-contract-"));
  const stagingParent = path.join(temporaryRoot, "staging");
  const canonicalRoot = path.join(temporaryRoot, "canonical");
  const captureId = "0123456789abcdef";
  const stagingRoot = path.join(stagingParent, captureId);
  try {
    await prepareJourneyCaptureStaging({
      environment: { CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID: captureId },
      canonicalRoot,
      stagingParent,
    });
    const marker = path.join(stagingRoot, "partial-evidence.json");
    await writeFile(marker, "partial\n", { flag: "wx" });

    await expect(prepareJourneyCaptureStaging({
      environment: { CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID: captureId },
      canonicalRoot,
      stagingParent,
    })).rejects.toThrow("use a new capture id");
    expect(await readFile(marker, "utf8")).toBe("partial\n");
    await expect(readFile(canonicalRoot)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
