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

import {
  aggregateStatus,
  checkDatabase,
  checkMailpit,
  checkRedis,
  checkRemnawave,
  checkRemnashop,
  checkTelegramOidc,
} from "@/backend/health/checks";

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

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(checkRemnashop()).resolves.toMatchObject({
      status: "down",
      message: "Remnashop public API returned 404; enable WEB_ENABLED=true with APP_API_KEY and APP_JWT_SECRET in Remnashop",
    });
  });

  it("checks optional Mailpit, Telegram OIDC and Remnawave readiness dependencies", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_MAILPIT_URL", "http://mailpit.test:8025");
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_TOKEN", "test-remnawave-token");

    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [{ kid: "dev" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(checkMailpit()).resolves.toMatchObject({ status: "ok" });
    await expect(checkTelegramOidc()).resolves.toMatchObject({ status: "ok" });
    await expect(checkRemnawave()).resolves.toMatchObject({ status: "ok" });

    expect(fetch).toHaveBeenNthCalledWith(1, new URL("http://mailpit.test:8025/api/v1/messages"), {
      cache: "no-store",
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "https://oauth.telegram.org/.well-known/jwks.json", {
      cache: "no-store",
    });
    expect(fetch).toHaveBeenNthCalledWith(3, new URL("http://remnawave.test:3000/api/system/metadata"), {
      headers: {
        accept: "application/json",
        authorization: "Bearer test-remnawave-token",
      },
      cache: "no-store",
    });
  });

  it("reports a missing Remnawave readiness token without making a request", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "");
    vi.stubEnv("REMNAWAVE_TOKEN", "");
    const fetch = vi.spyOn(globalThis, "fetch");

    await expect(checkRemnawave()).resolves.toMatchObject({
      status: "down",
      message: "Remnawave token is not configured",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps an existing Bearer prefix in the Remnawave readiness token", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_TOKEN", "Bearer ready-token");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(checkRemnawave()).resolves.toMatchObject({ status: "ok" });
    expect(fetch).toHaveBeenCalledWith(new URL("http://remnawave.test:3000/api/system/metadata"), {
      headers: {
        accept: "application/json",
        authorization: "Bearer ready-token",
      },
      cache: "no-store",
    });
  });

  it("skips optional readiness checks when URLs are not configured", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_MAILPIT_URL", "");
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "");

    await expect(checkMailpit()).resolves.toBeNull();
    await expect(checkRemnawave()).resolves.toBeNull();
  });
});
