import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { getEnv } from "@/backend/config/env";
import { getReadinessDatabasePool } from "@/backend/database/pools";
import { prismaPgAdapterOptions } from "../../../runtime/database-pool.mjs";

const globalForReadinessPrisma = globalThis as unknown as {
  readinessPrisma?: PrismaClient;
};

let processReadinessPrisma: PrismaClient | undefined;

export function getReadinessPrismaClient() {
  processReadinessPrisma ??= globalForReadinessPrisma.readinessPrisma;
  if (!processReadinessPrisma) {
    const connectionString = getEnv().databaseUrl;
    const readinessAdapter = new PrismaPg(getReadinessDatabasePool(), {
      ...prismaPgAdapterOptions(connectionString),
      disposeExternalPool: true,
    });
    processReadinessPrisma = new PrismaClient({
      adapter: readinessAdapter,
      log: ["error"],
    });
    if (process.env.NODE_ENV !== "production") {
      globalForReadinessPrisma.readinessPrisma = processReadinessPrisma;
    }
  }
  return processReadinessPrisma;
}

export const readinessPrisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getReadinessPrismaClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});
