import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const runner = readFileSync("scripts/e2e-devcontainer.mjs", "utf8");

describe("devcontainer e2e runner readiness", () => {
  it("allows slow dependency installation without waiting forever", () => {
    expect(runner).toContain("seq 1 120");
    expect(runner).toContain("sleep 1");
    expect(runner).toContain("Timed out waiting 120 seconds");
    expect(runner).not.toContain("seq 1 100");
    expect(runner).not.toContain("sleep 0.1");
  });

  it("retries transient devcontainer image build failures with a bound", () => {
    expect(runner).toContain("runWithRetries(");
    expect(runner).toContain('label: "Devcontainer image build/start"');
    expect(runner).toContain("attempts: 3");
    expect(runner).toContain("attempt * 2_000");
  });
});
