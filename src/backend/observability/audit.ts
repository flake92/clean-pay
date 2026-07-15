import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { getEnv } from "@/backend/config/env";
import { logger, sanitizeLogValue } from "@/backend/observability/logger";
import { prisma } from "@/backend/database/prisma";
import type { BffError } from "@/backend/integrations/remnashop/errors";

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

function isProductionLog() {
  return process.env.NODE_ENV === "production";
}

function technicalMetadata(metadata: Record<string, unknown>) {
  if (isProductionLog()) {
    return undefined;
  }

  return sanitizeValue(metadata) as Prisma.InputJsonValue;
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
  const safeMetadata = technicalMetadata(metadata);

  logger.error(event, {
    code: typeof bffError.code === "string" ? bffError.code : undefined,
    status: typeof bffError.status === "number" ? bffError.status : undefined,
    message: isProductionLog() ? undefined : error instanceof Error ? error.message : String(error),
    ...(safeMetadata === undefined ? {} : { metadata: safeMetadata }),
  }, { category: "technical" });
}

export function logTechnicalWarning(event: string, metadata: Record<string, unknown> = {}) {
  const safeMetadata = technicalMetadata(metadata);

  logger.warn(event, safeMetadata === undefined ? {} : { metadata: safeMetadata }, { category: "technical" });
}

export function logTechnicalInfo(event: string, metadata: Record<string, unknown> = {}) {
  const safeMetadata = technicalMetadata(metadata);

  logger.info(event, safeMetadata === undefined ? {} : { metadata: safeMetadata }, { category: "technical" });
}
