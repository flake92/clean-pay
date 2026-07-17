import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseReconciliationBatch } from "../../../deploy/prod/reconciliation-batch.mjs";

const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");
const startScript = readFileSync("start.sh", "utf8");
const prodCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");
const reconcileLoop = readFileSync("deploy/prod/reconcile-loop.mjs", "utf8");
const rootDockerfile = readFileSync("Dockerfile", "utf8");
const prodDockerfile = readFileSync("deploy/prod/Dockerfile", "utf8");

describe("production reconciliation startup", () => {
  it("automatically activates the reconciliation profile from the validated flag", () => {
    expect(prodCommand).toContain(
      'readEnvValue("PAYMENT_RECONCILIATION_ENABLED", "false") === "true"',
    );
    expect(prodCommand).toContain('base.push("--profile", "reconciliation")');
    expect(startScript).toContain(
      'env_value PAYMENT_RECONCILIATION_ENABLED false',
    );
    expect(startScript).toContain("--profile reconciliation");
  });

  it("fails verify and ps unless the enabled worker heartbeat is healthy", () => {
    expect(prodCommand).toContain(
      'composeArgs("ps", "-q", "reconciliation-worker")',
    );
    expect(prodCommand).toContain(
      'lastStatus === "healthy"',
    );
    expect(startScript).toContain(
      "compose ps -q reconciliation-worker",
    );
    expect(startScript).toContain(
      'last_status" = "healthy"',
    );
    expect(prodCompose).toMatch(
      /reconciliation-worker:[\s\S]*healthcheck:[\s\S]*clean-pay-reconciliation-heartbeat/,
    );
    expect(rootCompose).toMatch(
      /reconciliation-worker:[\s\S]*healthcheck:[\s\S]*clean-pay-reconciliation-heartbeat/,
    );
    expect(reconcileLoop).toContain("writeHeartbeat()");
    expect(reconcileLoop).toContain("manual_operation_ids=");
    expect(reconcileLoop).toContain("history_failed=");
    expect(rootDockerfile).toContain("reconciliation-batch.mjs");
    expect(prodDockerfile).toContain("reconciliation-batch.mjs");
  });

  it("publishes no heartbeat before the first strictly valid successful batch", () => {
    const loopStart = reconcileLoop.indexOf("while (true)");
    const parseSuccess = reconcileLoop.indexOf(
      "const counts = parseReconciliationBatch(await response.json())",
    );
    const firstHeartbeat = reconcileLoop.indexOf("writeHeartbeat();");

    expect(loopStart).toBeGreaterThan(0);
    expect(parseSuccess).toBeGreaterThan(loopStart);
    expect(firstHeartbeat).toBeGreaterThan(loopStart);
    expect(firstHeartbeat).toBeGreaterThan(parseSuccess);
    expect(() => parseReconciliationBatch({ data: {} })).toThrow(
      "data.history must be an object",
    );
    expect(() =>
      parseReconciliationBatch({
        data: {
          claimed: 1,
          succeeded: 1,
          inProgress: 0,
          unknown: 0,
          manualRequired: 0,
          retryReady: 0,
          failed: 0,
          manualRequiredOperationIds: [],
          history: {
            attempted: 0,
            applied: 0,
            completed: 0,
            // Missing history.failed means a malformed HTTP 200 is not healthy.
          },
        },
      }),
    ).toThrow("data.history.failed");
    expect(
      parseReconciliationBatch({
        data: {
          claimed: 1,
          succeeded: 0,
          inProgress: 0,
          unknown: 0,
          manualRequired: 1,
          retryReady: 0,
          failed: 0,
          manualRequiredOperationIds: ["operation-1"],
          history: {
            attempted: 1,
            applied: 10,
            completed: 1,
            failed: 0,
          },
        },
      }),
    ).toMatchObject({
      claimed: 1,
      manualRequiredOperationIds: ["operation-1"],
      history: { failed: 0 },
    });
  });

  it("starts the worker only after the production app readiness healthcheck", () => {
    expect(prodCompose).toContain("/api/health/readiness");
    expect(prodCompose).toMatch(
      /reconciliation-worker:[\s\S]*depends_on:[\s\S]*app:[\s\S]*condition: service_healthy/,
    );
  });
});
