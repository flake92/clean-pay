import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { getEnv } from "@/backend/config/env";
import { getApplicationDatabasePool } from "@/backend/database/pools";
import { prismaPgAdapterOptions } from "../../../deploy/prod/database-pool.mjs";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

let processPrisma: PrismaClient | undefined;

export function getPrismaClient() {
  processPrisma ??= globalForPrisma.prisma;
  if (!processPrisma) {
    const connectionString = getEnv().databaseUrl;
    const adapter = new PrismaPg(getApplicationDatabasePool(), {
      ...prismaPgAdapterOptions(connectionString),
      disposeExternalPool: true,
    });
    processPrisma = new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    });
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = processPrisma;
    }
  }
  return processPrisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});
