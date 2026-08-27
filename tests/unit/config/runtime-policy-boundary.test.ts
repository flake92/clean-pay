import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("neutral runtime policy boundary", () => {
  it("keeps deployment entrypoint module paths as compatibility re-exports", () => {
    expect(readFileSync("deploy/prod/database-pool.mjs", "utf8").trim()).toBe(
      'export * from "../../runtime/database-pool.mjs";',
    );
    expect(
      readFileSync("deploy/prod/production-env-rules.mjs", "utf8").trim(),
    ).toBe('export * from "../../runtime/production-env-rules.mjs";');
  });

  it("preserves every public deploy export by identity", async () => {
    const [deployPool, runtimePool, deployEnvironment, runtimeEnvironment] =
      await Promise.all([
        import("../../../deploy/prod/database-pool.mjs"),
        import("../../../runtime/database-pool.mjs"),
        import("../../../deploy/prod/production-env-rules.mjs"),
        import("../../../runtime/production-env-rules.mjs"),
      ]);

    for (const [deployModule, runtimeModule] of [
      [deployPool, runtimePool],
      [deployEnvironment, runtimeEnvironment],
    ] as const) {
      expect(Object.keys(deployModule).sort()).toEqual(
        Object.keys(runtimeModule).sort(),
      );
      for (const name of Object.keys(runtimeModule)) {
        expect(
          (deployModule as Record<string, unknown>)[name],
          name,
        ).toBe((runtimeModule as Record<string, unknown>)[name]);
      }
    }
  });
});
