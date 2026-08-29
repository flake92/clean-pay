import { test } from "@playwright/test";

import { prepareExactCapturePair } from "./public-overlap-evidence";

test("creates verifier-owned public overlap evidence roots", async () => {
  const captureId = process.env.CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID;
  const baselineBindingSha256 = process.env.CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_BINDING_SHA256;
  const candidateBindingSha256 = process.env.CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_BINDING_SHA256;
  if (
    typeof captureId !== "string"
    || typeof baselineBindingSha256 !== "string"
    || typeof candidateBindingSha256 !== "string"
  ) {
    throw new Error("Public overlap preparation environment is incomplete.");
  }
  await prepareExactCapturePair({
    baselineBindingSha256,
    candidateBindingSha256,
    captureId,
  });
});
