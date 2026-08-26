#!/usr/bin/env node

import { PrismaPg } from "@prisma/adapter-pg";
import prismaClientPackage from "@prisma/client";

import { deployLog } from "./deploy-log.mjs";
import { validateProductionDatabaseRoleEnvironment } from "./production-env-rules.mjs";
import {
  createPostgresPool,
  postgresPoolMetrics,
  prismaPgAdapterOptions,
} from "./database-pool.mjs";
import {
  retentionPolicy,
  RetentionCleanupAggregateError,
  RetentionProgressError,
  retentionRetryDelayMs,
  runRetentionCleanup,
} from "./retention-cleanup.mjs";
import {
  createRetentionHeartbeat,
  RetentionHeartbeatError,
  retentionHeartbeatPolicy,
} from "./retention-heartbeat.mjs";
import { createWorkerShutdownController } from "./worker-shutdown.mjs";

const { PrismaClient } = prismaClientPackage;

const MAX_CONSECUTIVE_CLEANUP_FAILURES = 5;

if (process.env.CLEAN_PAY_RUNTIME_ROLE !== "retention") {
  throw new Error("CLEAN_PAY_RUNTIME_ROLE=retention is required");
}
validateProductionDatabaseRoleEnvironment(process.env);
const connectionString = process.env.DATABASE_URL.trim();

const heartbeatPolicy = retentionHeartbeatPolicy();
const intervalSeconds = heartbeatPolicy.intervalMs / 1_000;
const policy = retentionPolicy();
const heartbeat = createRetentionHeartbeat({
  intervalMs: heartbeatPolicy.intervalMs,
});
const retentionPool = createPostgresPool({
  connectionString,
  role: "retention",
});
const prisma = new PrismaClient({
  adapter: new PrismaPg(retentionPool, {
    ...prismaPgAdapterOptions(connectionString),
    disposeExternalPool: true,
  }),
});

deployLog("info", "retention_worker_started", "Data retention worker started.", {
  intervalSeconds,
});
const shutdown = createWorkerShutdownController({
  onSignal(signal) {
    deployLog(
      "info",
      "retention_worker_shutdown_requested",
      "Data retention worker shutdown requested; the current cleanup will finish.",
      { signal },
    );
  },
});
let consecutiveCleanupFailures = 0;
let exitAfterWorkerFailure = false;

try {
  while (!shutdown.requested) {
    const startedAt = Date.now();

    try {
      heartbeat.running();
      const counts = await runRetentionCleanup(
        prisma,
        policy,
        new Date(),
        { onProgress: () => heartbeat.progress() },
      );
      consecutiveCleanupFailures = 0;
      deployLog("info", "retention_cleanup_completed", "Data retention cleanup completed.", {
        ...counts,
        ...retentionPoolLogMetadata(),
      });
      if (counts.retentionBacklog) {
        heartbeat.sleeping(1_000);
        await shutdown.sleep(1_000);
        continue;
      }

      if (shutdown.requested) break;

      const remainingMs = Math.min(
        heartbeatPolicy.intervalMs,
        Math.max(
          1_000,
          heartbeatPolicy.intervalMs - (Date.now() - startedAt),
        ),
      );
      heartbeat.sleeping(remainingMs);
      await shutdown.sleep(remainingMs);
    } catch (error) {
      if (
        error instanceof RetentionHeartbeatError
        || error instanceof RetentionProgressError
      ) {
        deployLog(
          "error",
          "retention_heartbeat_failed",
          "Retention heartbeat reporting failed; the worker will exit for supervisor restart.",
          {
            error: error instanceof RetentionHeartbeatError
              ? "RetentionHeartbeatError"
              : "RetentionProgressError",
            supervisorRestartRequired: true,
            ...retentionPoolLogMetadata(),
          },
        );
        exitAfterWorkerFailure = true;
        break;
      }

      consecutiveCleanupFailures += 1;
      const retryDelayMs = retentionRetryDelayMs(consecutiveCleanupFailures);
      const exhausted =
        consecutiveCleanupFailures >= MAX_CONSECUTIVE_CLEANUP_FAILURES;
      const failedPhases = error instanceof RetentionCleanupAggregateError
        ? error.phases
        : ["cleanup"];
      deployLog("error", "retention_cleanup_failed", exhausted
        ? "Data retention cleanup repeatedly failed; the worker will exit for supervisor restart."
        : "Data retention cleanup failed; the worker will retry with bounded backoff.", {
        error: error instanceof RetentionCleanupAggregateError
          ? "RetentionCleanupAggregateError"
          : "RetentionCleanupError",
        failedPhases,
        consecutiveFailures: consecutiveCleanupFailures,
        retryDelayMs: exhausted ? 0 : retryDelayMs,
        supervisorRestartRequired: exhausted,
        ...retentionPoolLogMetadata(),
      });
      if (exhausted) {
        exitAfterWorkerFailure = true;
        break;
      }
      await shutdown.sleep(retryDelayMs);
      continue;
    }
  }
} finally {
  try {
    await prisma.$disconnect();
    deployLog(
      "info",
      "retention_worker_stopped",
      "Data retention worker stopped after disconnecting from the database.",
      { signal: shutdown.requestedSignal },
    );
  } finally {
    shutdown.dispose();
  }
}

if (exitAfterWorkerFailure) {
  process.exitCode = 1;
}

function retentionPoolLogMetadata() {
  const snapshot = postgresPoolMetrics(retentionPool, "retention");
  return {
    database_pool_active: snapshot.active,
    database_pool_idle: snapshot.idle,
    database_pool_waiting: snapshot.waiting,
    database_pool_maximum: snapshot.maximum,
    database_pool_exhausted: snapshot.exhausted,
  };
}
