import { test } from "@playwright/test";

import { verifyPublicCharacterizationOverlap } from "./public-overlap-proof";

test("rechecks exact ephemeral public characterization overlap", async () => {
  await verifyPublicCharacterizationOverlap();
});
