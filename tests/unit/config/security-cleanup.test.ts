import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

describe("security cleanup guardrails", () => {
  it("keeps local production env files ignored while tracking examples", () => {
    expect(git(["check-ignore", "deploy/prod/.env"])).toBe("deploy/prod/.env");
    expect(git(["check-ignore", "deploy/prod/remnashop.env"])).toBe("deploy/prod/remnashop.env");
    expect(git(["ls-files", "deploy/prod/.env.example"])).toBe("deploy/prod/.env.example");
    expect(git(["ls-files", "deploy/prod/remnashop.env.example"])).toBe("deploy/prod/remnashop.env.example");
  });

  it("keeps the pnpm release-age exclusion behind an active cooldown", () => {
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    const minimumReleaseAge = Number(
      workspace.match(/^minimumReleaseAge:\s*(\d+)$/m)?.[1] ?? 0,
    );

    expect(minimumReleaseAge).toBeGreaterThanOrEqual(1_440);
    expect(workspace).toContain("minimumReleaseAgeExclude:");
  });

  it("requires explicit review for every npm dependency install script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      allowScripts?: Record<string, boolean>;
    };
    const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { hasInstallScript?: boolean; version?: string }>;
    };
    const installScriptPackages = Object.entries(packageLock.packages)
      .filter(([packagePath, metadata]) => packagePath && metadata.hasInstallScript)
      .map(([packagePath, metadata]) => (
        `${packagePath.replace(/^.*node_modules\//, "")}@${metadata.version}`
      ))
      .sort();

    expect(readFileSync(".npmrc", "utf8")).toContain("strict-allow-scripts=true");
    expect(Object.keys(packageJson.allowScripts ?? {}).sort()).toEqual(installScriptPackages);
  });
});
