import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRecentRecords: vi.fn(),
  readHistorySnapshotStatus: vi.fn(),
  serializePaymentRecord: vi.fn(),
}));

vi.mock("@/backend/integrations/payments/prisma-payment-query-repository", () => ({
  prismaPaymentQueryRepository: {
    findRecentRecords: mocks.findRecentRecords,
    readHistorySnapshotStatus: mocks.readHistorySnapshotStatus,
  },
}));
vi.mock("@/backend/integrations/payments/payment-record-service", () => ({
  serializePaymentRecord: mocks.serializePaymentRecord,
}));

import { createProductionPaymentHistoryGateway } from "@/backend/integrations/payments/payment-history-reader";

describe("production payment history reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves only owner-scoped local records through the cabinet read path", async () => {
    mocks.findRecentRecords.mockResolvedValue([{ id: "record-1" }]);
    mocks.serializePaymentRecord.mockReturnValue({ payment_id: "payment-1" });
    const gateway = createProductionPaymentHistoryGateway();

    await expect(gateway.loadRecent("user-1", 20)).resolves.toEqual([
      { payment_id: "payment-1" },
    ]);

    expect(mocks.findRecentRecords).toHaveBeenCalledWith("user-1", 20);
    expect(mocks.serializePaymentRecord).toHaveBeenCalledWith({ id: "record-1" });
  });

  it.each(["current", "refreshing", "unavailable"] as const)(
    "preserves the semantic snapshot status %s",
    async (status) => {
      mocks.readHistorySnapshotStatus.mockResolvedValue(status);
      const gateway = createProductionPaymentHistoryGateway();

      await expect(gateway.readSnapshotStatus("user-1")).resolves.toBe(status);
      expect(mocks.readHistorySnapshotStatus).toHaveBeenCalledWith("user-1");
    },
  );
});
