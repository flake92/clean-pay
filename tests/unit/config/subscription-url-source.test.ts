import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("subscription connection URL source", () => {
  it("requires the current subscription route to use only the Remnawave URL", () => {
    const source = readFileSync("src/app/api/bff/subscription/current/route.ts", "utf8");

    expect(source).toContain("getLiveRemnawaveSubscriptionUrl");
    expect(source).toContain('"SUBSCRIPTION_URL_UNAVAILABLE"');
    expect(source).not.toContain("liveUrl ?? subscription.url");
    expect(source).not.toContain("subscription.url ?? liveUrl");
    expect(source).not.toContain("url: subscription.url");
    expect(source).toContain("url: liveUrl");
  });
});
