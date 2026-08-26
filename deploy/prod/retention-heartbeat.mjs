#!/usr/bin/env node

import {
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RETENTION_HEARTBEAT_FILE = "/tmp/clean-pay-retention-heartbeat";

const HEARTBEAT_VERSION = 1;
const HEARTBEAT_PROGRESS_WRITE_INTERVAL_MS = 1_000;
const HEARTBEAT_MARGIN_MS = 60_000;

export class RetentionHeartbeatError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RetentionHeartbeatError";
  }
}

function boundedInteger(env, name, fallback, minimum, maximum) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

/** @param {Record<string, string | undefined>} env */
export function retentionHeartbeatPolicy(env = process.env) {
  const intervalMs = boundedInteger(
    env,
    "DATA_RETENTION_INTERVAL_SECONDS",
    21_600,
    300,
    86_400,
  ) * 1_000;
  const databaseBudgetMs = Math.max(
    boundedInteger(
      env,
      "RETENTION_DATABASE_CONNECTION_TIMEOUT_MS",
      5_000,
      250,
      60_000,
    ),
    boundedInteger(
      env,
      "RETENTION_DATABASE_QUERY_TIMEOUT_MS",
      120_000,
      250,
      300_000,
    ),
    boundedInteger(
      env,
      "RETENTION_DATABASE_STATEMENT_TIMEOUT_MS",
      120_000,
      250,
      300_000,
    ),
    boundedInteger(
      env,
      "RETENTION_DATABASE_LOCK_TIMEOUT_MS",
      30_000,
      250,
      300_000,
    ),
  );

  return Object.freeze({
    intervalMs,
    runningMaxAgeMs: databaseBudgetMs + HEARTBEAT_MARGIN_MS,
    sleepingMarginMs: HEARTBEAT_MARGIN_MS,
  });
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assessRetentionHeartbeat(
  heartbeat,
  policy,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("heartbeat assessment time must be a non-negative integer");
  }
  if (
    !heartbeat
    || typeof heartbeat !== "object"
    || Array.isArray(heartbeat)
    || heartbeat.version !== HEARTBEAT_VERSION
    || !["running", "sleeping"].includes(heartbeat.state)
    || !timestamp(heartbeat.lastProgressAt)
    || (
      heartbeat.lastSuccessAt !== null
      && !timestamp(heartbeat.lastSuccessAt)
    )
  ) {
    return Object.freeze({ healthy: false, reason: "invalid heartbeat" });
  }
  if (
    heartbeat.lastProgressAt > now
    || (heartbeat.lastSuccessAt !== null && heartbeat.lastSuccessAt > now)
  ) {
    return Object.freeze({ healthy: false, reason: "future heartbeat" });
  }
  if (
    heartbeat.lastSuccessAt !== null
    && heartbeat.lastSuccessAt > heartbeat.lastProgressAt
  ) {
    return Object.freeze({ healthy: false, reason: "invalid heartbeat order" });
  }

  if (heartbeat.state === "running") {
    if (heartbeat.nextRunAt !== null) {
      return Object.freeze({ healthy: false, reason: "invalid running heartbeat" });
    }
    return Object.freeze({
      healthy: now - heartbeat.lastProgressAt <= policy.runningMaxAgeMs,
      reason: now - heartbeat.lastProgressAt <= policy.runningMaxAgeMs
        ? null
        : "retention cleanup made no progress",
    });
  }

  if (
    heartbeat.lastSuccessAt === null
    || heartbeat.lastSuccessAt !== heartbeat.lastProgressAt
    || !timestamp(heartbeat.nextRunAt)
    || heartbeat.nextRunAt <= heartbeat.lastProgressAt
    || heartbeat.nextRunAt - heartbeat.lastProgressAt > policy.intervalMs
  ) {
    return Object.freeze({ healthy: false, reason: "invalid sleeping heartbeat" });
  }
  return Object.freeze({
    healthy: now <= heartbeat.nextRunAt + policy.sleepingMarginMs,
    reason: now <= heartbeat.nextRunAt + policy.sleepingMarginMs
      ? null
      : "retention cleanup missed its next run",
  });
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The rename may already have consumed the temporary file.
    }
    throw new RetentionHeartbeatError(
      "Retention heartbeat state could not be written",
      error,
    );
  }
}

/**
 * @param {{
 *   filePath?: string,
 *   intervalMs: number,
 *   now?: () => number,
 * }} options
 */
export function createRetentionHeartbeat({
  filePath = RETENTION_HEARTBEAT_FILE,
  intervalMs,
  now = Date.now,
}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new RetentionHeartbeatError(
      "Retention heartbeat interval must be a positive integer",
    );
  }
  let lastWriteAt = null;
  let lastSuccessAt = null;

  function write(state, nextRunAt, force, sampledNow) {
    const current = sampledNow ?? now();
    if (!Number.isSafeInteger(current) || current < 0) {
      throw new RetentionHeartbeatError(
        "Retention heartbeat clock returned an invalid timestamp",
      );
    }
    if (lastWriteAt !== null && current < lastWriteAt) {
      throw new RetentionHeartbeatError(
        "Retention heartbeat clock moved backwards",
      );
    }
    if (
      !force
      && lastWriteAt !== null
      && current >= lastWriteAt
      && current - lastWriteAt < HEARTBEAT_PROGRESS_WRITE_INTERVAL_MS
    ) {
      return;
    }
    const nextSuccessAt = state === "sleeping" ? current : lastSuccessAt;
    atomicWriteJson(filePath, {
      version: HEARTBEAT_VERSION,
      state,
      lastProgressAt: current,
      lastSuccessAt: nextSuccessAt,
      nextRunAt,
    });
    lastSuccessAt = nextSuccessAt;
    lastWriteAt = current;
  }

  return Object.freeze({
    running() {
      write("running", null, true);
    },
    progress() {
      write("running", null, false);
    },
    sleeping(delayMs) {
      if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > intervalMs) {
        throw new RetentionHeartbeatError(
          "Retention heartbeat delay must fit the cleanup interval",
        );
      }
      const current = now();
      if (!Number.isSafeInteger(current) || current < 0) {
        throw new RetentionHeartbeatError(
          "Retention heartbeat clock returned an invalid timestamp",
        );
      }
      // Use the same sampled clock for both timestamps so the ordering remains
      // valid even when an injected/test clock advances on every call.
      write("sleeping", current + delayMs, true, current);
    },
  });
}

function readHeartbeat(filePath) {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function runHealthcheck() {
  const policy = retentionHeartbeatPolicy();
  const assessment = assessRetentionHeartbeat(
    readHeartbeat(RETENTION_HEARTBEAT_FILE),
    policy,
  );
  if (!assessment.healthy) throw new Error(assessment.reason);
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "check") {
      throw new Error("usage: retention-heartbeat.mjs check");
    }
    runHealthcheck();
  } catch {
    process.stderr.write("Retention heartbeat unhealthy\n");
    process.exitCode = 1;
  }
}
