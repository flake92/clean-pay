import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { getEnv } from "@/lib/env";
import { logger, sanitizeLogValue } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { BffError } from "@/lib/remnashop/errors";

type AuditSeverity = "INFO" | "WARN" | "ERROR";

type AuditInput = {
  action: string;
  userId?: string | null;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
};

function sanitizeValue(value: unknown): unknown {
  return sanitizeLogValue(value);
}

function getIpFromHeaders(requestHeaders: Headers) {
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();

  return forwardedFor || requestHeaders.get("x-real-ip") || null;
}

function hashIp(ip: string | null) {
  if (!ip) {
    return null;
  }

  return createHash("sha256")
    .update(`${getEnv().auditIpHashSecret}:${ip}`)
    .digest("hex");
}

export async function auditLog({
  action,
  userId,
  severity = "INFO",
  metadata,
}: AuditInput) {
  try {
    const requestHeaders = await headers();
    const sanitized = metadata ? sanitizeValue(metadata) : undefined;

    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        action,
        severity,
        ipHash: hashIp(getIpFromHeaders(requestHeaders)),
        metadata: sanitized as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    logger.error("audit_write_failed", {
      action,
      error: error instanceof Error ? error.message : String(error),
    }, { category: "audit" });
  }
}

export function logTechnicalError(event: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const bffError = error as Partial<BffError>;
  const sanitized = sanitizeValue(metadata);

  logger.error(event, {
    code: typeof bffError.code === "string" ? bffError.code : undefined,
    status: typeof bffError.status === "number" ? bffError.status : undefined,
    message: error instanceof Error ? error.message : String(error),
    metadata: sanitized as Prisma.InputJsonValue,
  }, { category: "technical" });
}

export function logTechnicalWarning(event: string, metadata: Record<string, unknown> = {}) {
  logger.warn(event, { metadata: sanitizeValue(metadata) as Prisma.InputJsonValue }, { category: "technical" });
}

export function logTechnicalInfo(event: string, metadata: Record<string, unknown> = {}) {
  logger.info(event, { metadata: sanitizeValue(metadata) as Prisma.InputJsonValue }, { category: "technical" });
}
