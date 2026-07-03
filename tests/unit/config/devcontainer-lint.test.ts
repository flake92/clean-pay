import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("devcontainer mock lint configuration", () => {
  it("lints devcontainer JavaScript mocks instead of hiding them behind a broad ignore", () => {
    const config = readFileSync("eslint.config.mjs", "utf8");

    expect(config).toContain('files: [".devcontainer/**/*.js"]');
    expect(config).toContain('sourceType: "commonjs"');
    expect(config).toContain('require: "readonly"');
    expect(config).toContain('"@typescript-eslint/no-require-imports": "off"');
    expect(config).not.toContain('".devcontainer/**/*.js",');
  });
});
