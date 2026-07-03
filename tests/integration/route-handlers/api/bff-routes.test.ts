import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn(),
  logTechnicalError: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  loginWithEmail: vi.fn(),
  registerWithEmail: vi.fn(),
  getCurrentAuthProfile: vi.fn(),
  changePassword: vi.fn(),
  linkRemnashopAccount: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  remnashopRequest: vi.fn(),
  getLiveRemnawaveSubscriptionUrl: vi.fn(),
  assertRateLimit: vi.fn(),
  recordPayment: vi.fn(),
  getCurrentUser: vi.fn(),
  prisma: {
    paymentRecord: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  checkDatabase: vi.fn(),
  checkRedis: vi.fn(),
  checkRemnashop: vi.fn(),
  checkMailpit: vi.fn(),
  checkTelegramOidc: vi.fn(),
  checkRemnawave: vi.fn(),
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
  logTechnicalError: mocks.logTechnicalError,
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/auth/email-login", () => ({ loginWithEmail: mocks.loginWithEmail }));
vi.mock("@/backend/auth/email-register", () => ({ registerWithEmail: mocks.registerWithEmail }));
vi.mock("@/backend/auth/profile", () => ({ getCurrentAuthProfile: mocks.getCurrentAuthProfile }));
vi.mock("@/backend/auth/password", () => ({ changePassword: mocks.changePassword }));
vi.mock("@/backend/auth/remnashop-link", () => ({ linkRemnashopAccount: mocks.linkRemnashopAccount }));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  remnashopRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnawave/client", () => ({
  getLiveRemnawaveSubscriptionUrl: mocks.getLiveRemnawaveSubscriptionUrl,
}));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/payments/records", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/payments/records")>(),
  recordPayment: mocks.recordPayment,
}));
vi.mock("@/backend/sessions/web-session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/health/checks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/health/checks")>(),
  checkDatabase: mocks.checkDatabase,
  checkRedis: mocks.checkRedis,
  checkRemnashop: mocks.checkRemnashop,
  checkMailpit: mocks.checkMailpit,
  checkTelegramOidc: mocks.checkTelegramOidc,
  checkRemnawave: mocks.checkRemnawave,
}));

import * as loginRoute from "@/app/api/bff/auth/login/route";
import * as registerRoute from "@/app/api/bff/auth/register/route";
import * as meRoute from "@/app/api/bff/auth/me/route";
import * as passwordRoute from "@/app/api/bff/auth/change-password/route";
import * as linkRoute from "@/app/api/bff/link/remnashop/route";
import * as plansRoute from "@/app/api/bff/plans/public/route";
import * as currentRoute from "@/app/api/bff/subscription/current/route";
import * as devicesRoute from "@/app/api/bff/subscription/devices/route";
import * as deviceRoute from "@/app/api/bff/subscription/devices/[hwid]/route";
import * as offersRoute from "@/app/api/bff/subscription/offers/route";
import * as promocodeRoute from "@/app/api/bff/subscription/promocode/route";
import * as purchaseRoute from "@/app/api/bff/subscription/purchase/route";
import * as extendRoute from "@/app/api/bff/subscription/extend/route";
import * as reissueRoute from "@/app/api/bff/subscription/reissue/route";
import * as paymentsHistoryRoute from "@/app/api/bff/payments/history/route";
import * as paymentsStatusRoute from "@/app/api/bff/payments/status/route";
import * as supportRoute from "@/app/api/bff/support/route";
import * as readinessRoute from "@/app/api/health/readiness/route";
import { BffError } from "@/backend/integrations/remnashop/errors";

