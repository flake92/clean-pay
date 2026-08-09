import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOperation: vi.fn(),
  findRecord: vi.fn(),
  findLatestRecord: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  remnashopRequest: vi.fn(),
  getExactTransaction: vi.fn(),
  getLegacyTransactions: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  syncOnePaymentHistoryPage: vi.fn(),
  isPaymentManualRequired: vi.fn(),
  assertPaymentUpstreamIdentity: vi.fn(),
  reconcileUnknownPayments: vi.fn(),
  serializePaymentRecord: vi.fn(),
  syncExactPaymentRecordFromRemnashop: vi.fn(),
  syncPaymentRecordsFromRemnashopTransactions: vi.fn(),
  assertEmailVerificationPolicy: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/backend/integrations/payments/prisma-payment-query-repository", () => ({
  prismaPaymentQueryRepository: {
    findOperation: mocks.findOperation,
    findRecord: mocks.findRecord,
    findLatestRecord: mocks.findLatestRecord,
  },
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  remnashopRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  getExactTransaction: mocks.getExactTransaction,
  getLegacyTransactions: mocks.getLegacyTransactions,
  getPaymentCapabilities: mocks.getPaymentCapabilities,
}));
vi.mock("@/backend/integrations/payments/payment-history-sync-service", () => ({
  syncOnePaymentHistoryPage: mocks.syncOnePaymentHistoryPage,
}));
vi.mock("@/backend/payments/manual-review", () => ({ isPaymentManualRequired: mocks.isPaymentManualRequired }));
vi.mock("@/backend/integrations/payments/payment-owner-service", () => ({
  assertPaymentUpstreamIdentity: mocks.assertPaymentUpstreamIdentity,
}));
vi.mock("@/backend/integrations/payments/payment-reconciliation-service", () => ({
  reconcileUnknownPayments: mocks.reconcileUnknownPayments,
}));
vi.mock("@/backend/integrations/payments/payment-record-service", () => ({
  serializePaymentRecord: mocks.serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop: mocks.syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions: mocks.syncPaymentRecordsFromRemnashopTransactions,
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  assertEmailVerificationPolicy: mocks.assertEmailVerificationPolicy,
  getCurrentUser: mocks.getCurrentUser,
}));

import { ServiceError } from "@/backend/errors/service-error";
import { productionPaymentStatusReader } from "@/backend/integrations/payments/payment-status-reader";

const paymentId = "11111111-1111-4111-8111-111111111111";
const record = { id: "record-1", paymentId, status: "COMPLETED" };

describe("production payment status adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token" });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-user-1");
    mocks.remnashopRequest.mockResolvedValue(null);
    mocks.serializePaymentRecord.mockImplementation((value) => ({ serialized: value.id }));
    mocks.isPaymentManualRequired.mockReturnValue(false);
  });

  it("validates public identifiers before accessing user data", async () => {
    await expect(productionPaymentStatusReader.load({ paymentId: "bad", operationId: null }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    await expect(productionPaymentStatusReader.load({ paymentId: null, operationId: "bad value" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("requires an authenticated verified user", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    await expect(productionPaymentStatusReader.load({ paymentId: null, operationId: null }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(mocks.assertEmailVerificationPolicy).not.toHaveBeenCalled();
  });

  it("returns a terminal local operation without contacting the provider", async () => {
    mocks.findOperation.mockResolvedValue({
      id: "operation-1",
      status: "FAILED_FINAL",
      reconciledAt: null,
      reconcileErrorSnapshot: null,
      paymentRecord: record,
    });

    await expect(productionPaymentStatusReader.load({ paymentId: null, operationId: "operation-1" }))
      .resolves.toEqual({
        payment: { serialized: "record-1" },
        operation: expect.objectContaining({ operation_id: "operation-1", status: "failed" }),
        subscription: null,
      });
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
  });

  it("refreshes an exact payment and returns the synchronized local record", async () => {
    mocks.findOperation.mockResolvedValue(null);
    mocks.getPaymentCapabilities.mockResolvedValue({ transactions: { max_page_size: 100 } });
    mocks.getExactTransaction.mockResolvedValue({ payment_id: paymentId });
    mocks.findRecord.mockResolvedValue(record);

    await expect(productionPaymentStatusReader.load({ paymentId, operationId: null }))
      .resolves.toEqual({ payment: { serialized: "record-1" }, operation: null, subscription: null });
    expect(mocks.syncExactPaymentRecordFromRemnashop).toHaveBeenCalledWith({
      userId: "user-1",
      upstreamAccountId: "upstream-user-1",
      transaction: { payment_id: paymentId },
    });
    expect(mocks.reconcileUnknownPayments).toHaveBeenCalledWith({
      limit: 1,
      userId: "user-1",
      accessToken: "access-token",
    });
  });

  it("uses legacy transaction synchronization when capabilities are absent", async () => {
    mocks.findOperation.mockResolvedValue(null);
    mocks.getPaymentCapabilities.mockResolvedValue(null);
    mocks.getLegacyTransactions.mockResolvedValue([{ payment_id: paymentId }]);
    mocks.findLatestRecord.mockResolvedValue(record);

    await productionPaymentStatusReader.load({ paymentId: null, operationId: null });
    expect(mocks.syncPaymentRecordsFromRemnashopTransactions).toHaveBeenCalledWith({
      userId: "user-1",
      upstreamAccountId: "upstream-user-1",
      transactions: [{ payment_id: paymentId }],
    });
  });

  it("keeps a succeeded local result available during provider failure", async () => {
    mocks.findOperation.mockResolvedValue({
      id: "operation-1",
      status: "SUCCEEDED",
      reconciledAt: null,
      reconcileErrorSnapshot: null,
      paymentRecord: { ...record, status: "PENDING" },
    });
    mocks.getAuthorizedRemnashopTokens.mockRejectedValueOnce(new ServiceError("UPSTREAM_UNAVAILABLE", 503));

    await expect(productionPaymentStatusReader.load({ paymentId: null, operationId: "operation-1" }))
      .resolves.toMatchObject({ payment: { serialized: "record-1" }, subscription: null });
  });
});
