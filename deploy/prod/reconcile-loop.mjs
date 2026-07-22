#!/usr/bin/env node

import { writeFileSync } from "node:fs";

import { deployLog } from "./deploy-log.mjs";
import { parseReconciliationBatch } from "./reconciliation-batch.mjs";

const enabled = process.env.PAYMENT_RECONCILIATION_ENABLED === "true";

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
const heartbeatFile = "/tmp/clean-pay-reconciliation-heartbeat";

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

while (true) {
  const startedAt = Date.now();

  try {
    const response = await fetch(parsedEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-clean-pay-reconciliation-secret": secret,
      },
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      await response.body?.cancel();
      deployLog("warn", "reconciliation_batch_rejected", "Payment reconciliation endpoint returned an unsuccessful response.", {
        status: response.status,
      });
    } else {
      const counts = parseReconciliationBatch(await response.json());
      const manualOperationIds = counts.manualRequiredOperationIds.join(",");
      const history = counts.history;
      deployLog("info", "reconciliation_batch_completed", `Payment reconciliation batch completed: manual_operation_ids=${manualOperationIds || "none"}, history_failed=${history.failed}.`, {
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
      });
      writeHeartbeat();
    }
  } catch (error) {
    deployLog("error", "reconciliation_batch_failed", "Payment reconciliation batch failed; it will be retried on the next interval.", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }

  const remainingMs = Math.max(
    1_000,
    intervalSeconds * 1_000 - (Date.now() - startedAt),
  );
  await new Promise((resolve) => setTimeout(resolve, remainingMs));
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
