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
const databasePools = readFileSync("src/backend/database/pools.ts", "utf8");
const databasePoolConfig = readFileSync("deploy/prod/database-pool.mjs", "utf8");
const readinessPrismaClient = readFileSync(
  "src/backend/database/readiness-prisma.ts",
  "utf8",
);

describe("production readiness startup gate", () => {
  it("verifies the readiness endpoint and its dependency payload", () => {
    expect(prodCommand).toContain("/api/internal/health/readiness");
    expect(prodCommand).not.toContain("const url = `http://127.0.0.1:${port}/api/health`");
    expect(prodCommand).toContain("assessReadinessResponse(response)");
    expect(prodCommand).toContain("HTTP_RESPONSE_LIMIT_BYTES = 1_048_576");
    expect(prodCommand).toContain("HTTP_REQUEST_DEADLINE_MS = 10_000");
    expect(prodCommand).toContain("bodyBytes > HTTP_RESPONSE_LIMIT_BYTES");
    expect(rootStart).toContain('/api/internal/health/readiness');
    expect(rootStart).toContain('x-clean-pay-readiness-secret');
    expect(rootStart).toContain("compose exec -T app node -e");
    expect(rootStart).toContain("process.env.READINESS_INTERNAL_SECRET");
    expect(rootStart).toContain("checks.length===0");
    expect(rootStart).not.toContain('readiness_secret=$(env_value READINESS_INTERNAL_SECRET)');
    expect(rootStart).not.toContain('x-clean-pay-readiness-secret: ${readiness_secret}');
    expect(deployScript).toContain("verify_detailed_readiness");
    expect(deployScript).toContain("checks.length===0");
    expect(deployScript).toContain("!Array.isArray(body.checks)");
    expect(deployScript).toContain("tr ';' '\\n'");
    expect(deployScript).toContain('printf \'%s\' "$csp" | grep -Fiq');
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
      status: 200,
      body: JSON.stringify({ status: "ok", checks: [{ status: "ok" }] }),
    })).toMatchObject({ ready: false });
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

  it("does not echo internal readiness details to operator output", () => {
    const sentinel = "database-secret-from-internal-readiness";
    const assessment = assessReadinessResponse({
      status: 503,
      body: JSON.stringify({
        status: "degraded",
        checks: { [sentinel]: { status: "down", message: sentinel } },
      }),
    });
    const verify = prodCommand.slice(
      prodCommand.indexOf("async function verify()"),
      prodCommand.indexOf("requireEnvFile();\nvalidateProductionEnvFile();"),
    );

    expect(assessment.reason).toContain(sentinel);
    expect(verify).not.toContain("console.log(response.body)");
    expect(verify).not.toContain("${response.body}");
    expect(verify).not.toContain("assessment.reason");
    expect(verify).toContain(
      'lastError = new Error("Detailed readiness checks have not passed")',
    );
    expect("Detailed readiness checks have not passed").not.toContain(sentinel);
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
    expect(readinessPrismaClient).toContain("getReadinessDatabasePool");
    expect(readinessPrismaClient).toContain("disposeExternalPool: true");
    expect(prismaClient).toContain("getApplicationDatabasePool");
    expect(prismaClient).toContain("disposeExternalPool: true");
    expect(databasePools).toContain('"application"');
    expect(databasePools).toContain('"readiness"');
    expect(databasePoolConfig).toMatch(
      /readiness:[\s\S]*poolMax: 1,[\s\S]*connectionTimeoutMs: 4_000,[\s\S]*queryTimeoutMs: 4_000,[\s\S]*statementTimeoutMs: 4_000,[\s\S]*idleTransactionTimeoutMs: 4_000,[\s\S]*lockTimeoutMs: 4_000/,
    );
  });
});
