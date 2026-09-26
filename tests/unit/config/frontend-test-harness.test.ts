import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("frontend test harness", () => {
  it("enables React act semantics and rejects unexpected warnings and errors", () => {
    const baseConfig = readFileSync("config/vitest/base.mts", "utf8");
    const config = readFileSync("config/vitest/frontend.mts", "utf8");
    const setup = readFileSync("tests/setup/frontend.ts", "utf8");

    expect(baseConfig).toContain('path.join(projectRoot, "tests/setup/frontend.ts")');
    expect(config).toContain('path.join(projectRoot, "tests/setup/frontend.ts")');
    expect(setup).toContain('typeof document === "undefined"');
    expect(setup).toContain("IS_REACT_ACT_ENVIRONMENT = true");
    expect(setup).toContain('vi.spyOn(console, "error")');
    expect(setup).toContain('vi.spyOn(console, "warn")');
    expect(setup).toContain("Unexpected browser-test console output");
  });
});
