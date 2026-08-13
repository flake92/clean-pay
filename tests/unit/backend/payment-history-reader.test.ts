import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPendingPaymentIds: vi.fn(),
  findRecentRecords: vi.fn(),
  isHistorySnapshotStale: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getExactTransaction: vi.fn(),
  getLegacyTransactions: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  assertPaymentUpstreamIdentity: vi.fn(),
  serializePaymentRecord: vi.fn(),
  syncExactPaymentRecordFromRemnashop: vi.fn(),
  syncPaymentRecordsFromRemnashopTransactions: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/backend/integrations/payments/prisma-payment-query-repository", () => ({
  prismaPaymentQueryRepository: {
    findPendingPaymentIds: mocks.findPendingPaymentIds,
    findRecentRecords: mocks.findRecentRecords,
    isHistorySnapshotStale: mocks.isHistorySnapshotStale,
  },
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
}));
vi.mock("@/backend/integrations/remnashop/payment-recovery", () => ({
  getExactTransaction: mocks.getExactTransaction,
  getLegacyTransactions: mocks.getLegacyTransactions,
  getPaymentCapabilities: mocks.getPaymentCapabilities,
}));
vi.mock("@/backend/integrations/payments/payment-owner-service", () => ({
  assertPaymentUpstreamIdentity: mocks.assertPaymentUpstreamIdentity,
}));
vi.mock("@/backend/integrations/payments/payment-record-service", () => ({
  serializePaymentRecord: mocks.serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop: mocks.syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions:
    mocks.syncPaymentRecordsFromRemnashopTransactions,
}));
vi.mock("@/backend/observability/logger", () => ({
  logger: { warn: mocks.warn },
}));

import { createProductionPaymentHistoryGateway } from "@/backend/integrations/payments/payment-history-reader";

describe("production payment history reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authorizes the local owner and maps capabilities and repository reads", async () => {
    const tokens = { accessToken: "access", refreshToken: "refresh" };
    const authorize = vi.fn().mockResolvedValue(tokens);
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    mocks.getPaymentCapabilities
      .mockResolvedValueOnce({ transactions: { max_page_size: 75 } })
      .mockResolvedValueOnce(null);
    mocks.findPendingPaymentIds.mockResolvedValue(["payment-1"]);
    mocks.findRecentRecords.mockResolvedValue([{ id: "record-1" }]);
    mocks.serializePaymentRecord.mockReturnValue({ id: "serialized-1" });
    mocks.isHistorySnapshotStale.mockResolvedValue(true);
    const gateway = createProductionPaymentHistoryGateway(authorize);

    const authorization = await gateway.authorize("user-1");
    expect(authorization).toEqual({ context: tokens, upstreamAccountId: "owner-1" });
    expect(mocks.assertPaymentUpstreamIdentity).toHaveBeenCalledWith("user-1", "owner-1");
    await expect(gateway.loadCapabilities(authorization)).resolves.toEqual({ maxPageSize: 75 });
    await expect(gateway.loadCapabilities(authorization)).resolves.toBeNull();
    await expect(gateway.findPendingPaymentIds("user-1", 4)).resolves.toEqual(["payment-1"]);
    await expect(gateway.loadRecent("user-1", 3)).resolves.toEqual([{ id: "serialized-1" }]);
    await expect(gateway.isSnapshotStale("user-1")).resolves.toBe(true);
    expect(mocks.getPaymentCapabilities).toHaveBeenNthCalledWith(1, "access");
    expect(mocks.findPendingPaymentIds).toHaveBeenCalledWith("user-1", 4);
    expect(mocks.findRecentRecords).toHaveBeenCalledWith("user-1", 3);
  });

  it("loads and persists exact and legacy transactions without losing context", async () => {
    const authorize = vi.fn().mockResolvedValue({ accessToken: "access" });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("owner-1");
    const exact = { id: "exact-1" };
    const legacy = [{ id: "legacy-1" }, { id: "legacy-2" }];
    mocks.getExactTransaction.mockResolvedValueOnce(exact).mockResolvedValueOnce(null);
    mocks.getLegacyTransactions.mockResolvedValue(legacy);
    const gateway = createProductionPaymentHistoryGateway(authorize);
    const authorization = await gateway.authorize("user-1");

    const exactResult = await gateway.loadExactTransaction(authorization, "payment-1");
    await expect(gateway.loadExactTransaction(authorization, "missing")).resolves.toBeNull();
    expect(exactResult).toEqual({ context: exact });
    await gateway.persistExactTransaction("user-1", authorization, exactResult!);

    const legacyResult = await gateway.loadLegacyTransactions(authorization);
    expect(legacyResult).toEqual([{ context: legacy[0] }, { context: legacy[1] }]);
    await gateway.persistLegacyTransactions("user-1", authorization, legacyResult);

    expect(mocks.getExactTransaction).toHaveBeenNthCalledWith(1, {
      accessToken: "access",
      paymentId: "payment-1",
    });
    expect(mocks.syncExactPaymentRecordFromRemnashop).toHaveBeenCalledWith({
      userId: "user-1",
      upstreamAccountId: "owner-1",
      transaction: exact,
    });
    expect(mocks.getLegacyTransactions).toHaveBeenCalledWith("access");
    expect(mocks.syncPaymentRecordsFromRemnashopTransactions).toHaveBeenCalledWith({
      userId: "user-1",
      upstreamAccountId: "owner-1",
      transactions: legacy,
    });
  });

  it("logs typed and unknown exact and degraded failures", () => {
    const gateway = createProductionPaymentHistoryGateway(vi.fn());

    gateway.logExactFailure(new TypeError("exact"), 2);
    gateway.logExactFailure("exact", 3);
    gateway.logDegraded(new RangeError("page"));
    gateway.logDegraded({ reason: "page" });

    expect(mocks.warn).toHaveBeenNthCalledWith(
      1,
      "payment_history_exact_sync_failed",
      { index: 2, errorName: "TypeError" },
      expect.objectContaining({ source: "payments.history" }),
    );
    expect(mocks.warn).toHaveBeenNthCalledWith(
      2,
      "payment_history_exact_sync_failed",
      { index: 3, errorName: "UnknownError" },
      expect.any(Object),
    );
    expect(mocks.warn).toHaveBeenNthCalledWith(
      3,
      "payment_history_sync_degraded",
      { errorName: "RangeError" },
      expect.objectContaining({ category: "upstream" }),
    );
    expect(mocks.warn).toHaveBeenNthCalledWith(
      4,
      "payment_history_sync_degraded",
      { errorName: "UnknownError" },
      expect.any(Object),
    );
  });
});
