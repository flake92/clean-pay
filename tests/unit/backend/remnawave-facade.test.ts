import { describe, expect, it } from "vitest";

import * as remnawave from "@/backend/integrations/remnawave/client";

describe("Remnawave client facade", () => {
  it("preserves the exact runtime export surface", () => {
    expect(Object.keys(remnawave).sort()).toEqual([
      "assertRemnawaveIdentitySynchronizationConfigured",
      "getLiveRemnawaveSubscriptionUrl",
      "synchronizeRemnawaveUserIdentity",
    ]);
  });
});
