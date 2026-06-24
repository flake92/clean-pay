import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { BffError } from "@/lib/remnashop/errors";

type AuditSeverity = "INFO" | "WARN" | "ERROR";

type AuditInput = {
  action: string;
  userId?: string | null;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
};

const secretKeyPattern = /(password|token|secret|cookie|authorization|code|key)/i;

function sanitizeValue(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      if (secretKeyPattern.test(key)) {
        output[key] = "[redacted]";
        continue;
      }

      const sanitized = sanitizeValue(item);

      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }

    return output;
  }

  return String(value);
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

function writeJsonLog(level: "info" | "warn" | "error", payload: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    service: "clean-pay",
    ...payload,
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
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
    writeJsonLog("error", {
      event: "audit_write_failed",
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function logTechnicalError(event: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const bffError = error as Partial<BffError>;
  const sanitized = sanitizeValue(metadata);

  writeJsonLog("error", {
    event,
    code: typeof bffError.code === "string" ? bffError.code : undefined,
    status: typeof bffError.status === "number" ? bffError.status : undefined,
    message: error instanceof Error ? error.message : String(error),
    metadata: sanitized as Prisma.InputJsonValue,
  });
}

export function logTechnicalWarning(event: string, metadata: Record<string, unknown> = {}) {
  writeJsonLog("warn", { event, metadata: sanitizeValue(metadata) });
}

export function logTechnicalInfo(event: string, metadata: Record<string, unknown> = {}) {
  writeJsonLog("info", { event, metadata: sanitizeValue(metadata) });
}
