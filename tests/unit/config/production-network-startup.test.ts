import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("production Docker network startup", () => {
  it("checks and creates the configured Remnawave edge network before compose up", () => {
    const source = readFileSync("deploy/prod/prod.mjs", "utf8");
    const upCase = source.slice(source.indexOf('case "up":'), source.indexOf('case "down":'));

    expect(source).toContain("validateProductionEnvFile");
    expect(source).toContain('readEnvValue("CLEAN_PAY_EDGE_NETWORK", "remnawave-network")');
    expect(source).toContain('"network", "inspect", networkName');
    expect(source).toContain('"network", "create", networkName');
    expect(upCase.indexOf("ensureEdgeNetwork();")).toBeGreaterThanOrEqual(0);
    expect(upCase.indexOf("composeArgs(\"up\", \"-d\", \"--build\")")).toBeGreaterThan(
      upCase.indexOf("ensureEdgeNetwork();"),
    );
  });

  it("documents a single production startup command without manual network creation", () => {
    const english = readFileSync("README.md", "utf8");
    const russian = readFileSync("README.ru_RU.md", "utf8");

    expect(english).toContain("node deploy/prod/prod.mjs up");
    expect(russian).toContain("node deploy/prod/prod.mjs up");
    expect(english).not.toContain("docker network create remnawave-network");
    expect(russian).not.toContain("docker network create remnawave-network");
  });
});
