import type { Prisma } from "@prisma/client";
import { prisma } from "@/backend/database/prisma";

type AuditEvent = {
  action: string;
  userId: string | null;
  severity: "INFO" | "WARN" | "ERROR";
  ipHash: string | null;
  metadata?: Record<string, unknown>;
};

export const prismaAuditEventRepository = {
  async append(event: AuditEvent) {
    await prisma.auditLog.createMany({
      data: {
        userId: event.userId,
        action: event.action,
        severity: event.severity,
        ipHash: event.ipHash,
        metadata: event.metadata as Prisma.InputJsonValue | undefined,
      },
      // createMany intentionally emits no RETURNING clause. The production
      // role can append audit rows without receiving private audit payloads.
    });
  },
};
