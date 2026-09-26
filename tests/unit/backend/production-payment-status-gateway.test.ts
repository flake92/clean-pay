import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getAuthorizedRemnashopTokens: vi.fn(), getRemnashopUserIdFromAccessToken: vi.fn(),
  findOperation: vi.fn(), findRecord: vi.fn(), findLatestRecord: vi.fn(), serializePaymentRecord: vi.fn(),
  getPaymentCapabilities: vi.fn(), getExactTransaction: vi.fn(), getLegacyTransactions: vi.fn(),
  assertPaymentUpstreamIdentity: vi.fn(), syncExactPaymentRecordFromRemnashop: vi.fn(),
  syncPaymentRecordsFromRemnashopTransactions: vi.fn(), remnashopRequest: vi.fn(),
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  remnashopRequest: mocks.remnashopRequest,
  remnashopValidatedRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnashop/api-client-runtime", () => ({
  remnashopValidatedRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/payments/prisma-payment-query-repository", () => ({
  prismaPaymentQueryRepository: {
    findOperation: mocks.findOperation, findRecord: mocks.findRecord, findLatestRecord: mocks.findLatestRecord,
  },
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  getPaymentCapabilities: mocks.getPaymentCapabilities, getExactTransaction: mocks.getExactTransaction,
  getLegacyTransactions: mocks.getLegacyTransactions,
}));
vi.mock("@/backend/integrations/payments/payment-owner-service", () => ({ assertPaymentUpstreamIdentity: mocks.assertPaymentUpstreamIdentity }));
vi.mock("@/backend/integrations/payments/payment-record-service", () => ({
  serializePaymentRecord: mocks.serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop: mocks.syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions: mocks.syncPaymentRecordsFromRemnashopTransactions,
}));

import { PaymentStatusGatewayError } from "@/application/payments/ports/payment-status-reader";
import { ServiceError } from "@/backend/errors/service-error";
import { createProductionPaymentStatusReader } from "@/backend/integrations/payments/payment-status-reader";

const gateway = createProductionPaymentStatusReader();

describe("production payment status gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", emailVerified: true, telegramId: null });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access" });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-1");
    mocks.serializePaymentRecord.mockImplementation((record) => ({ payment_id: record.paymentId }));
  });

  it("maps every provider and persistence primitive to application DTOs", async () => {
    const record = { id: "op-1", status: "OUTCOME_UNKNOWN", paymentRecord: { paymentId: "payment-1", status: "PENDING" } };
    mocks.findOperation.mockResolvedValue(record);
    mocks.getPaymentCapabilities.mockResolvedValue({ transactions: { max_page_size: 250 } });
    mocks.getExactTransaction.mockResolvedValue({ payment_id: "payment-1" });
    mocks.getLegacyTransactions.mockResolvedValue([{ payment_id: "legacy-1" }]);
    mocks.remnashopRequest.mockResolvedValue({ status: "ACTIVE", plan_name: "Basic", expire_at: "2099-01-01" });
    mocks.findRecord.mockResolvedValue({ paymentId: "payment-1" });
    mocks.findLatestRecord.mockResolvedValue({ paymentId: "latest" });

    await expect(gateway.loadActor()).resolves.toEqual({ id: "user-1", emailVerified: true, telegramId: null });
    await expect(gateway.findOperation("user-1", "op-1")).resolves.toMatchObject({ id: "op-1", paymentId: "payment-1" });
    const authorization = await gateway.authorize();
    await gateway.assertUpstreamOwner("user-1", "upstream-1");
    await expect(gateway.loadCapabilities(authorization)).resolves.toEqual({ maxPageSize: 250 });
    const exact = await gateway.loadExactTransaction(authorization, "payment-1");
    await gateway.persistExactTransaction("user-1", "upstream-1", exact!);
    const legacy = await gateway.loadLegacyTransactions(authorization);
    await gateway.persistLegacyTransactions("user-1", "upstream-1", legacy);
    await expect(gateway.loadSubscription(authorization)).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(gateway.findPayment("user-1", "payment-1")).resolves.toEqual({ payment_id: "payment-1" });
    await expect(gateway.findLatestPayment("user-1")).resolves.toEqual({ payment_id: "latest" });

    expect(mocks.syncExactPaymentRecordFromRemnashop).toHaveBeenCalledWith(expect.objectContaining({ upstreamAccountId: "upstream-1" }));
    expect(mocks.syncPaymentRecordsFromRemnashopTransactions).toHaveBeenCalledWith(expect.objectContaining({ transactions: [{ payment_id: "legacy-1" }] }));
  });

  it("covers absent optional data and translates infrastructure errors", async () => {
    mocks.getPaymentCapabilities.mockResolvedValue(null);
    mocks.getExactTransaction.mockResolvedValue(null);
    mocks.findOperation.mockResolvedValue(null);
    mocks.findRecord.mockResolvedValue(null);
    mocks.findLatestRecord.mockResolvedValue(null);
    const authorization = await gateway.authorize();
    await expect(gateway.loadCapabilities(authorization)).resolves.toBeNull();
    await expect(gateway.loadExactTransaction(authorization, "missing")).resolves.toBeNull();
    await expect(gateway.findOperation("user-1", null)).resolves.toBeNull();
    await expect(gateway.findPayment("user-1", "missing")).resolves.toBeNull();
    await expect(gateway.findLatestPayment("user-1")).resolves.toBeNull();

    expect(gateway.isSubscriptionMissing(new PaymentStatusGatewayError("SUBSCRIPTION_NOT_FOUND"))).toBe(true);
    expect(gateway.isSubscriptionMissing(new Error("other"))).toBe(false);
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    await expect(gateway.loadActor()).resolves.toBeNull();
    mocks.getAuthorizedRemnashopTokens.mockRejectedValueOnce(new ServiceError("UPSTREAM_UNAVAILABLE", 503));
    await expect(gateway.authorize()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});
