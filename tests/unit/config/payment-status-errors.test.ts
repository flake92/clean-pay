import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("payment status subscription errors", () => {
  it("does not silently convert every subscription lookup failure to null", () => {
    const source = readFileSync("src/app/api/bff/payments/status/route.ts", "utf8");

    expect(source).toContain("SUBSCRIPTION_NOT_FOUND");
    expect(source).toContain("throw error");
    expect(source).not.toContain("catch {\n      subscription = null;");
    expect(source).not.toContain("catch {\r\n      subscription = null;");
  });
});
