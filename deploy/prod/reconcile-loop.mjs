#!/usr/bin/env node

import { rmSync, writeFileSync } from "node:fs";

import { deployLog } from "./deploy-log.mjs";
import {
  classifyReconciliationBatchHealth,
  parseReconciliationBatch,
} from "./reconciliation-batch.mjs";
import { createWorkerShutdownController } from "./worker-shutdown.mjs";

const enabled = process.env.PAYMENT_RECONCILIATION_ENABLED === "true";
const heartbeatFile = "/tmp/clean-pay-reconciliation-heartbeat";
const maxConsecutiveFailures = 5;

rmSync(heartbeatFile, { force: true });

if (!enabled) {
  deployLog("info", "reconciliation_worker_disabled", "Payment reconciliation worker is disabled by configuration.");
  process.exit(0);
}

const secret = process.env.PAYMENT_RECONCILIATION_SECRET?.trim();
const intervalSeconds = boundedInteger(
  "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
  30,
  5,
  3_600,
);
const endpoint =
  process.env.PAYMENT_RECONCILIATION_INTERNAL_URL?.trim() ||
  "http://app:4000/api/internal/payments/reconcile";
if (!secret || secret.length < 32) {
  throw new Error(
    "PAYMENT_RECONCILIATION_SECRET must contain at least 32 characters",
  );
}

const parsedEndpoint = new URL(endpoint);

if (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") {
  throw new Error("PAYMENT_RECONCILIATION_INTERNAL_URL must be http(s)");
}

deployLog("info", "reconciliation_worker_started", "Payment reconciliation worker started.", {
  intervalSeconds,
  endpoint: parsedEndpoint.origin,
});

let consecutiveFailures = 0;
const shutdown = createWorkerShutdownController({
  onSignal(signal) {
    deployLog(
      "info",
      "reconciliation_worker_shutdown_requested",
      "Payment reconciliation worker shutdown requested.",
      { signal },
    );
  },
});

try {
  while (!shutdown.requested) {
    const startedAt = Date.now();
    let batchHealthy = false;

    try {
      const response = await fetch(parsedEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-clean-pay-reconciliation-secret": secret,
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(45_000),
          shutdown.signal,
        ]),
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(
          new Error(`Payment reconciliation endpoint returned HTTP ${response.status}`),
          { name: "ReconciliationHttpError" },
        );
      }

      const counts = parseReconciliationBatch(await response.json());
      const health = classifyReconciliationBatchHealth(counts);
      const manualOperationIds = counts.manualRequiredOperationIds.join(",");
      const history = counts.history;
      const backlog = counts.backlog;
      const severity = !health.healthy || backlog.manualRequired > 0 || backlog.oldestAgeSeconds > 900
        ? "warn"
        : "info";
      deployLog(severity, "reconciliation_batch_completed", `Payment reconciliation batch completed: health=${health.outcome}, manual_operation_ids=${manualOperationIds || "none"}, history_failed=${history.failed}, backlog=${backlog.pending}.`, {
        health: health.outcome,
        claimed: counts.claimed,
        succeeded: counts.succeeded,
        in_progress: counts.inProgress,
        unknown: counts.unknown,
        manual_required: counts.manualRequired,
        manual_operation_ids: manualOperationIds || "none",
        failed: counts.failed,
        history_attempted: history.attempted,
        history_applied: history.applied,
        history_completed: history.completed,
        history_failed: history.failed,
        backlog_pending: backlog.pending,
        backlog_due: backlog.due,
        backlog_manual_required: backlog.manualRequired,
        backlog_oldest_age_seconds: backlog.oldestAgeSeconds,
        backlog_maximum_attempt_count: backlog.maximumAttemptCount,
        backlog_total_failure_count: backlog.totalFailureCount,
      });

      if (!health.healthy) {
        throw Object.assign(
          new Error(`Payment reconciliation batch made no healthy progress (${health.outcome})`),
          { name: "ReconciliationBatchUnhealthy" },
        );
      }

      writeHeartbeat();
      batchHealthy = true;
    } catch (error) {
      if (shutdown.requested) {
        deployLog(
          "info",
          "reconciliation_batch_shutdown_interrupted",
          "Payment reconciliation batch interrupted by worker shutdown.",
          { signal: shutdown.requestedSignal },
        );
      } else {
        deployLog("error", "reconciliation_batch_failed", "Payment reconciliation batch failed; it will be retried on the next interval.", {
          error: error instanceof Error ? error.name : "UnknownError",
          reason: error instanceof Error ? error.message.slice(0, 240) : "unknown_failure",
        });
      }
    }

    if (shutdown.requested) break;

    if (batchHealthy) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;

      if (consecutiveFailures >= maxConsecutiveFailures) {
        deployLog("error", "reconciliation_worker_failure_limit_reached", "Payment reconciliation worker reached its consecutive failure limit and will restart.", {
          consecutive_failures: consecutiveFailures,
        });
        process.exitCode = 1;
        break;
      }
    }

    const remainingMs = Math.max(
      1_000,
      intervalSeconds * 1_000 - (Date.now() - startedAt),
    );
    await shutdown.sleep(remainingMs);
  }
} finally {
  deployLog(
    "info",
    "reconciliation_worker_stopped",
    "Payment reconciliation worker stopped.",
    { signal: shutdown.requestedSignal },
  );
  shutdown.dispose();
}

function writeHeartbeat() {
  writeFileSync(heartbeatFile, String(Date.now()), { encoding: "utf8" });
}

function boundedInteger(name, fallback, min, max) {
  const raw = process.env[name]?.trim();

  if (!raw) return fallback;

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}
