import { existsSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const allowedRootFiles = [
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
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
  "postcss.config.mjs",
  "prisma.config.ts",
  "README.md",
  "README.ru_RU.md",
  "start.sh",
  "tsconfig.json",
].sort();

describe("repository root layout", () => {
  it("contains only documented root-level entry and environment files", () => {
    const rootFiles = readdirSync(".", { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((file) => (
        file !== "next-env.d.ts"
        && !file.endsWith(".tsbuildinfo")
        && (file === ".env.example" || !file.startsWith(".env."))
        && file !== ".env"
      ))
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
