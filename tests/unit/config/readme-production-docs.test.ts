import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function envKeys() {
  return readFileSync("deploy/prod/.env.example", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0])
    .filter(Boolean);
}

describe("production README docs", () => {
  it("documents every production env example variable in both languages", () => {
    const english = readFileSync("README.md", "utf8");
    const russian = readFileSync("README.ru_RU.md", "utf8");

    for (const key of envKeys()) {
      expect(english, `README.md should document ${key}`).toContain(`\`${key}\``);
      expect(russian, `README.ru_RU.md should document ${key}`).toContain(`\`${key}\``);
    }
  });

  it("keeps startup to one production helper command and documents current hardening rules", () => {
    const english = readFileSync("README.md", "utf8");
    const russian = readFileSync("README.ru_RU.md", "utf8");
    const combined = `${english}\n${russian}`;

    expect(english).toContain("node deploy/prod/prod.mjs up");
    expect(russian).toContain("node deploy/prod/prod.mjs up");
    expect(combined).not.toMatch(/\b(npm|pnpm|yarn)\b/);
    expect(combined).not.toContain("docker network create");
    expect(combined).toContain("Linux");
    expect(combined).toContain("REMNAWAVE_API_BASE_URL");
    expect(combined).toContain("REMNAWAVE_TOKEN");
    expect(english).toContain("only from Remnawave");
    expect(russian).toContain("только из Remnawave");
    expect(english).toContain('`COOKIE_SECURE=true`');
    expect(russian).toContain('`COOKIE_SECURE=true`');
  });
});
