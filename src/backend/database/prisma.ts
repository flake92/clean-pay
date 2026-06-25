import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { getEnv } from "@/backend/config/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const adapter = new PrismaPg({ connectionString: getEnv().databaseUrl });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    {
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    },
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
