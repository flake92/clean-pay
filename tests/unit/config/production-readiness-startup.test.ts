import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessReadinessResponse } from "../../../deploy/prod/readiness.mjs";

const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const prodCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");

describe("production readiness startup gate", () => {
  it("verifies the readiness endpoint and its dependency payload", () => {
    expect(prodCommand).toContain("/api/health/readiness");
    expect(prodCommand).not.toContain("const url = `http://127.0.0.1:${port}/api/health`");
    expect(prodCommand).toContain("assessReadinessResponse(response)");
    expect(rootStart).toContain('/api/health/readiness');
  });

  it("fails closed for malformed or degraded readiness payloads", () => {
    expect(assessReadinessResponse({ status: 200, body: "not-json" })).toMatchObject({ ready: false });
    expect(assessReadinessResponse({
      status: 503,
      body: JSON.stringify({
        status: "degraded",
        checks: { database: { status: "ok" }, redis: { status: "down" } },
      }),
    })).toMatchObject({
      ready: false,
      reason: "critical dependencies are not ready: redis",
    });
    expect(assessReadinessResponse({
      status: 200,
      body: JSON.stringify({
        status: "ok",
        checks: { database: { status: "ok" }, redis: { status: "ok" } },
      }),
    })).toMatchObject({ ready: true, reason: null });
  });

  it("does not report compose up as successful before readiness passes", () => {
    expect(prodCommand).toMatch(
      /case "up":[\s\S]*runDocker\(composeArgs\("up", "-d", "--build"\)\)[\s\S]*await verify\(\)/,
    );
    expect(rootStart).toMatch(/compose up -d --build\s+verify\s+info "started/);
  });

  it("marks the app healthy only for a fully healthy readiness response", () => {
    for (const compose of [prodCompose, rootCompose]) {
      expect(compose).toContain("/api/health/readiness");
      expect(compose).toContain("AbortSignal.timeout(4000)");
      expect(compose).toContain("b.status!=='ok'");
      expect(compose).toContain("Object.values(b.checks).some(c=>c.status!=='ok')");
    }
  });
});
