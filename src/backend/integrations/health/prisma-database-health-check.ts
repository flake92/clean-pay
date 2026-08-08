import type { DatabaseHealthCheck } from "@/backend/application/health/ports/database-health-check";
import { readinessPrisma } from "@/backend/database/readiness-prisma";
export const prismaDatabaseHealthCheck: DatabaseHealthCheck = {
  async ping() { await readinessPrisma.$queryRaw`SELECT 1`; },
};
