import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

const allowedRootFiles = [
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".gitleaksignore",
  ".node-version",
  ".npmrc",
  ".nvmrc",
  "deploy.sh",
  "docker-compose.remnashop.yml",
  "docker-compose.yml",
  "Dockerfile",
  "eslint.config.mjs",
  "LICENSE",
  "Makefile",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "prisma.config.ts",
  "README.md",
  "README.ru_RU.md",
  "start.sh",
  "tsconfig.json",
].sort();

describe("repository root layout", () => {
  it("contains only documented root-level entry and environment files", () => {
    // Read the tracked root layout from git rather than the filesystem so that
    // ignored local artefacts (.DS_Store, editor state, build output) cannot
    // fail the assertion on a developer machine.
    const rootFiles = execFileSync("git", ["ls-files", "-z", "--", ":(exclude)*/*"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter((file) => file.length > 0)
      .sort();

    expect(rootFiles).toEqual(allowedRootFiles);
  });

  it("keeps secondary tool configurations grouped under config", () => {
    for (const config of [
      "config/typescript/typecheck.json",
      "config/vitest/base.mts",
      "config/vitest/vitest.e2e.config.mts",
      "config/vitest/vitest.integration.config.mts",
      "config/vitest/workspace.mts",
    ]) {
      expect(existsSync(config), config).toBe(true);
    }
  });
});
