import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    webUser: { findUnique: vi.fn() },
    paymentOperation: { findFirst: vi.fn() },
    paymentRecord: { findFirst: vi.fn(), findMany: vi.fn() },
    paymentHistorySyncState: { findUnique: vi.fn() },
  },
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getExactTransaction: vi.fn(),
  getLegacyTransactions: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  claimHistory: vi.fn(), loadHistoryPage: vi.fn(), completeHistoryPage: vi.fn(), failHistory: vi.fn(),
  assertPaymentUpstreamIdentity: vi.fn(),
  serializePaymentRecord: vi.fn(),
  syncExactPaymentRecordFromRemnashop: vi.fn(),
  syncPaymentRecordsFromRemnashopTransactions: vi.fn(),
  loggerWarn: vi.fn(),
  recoverRemnashopTelegramSession: vi.fn(),
  remnashopAuth: vi.fn(),
  getRemnashopMe: vi.fn(),
  reconcileUserFromRemnashopAuth: vi.fn(),
  assertRateLimit: vi.fn(),
  assertRateLimitCapacity: vi.fn(),
  assertTargetRateLimit: vi.fn(),
  withAuthConcurrency: vi.fn(),
  revokeWebSessionById: vi.fn(),
  clearWebSessionCookies: vi.fn(),
  createWebSessionForRemnashopUser: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  recoverRemnashopTelegramSession: mocks.recoverRemnashopTelegramSession,
  remnashopAuth: mocks.remnashopAuth,
  getRemnashopMe: mocks.getRemnashopMe,
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
  syncPaymentRecordsFromRemnashopTransactions: mocks.syncPaymentRecordsFromRemnashopTransactions,
}));
vi.mock("@/backend/observability/logger", () => ({ logger: { warn: mocks.loggerWarn } }));
vi.mock("@/backend/integrations/remnashop/session", () => ({
  reconcileUserFromRemnashopAuth: mocks.reconcileUserFromRemnashopAuth,
}));
vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertRateLimitCapacity: mocks.assertRateLimitCapacity,
  assertTargetRateLimit: mocks.assertTargetRateLimit,
  withAuthConcurrency: mocks.withAuthConcurrency,
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  createWebSessionForRemnashopUser: mocks.createWebSessionForRemnashopUser,
}));
vi.mock("@/backend/integrations/sessions/web-session-revocation", () => ({
  revokeWebSessionById: mocks.revokeWebSessionById,
  clearWebSessionCookies: mocks.clearWebSessionCookies,
}));

import { prismaPasskeyAccountReader } from "@/backend/integrations/auth/prisma-passkey-account-reader";
import { createProductionTelegramWebAppGateway } from "@/backend/integrations/auth/telegram-webapp-gateway";
import { loadPaymentHistory } from "@/application/payments/load-payment-history";
import { createProductionPaymentHistoryGateway } from "@/backend/integrations/payments/payment-history-reader";
import { prismaPaymentQueryRepository } from "@/backend/integrations/payments/prisma-payment-query-repository";

const productionTelegramWebAppGateway = createProductionTelegramWebAppGateway();
const productionPaymentHistoryGateway = createProductionPaymentHistoryGateway();

