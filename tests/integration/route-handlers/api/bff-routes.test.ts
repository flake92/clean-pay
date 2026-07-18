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
  getPaymentCapabilities: vi.fn(),
  getLegacyTransactions: vi.fn(),
  getExactTransaction: vi.fn(),
  syncOnePaymentHistoryPage: vi.fn(),
  reconcileUnknownPayments: vi.fn(),
  assertPaymentUpstreamIdentity: vi.fn(),
  syncPaymentRecordsFromRemnashopTransactions: vi.fn(),
  applyRemnashopTransaction: vi.fn(),
  syncExactPaymentRecordFromRemnashop: vi.fn(),
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
    paymentOperation: { findFirst: vi.fn() },
    webUser: { findUnique: vi.fn() },
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
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  getPaymentCapabilities: mocks.getPaymentCapabilities,
  getLegacyTransactions: mocks.getLegacyTransactions,
  getExactTransaction: mocks.getExactTransaction,
}));
vi.mock("@/backend/integrations/remnawave/client", () => ({
  getLiveRemnawaveSubscriptionUrl: mocks.getLiveRemnawaveSubscriptionUrl,
}));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/payments/records", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/payments/records")>(),
  recordPayment: mocks.recordPayment,
  syncPaymentRecordsFromRemnashopTransactions:
    mocks.syncPaymentRecordsFromRemnashopTransactions,
  applyRemnashopTransaction: mocks.applyRemnashopTransaction,
  syncExactPaymentRecordFromRemnashop:
    mocks.syncExactPaymentRecordFromRemnashop,
}));
vi.mock("@/backend/payments/history-sync", () => ({
  syncOnePaymentHistoryPage: mocks.syncOnePaymentHistoryPage,
}));
vi.mock("@/backend/payments/reconciliation", () => ({
  reconcileUnknownPayments: mocks.reconcileUnknownPayments,
}));
vi.mock("@/backend/payments/owner", () => ({
  assertPaymentUpstreamIdentity: mocks.assertPaymentUpstreamIdentity,
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
import { confirmedPaymentOffer } from "@/shared/payments/offer-confirmation";

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

const paymentId = "11111111-1111-4111-8111-111111111111";

const payment = {
  payment_id: paymentId,
  purchase_type: "subscription",
  status: "pending",
  final_amount: "100.00",
  currency: "RUB",
  gateway_type: "YOOKASSA",
  payment_url: "https://pay.test",
  is_free: false,
  return_url: "http://localhost:8080/payment/pending?operation_id=operation-1",
};

const offerPrice = {
  gateway_type: "YOOKASSA",
  currency: "RUB",
  currency_symbol: "₽",
  original_amount: "100.00",
  discount_percent: 0,
  final_amount: "100.00",
  is_free: false,
};

const purchasePlan = {
  id: 1,
  public_code: "basic",
  name: "Basic",
  description: null,
  traffic_limit: 0,
  device_limit: 3,
  type: "regular",
  recommended_purchase_type: "new",
  durations: [{ days: 30, prices: [offerPrice] }],
};

const renewPlan = {
  ...purchasePlan,
  id: 2,
  public_code: "renew",
  name: "Renew",
  recommended_purchase_type: "renew",
};

function purchaseRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    plan_code: purchasePlan.public_code,
    gateway_type: offerPrice.gateway_type,
    duration_days: 30,
    ...confirmedPaymentOffer(purchasePlan, 30, offerPrice),
    ...overrides,
  };
}

function extendRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    gateway_type: offerPrice.gateway_type,
    duration_days: 30,
    ...confirmedPaymentOffer(renewPlan, 30, offerPrice),
    ...overrides,
  };
}

