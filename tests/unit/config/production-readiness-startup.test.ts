import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessReadinessResponse } from "../../../deploy/prod/readiness.mjs";

const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const deployScript = readFileSync("deploy.sh", "utf8");
const prodCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");
const devcontainerCompose = readFileSync(".devcontainer/docker-compose.yml", "utf8");
const prismaClient = readFileSync("src/backend/database/prisma.ts", "utf8");
const readinessPrismaClient = readFileSync(
  "src/backend/database/readiness-prisma.ts",
  "utf8",
);

describe("production readiness startup gate", () => {
  it("verifies the readiness endpoint and its dependency payload", () => {
    expect(prodCommand).toContain("/api/internal/health/readiness");
    expect(prodCommand).not.toContain("const url = `http://127.0.0.1:${port}/api/health`");
    expect(prodCommand).toContain("assessReadinessResponse(response)");
    expect(rootStart).toContain('/api/internal/health/readiness');
    expect(rootStart).toContain('x-clean-pay-readiness-secret');
    expect(deployScript).toContain("verify_detailed_readiness");
    expect(deployScript).toContain("Object.entries(body.checks||{})");
    const install = deployScript.slice(
      deployScript.indexOf("install_services() {"),
      deployScript.indexOf("up() {"),
    );
    expect(install.indexOf("verify_detailed_readiness\n  verify_external_security_headers"))
      .toBeGreaterThan(install.indexOf("start_verified_runtimes"));
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
      /case "up":[\s\S]*prepareDeploymentImages\(\)[\s\S]*preflightDeploymentImages\(\)[\s\S]*stopRuntimeServices\(\)[\s\S]*runVerifiedMigration\(\)[\s\S]*startVerifiedRuntimes\(\)[\s\S]*await verify\(\)/,
    );
    expect(rootStart).toMatch(
      /sh "\$REMNASHOP_ROLLOUT_SCRIPT" "\$ENV_FILE" check[\s\S]*prepare_images\s+preflight_images\s+prepare_runtime_dependencies\s+stop_runtime_services[\s\S]*run_verified_migration\s+start_verified_runtimes[\s\S]*verify[\s\S]*sh "\$REMNASHOP_ROLLOUT_SCRIPT" "\$ENV_FILE" finalize[\s\S]*info "started/,
    );
  });

  it("keeps container health on core dependencies while retaining detailed diagnostics", () => {
    for (const compose of [prodCompose, rootCompose, devcontainerCompose]) {
      expect(compose).toContain("/api/internal/health/readiness");
      expect(compose).toContain("AbortSignal.timeout(10000)");
      expect(compose).toContain("x-clean-pay-readiness-secret");
      expect(compose).toContain("b.checks.database?.status!=='ok'");
      expect(compose).toContain("b.checks.redis?.status!=='ok'");
      expect(compose).not.toContain("Object.values(b.checks).some(c=>c.status!=='ok')");
      expect(compose).toContain("timeout: 12s");
    }

    for (const compose of [prodCompose, rootCompose]) {
      expect(compose).toContain("interval: 10s");
      expect(compose).not.toContain("start_interval:");
    }
  });

  it("bounds database connection, client-query and server-statement waits", () => {
    expect(readinessPrismaClient).toContain(
      "connectionTimeoutMillis: readinessDatabaseTimeoutMs",
    );
    expect(readinessPrismaClient).toContain(
      "query_timeout: readinessDatabaseTimeoutMs",
    );
    expect(readinessPrismaClient).toContain(
      "statement_timeout: readinessDatabaseTimeoutMs",
    );
    expect(readinessPrismaClient).toContain("max: 1");
    expect(readinessPrismaClient).toContain(
      "const readinessDatabaseTimeoutMs = 4_000",
    );
    expect(prismaClient).not.toContain("query_timeout");
  });
});