describe("production persistence and Telegram adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withAuthConcurrency.mockImplementation(async (_action: string, work: () => Promise<unknown>) => work());
    mocks.serializePaymentRecord.mockImplementation((record) => ({ id: record.id }));
    mocks.claimHistory.mockResolvedValue({ context: {}, cursor: null });
    mocks.loadHistoryPage.mockResolvedValue({ context: {} });
    mocks.completeHistoryPage.mockResolvedValue({ applied: 0, hasMore: false });
    mocks.prisma.paymentHistorySyncState.findUnique.mockResolvedValue({
      backfillCompletedAt: new Date(),
      lastSyncedAt: new Date(),
      failureCount: 0,
      errorSnapshot: null,
    });
  });

  it("checks passkey existence with a bounded projection", async () => {
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({ webAuthnCredentials: [{ id: "credential-1" }] });
    await expect(prismaPasskeyAccountReader.hasCredential("u@example.com")).resolves.toBe(true);
    expect(mocks.prisma.webUser.findUnique).toHaveBeenCalledWith({
      where: { email: "u@example.com" },
      select: { webAuthnCredentials: { select: { id: true }, take: 1 } },
    });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(null);
    await expect(prismaPasskeyAccountReader.hasCredential("missing@example.com")).resolves.toBe(false);
  });

  it("owner-scopes all payment queries", async () => {
    mocks.prisma.paymentOperation.findFirst.mockResolvedValue(null);
    mocks.prisma.paymentRecord.findFirst.mockResolvedValue(null);
    mocks.prisma.paymentRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ paymentId: "payment-1" }]);

    await prismaPaymentQueryRepository.findOperation("user-1", "operation-1");
    await prismaPaymentQueryRepository.findOperation("user-1", null);
    await prismaPaymentQueryRepository.findRecord("user-1", "payment-1");
    await prismaPaymentQueryRepository.findLatestRecord("user-1");
    await prismaPaymentQueryRepository.findRecentRecords("user-1", 20);
    await expect(prismaPaymentQueryRepository.findPendingPaymentIds("user-1", 5))
      .resolves.toEqual(["payment-1"]);

    expect(mocks.prisma.paymentOperation.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "operation-1", userId: "user-1" },
    }));
    expect(mocks.prisma.paymentRecord.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { userId: "user-1", status: { in: ["PENDING", "UNKNOWN"] } },
      take: 5,
    }));
  });

  it("serves bounded payment history directly from the local snapshot", async () => {
    mocks.prisma.paymentRecord.findMany.mockResolvedValueOnce([{ id: "record-1" }]);

    await expect(loadPaymentHistory(productionPaymentHistoryGateway, "user-1")).resolves.toEqual({
      records: [{ id: "record-1" }],
      status: "current",
    });
    expect(mocks.prisma.paymentRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    expect(mocks.getExactTransaction).not.toHaveBeenCalled();
    expect(mocks.loadHistoryPage).not.toHaveBeenCalled();
  });

  it("does not contact an unavailable provider while rendering cached history", async () => {
    mocks.prisma.paymentRecord.findMany.mockResolvedValueOnce([{ id: "cached-record" }]);
    await expect(loadPaymentHistory(productionPaymentHistoryGateway, "user-1")).resolves.toEqual({
      records: [{ id: "cached-record" }],
      status: "current",
    });
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  });

  it("marks a never-synchronized local history snapshot as stale", async () => {
    mocks.prisma.paymentRecord.findMany.mockResolvedValueOnce([]);
    mocks.prisma.paymentHistorySyncState.findUnique.mockResolvedValueOnce(null);

    await expect(loadPaymentHistory(
      productionPaymentHistoryGateway,
      "user-1",
    )).resolves.toEqual({ records: [], status: "refreshing" });
    expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
  });

  it("distinguishes a failed snapshot from a refresh that is still pending", async () => {
    mocks.prisma.paymentHistorySyncState.findUnique
      .mockResolvedValueOnce({
        backfillCompletedAt: null,
        lastSyncedAt: null,
        errorSnapshot: null,
      })
      .mockResolvedValueOnce({
        backfillCompletedAt: null,
        lastSyncedAt: null,
        errorSnapshot: { code: "UPSTREAM_UNAVAILABLE" },
      });

    await expect(prismaPaymentQueryRepository.readHistorySnapshotStatus("refreshing-user"))
      .resolves.toBe("refreshing");
    await expect(prismaPaymentQueryRepository.readHistorySnapshotStatus("failed-user"))
      .resolves.toBe("unavailable");
  });

  it("leaves legacy history synchronization to the maintenance worker", async () => {
    mocks.prisma.paymentRecord.findMany.mockResolvedValueOnce([]);
    await loadPaymentHistory(productionPaymentHistoryGateway, "user-1");
    expect(mocks.getPaymentCapabilities).not.toHaveBeenCalled();
    expect(mocks.getLegacyTransactions).not.toHaveBeenCalled();
    expect(mocks.syncPaymentRecordsFromRemnashopTransactions).not.toHaveBeenCalled();
  });

  it("implements granular Telegram WebApp provider and persistence operations", async () => {
    mocks.remnashopAuth.mockResolvedValue({
      cookies: { accessToken: "access-token", refreshToken: "refresh-token" },
      data: { user: {} },
    });
    mocks.getRemnashopMe.mockResolvedValue({ telegram_id: 123 });
    mocks.reconcileUserFromRemnashopAuth.mockResolvedValue({
      user: { id: "user-1" },
      remnashopSession: {
        accessTokenEncrypted: "encrypted-access",
        refreshTokenEncrypted: "encrypted-refresh",
        accessExpiresAt: new Date("2026-01-01"),
        refreshExpiresAt: new Date("2026-02-01"),
      },
      requiresTelegramRecovery: true,
    });
    mocks.createWebSessionForRemnashopUser.mockResolvedValue({ id: "session-1" });

    await productionTelegramWebAppGateway.preflightCapacity();
    const concurrencyWork = vi.fn().mockResolvedValue("guarded-result");
    await expect(productionTelegramWebAppGateway.withUpstreamConcurrency(
      "telegram_webapp_login",
      concurrencyWork,
    )).resolves.toBe("guarded-result");

    const provider = await productionTelegramWebAppGateway.authenticateProvider("signed-init-data");
    const identity = await productionTelegramWebAppGateway.verifiedIdentity(provider);
    await productionTelegramWebAppGateway.rateLimit(String(identity.telegramId));
    const reconciled = await productionTelegramWebAppGateway.reconcileIdentity(provider, identity);
    const session = await productionTelegramWebAppGateway.createSession({
      userId: reconciled.userId,
      upstreamSession: reconciled.upstreamSession!,
    });
    await productionTelegramWebAppGateway.recoverSession(session!.id, reconciled.userId);
    await productionTelegramWebAppGateway.revokeSession(session!.id, reconciled.userId);
    await productionTelegramWebAppGateway.clearSessionCookies();
    expect(mocks.assertRateLimitCapacity).toHaveBeenCalledWith("telegram_webapp_login");
    expect(mocks.withAuthConcurrency).toHaveBeenCalledWith("telegram_webapp_login", concurrencyWork);
    expect(mocks.assertTargetRateLimit).toHaveBeenCalledWith(expect.objectContaining({ tgId: "123" }));
    expect(mocks.createWebSessionForRemnashopUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      remnashopAccessTokenEncrypted: "encrypted-access",
    }));
    expect(mocks.recoverRemnashopTelegramSession).toHaveBeenCalledWith("session-1", "user-1");
    expect(mocks.revokeWebSessionById).toHaveBeenCalledWith("session-1", "user-1");
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
  });

  it("returns an unverified Telegram identity for application policy", async () => {
    mocks.remnashopAuth.mockResolvedValue({ cookies: { accessToken: "access", refreshToken: "refresh" }, data: {} });
    mocks.getRemnashopMe.mockResolvedValue({ telegram_id: null });
    const provider = await productionTelegramWebAppGateway.authenticateProvider("bad-init-data");
    await expect(productionTelegramWebAppGateway.verifiedIdentity(provider))
      .resolves.toMatchObject({ telegramId: null });
    expect(mocks.reconcileUserFromRemnashopAuth).not.toHaveBeenCalled();
  });
});
