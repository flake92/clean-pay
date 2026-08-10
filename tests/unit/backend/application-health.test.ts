import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPublicReadiness,
  resetReadinessStateForTests,
  runDetailedReadiness,
} from "@/application/health/readiness";
import type { ReadinessGateway } from "@/application/health/ports/readiness-gateway";

function gateway(overrides: Partial<ReadinessGateway> = {}): ReadinessGateway {
  return {
    checkDatabase: vi.fn(async () => undefined),
    checkRedis: vi.fn(async () => undefined),
    checkRemnashop: vi.fn(async () => undefined),
    checkTelegramOidc: vi.fn(async () => undefined),
    readSharedState: vi.fn(async () => null),
    writeSharedState: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("application readiness", () => {
  beforeEach(() => resetReadinessStateForTests());

  it("orchestrates dependency checks and shared cache through one port", async () => {
    const dependencies = gateway({
      checkMailpit: vi.fn(async () => undefined),
      checkRemnawave: vi.fn(async () => undefined),
    });

    const result = await runDetailedReadiness(dependencies);

    expect(result.status).toBe("ok");
    expect(Object.keys(result.checks)).toEqual([
      "database",
      "redis",
      "remnashop",
      "telegramOidc",
      "mailpit",
      "remnawave",
    ]);
    expect(dependencies.writeSharedState).toHaveBeenCalledWith(
      expect.stringContaining('"status":"ok"'),
      120,
    );
  });

  it("degrades when a dependency or cache write fails", async () => {
    const dependencies = gateway({
      checkDatabase: vi.fn(async () => { throw new Error("database unavailable"); }),
      writeSharedState: vi.fn(async () => { throw new Error("cache unavailable"); }),
    });

    await expect(runDetailedReadiness(dependencies)).resolves.toMatchObject({
      status: "degraded",
      checks: {
        database: { status: "down", message: "database unavailable" },
        redis: { status: "down", message: "Redis readiness cache is unavailable" },
      },
    });
  });

  it("validates cached public readiness and fails closed", async () => {
    const now = Date.parse("2026-08-09T06:00:00.000Z");
    const fresh = gateway({
      readSharedState: vi.fn(async () => JSON.stringify({
        status: "ok",
        checkedAt: "2026-08-09T05:59:30.000Z",
      })),
    });

    await expect(getPublicReadiness(fresh, now)).resolves.toEqual({
      status: "ok",
      checkedAt: "2026-08-09T05:59:30.000Z",
      stale: false,
    });

    const invalid = gateway({ readSharedState: vi.fn(async () => "not-json") });
    await expect(getPublicReadiness(invalid, now)).resolves.toEqual({
      status: "degraded",
      checkedAt: null,
      stale: true,
    });
  });

  it("serves a fresh process-local readiness snapshot without opening Redis", async () => {
    const dependencies = gateway();
    const detailed = await runDetailedReadiness(dependencies);
    const readSharedState = vi.fn(async () => {
      throw new Error("Redis should not be read for a fresh local snapshot");
    });

    await expect(getPublicReadiness({ readSharedState }, Date.parse(detailed.checkedAt) + 1_000))
      .resolves.toEqual({
        status: "ok",
        checkedAt: detailed.checkedAt,
        stale: false,
      });
    expect(readSharedState).not.toHaveBeenCalled();
  });
});
