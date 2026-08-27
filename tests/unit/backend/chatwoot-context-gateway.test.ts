import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  remnashopRequest: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  remnashopRequest: mocks.remnashopRequest,
  remnashopValidatedRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnashop/api-client-runtime", () => ({
  remnashopValidatedRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    paymentRecord: { findMany: mocks.findMany },
    paymentHistorySyncState: { findUnique: mocks.findUnique },
  },
}));

import { productionChatwootContextGateway } from "@/backend/integrations/support/chatwoot-context-gateway";

describe("Chatwoot context gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({ userId: "user-1" });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "access-token",
      session: { userId: "user-1" },
    });
    mocks.findMany.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => (
      Promise.all(operations)
    ));
  });

  it("binds every lookup to the current Clean Pay user", async () => {
    await expect(productionChatwootContextGateway.loadActor()).resolves.toEqual({ userId: "user-1" });
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(productionChatwootContextGateway.loadActor()).resolves.toBeNull();

    mocks.getAuthorizedRemnashopTokens.mockResolvedValueOnce({
      accessToken: "access-token",
      session: { userId: "other-user" },
    });
    await expect(productionChatwootContextGateway.loadSubscription("user-1"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.remnashopRequest).not.toHaveBeenCalled();
  });

  it("returns only the safe subscription fields", async () => {
    mocks.remnashopRequest.mockResolvedValue({
      status: "ACTIVE",
      plan_name: "Premium",
      expire_at: "2026-09-01T00:00:00.000Z",
      is_trial: false,
      url: "vpn://must-not-leak",
      traffic_limit: 100,
    });

    await expect(productionChatwootContextGateway.loadSubscription("user-1"))
      .resolves.toEqual({
        status: "ACTIVE",
        planName: "Premium",
        expiresAt: "2026-09-01T00:00:00.000Z",
        isTrial: false,
      });
    expect(mocks.remnashopRequest).toHaveBeenCalledWith(
      "/subscription/current",
      { accessToken: "access-token" },
    );
  });

  it("loads five owner-scoped payments without raw provider data or URLs", async () => {
    mocks.findMany.mockResolvedValue([{
      status: "FAILED",
      finalAmount: { toString: () => "299.00" },
      currency: "RUB",
      gatewayType: "CARD",
      planName: "Premium",
      upstreamCreatedAt: new Date("2026-08-10T12:00:00.000Z"),
    }]);
    mocks.findUnique.mockResolvedValue({
      lastSyncedAt: new Date("2026-08-12T11:55:00.000Z"),
      backfillCompletedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    await expect(productionChatwootContextGateway.loadRecentPayments("user-1", 5))
      .resolves.toEqual({
        records: [{
          status: "FAILED",
          finalAmount: "299.00",
          currency: "RUB",
          gatewayType: "CARD",
          planName: "Premium",
          createdAt: "2026-08-10T12:00:00.000Z",
        }],
        synchronizedAt: "2026-08-12T11:55:00.000Z",
      });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }],
      take: 5,
      select: {
        status: true,
        finalAmount: true,
        currency: true,
        gatewayType: true,
        planName: true,
        upstreamCreatedAt: true,
      },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: {
        lastSyncedAt: true,
        backfillCompletedAt: true,
      },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Array),
      { isolationLevel: "RepeatableRead" },
    );
  });

  it("does not invent synchronization freshness when no sync state exists", async () => {
    await expect(productionChatwootContextGateway.loadRecentPayments("user-1", 5))
      .resolves.toEqual({ records: [], synchronizedAt: null });
  });
});
