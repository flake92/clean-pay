import { execFileSync } from "node:child_process";

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
});
