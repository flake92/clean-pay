#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseDatabaseRoleConfiguration,
  runDatabaseRoleProvisioning,
} from "./database-role-provision.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const prismaCli = fileURLToPath(
  new URL("../../node_modules/prisma/build/index.js", import.meta.url),
);

export function createPrismaMigrationStatusEnvironment(environment = process.env) {
  const configuration = parseDatabaseRoleConfiguration(environment);
  return Object.freeze({
    DATABASE_URL: configuration.bootstrap.raw,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
  });
}

export async function proveNoPendingPrismaMigrations({
  environment = process.env,
  execute = executePrismaMigrationStatus,
  verify = runDatabaseRoleProvisioning,
} = {}) {
  await verify({ environment, mode: "verify" });
  const childEnvironment = createPrismaMigrationStatusEnvironment(environment);
  await execute(childEnvironment);
}

function executePrismaMigrationStatus(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "status"], {
      cwd: repositoryRoot,
      env: environment,
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const forwardedSignals = ["SIGINT", "SIGTERM"];
    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    const signalHandlers = new Map(
      forwardedSignals.map((signal) => [signal, () => forward(signal)]),
    );
    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    };
    for (const [signal, handler] of signalHandlers) process.once(signal, handler);
    child.once("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Prisma migration status process could not start."));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0 && signal === null) resolve();
      else reject(new Error("Prisma migration status did not pass."));
    });
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  if (
    process.argv.length !== 4
    || process.argv[2] !== "migrate"
    || process.argv[3] !== "status"
  ) {
    process.stderr.write("Prisma migration status invocation is invalid.\n");
    process.exitCode = 1;
  } else {
    proveNoPendingPrismaMigrations().catch(() => {
      process.stderr.write("Prisma migration status verification failed.\n");
      process.exitCode = 1;
    });
  }
}
