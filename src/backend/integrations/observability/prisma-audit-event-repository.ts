import type { Prisma } from "@prisma/client";
import type { AuditEventRepository } from "@/backend/application/observability/ports/audit-event-repository";
import { prisma } from "@/backend/database/prisma";

export const prismaAuditEventRepository: AuditEventRepository = {
  async append(event) {
    await prisma.auditLog.create({ data: {
      userId: event.userId,
      action: event.action,
      severity: event.severity,
      ipHash: event.ipHash,
      metadata: event.metadata as Prisma.InputJsonValue | undefined,
    } });
  },
};
