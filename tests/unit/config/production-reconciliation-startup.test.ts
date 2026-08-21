import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifyReconciliationBatchHealth,
  parseReconciliationBatch,
} from "../../../deploy/prod/reconciliation-batch.mjs";

const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");
const startScript = readFileSync("start.sh", "utf8");
const deployScript = readFileSync("deploy.sh", "utf8");
const prodCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");
const devcontainerCompose = readFileSync(".devcontainer/docker-compose.yml", "utf8");
const reconcileLoop = readFileSync("deploy/prod/reconcile-loop.mjs", "utf8");
const reconciliationService = readFileSync(
  "src/backend/integrations/payments/payment-reconciliation-service.ts",
  "utf8",
);
const rootDockerfile = readFileSync("Dockerfile", "utf8");
const emptyBacklog = {
  pending: 0,
  due: 0,
  manualRequired: 0,
  oldestAgeSeconds: 0,
  maximumAttemptCount: 0,
  totalFailureCount: 0,
};

describe("production reconciliation startup", () => {
  it("automatically activates the reconciliation profile from the validated flag", () => {
    expect(prodCommand).toContain(
      'readEnvValue("PAYMENT_RECONCILIATION_ENABLED", "true") === "true"',
    );
    expect(prodCommand).toContain('base.push("--profile", "reconciliation")');
    expect(startScript).toContain(
      'env_value PAYMENT_RECONCILIATION_ENABLED true',
    );
    expect(startScript).toContain("--profile reconciliation");
    expect(deployScript).toContain(
      "env_value PAYMENT_RECONCILIATION_ENABLED true",
    );
    expect(deployScript).toContain("--profile reconciliation");
    expect(deployScript).toContain("COMPOSE_PROJECT_NAME");
    expect(deployScript).toContain("CLEAN_PAY_EDGE_NETWORK");
    expect(deployScript).toContain("COMPOSE_FILE");
    expect(devcontainerCompose).toContain(
      'PAYMENT_RECONCILIATION_ENABLED: "false"',
    );
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
    expect(reconcileLoop).toContain("rmSync(heartbeatFile, { force: true })");
    expect(reconcileLoop).toContain("maxConsecutiveFailures");
    expect(reconcileLoop).toContain("process.exitCode = 1");
    expect(reconcileLoop).toContain("manual_operation_ids=");
    expect(reconcileLoop).toContain("history_failed=");
    expect(rootDockerfile).toContain("reconciliation-batch.mjs");
    expect(prodCompose).toContain("dockerfile: Dockerfile");
    expect(prodCompose).toContain('restart: "on-failure"');
    expect(rootCompose).toContain('restart: "on-failure"');
    expect(prodCompose).not.toContain('restart: "on-failure:');
    expect(rootCompose).not.toContain('restart: "on-failure:');
  });

  it("publishes health only for useful progress or a genuinely idle queue", () => {
    const batch = (overrides: Record<string, unknown> = {}) => parseReconciliationBatch({
      claimed: 0,
      succeeded: 0,
      inProgress: 0,
      unknown: 0,
      manualRequired: 0,
      retryReady: 0,
      failed: 0,
      manualRequiredOperationIds: [],
      history: { attempted: 0, applied: 0, completed: 0, failed: 0 },
      backlog: emptyBacklog,
      ...overrides,
    });

    expect(classifyReconciliationBatchHealth(batch())).toEqual({
      healthy: true,
      outcome: "idle",
    });
    expect(classifyReconciliationBatchHealth(batch({
      claimed: 1,
      succeeded: 1,
    }))).toEqual({ healthy: true, outcome: "progress" });
    expect(classifyReconciliationBatchHealth(batch({
      claimed: 1,
      failed: 1,
    }))).toEqual({ healthy: false, outcome: "failed" });
    expect(classifyReconciliationBatchHealth(batch({
      backlog: { ...emptyBacklog, pending: 1, due: 1 },
    }))).toEqual({ healthy: false, outcome: "no_progress" });
  });

  it("publishes no heartbeat before the first strictly valid successful batch", () => {
    const loopStart = reconcileLoop.indexOf("while (!shutdown.requested)");
    const parseSuccess = reconcileLoop.indexOf(
      "const counts = parseReconciliationBatch(await response.json())",
    );
    const firstHeartbeat = reconcileLoop.indexOf("writeHeartbeat();");

    expect(loopStart).toBeGreaterThan(0);
    expect(parseSuccess).toBeGreaterThan(loopStart);
    expect(firstHeartbeat).toBeGreaterThan(loopStart);
    expect(firstHeartbeat).toBeGreaterThan(parseSuccess);
    expect(() => parseReconciliationBatch({})).toThrow(
      "data.history must be an object",
    );
    expect(() =>
      parseReconciliationBatch({
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
        backlog: emptyBacklog,
      }),
    ).toThrow("data.history.failed");
    expect(
      parseReconciliationBatch({
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
        backlog: {
          ...emptyBacklog,
          pending: 1,
          manualRequired: 1,
        },
      }),
    ).toMatchObject({
      claimed: 1,
      manualRequiredOperationIds: ["operation-1"],
      history: { failed: 0 },
      backlog: { pending: 1, manualRequired: 1 },
    });
  });

  it("starts the worker only after the production app readiness healthcheck", () => {
    expect(prodCompose).toContain("/api/internal/health/readiness");
    expect(prodCompose).toMatch(
      /reconciliation-worker:[\s\S]*depends_on:[\s\S]*app:[\s\S]*condition: service_healthy/,
    );
  });

  it("uses an init process and a bounded graceful-stop window", () => {
    for (const compose of [prodCompose, rootCompose]) {
      const reconciliationSection =
        compose.split(/\n  reconciliation-worker:\n/)[1]?.split(/\n  retention-worker:\n/)[0] ?? "";

      expect(reconciliationSection).toContain("init: true");
      expect(reconciliationSection).toContain("stop_grace_period: 2m");
    }
    expect(reconcileLoop).toContain("createWorkerShutdownController");
    expect(reconcileLoop).toContain("AbortSignal.any([");
    expect(reconcileLoop).toContain("shutdown.signal");
    expect(reconcileLoop.indexOf("if (shutdown.requested) break;"))
      .toBeLessThan(reconcileLoop.indexOf("consecutiveFailures += 1"));
    expect(reconcileLoop).toContain("await shutdown.sleep(remainingMs)");
    expect(rootDockerfile).toContain("worker-shutdown.mjs");
  });

  it("keeps terminal manual-review operations visible in the backlog", () => {
    const manualRequiredFilter = reconciliationService.match(
      /COUNT\(\*\) FILTER \([\s\S]*?\)::int AS "manualRequired"/,
    )?.[0];

    expect(manualRequiredFilter).toContain('WHERE "status" = \'OUTCOME_UNKNOWN\'');
    expect(manualRequiredFilter).toContain('AND "reconciledAt" IS NOT NULL');
    expect(manualRequiredFilter).toContain("AND \"reconcileErrorSnapshot\" ->> 'code' = 'MANUAL_REQUIRED'");
    expect(reconciliationService.match(/"reconcileErrorSnapshot" ->> 'code' = 'MANUAL_REQUIRED'/g))
      .toHaveLength(3);
  });
});
