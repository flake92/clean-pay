import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aggregateReadinessStatus,
  measureReadinessCheck,
} from "@/application/health/readiness";

const mocks = vi.hoisted(() => ({
  readinessPrisma: { $queryRaw: vi.fn() },
  redisCommand: vi.fn(),
}));

vi.mock("@/backend/database/readiness-prisma", () => ({
  readinessPrisma: mocks.readinessPrisma,
}));

vi.mock("@/backend/cache/redis", () => ({
  redisCommand: mocks.redisCommand,
}));

import { createProductionReadinessGateway } from "@/backend/health/checks";

function measuredCheck(
  name: string,
  check: ((signal: AbortSignal) => Promise<void>) | undefined,
  deadlineSignal?: AbortSignal,
) {
  return check ? measureReadinessCheck(name, check, deadlineSignal) : Promise.resolve(null);
}

describe("health checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("aggregates degraded and ok statuses", () => {
    expect(aggregateReadinessStatus({ db: { status: "ok", latencyMs: 1 }, redis: { status: "ok", latencyMs: 1 } })).toBe("ok");
    expect(aggregateReadinessStatus({ db: { status: "ok", latencyMs: 1 }, redis: { status: "down", latencyMs: 1 } })).toBe(
      "degraded",
    );
  });

  it("checks database and redis", async () => {
    mocks.readinessPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mocks.redisCommand.mockResolvedValue("PONG");

    const gateway = createProductionReadinessGateway();
    await expect(measuredCheck("Database", gateway.checkDatabase)).resolves.toMatchObject({ status: "ok" });
    await expect(measuredCheck("Redis", gateway.checkRedis)).resolves.toMatchObject({ status: "ok" });

    mocks.redisCommand.mockResolvedValueOnce("NOPE");
    await expect(measuredCheck("Redis", gateway.checkRedis)).resolves.toMatchObject({ status: "down", message: "Redis did not return PONG" });
  });

  it("stops waiting for a hanging check with a distinct shared-deadline reason", async () => {
    const controller = new AbortController();
    mocks.readinessPrisma.$queryRaw.mockReturnValue(new Promise(() => undefined));

    const result = measuredCheck("Database", createProductionReadinessGateway().checkDatabase, controller.signal);
    controller.abort(new Error("readiness deadline"));

    await expect(result).resolves.toMatchObject({
      status: "down",
      message: "Database cancelled: readiness deadline exceeded",
    });
  });

  it("checks Remnashop availability", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 422 }));

    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({ status: "ok" });
    expect(fetch).toHaveBeenNthCalledWith(1, "http://remnashop:5000/api/v1/public/plans/public", expect.objectContaining({
      cache: "no-store",
      signal: expect.any(Object),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "http://remnashop:5000/api/v1/public/auth/email/start", expect.objectContaining({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-remnashop-auth-service-key": "auth-service-unit-7Vr3Nm8Wp2Kq5Xs9Lc4D",
      },
      body: "{}",
      cache: "no-store",
      signal: expect.any(Object),
    }));
    expect(fetch).toHaveBeenNthCalledWith(3, "http://remnashop:5000/api/v1/public/auth/identify", expect.objectContaining({
      method: "POST",
      body: "{}",
    }));
    expect(fetch).toHaveBeenNthCalledWith(4, "http://remnashop:5000/api/v1/public/auth/service-session", expect.objectContaining({
      method: "POST",
      body: "{}",
    }));

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({ status: "down", message: "Remnashop returned 503" });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "Remnashop public API returned 404; enable WEB_ENABLED=true with APP_API_KEY and APP_JWT_SECRET in Remnashop",
    });
  });

  it("cancels every unused Remnashop, Mailpit and Remnawave response body", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_MAILPIT_URL", "http://mailpit.test:8025");
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_TOKEN", "ready-token");
    const responses = [
      new Response("plans", { status: 200 }),
      new Response("email", { status: 422 }),
      new Response("identify", { status: 422 }),
      new Response("service", { status: 422 }),
      new Response("mailpit", { status: 200 }),
      new Response("remnawave", { status: 200 }),
    ];
    vi.spyOn(globalThis, "fetch");
    for (const response of responses) {
      vi.mocked(fetch).mockResolvedValueOnce(response);
    }

    const gateway = createProductionReadinessGateway();
    await expect(gateway.checkRemnashop(new AbortController().signal)).resolves.toBeUndefined();
    await expect(gateway.checkMailpit?.(new AbortController().signal)).resolves.toBeUndefined();
    await expect(gateway.checkRemnawave?.(new AbortController().signal)).resolves.toBeUndefined();

    expect(responses.every((response) => response.bodyUsed)).toBe(true);
  });

  it("cancels a failed health response before reporting its status", async () => {
    const response = new Response("unavailable", { status: 503 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);

    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "Remnashop returned 503",
    });
    expect(response.bodyUsed).toBe(true);
  });

  it("fails readiness for an incompatible Remnashop auth contract", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    fetch
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "Remnashop is incompatible: /auth/email/start is missing",
    });

    fetch
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "Remnashop rejected REMNASHOP_AUTH_SERVICE_KEY",
    });

    fetch
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 202 }));
    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "Remnashop /auth/email/start contract returned 202, expected 422",
    });

    fetch
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "Remnashop is incompatible: /auth/identify is missing",
    });

    fetch
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "Remnashop is incompatible: /auth/service-session is missing",
    });
  });

  it("reports a missing Remnashop service key before probing auth contracts", async () => {
    vi.stubEnv("REMNASHOP_AUTH_SERVICE_KEY", "");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(measuredCheck("Remnashop", createProductionReadinessGateway().checkRemnashop)).resolves.toMatchObject({
      status: "down",
      message: "REMNASHOP_AUTH_SERVICE_KEY is not configured",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unavailable and empty Telegram OIDC key sets", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const gateway = createProductionReadinessGateway();

    await expect(measuredCheck("Telegram OIDC", gateway.checkTelegramOidc)).resolves.toMatchObject({
      status: "down",
      message: "Telegram OIDC returned 503",
    });
    await expect(measuredCheck("Telegram OIDC", gateway.checkTelegramOidc)).resolves.toMatchObject({
      status: "down",
      message: "Telegram OIDC JWKS did not include keys",
    });
    await expect(measuredCheck("Telegram OIDC", gateway.checkTelegramOidc)).resolves.toMatchObject({
      status: "down",
      message: "Telegram OIDC JWKS did not include keys",
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

    const gateway = createProductionReadinessGateway();
    await expect(measuredCheck("Mailpit", gateway.checkMailpit)).resolves.toMatchObject({ status: "ok" });
    await expect(measuredCheck("Telegram OIDC", gateway.checkTelegramOidc)).resolves.toMatchObject({ status: "ok" });
    await expect(measuredCheck("Remnawave", gateway.checkRemnawave)).resolves.toMatchObject({ status: "ok" });

    expect(fetch).toHaveBeenNthCalledWith(1, new URL("http://mailpit.test:8025/api/v1/messages"), expect.objectContaining({
      cache: "no-store",
      signal: expect.any(Object),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "https://oauth.telegram.org/.well-known/jwks.json", expect.objectContaining({
      cache: "no-store",
      signal: expect.any(Object),
    }));
    expect(fetch).toHaveBeenNthCalledWith(3, new URL("http://remnawave.test:3000/api/system/metadata"), expect.objectContaining({
      headers: {
        accept: "application/json",
        authorization: "Bearer test-remnawave-token",
      },
      cache: "no-store",
      signal: expect.any(Object),
    }));
  });

  it("reports a missing Remnawave readiness token without making a request", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "");
    vi.stubEnv("REMNAWAVE_TOKEN", "");
    const fetch = vi.spyOn(globalThis, "fetch");

    const gateway = createProductionReadinessGateway();
    await expect(measuredCheck("Remnawave", gateway.checkRemnawave)).resolves.toMatchObject({
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

    const gateway = createProductionReadinessGateway();
    await expect(measuredCheck("Remnawave", gateway.checkRemnawave)).resolves.toMatchObject({ status: "ok" });
    expect(fetch).toHaveBeenCalledWith(new URL("http://remnawave.test:3000/api/system/metadata"), expect.objectContaining({
      headers: {
        accept: "application/json",
        authorization: "Bearer ready-token",
      },
      cache: "no-store",
      signal: expect.any(Object),
    }));
  });

  it("skips optional readiness checks when URLs are not configured", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_MAILPIT_URL", "");
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "");

    const gateway = createProductionReadinessGateway();
    await expect(measuredCheck("Mailpit", gateway.checkMailpit)).resolves.toBeNull();
    await expect(measuredCheck("Remnawave", gateway.checkRemnawave)).resolves.toBeNull();
  });

  it("reports optional dependency failures and persists shared readiness state", async () => {
    vi.stubEnv("CLEAN_PAY_READINESS_MAILPIT_URL", "http://mailpit.test:8025");
    vi.stubEnv("CLEAN_PAY_READINESS_REMNAWAVE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_API_BASE_URL", "http://remnawave.test:3000");
    vi.stubEnv("REMNAWAVE_TOKEN", "ready-token");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    mocks.redisCommand
      .mockResolvedValueOnce('{"status":"ok"}')
      .mockResolvedValueOnce("OK");
    const gateway = createProductionReadinessGateway();

    await expect(measuredCheck("Mailpit", gateway.checkMailpit)).resolves.toMatchObject({
      status: "down",
      message: "Mailpit returned 502",
    });
    await expect(measuredCheck("Remnawave", gateway.checkRemnawave)).resolves.toMatchObject({
      status: "down",
      message: "Remnawave returned 503",
    });
    await expect(gateway.readSharedState()).resolves.toBe('{"status":"ok"}');
    await expect(gateway.writeSharedState('{"status":"ok"}', 15)).resolves.toBeUndefined();
    expect(mocks.redisCommand).toHaveBeenNthCalledWith(1, ["GET", "clean-pay:health:readiness:v1"]);
    expect(mocks.redisCommand).toHaveBeenNthCalledWith(2, ["SET", "clean-pay:health:readiness:v1", '{"status":"ok"}', "EX", 15]);
  });
});
