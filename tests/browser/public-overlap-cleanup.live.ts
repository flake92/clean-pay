import { test } from "@playwright/test";

import { cleanupPreparedCapturePair } from "./public-overlap-evidence";

test("removes only the verifier-owned failed public overlap evidence root", async () => {
  const captureId = process.env.CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID;
  const pairReceiptSha256 = process.env.CLEAN_PAY_PUBLIC_OVERLAP_PAIR_OWNERSHIP_SHA256;
  if (typeof captureId !== "string" || typeof pairReceiptSha256 !== "string") {
    throw new Error("Public overlap cleanup environment is incomplete.");
  }
  await cleanupPreparedCapturePair({ captureId, pairReceiptSha256 });
});
