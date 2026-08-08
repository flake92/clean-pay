import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function files(pattern: string) {
  return globSync(pattern).map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

describe("clean architecture boundaries", () => {
  it("keeps application use cases independent from frameworks and adapters", () => {
    for (const { file, source } of files("src/backend/application/**/*.{ts,tsx}")) {
      expect(source, file).not.toMatch(/from ["']next(?:\/|["'])/);
      expect(source, file).not.toMatch(/@\/backend\/(?:database|integrations|cache|config)\//);
      expect(source, file).not.toMatch(/@prisma\/client/);
    }
  });

  it("keeps the complete React layer free from transport and backend concerns", () => {
    for (const { file, source } of files("src/frontend/**/*.{ts,tsx}")) {
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toContain("/api/bff");
      expect(source, file).not.toMatch(/@\/backend\//);
    }
  });

  it("does not expose the removed internal browser transport", () => {
    expect(globSync("src/app/api/bff/**/route.ts")).toEqual([]);
  });

  it("keeps backend orchestration free from direct database access", () => {
    for (const pattern of [
      "src/backend/auth/**/*.{ts,tsx}",
      "src/backend/payments/**/*.{ts,tsx}",
      "src/backend/sessions/**/*.{ts,tsx}",
      "src/backend/observability/**/*.{ts,tsx}",
    ]) {
      for (const { file, source } of files(pattern)) {
        expect(source, file).not.toContain("@/backend/database/prisma");
        expect(source, file).not.toMatch(/\bprisma\./);
      }
    }
  });

  it("keeps persistence dependencies out of shared and frontend code", () => {
    for (const pattern of ["src/shared/**/*.{ts,tsx}", "src/frontend/**/*.{ts,tsx}"]) {
      for (const { file, source } of files(pattern)) {
        expect(source, file).not.toContain("@/backend/database/");
        expect(source, file).not.toContain("@prisma/client");
      }
    }
  });
});
