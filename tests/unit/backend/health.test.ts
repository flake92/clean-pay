import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn() },
  redisCommand: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/cache/redis", () => ({
  redisCommand: mocks.redisCommand,
}));

import { aggregateStatus, checkDatabase, checkRedis, checkRemnashop } from "@/backend/health/checks";

describe("health checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("aggregates degraded and ok statuses", () => {
    expect(aggregateStatus({ db: { status: "ok", latencyMs: 1 }, redis: { status: "ok", latencyMs: 1 } })).toBe("ok");
    expect(aggregateStatus({ db: { status: "ok", latencyMs: 1 }, redis: { status: "down", latencyMs: 1 } })).toBe(
      "degraded",
    );
  });

  it("checks database and redis", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mocks.redisCommand.mockResolvedValue("PONG");

    await expect(checkDatabase()).resolves.toMatchObject({ status: "ok" });
    await expect(checkRedis()).resolves.toMatchObject({ status: "ok" });

    mocks.redisCommand.mockResolvedValueOnce("NOPE");
    await expect(checkRedis()).resolves.toMatchObject({ status: "down", message: "Redis did not return PONG" });
  });

  it("checks Remnashop availability", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(checkRemnashop()).resolves.toMatchObject({ status: "ok" });
    expect(globalThis.fetch).toHaveBeenCalledWith("http://remnashop:5000/api/v1/public/plans/public", {
      cache: "no-store",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(checkRemnashop()).resolves.toMatchObject({ status: "down", message: "Remnashop returned 503" });
  });
});
