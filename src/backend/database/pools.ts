import type { Pool } from "pg";

import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";
import {
  createPostgresPool,
  postgresPoolMetrics,
} from "../../../runtime/database-pool.mjs";

type DatabasePoolGlobals = typeof globalThis & {
  cleanPayApplicationDatabasePool?: Pool;
  cleanPayReadinessDatabasePool?: Pool;
};

const databasePoolGlobals = globalThis as DatabasePoolGlobals;

function sharedPool(
  key: "cleanPayApplicationDatabasePool" | "cleanPayReadinessDatabasePool",
  role: "application" | "readiness",
) {
  const existing = databasePoolGlobals[key];
  if (existing) return existing;

  const pool = createPostgresPool({
    connectionString: getEnv().databaseUrl,
    role,
    onError(metadata: Record<string, unknown>) {
      logger.error(
        "database_pool_error",
        metadata,
        { source: "database.pool" },
      );
    },
  });
  databasePoolGlobals[key] = pool;
  return pool;
}

export function getApplicationDatabasePool() {
  return sharedPool("cleanPayApplicationDatabasePool", "application");
}

export function getReadinessDatabasePool() {
  return sharedPool("cleanPayReadinessDatabasePool", "readiness");
}

export function runtimeDatabasePoolMetrics() {
  return [
    postgresPoolMetrics(getApplicationDatabasePool(), "application"),
    postgresPoolMetrics(getReadinessDatabasePool(), "readiness"),
  ];
}
