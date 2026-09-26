#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAXIMUM_OUTPUT_BYTES = 256 * 1024;
const EXPECTED_UNMANAGED_TABLE_DIFF = [
  "-- DropTable",
  "DROP TABLE \"_clean_pay_retention_policy\";",
  "",
].join("\n");

export function assertPrismaMigrationSchemaDiff(value) {
  if (typeof value !== "string") {
    throw new Error("Prisma migration/schema diff output is not text.");
  }
  const normalized = value.replaceAll("\r\n", "\n").replace(/\n+$/u, "\n");
  if (normalized !== EXPECTED_UNMANAGED_TABLE_DIFF) {
    throw new Error(
      "Prisma migration/schema diff escaped the exact unmanaged-table allowlist "
      + `(bytes=${Buffer.byteLength(value, "utf8")},sha256=${sha256(value)}).`,
    );
  }
  return Object.freeze({
    status: "prisma_migration_schema_drift_verified",
    unmanagedTables: Object.freeze(["_clean_pay_retention_policy"]),
  });
}

export function verifyPrismaMigrationSchemaDrift(options = {}) {
  const environment = options.environment ?? process.env;
  const run = options.run ?? spawnSync;
  if (typeof environment.DATABASE_URL !== "string" || environment.DATABASE_URL.length === 0) {
    throw new Error("DATABASE_URL is required for the Prisma migration/schema drift verifier.");
  }
  const prismaCli = fileURLToPath(new URL(
    "../../node_modules/prisma/build/index.js",
    import.meta.url,
  ));
  const result = run(process.execPath, [
    prismaCli,
    "migrate",
    "diff",
    "--from-config-datasource",
    "--to-schema",
    "prisma/schema.prisma",
    "--script",
  ], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    env: environment,
    maxBuffer: MAXIMUM_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.signal || result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    throw new Error(
      "Prisma migration/schema diff command failed "
      + `(status=${String(result.status)},signal=${String(result.signal)},`
      + `stderrBytes=${Buffer.byteLength(stderr, "utf8")},stderrSha256=${sha256(stderr)}).`,
    );
  }
  return assertPrismaMigrationSchemaDiff(result.stdout);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

if (
  process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.stdout.write(`${JSON.stringify(verifyPrismaMigrationSchemaDrift())}\n`);
}
