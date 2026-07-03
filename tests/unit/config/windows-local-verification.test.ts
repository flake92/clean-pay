import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Windows local verification guardrails", () => {
  it("keeps local check scripts free of POSIX-only env assignments", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toBe("node scripts/next-command.mjs dev");
    expect(packageJson.scripts.build).toBe("node scripts/next-command.mjs build");

    for (const [name, script] of Object.entries(packageJson.scripts)) {
      expect(script, `script ${name} should not use POSIX-only inline env`).not.toMatch(
        /(^|\s)[A-Z][A-Z0-9_]*=/,
      );
    }
  });

  it("documents Linux as the runtime target without adding a Windows setup guide to public READMEs", () => {
    const english = readFileSync("README.md", "utf8");
    const russian = readFileSync("README.ru_RU.md", "utf8");
    const combined = `${english}\n${russian}`;

    expect(combined).toContain("Linux");
    expect(combined).not.toMatch(/\b(Windows|PowerShell|cmd\.exe|WSL)\b/i);
  });

  it("uses shell-free Node wrappers for production and Next verification commands", () => {
    const prodHelper = readFileSync("deploy/prod/prod.mjs", "utf8");
    const nextCommand = readFileSync("scripts/next-command.mjs", "utf8");

    expect(prodHelper).toContain("shell: false");
    expect(nextCommand).toContain("shell: false");
    expect(nextCommand).toContain('WATCHPACK_POLLING: "true"');
    expect(nextCommand).toContain('NODE_ENV: "production"');
  });
});
