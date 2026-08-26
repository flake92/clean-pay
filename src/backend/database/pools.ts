import type { Pool } from "pg";

import { getEnv } from "@/backend/config/env";
import {
  createPostgresPool,
  postgresPoolMetrics,
} from "../../../deploy/prod/database-pool.mjs";

type DatabasePoolGlobals = typeof globalThis & {
  cleanPayApplicationDatabasePool?: Pool;
  cleanPayReadinessDatabasePool?: Pool;
};

const databasePoolGlobals = globalThis as DatabasePoolGlobals;

function sharedPool(
  key: "cleanPayApplicationDatabasePool" | "cleanPayReadinessDatabasePool",
  role: "application" | "readiness",
) {
  databasePoolGlobals[key] ??= createPostgresPool({
    connectionString: getEnv().databaseUrl,
    role,
  });
  return databasePoolGlobals[key];
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
