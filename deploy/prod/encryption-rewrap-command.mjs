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
import { validateProductionApplicationRoleEnvironment } from "./production-env-rules.mjs";
import {
  encryptionKeyringFromEnvironment,
  runEncryptionRewrap,
} from "./encryption-rewrap.mjs";

function canonicalInteger(argument, name, minimum, maximum) {
  const value = argument.slice(name.length + 1);
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be a canonical integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseEncryptionRewrapArguments(arguments_) {
  const options = {
    apply: false,
    retirementCheck: false,
    batchSize: 100,
    maxBatches: 10,
  };
  let selectedMode = false;
  for (const argument of arguments_) {
    if (["--dry-run", "--report"].includes(argument)) {
      if (selectedMode) throw new Error("Select exactly one rewrap mode");
      selectedMode = true;
      options.apply = false;
      options.retirementCheck = false;
    } else if (argument === "--retirement-check") {
      if (selectedMode) throw new Error("Select exactly one rewrap mode");
      selectedMode = true;
      options.apply = false;
      options.retirementCheck = true;
    } else if (argument === "--apply") {
      if (selectedMode) throw new Error("Select exactly one rewrap mode");
      selectedMode = true;
      options.apply = true;
      options.retirementCheck = false;
    } else if (argument.startsWith("--batch-size=")) {
      options.batchSize = canonicalInteger(argument, "--batch-size", 1, 500);
    } else if (argument.startsWith("--max-batches=")) {
      options.maxBatches = canonicalInteger(argument, "--max-batches", 1, 1_000);
    } else {
      throw new Error(`Unknown encryption rewrap argument: ${argument}`);
    }
  }
  return options;
}

export function encryptionRewrapExitCode(report, options) {
  if (report.unreadable > 0 || report.conflicts > 0) return 1;
  if (!options.retirementCheck) return 0;
  return report.complete
    && report.needsRewrap === 0
    && report.retirementReady === true
    ? 0
    : 1;
}

export function assertEncryptionRewrapRuntimeEnvironment(environment) {
  if (environment.CLEAN_PAY_RUNTIME_ROLE !== "application") {
    throw new Error("CLEAN_PAY_RUNTIME_ROLE=application is required");
  }
  validateProductionApplicationRoleEnvironment(environment);
  return environment.DATABASE_URL.trim();
}

async function main() {
  const connectionString = assertEncryptionRewrapRuntimeEnvironment(process.env);

  const options = parseEncryptionRewrapArguments(process.argv.slice(2));
  const keyring = encryptionKeyringFromEnvironment();
  const prisma = new PrismaClient({
    adapter: new PrismaPg(prismaPgPoolOptions({
      connectionString,
      role: "application",
    }), prismaPgAdapterOptions(connectionString)),
  });

  deployLog(
    "info",
    "encryption_rewrap_started",
    "Bounded encryption rewrap scan started.",
    {
      mode: options.apply
        ? "apply"
        : options.retirementCheck ? "retirement-check" : "report",
      batchSize: options.batchSize,
      maxBatches: options.maxBatches,
    },
  );

  try {
    const report = await runEncryptionRewrap(prisma, keyring, options);
    const exitCode = encryptionRewrapExitCode(report, options);
    deployLog(
      exitCode === 0 ? "info" : "warn",
      "encryption_rewrap_completed",
      "Bounded encryption rewrap scan completed.",
      report,
    );
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (error) {
    deployLog(
      "error",
      "encryption_rewrap_failed",
      "Encryption rewrap failed without logging row identifiers or key material.",
      { error: error instanceof Error ? error.name : "UnknownError" },
    );
    process.exitCode = 1;
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
      "encryption_rewrap_startup_failed",
      "Encryption rewrap could not start; no environment values were logged.",
      { error: error instanceof Error ? error.name : "UnknownError" },
    );
    process.exitCode = 1;
  }
}
