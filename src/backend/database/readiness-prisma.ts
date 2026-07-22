import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { getEnv } from "@/backend/config/env";

const globalForReadinessPrisma = globalThis as unknown as {
  readinessPrisma?: PrismaClient;
};

export const readinessDatabaseTimeoutMs = 4_000;

const readinessAdapter = new PrismaPg({
  connectionString: getEnv().databaseUrl,
  max: 1,
  connectionTimeoutMillis: readinessDatabaseTimeoutMs,
  query_timeout: readinessDatabaseTimeoutMs,
  statement_timeout: readinessDatabaseTimeoutMs,
});

export const readinessPrisma =
  globalForReadinessPrisma.readinessPrisma ??
  new PrismaClient({
    adapter: readinessAdapter,
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForReadinessPrisma.readinessPrisma = readinessPrisma;
}