const record = {
  id: "record-1",
  paymentId,
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
  upstreamCreatedAt: new Date("2026-06-25T00:00:00.000Z"),
  upstreamUpdatedAt: new Date("2026-06-25T01:00:00.000Z"),
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
    mocks.getPaymentCapabilities.mockResolvedValue(null);
    mocks.getLegacyTransactions.mockResolvedValue([]);
    mocks.getExactTransaction.mockResolvedValue(null);
    mocks.syncOnePaymentHistoryPage.mockResolvedValue({
      claimed: true,
      applied: 0,
      hasMore: false,
    });
    mocks.reconcileUnknownPayments.mockResolvedValue({ claimed: 0 });
    mocks.assertPaymentUpstreamIdentity.mockResolvedValue(undefined);
    mocks.syncPaymentRecordsFromRemnashopTransactions.mockResolvedValue(undefined);
    mocks.applyRemnashopTransaction.mockResolvedValue(undefined);
    mocks.syncExactPaymentRecordFromRemnashop.mockResolvedValue(undefined);
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
    mocks.prisma.paymentOperation.findFirst.mockResolvedValue(null);
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
        plans: [purchasePlan],
      })
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({
        plans: [renewPlan],
      })
      .mockResolvedValueOnce(payment);

    const purchaseResponse = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody({
      ignored_client_field: "must-not-reach-upstream",
    }), { "idempotency-key": "11111111-1111-4111-8111-111111111111" }));
    const extendResponse = await extendRoute.POST(jsonRequest("/api/bff/subscription/extend", extendRequestBody(), { "idempotency-key": "22222222-2222-4222-8222-222222222222" }));

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
        return_url: "http://localhost:8080/payment/pending?operation_id=operation-1",
      },
    }));
    expect(mocks.remnashopRequest).toHaveBeenCalledWith("/subscription/extend", expect.objectContaining({
      idempotencyKey: "upstream-operation-1",
      body: {
        gateway_type: "YOOKASSA",
        duration_days: 30,
        return_url: "http://localhost:8080/payment/pending?operation_id=operation-1",
      },
    }));
  });

  it("rejects malformed payment JSON with a controlled 400 before side effects", async () => {
    const response = await purchaseRoute.POST(
      new Request("http://clean-pay.local/api/bff/subscription/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(body(response)).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.beginPaymentOperation).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).not.toHaveBeenCalled();
  });

  it("does not dispatch an invoice when the confirmed offer changed", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce({
      plans: [
        {
          ...purchasePlan,
          durations: [
            {
              days: 30,
              prices: [{ ...offerPrice, final_amount: "150.00" }],
            },
          ],
        },
      ],
    });

    const response = await purchaseRoute.POST(
      jsonRequest(
        "/api/bff/subscription/purchase",
        purchaseRequestBody(),
        { "idempotency-key": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      ),
    );

    expect(response.status).toBe(409);
    await expect(body(response)).resolves.toMatchObject({
      error: { code: "OFFER_CHANGED" },
    });
    expect(mocks.markPaymentOperationDispatched).not.toHaveBeenCalled();
    expect(mocks.completePaymentOperationSuccess).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).toHaveBeenCalledTimes(1);
    expect(mocks.settlePaymentOperationBeforeDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ final: true }),
    );
  });

  it("replays a completed payment without rate limiting or another upstream call", async () => {
    mocks.beginPaymentOperation.mockResolvedValueOnce({
      state: "replay",
      outcome: "success",
      operationId: "operation-replay",
      response: payment,
    });

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "33333333-3333-4333-8333-333333333333" }));

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

    const response = await extendRoute.POST(jsonRequest("/api/bff/subscription/extend", extendRequestBody(), { "idempotency-key": "44444444-4444-4444-8444-444444444444" }));

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

  it("returns an explicit terminal operator signal for a manual-review payment", async () => {
    mocks.beginPaymentOperation.mockResolvedValueOnce({
      state: "manual_required",
      operationId: "operation-manual",
    });

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "99999999-9999-4999-8999-999999999999" }));

    expect(response.status).toBe(409);
    expect(response.headers.get("x-payment-operation-id")).toBe("operation-manual");
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    await expect(body(response)).resolves.toEqual({
      data: {
        operation_id: "operation-manual",
        status: "manual_required",
        retry_after_seconds: null,
        requires_support: true,
        operator_action: "review_payment_operation",
      },
    });
    expect(mocks.assertRateLimit).not.toHaveBeenCalled();
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    expect(mocks.remnashopRequest).not.toHaveBeenCalled();
  });

  it("releases a pre-dispatch operation after rate limiting so the same key can retry later", async () => {
    mocks.assertRateLimit.mockRejectedValueOnce(new BffError("RATE_LIMITED", 429));

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "77777777-7777-4777-8777-777777777777" }));

    expect(response.status).toBe(429);
    expect(mocks.settlePaymentOperationBeforeDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ final: false }),
    );
    expect(mocks.markPaymentOperationDispatched).not.toHaveBeenCalled();
  });

  it("does not create an operation for a new key rejected by the anti-abuse gate", async () => {
    mocks.beginPaymentOperation.mockResolvedValueOnce({ state: "missing" });
    mocks.assertRateLimit.mockRejectedValueOnce(new BffError("RATE_LIMITED", 429));

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "99999999-9999-4999-8999-999999999999" }));

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
      .mockResolvedValueOnce({ plans: [purchasePlan] })
      .mockResolvedValueOnce({
        ...payment,
        return_url: "http://localhost:8080/payment/pending?operation_id=operation-new",
      });

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));

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
      .mockResolvedValueOnce({ plans: [purchasePlan] })
      .mockRejectedValueOnce(
        new BffError("UPSTREAM_UNAVAILABLE", 502, "connection reset", {
          upstreamPath: "/subscription/purchase",
        }),
      );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "55555555-5555-4555-8555-555555555555" }));

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
      .mockResolvedValueOnce({ plans: [purchasePlan] })
      .mockRejectedValueOnce(
        new BffError("PAYMENT_OPERATION_IN_PROGRESS", 409, "already in progress", {
          upstreamStatus: 409,
          upstreamPath: "/subscription/purchase",
        }),
      );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "88888888-8888-4888-8888-888888888888" }));

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
      .mockResolvedValueOnce({ plans: [purchasePlan] })
      .mockRejectedValueOnce(error);

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));

    expect(response.status).toBe(202);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
  });

  it("releases a post-dispatch upstream 429 for retry with the same key", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [purchasePlan] })
      .mockRejectedValueOnce(
        new BffError("RATE_LIMITED", 429, "slow down", {
          upstreamStatus: 429,
          upstreamPath: "/subscription/purchase",
        }),
      );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }));

    expect(response.status).toBe(429);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "RETRYABLE" }),
    );
  });

  it("returns 202 instead of enabling a new key when local persistence fails after upstream success", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [purchasePlan] })
      .mockResolvedValueOnce(payment);
    mocks.completePaymentOperationSuccess.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "66666666-6666-4666-8666-666666666666" }));

    expect(response.status).toBe(202);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  it("keeps the outcome unknown after a local payment-record conflict", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ plans: [purchasePlan] })
      .mockResolvedValueOnce(payment);
    mocks.completePaymentOperationSuccess.mockRejectedValueOnce(
      new BffError("CONFLICT", 409, "local payment id collision"),
    );

    const response = await purchaseRoute.POST(jsonRequest("/api/bff/subscription/purchase", purchaseRequestBody(), { "idempotency-key": "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));

    expect(response.status).toBe(202);
    expect(mocks.settlePaymentOperationAfterDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "UNKNOWN" }),
    );
  });

  it("returns offers, payment history, payment status and support data", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ offers: [] })
      .mockResolvedValueOnce({ uuid: "sub-1" });

    await expect(body(await offersRoute.GET())).resolves.toEqual({ data: { offers: [] } });
    await expect(body(await paymentsHistoryRoute.GET())).resolves.toMatchObject({
      data: [{ payment_id: paymentId, status: "pending" }],
    });
    expect(mocks.syncPaymentRecordsFromRemnashopTransactions).toHaveBeenCalled();
    await expect(
      body(await paymentsStatusRoute.GET(new Request(`http://clean-pay.local/api/bff/payments/status?payment_id=${paymentId}`))),
    ).resolves.toMatchObject({
      data: {
        payment: { payment_id: paymentId },
        subscription: { uuid: "sub-1" },
        source: "local_payment_record_and_current_subscription",
      },
    });
    await expect(body(await supportRoute.GET())).resolves.toMatchObject({
      data: { enabled: true, email: "support@clean-pay.localhost" },
    });
  });

  it("keeps missing subscription explicit but non-fatal in payment status", async () => {
    mocks.remnashopRequest.mockRejectedValueOnce(new BffError("SUBSCRIPTION_NOT_FOUND", 404, "missing subscription"));

    const response = await paymentsStatusRoute.GET(
      new Request(`http://clean-pay.local/api/bff/payments/status?payment_id=${paymentId}`),
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      data: {
        payment: { payment_id: paymentId },
        subscription: null,
        source: "local_payment_record_and_current_subscription",
      },
    });
  });

  it("returns a user-scoped terminal manual-review operation and no phantom payment", async () => {
    mocks.prisma.paymentOperation.findFirst.mockResolvedValueOnce({
      id: "operation-manual",
      status: "OUTCOME_UNKNOWN",
      reconciledAt: new Date("2026-07-17T12:00:00.000Z"),
      reconcileErrorSnapshot: { code: "MANUAL_REQUIRED" },
      paymentRecord: null,
    });

    const response = await paymentsStatusRoute.GET(
      new Request(
        "http://clean-pay.local/api/bff/payments/status?operation_id=operation-manual",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    expect(mocks.reconcileUnknownPayments).not.toHaveBeenCalled();
    expect(mocks.prisma.paymentOperation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "operation-manual", userId: "user-1" },
      }),
    );
    await expect(body(response)).resolves.toMatchObject({
      data: {
        payment: null,
        operation: {
          operation_id: "operation-manual",
          status: "manual_required",
          retry_after_seconds: null,
          requires_support: true,
          operator_action: "review_payment_operation",
        },
        source: "local_terminal_payment_operation",
      },
    });
  });

  it("returns a locally succeeded operation while Remnashop is unavailable", async () => {
    mocks.prisma.paymentOperation.findFirst.mockResolvedValueOnce({
      id: "operation-succeeded",
      status: "SUCCEEDED",
      reconciledAt: new Date("2026-07-17T12:00:00.000Z"),
      reconcileErrorSnapshot: null,
      paymentRecord: record,
    });
    const response = await paymentsStatusRoute.GET(
      new Request(
        "http://clean-pay.local/api/bff/payments/status?operation_id=operation-succeeded",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    await expect(body(response)).resolves.toMatchObject({
      data: {
        payment: { payment_id: paymentId },
        operation: {
          operation_id: "operation-succeeded",
          status: "succeeded",
          retry_after_seconds: null,
        },
        subscription: null,
        source: "local_terminal_payment_operation",
      },
    });
  });

  it("uses exact v1 lookup for an old payment beyond the legacy first page", async () => {
    const exact = {
      payment_id: paymentId,
      purchase_type: "NEW",
      status: "completed",
      gateway_type: "YOOKASSA",
      final_amount: "100.00",
      currency: "₽",
      plan_name: "Basic",
      duration_days: 30,
      device_limit: 3,
      traffic_limit: null,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:01:00.000Z",
    };
    mocks.getPaymentCapabilities.mockResolvedValueOnce({
      contract_version: 1,
      transactions: { max_page_size: 100 },
    });
    mocks.getExactTransaction.mockResolvedValueOnce(exact);
    mocks.remnashopRequest.mockResolvedValueOnce({ uuid: "sub-1" });

    const response = await paymentsStatusRoute.GET(
      new Request(
        `http://clean-pay.local/api/bff/payments/status?payment_id=${paymentId}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getExactTransaction).toHaveBeenCalledWith({
      accessToken: "access-token",
      paymentId,
    });
    expect(mocks.syncExactPaymentRecordFromRemnashop).toHaveBeenCalledWith({
      userId: "user-1",
      upstreamAccountId: "remnashop-user-1",
      transaction: exact,
    });
  });

  it("fails closed before upstream reads when the JWT owner changed", async () => {
    mocks.assertPaymentUpstreamIdentity.mockRejectedValueOnce(
      new BffError("ACCOUNT_MERGE_REQUIRED", 409, "owner mismatch"),
    );

    const response = await paymentsStatusRoute.GET(
      new Request(
        `http://clean-pay.local/api/bff/payments/status?payment_id=${paymentId}`,
      ),
    );

    expect(response.status).toBe(409);
    expect(mocks.getPaymentCapabilities).not.toHaveBeenCalled();
    expect(mocks.getExactTransaction).not.toHaveBeenCalled();
  });

  it("returns an explicit error when payment status cannot verify subscription", async () => {
    mocks.remnashopRequest.mockRejectedValueOnce(new BffError("UPSTREAM_UNAVAILABLE", 502, "Remnashop unavailable"));

    const response = await paymentsStatusRoute.GET(
      new Request(`http://clean-pay.local/api/bff/payments/status?payment_id=${paymentId}`),
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

  it("starts every readiness dependency in parallel with one deadline signal", async () => {
    let release!: (value: { status: "ok"; latencyMs: number }) => void;
    const gate = new Promise<{ status: "ok"; latencyMs: number }>((resolve) => {
      release = resolve;
    });
    const checks = [
      mocks.checkDatabase,
      mocks.checkRedis,
      mocks.checkRemnashop,
      mocks.checkTelegramOidc,
      mocks.checkMailpit,
      mocks.checkRemnawave,
    ];

    for (const check of checks) {
      check.mockImplementationOnce(() => gate);
    }

    const responsePromise = readinessRoute.GET();
    await Promise.resolve();

    for (const check of checks) {
      expect(check).toHaveBeenCalledOnce();
      expect(check).toHaveBeenCalledWith(expect.any(Object));
    }

    const signals = checks.map((check) => check.mock.calls[0]?.[0]);
    expect(new Set(signals).size).toBe(1);
    release({ status: "ok", latencyMs: 1 });

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });
});
