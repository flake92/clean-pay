#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  prismaPgAdapterOptions,
  prismaPgPoolOptions,
} from "./database-pool.mjs";
import { deployLog } from "./deploy-log.mjs";
import { validateProductionDatabaseRoleEnvironment } from "./production-env-rules.mjs";
import {
  disposePaymentRetentionHold,
  placePaymentRetentionHold,
  releasePaymentRetentionHold,
} from "./payment-retention-hold.mjs";

const MAX_REQUEST_BYTES = 16 * 1_024;

export function assertPaymentRetentionHoldRuntimeEnvironment(environment) {
  if (environment.CLEAN_PAY_RUNTIME_ROLE !== "hold-operator") {
    throw new Error("CLEAN_PAY_RUNTIME_ROLE=hold-operator is required");
  }
  validateProductionDatabaseRoleEnvironment(environment);
  return environment.DATABASE_URL.trim();
}

export async function readBoundedJson(stream) {
  let contents = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    contents += chunk;
    if (Buffer.byteLength(contents, "utf8") > MAX_REQUEST_BYTES) {
      throw new Error("Retention hold request exceeds 16 KiB");
    }
  }
  const parsed = JSON.parse(contents);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Retention hold request must be a JSON object");
  }
  return parsed;
}

async function main() {
  const connectionString = assertPaymentRetentionHoldRuntimeEnvironment(process.env);
  if (process.argv.length !== 2 || process.stdin.isTTY) {
    throw new Error("Provide one hold/release/dispose JSON request on standard input");
  }
  const request = await readBoundedJson(process.stdin);
  if (!["hold", "release", "dispose"].includes(request.action)) {
    throw new Error("action must be hold, release, or dispose");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      prismaPgPoolOptions({ connectionString, role: "holdOperator" }),
      prismaPgAdapterOptions(connectionString),
    ),
  });
  deployLog(
    "info",
    "payment_retention_hold_started",
    "Payment retention hold workflow started from bounded standard input.",
    { action: request.action },
  );
  try {
    if (request.action === "hold") {
      await placePaymentRetentionHold(prisma, request);
    } else if (request.action === "release") {
      await releasePaymentRetentionHold(prisma, request);
    } else {
      await disposePaymentRetentionHold(prisma, request);
    }
    deployLog(
      "info",
      "payment_retention_hold_completed",
      "Payment retention hold lifecycle action completed without logging case identifiers.",
      { action: request.action },
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    deployLog(
      "error",
      "payment_retention_hold_failed",
      "Payment retention hold workflow failed without logging request contents.",
      { error: error instanceof Error ? error.name : "UnknownError" },
    );
    process.exitCode = 1;
  }
}
