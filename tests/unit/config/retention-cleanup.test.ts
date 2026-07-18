import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  retentionPolicy,
  runRetentionCleanup,
} from "../../../deploy/prod/retention-cleanup.mjs";

function model(count: number) {
  return { deleteMany: vi.fn().mockResolvedValue({ count }) };
}

describe("production data retention", () => {
  it("uses conservative bounded defaults and rejects unsafe policy values", () => {
    expect(retentionPolicy({})).toEqual({
      authStateDays: 7,
      sessionDays: 90,
      auditInfoDays: 180,
      auditSecurityDays: 365,
      rateLimitDays: 30,
    });
    expect(() => retentionPolicy({ AUTH_STATE_RETENTION_DAYS: "0" })).toThrow(
      "AUTH_STATE_RETENTION_DAYS",
    );
    expect(() => retentionPolicy({
      AUDIT_INFO_RETENTION_DAYS: "400",
      AUDIT_SECURITY_RETENTION_DAYS: "365",
    })).toThrow("must be at least");
  });

  it("deletes only rows older than the policy cutoffs", async () => {
    const prisma = {
      webAuthnChallenge: model(1),
      telegramAuthState: model(2),
      emailVerificationCode: model(3),
      webSession: model(4),
      auditLog: model(5),
      rateLimitEvent: model(6),
    };
    const now = new Date("2026-07-18T00:00:00.000Z");

    await expect(
      runRetentionCleanup(prisma, retentionPolicy({}), now),
    ).resolves.toEqual({
      webAuthnChallenges: 1,
      telegramAuthStates: 2,
      emailVerificationCodes: 3,
      webSessions: 4,
      auditInfo: 5,
      auditSecurity: 5,
      rateLimitEvents: 6,
    });

    expect(prisma.webAuthnChallenge.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: new Date("2026-07-11T00:00:00.000Z") } },
          {
            consumedAt: {
              not: null,
              lt: new Date("2026-07-11T00:00:00.000Z"),
            },
          },
        ],
      },
    });
    expect(prisma.webSession.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            revokedAt: {
              not: null,
              lt: new Date("2026-04-19T00:00:00.000Z"),
            },
          },
          { refreshExpiresAt: { lt: new Date("2026-04-19T00:00:00.000Z") } },
        ],
      },
    });
    expect(prisma.auditLog.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        severity: "INFO",
        createdAt: { lt: new Date("2026-01-19T00:00:00.000Z") },
      },
    });
    expect(prisma.auditLog.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        severity: { in: ["WARN", "ERROR"] },
        createdAt: { lt: new Date("2025-07-18T00:00:00.000Z") },
      },
    });
  });

  it("packages and health-gates the always-on retention worker", () => {
    const prodCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
    const rootCompose = readFileSync("docker-compose.yml", "utf8");
    const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");
    const startScript = readFileSync("start.sh", "utf8");
    const rootDockerfile = readFileSync("Dockerfile", "utf8");
    const prodDockerfile = readFileSync("deploy/prod/Dockerfile", "utf8");

    for (const compose of [prodCompose, rootCompose]) {
      expect(compose).toMatch(
        /retention-worker:[\s\S]*retention-loop\.mjs[\s\S]*clean-pay-retention-heartbeat/,
      );
    }
    expect(prodCommand).toContain('composeArgs("ps", "-q", "retention-worker")');
    expect(startScript).toContain("compose ps -q retention-worker");
    expect(rootDockerfile).toContain("retention-cleanup.mjs");
    expect(prodDockerfile).toContain("retention-cleanup.mjs");
  });
});
