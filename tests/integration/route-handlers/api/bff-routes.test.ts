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
  getRemnashopUserIdFromAccessToken: vi.fn(),
  remnashopRequest: vi.fn(),
  getLiveRemnawaveSubscriptionUrl: vi.fn(),
  assertRateLimit: vi.fn(),
  recordPayment: vi.fn(),
  beginPaymentOperation: vi.fn(),
  bindPaymentOperationUpstreamOwner: vi.fn(),
  markPaymentOperationDispatched: vi.fn(),
  completePaymentOperationSuccess: vi.fn(),
  paymentOperationDispatchFailureOutcome: vi.fn(),
  paymentOperationErrorFromSnapshot: vi.fn(),
  settlePaymentOperationAfterDispatchFailure: vi.fn(),
  settlePaymentOperationBeforeDispatchFailure: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentUser: vi.fn(),
  prisma: {
    paymentRecord: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
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
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
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
vi.mock("@/backend/payments/idempotency", () => ({
  beginPaymentOperation: mocks.beginPaymentOperation,
  bindPaymentOperationUpstreamOwner: mocks.bindPaymentOperationUpstreamOwner,
  markPaymentOperationDispatched: mocks.markPaymentOperationDispatched,
  completePaymentOperationSuccess: mocks.completePaymentOperationSuccess,
  paymentOperationDispatchFailureOutcome: mocks.paymentOperationDispatchFailureOutcome,
  paymentOperationErrorFromSnapshot: mocks.paymentOperationErrorFromSnapshot,
  settlePaymentOperationAfterDispatchFailure: mocks.settlePaymentOperationAfterDispatchFailure,
  settlePaymentOperationBeforeDispatchFailure: mocks.settlePaymentOperationBeforeDispatchFailure,
}));
vi.mock("@/backend/sessions/web-session", () => ({
  getCurrentSession: mocks.getCurrentSession,
  getCurrentUser: mocks.getCurrentUser,
}));
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
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("remnashop-user-1");
    mocks.remnashopRequest.mockResolvedValue({ ok: true });
    mocks.beginPaymentOperation.mockResolvedValue({
      state: "execute",
      operationId: "operation-1",
      claimToken: "claim-1",
      upstreamKey: "upstream-operation-1",
    });
    mocks.completePaymentOperationSuccess.mockResolvedValue(payment);
    mocks.paymentOperationDispatchFailureOutcome.mockImplementation((error: unknown) => {
      if (
        error instanceof BffError &&
        typeof error.debug?.upstreamStatus !== "number"
      ) {
        return "UNKNOWN";
      }

      if (error instanceof BffError && error.status === 429) {
        return "RETRYABLE";
      }

      if (
        error instanceof BffError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.code !== "PAYMENT_OPERATION_IN_PROGRESS" &&
        error.code !== "PAYMENT_OUTCOME_UNKNOWN" &&
        error.code !== "IDEMPOTENCY_KEY_REUSED"
      ) {
        return "FINAL";
      }

      return "UNKNOWN";
    });
    mocks.paymentOperationErrorFromSnapshot.mockReturnValue(new BffError("CONFLICT", 409));
    mocks.getLiveRemnawaveSubscriptionUrl.mockResolvedValue(null);
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.prisma.paymentRecord.findMany.mockResolvedValue([record]);
    mocks.prisma.paymentRecord.findFirst.mockResolvedValue(record);
    mocks.prisma.paymentRecord.updateMany.mockResolvedValue({ count: 1 });
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

    const purchaseResponse = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
      ignored_client_field: "must-not-reach-upstream",
    }, { "idempotency-key": "11111111-1111-4111-8111-111111111111" }));
    const extendResponse = await extendRoute.POST(jsonRequest("/api/bff/subscription/extend", {
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "22222222-2222-4222-8222-222222222222" }));

    expect(purchaseResponse.status).toBe(200);
    expect(extendResponse.status).toBe(200);
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "subscription_purchase" }));
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "subscription_extend" }));
    expect(mocks.completePaymentOperationSuccess).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-1",
      payment: expect.objectContaining({ userId: "user-1", plan: expect.objectContaining({ name: "Basic" }) }),
    }));
    expect(mocks.completePaymentOperationSuccess).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-1",
      payment: expect.objectContaining({ userId: "user-1", plan: expect.objectContaining({ name: "Renew" }) }),
    }));
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/purchase", expect.objectContaining({
      idempotencyKey: "upstream-operation-1",
      body: {
        plan_code: "basic",
        gateway_type: "YOOKASSA",
        duration_days: 30,
      },
    }));
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/extend", expect.objectContaining({
      idempotencyKey: "upstream-operation-1",
      body: {
        gateway_type: "YOOKASSA",
        duration_days: 30,
      },
    }));
  });

  it("replays a completed payment without rate limiting or another upstream call", async () => {
    mocks.beginPaymentOperation.mockResolvedValueOnce({
      state: "replay",
      outcome: "success",
      operationId: "operation-replay",
      response: payment,
    });

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "33333333-3333-4333-8333-333333333333" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    await expect(body(response)).resolves.toEqual({ data: payment });
    expect(mocks.assertRateLimit).not.toHaveBeenCalled();
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).not.toHaveBeenCalled();
    expect(mocks.completePaymentOperationSuccess).not.toHaveBeenCalled();
  });

  it("returns a controlled 202 while the original payment outcome is unknown", async () => {
    mocks.beginPaymentOperation.mockResolvedValueOnce({
      state: "pending",
      reason: "OUTCOME_UNKNOWN",
      operationId: "operation-unknown",
      retryAfterSeconds: 15,
    });

    const response = await extendRoute.POST(jsonRequest("/api/bff/subscription/extend", {
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "44444444-4444-4444-8444-444444444444" }));

    expect(response.status).toBe(202);
    expect(response.headers.get("retry-after")).toBe("15");
    await expect(body(response)).resolves.toEqual({
      data: {
        operation_id: "operation-unknown",
        status: "outcome_unknown",
        retry_after_seconds: 15,
      },
    });
    expect(mocks.remnashopRequest).not.toHaveBeenCalled();
  });

  it("releases a pre-dispatch operation after rate limiting so the same key can retry later", async () => {
    mocks.assertRateLimit.mockRejectedValueOnce(new BffError("RATE_LIMITED", 429));

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "77777777-7777-4777-8777-777777777777" }));

    expect(response.status).toBe(429);
    expect(mocks.settlePaymentOperationBeforeDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ final: false }),
    );
    expect(mocks.markPaymentOperationDispatched).not.toHaveBeenCalled();
  });

  it("does not create an operation for a new key rejected by the anti-abuse gate", async () => {
    mocks.beginPaymentOperation.mockResolvedValueOnce({ state: "missing" });
    mocks.assertRateLimit.mockRejectedValueOnce(new BffError("RATE_LIMITED", 429));

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "99999999-9999-4999-8999-999999999999" }));

    expect(response.status).toBe(429);
    expect(mocks.beginPaymentOperation).toHaveBeenCalledTimes(1);
    expect(mocks.beginPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ createIfMissing: false }),
    );
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    expect(mocks.settlePaymentOperationBeforeDispatchFailure).not.toHaveBeenCalled();
  });

  it("creates a new operation only after local limiting and upstream authentication", async () => {
    mocks.beginPaymentOperation
      .mockResolvedValueOnce({ state: "missing" })
      .mockResolvedValueOnce({
        state: "execute",
        operationId: "operation-new",
        claimToken: "claim-new",
        upstreamKey: "upstream-new",
      });
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ public_code: "basic", name: "Basic" }] })
      .mockResolvedValueOnce(payment);

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));

    expect(response.status).toBe(200);
    expect(mocks.beginPaymentOperation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ createIfMissing: false }),
    );
    expect(mocks.beginPaymentOperation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ createIfMissing: true }),
    );
    expect(mocks.assertRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAuthorizedRemnashopTokens.mock.invocationCallOrder[0],
    );
    expect(mocks.getAuthorizedRemnashopTokens.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.beginPaymentOperation.mock.invocationCallOrder[1],
    );
  });

  it("keeps the same operation pending after an ambiguous upstream failure", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ public_code: "basic", name: "Basic" }] })
      .mockRejectedValueOnce(
        new BffError("UPSTREAM_UNAVAILABLE", 502, "connection reset", {
          upstreamPath: "/subscription/purchase",
        }),
      );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "55555555-5555-4555-8555-555555555555" }));

    expect(response.status).toBe(202);
    expect(mocks.markPaymentOperationDispatched).toHaveBeenCalledTimes(1);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
    expect(mocks.completePaymentOperationSuccess).not.toHaveBeenCalled();
    await expect(body(response)).resolves.toMatchObject({
      data: { operation_id: "operation-1", status: "outcome_unknown" },
    });
  });

  it("does not finalize a key while Remnashop reports the same operation in progress", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ public_code: "basic", name: "Basic" }] })
      .mockRejectedValueOnce(
        new BffError("PAYMENT_OPERATION_IN_PROGRESS", 409, "already in progress", {
          upstreamStatus: 409,
          upstreamPath: "/subscription/purchase",
        }),
      );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "88888888-8888-4888-8888-888888888888" }));

    expect(response.status).toBe(202);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
  });

  it.each([
    {
      name: "request timeout",
      error: new BffError("UPSTREAM_ERROR", 502, "request timeout", {
        upstreamStatus: 408,
        upstreamPath: "/subscription/purchase",
      }),
    },
    {
      name: "unmapped upstream 4xx",
      error: new BffError("UPSTREAM_ERROR", 502, "method not allowed", {
        upstreamStatus: 405,
        upstreamPath: "/subscription/purchase",
      }),
    },
    {
      name: "upstream idempotency conflict",
      error: new BffError("IDEMPOTENCY_KEY_REUSED", 409, "different request", {
        upstreamStatus: 409,
        upstreamPath: "/subscription/purchase",
      }),
    },
  ])("keeps the operation unknown after $name", async ({ error }) => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ public_code: "basic", name: "Basic" }] })
      .mockRejectedValueOnce(error);

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));

    expect(response.status).toBe(202);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
  });

  it("releases a post-dispatch upstream 429 for retry with the same key", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ public_code: "basic", name: "Basic" }] })
      .mockRejectedValueOnce(
        new BffError("RATE_LIMITED", 429, "slow down", {
          upstreamStatus: 429,
          upstreamPath: "/subscription/purchase",
        }),
      );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }));

    expect(response.status).toBe(429);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "RETRYABLE" }),
    );
  });

  it("returns 202 instead of enabling a new key when local persistence fails after upstream success", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ public_code: "basic", name: "Basic" }] })
      .mockResolvedValueOnce(payment);
    mocks.completePaymentOperationSuccess.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "66666666-6666-4666-8666-666666666666" }));

    expect(response.status).toBe(202);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  it("keeps the outcome unknown after a local payment-record conflict", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [{ public_code: "basic", name: "Basic" }] })
      .mockResolvedValueOnce(payment);
    mocks.completePaymentOperationSuccess.mockRejectedValueOnce(
      new BffError("CONFLICT", 409, "local payment id collision"),
    );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", {
      plan_code: "basic",
      gateway_type: "YOOKASSA",
      duration_days: 30,
    }, { "idempotency-key": "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));

    expect(response.status).toBe(202);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
  });

  it("returns offers, payment history, payment status and support data", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ offers: [] })
      .mockResolvedValueOnce([
        {
          payment_id: "payment-1",
          purchase_type: "subscription",
          status: "completed",
          final_amount: "100.00",
          currency: "RUB",
          gateway_type: "YOOKASSA",
          plan_name: "Basic",
          duration_days: 30,
          device_limit: 3,
          traffic_limit: null,
          created_at: "2026-06-25T00:00:00.000Z",
          updated_at: "2026-06-25T01:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ uuid: "sub-1" });

    await expect(body(await offersRoute.GET())).resolves.toEqual({ data: { offers: [] } });
    await expect(body(await paymentsHistoryRoute.GET())).resolves.toMatchObject({
      data: [{ payment_id: "payment-1", status: "pending" }],
    });
    expect(mocks.prisma.paymentRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", paymentId: "payment-1" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
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
    mocks.remnashopRequest
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new BffError("SUBSCRIPTION_NOT_FOUND", 404, "missing subscription"));

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
    mocks.remnashopRequest
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new BffError("UPSTREAM_UNAVAILABLE", 502, "Remnashop unavailable"));

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
