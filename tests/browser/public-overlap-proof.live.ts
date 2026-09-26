import { test } from "@playwright/test";

import { provePublicCharacterizationOverlap } from "./public-overlap-proof";

test("proves exact ephemeral public characterization overlap", async () => {
  await provePublicCharacterizationOverlap();
});