function jsonRequest(path: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(`http://clean-pay.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function body(response: Response) {
  return response.json() as Promise<unknown>;
}

const session = {
  userId: "user-1",
  user: {
    email: "user@example.com",
    telegramId: "123",
  },
};

const payment = {
  payment_id: "payment-1",
  purchase_type: "subscription",
  status: "pending",
  final_amount: "100.00",
  currency: "RUB",
  gateway_type: "YOOKASSA",
  payment_url: "https://pay.test",
  is_free: false,
};

const record = {
  id: "record-1",
  paymentId: "payment-1",
  purchaseType: "subscription",
  status: "PENDING",
  finalAmount: "100.00",
  currency: "RUB",
  gatewayType: "YOOKASSA",
  planCode: "basic",
  planName: "Basic",
  durationDays: 30,
  deviceLimit: 3,
  trafficLimit: null,
  isFree: false,
  createdAt: new Date("2026-06-25T00:00:00.000Z"),
  updatedAt: new Date("2026-06-25T01:00:00.000Z"),
};

describe("BFF route integration contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.loginWithEmail.mockResolvedValue({ user: { email: "user@example.com" } });
    mocks.registerWithEmail.mockResolvedValue({ user: { email: "user@example.com" } });
    mocks.getCurrentAuthProfile.mockResolvedValue({ user: { email: "user@example.com" } });
    mocks.changePassword.mockResolvedValue({ success: true });
    mocks.linkRemnashopAccount.mockResolvedValue({ linked: true });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token", session });
    mocks.remnashopRequest.mockResolvedValue({ ok: true });
    mocks.getLiveRemnawaveSubscriptionUrl.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.prisma.paymentRecord.findMany.mockResolvedValue([record]);
    mocks.prisma.paymentRecord.findFirst.mockResolvedValue(record);
    mocks.checkDatabase.mockResolvedValue({ status: "ok", latencyMs: 1 });
    mocks.checkRedis.mockResolvedValue({ status: "ok", latencyMs: 1 });
    mocks.checkRemnashop.mockResolvedValue({ status: "ok", latencyMs: 1 });
    mocks.checkMailpit.mockResolvedValue({ status: "ok", latencyMs: 1 });
    mocks.checkTelegramOidc.mockResolvedValue({ status: "ok", latencyMs: 1 });
    mocks.checkRemnawave.mockResolvedValue({ status: "ok", latencyMs: 1 });
  });

  it("runs auth endpoints through their backend use cases", async () => {
    const login = await loginRoute.POST(jsonRequest("/api/bff/auth/login", { email: "user@example.com", password: "secret" }, {
      "x-forwarded-for": "10.0.0.1",
    }));
    const register = await registerRoute.POST(jsonRequest("/api/bff/auth/register", { email: "user@example.com", password: "secret" }));
    const me = await meRoute.GET();
    const password = await passwordRoute.POST(jsonRequest("/api/bff/auth/change-password", {
      current_password: "old",
      new_password: "new",
    }));
    const link = await linkRoute.POST(jsonRequest("/api/bff/link/remnashop", { email: "user@example.com", password: "secret" }));

    expect(login.status).toBe(200);
    expect(register.status).toBe(201);
    expect(me.status).toBe(200);
    expect(password.status).toBe(200);
    expect(link.status).toBe(200);
    expect(mocks.loginWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" }),
      { token: null, remoteIp: "10.0.0.1" },
    );
    expect(mocks.changePassword).toHaveBeenCalledWith({ current_password: "old", new_password: "new" });
  });

  it("proxies public plans and authenticated subscription reads", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce({ plans: [] }).mockResolvedValueOnce({
      user_remna_id: "rw-1",
      url: "https://db-sub.example/old",
    });
    mocks.getLiveRemnawaveSubscriptionUrl.mockResolvedValueOnce("https://live-sub.example/fresh");

    await expect(body(await plansRoute.GET())).resolves.toEqual({ data: { plans: [] } });
    await expect(body(await currentRoute.GET())).resolves.toEqual({
      data: {
        user_remna_id: "rw-1",
        url: "https://live-sub.example/fresh",
      },
    });

    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(1, "/plans/public");
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(2, "/subscription/current", { accessToken: "access-token" });
    expect(mocks.getLiveRemnawaveSubscriptionUrl).toHaveBeenCalledWith({
      userRemnaId: "rw-1",
      email: "user@example.com",
      telegramId: "123",
    });
  });

  it("does not fall back to the Remnashop subscription URL when Remnawave has no live URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.remnashopRequest.mockResolvedValueOnce({
      user_remna_id: "rw-1",
      url: "https://db-sub.example/old",
    });
    mocks.getLiveRemnawaveSubscriptionUrl.mockResolvedValueOnce(null);

    const response = await currentRoute.GET();
    const responseBody = await body(response);

    expect(response.status).toBe(409);
    expect(responseBody).toMatchObject({
      error: {
        code: "SUBSCRIPTION_URL_UNAVAILABLE",
        message: expect.stringContaining("Ссылка подключения недоступна"),
      },
    });
    expect(JSON.stringify(responseBody)).not.toContain("db-sub.example");
  });

  it("covers subscription devices, promocode and reissue flows", async () => {
    await devicesRoute.GET();
    await devicesRoute.DELETE();
    await deviceRoute.DELETE(new Request("http://clean-pay.local"), { params: Promise.resolve({ hwid: "device/1" }) });
    await promocodeRoute.POST(jsonRequest("/api/bff/subscription/promocode", { code: "PROMO" }));
    await reissueRoute.POST();

    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/devices", { accessToken: "access-token" });
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/devices", { method: "DELETE", accessToken: "access-token" });
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/devices/device%2F1", {
      method: "DELETE",
      accessToken: "access-token",
    });
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/promocode", {
      method: "POST",
      accessToken: "access-token",
      body: { code: "PROMO" },
    });
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/reissue", { method: "POST", accessToken: "access-token" });
  });

  it("records purchase and extension payments with matched offers", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({
        plans: [{ public_code: "basic", name: "Basic", recommended_purchase_type: "new" }],
      })
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({
        plans: [{ public_code: "renew", name: "Renew", recommended_purchase_type: "renew" }],
      })
      .mockResolvedValueOnce(payment);

    await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }));
    await extendRoute.POST(jsonRequest("/api/bff/subscription/extend", {
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }));

    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "subscription_purchase" }));
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "subscription_extend" }));
    expect(mocks.recordPayment).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", plan: expect.objectContaining({ name: "Basic" }) }));
    expect(mocks.recordPayment).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", plan: expect.objectContaining({ name: "Renew" }) }));
  });

  it("returns offers, payment history, payment status and support data", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce({ offers: [] }).mockResolvedValueOnce({ uuid: "sub-1" });

    await expect(body(await offersRoute.GET())).resolves.toEqual({ data: { offers: [] } });
    await expect(body(await paymentsHistoryRoute.GET())).resolves.toMatchObject({
      data: [{ payment_id: "payment-1", status: "pending" }],
    });
    await expect(
      body(await paymentsStatusRoute.GET(new Request("http://clean-pay.local/api/bff/payments/status?payment_id=payment-1"))),
    ).resolves.toMatchObject({
      data: {
        payment: { payment_id: "payment-1" },
        subscription: { uuid: "sub-1" },
        source: "local_payment_record_and_current_subscription",
      },
    });
    await expect(body(await supportRoute.GET())).resolves.toMatchObject({
      data: { enabled: true, email: "support@clean-pay.localhost" },
    });
  });

  it("keeps missing subscription explicit but non-fatal in payment status", async () => {
    mocks.remnashopRequest.mockRejectedValueOnce(
      new BffError("SUBSCRIPTION_NOT_FOUND", 404, "missing subscription"),
    );

    const response = await paymentsStatusRoute.GET(
      new Request("http://clean-pay.local/api/bff/payments/status?payment_id=payment-1"),
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      data: {
        payment: { payment_id: "payment-1" },
        subscription: null,
        source: "local_payment_record_and_current_subscription",
      },
    });
  });

  it("returns an explicit error when payment status cannot verify subscription", async () => {
    mocks.remnashopRequest.mockRejectedValueOnce(
      new BffError("UPSTREAM_UNAVAILABLE", 502, "Remnashop unavailable"),
    );

    const response = await paymentsStatusRoute.GET(
      new Request("http://clean-pay.local/api/bff/payments/status?payment_id=payment-1"),
    );

    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({
      error: {
        code: "UPSTREAM_UNAVAILABLE",
      },
    });
  });

  it("returns BFF errors and readiness status in route shape", async () => {
    mocks.getCurrentAuthProfile.mockRejectedValueOnce(new BffError("UNAUTHORIZED", 401, "no session"));
    const authError = await meRoute.GET();

    expect(authError.status).toBe(401);
    await expect(body(authError)).resolves.toMatchObject({ error: { code: "UNAUTHORIZED" } });

    mocks.checkRedis.mockResolvedValueOnce({ status: "down", latencyMs: 1, message: "Redis did not return PONG" });
    const readiness = await readinessRoute.GET();

    expect(readiness.status).toBe(503);
    await expect(body(readiness)).resolves.toMatchObject({
      status: "degraded",
      checks: {
        redis: { status: "down" },
        mailpit: { status: "ok" },
        telegramOidc: { status: "ok" },
        remnawave: { status: "ok" },
      },
    });
  });
});
