import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { getEnv } from "@/backend/config/env";
import { logger, sanitizeLogValue } from "@/backend/observability/logger";
import { prismaAuditEventRepository } from "@/backend/integrations/observability/prisma-audit-event-repository";
import type { ServiceError } from "@/backend/errors/service-error";

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

  return sanitizeValue(metadata);
}

export function getTrustedClientIp(
  requestHeaders: Headers,
  trustedProxyHops: number,
) {
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 1) {
    return null;
  }

  const addresses = (requestHeaders.get("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const clientIndex = addresses.length - trustedProxyHops;

  return clientIndex >= 0 ? addresses[clientIndex] ?? null : null;
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

    await prismaAuditEventRepository.append({
      userId: userId ?? null,
      action,
      severity,
      ipHash: hashIp(
        getTrustedClientIp(requestHeaders, getEnv().trustedProxyHops),
      ),
      metadata: sanitized as Record<string, unknown> | undefined,
    });
  } catch (error) {
    logger.error("audit_write_failed", {
      action,
      error: error instanceof Error ? error.message : String(error),
    }, { category: "audit" });
  }
}

export function logTechnicalError(event: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const serviceError = error as Partial<ServiceError>;
  const safeMetadata = technicalMetadata(metadata);

  logger.error(event, {
    code: typeof serviceError.code === "string" ? serviceError.code : undefined,
    status: typeof serviceError.status === "number" ? serviceError.status : undefined,
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
