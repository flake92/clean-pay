import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("session service module boundaries", () => {
  it("keeps the Remnashop lifecycle facade as a persistence-free orchestrator", () => {
    const orchestrator = readFileSync(
      "src/backend/integrations/remnashop/session-token-lifecycle.ts",
      "utf8",
    );

    expect(orchestrator).toContain(
      "@/backend/integrations/remnashop/session-token-lifecycle-repository",
    );
    expect(orchestrator).toContain(
      "export async function acquireRemnashopTokensForSession",
    );
    expect(orchestrator).not.toMatch(
      /@\/backend\/database|next\/headers|next\/server|\bprisma\.|\$transaction/,
    );
  });

  it("keeps pure credential and token transitions outside persistence and web transport", () => {
    const transitionFiles = [
      "src/backend/integrations/remnashop/session-token-lifecycle-transitions.ts",
      "src/backend/integrations/sessions/web-session-transitions.ts",
    ];

    for (const file of transitionFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /@\/backend\/database|next\/headers|next\/server|\bprisma\.|\$transaction/,
      );
    }
  });
});
