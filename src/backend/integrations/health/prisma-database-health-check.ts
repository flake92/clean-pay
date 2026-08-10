import { readinessPrisma } from "@/backend/database/readiness-prisma";
export const prismaDatabaseHealthCheck = {
  async ping() { await readinessPrisma.$queryRaw`SELECT 1`; },
};
