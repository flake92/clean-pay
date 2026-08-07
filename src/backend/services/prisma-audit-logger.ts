import { prisma } from "@/backend/database/prisma";
import type { AuditLogInput, AuditLogger } from "@/backend/services/audit-logger";

export const prismaAuditLogger: AuditLogger = {
  async log(input: AuditLogInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        userId: input.userId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (input.metadata as any) ?? undefined,
      },
    });
  },
};
