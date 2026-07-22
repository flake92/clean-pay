#!/usr/bin/env node

import { writeFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { deployLog } from "./deploy-log.mjs";
import { retentionPolicy, runRetentionCleanup } from "./retention-cleanup.mjs";

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const intervalSeconds = boundedInteger(
  "DATA_RETENTION_INTERVAL_SECONDS",
  21_600,
  300,
  86_400,
);
const heartbeatFile = "/tmp/clean-pay-retention-heartbeat";
const policy = retentionPolicy();
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: ["error"],
});

deployLog("info", "retention_worker_started", "Data retention worker started.", {
  intervalSeconds,
});

try {
  while (true) {
    const startedAt = Date.now();

    try {
      const counts = await runRetentionCleanup(prisma, policy);
      deployLog("info", "retention_cleanup_completed", "Data retention cleanup completed.", counts);
      writeFileSync(heartbeatFile, String(Date.now()), { encoding: "utf8" });
    } catch (error) {
      deployLog("error", "retention_cleanup_failed", "Data retention cleanup failed; it will be retried on the next interval.", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }

    const remainingMs = Math.max(
      1_000,
      intervalSeconds * 1_000 - (Date.now() - startedAt),
    );
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }
} finally {
  await prisma.$disconnect();
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
