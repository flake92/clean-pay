import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    webUser: { findUnique: vi.fn() },
    paymentOperation: { findFirst: vi.fn() },
    paymentRecord: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  getAuthorizedRemnashopTokens: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  getExactTransaction: vi.fn(),
  getLegacyTransactions: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  syncOnePaymentHistoryPage: vi.fn(),
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
vi.mock("@/backend/integrations/payments/payment-history-sync-service", () => ({
  syncOnePaymentHistoryPage: mocks.syncOnePaymentHistoryPage,
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
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  createWebSessionForRemnashopUser: mocks.createWebSessionForRemnashopUser,
}));

import { prismaPasskeyAccountReader } from "@/backend/integrations/auth/prisma-passkey-account-reader";
import { productionTelegramSessionRecovery } from "@/backend/integrations/auth/telegram-session-recovery";
import { productionTelegramWebAppAuthenticator } from "@/backend/integrations/auth/telegram-webapp";
import { loadPaymentHistory } from "@/backend/integrations/payments/payment-history-reader";
import { prismaPaymentQueryRepository } from "@/backend/integrations/payments/prisma-payment-query-repository";

describe("production persistence and Telegram adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serializePaymentRecord.mockImplementation((record) => ({ id: record.id }));
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

  it("refreshes bounded payment history and degrades individual exact lookups", async () => {
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token" });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-user-1");
    mocks.getPaymentCapabilities.mockResolvedValue({ transactions: { max_page_size: 500 } });
    mocks.prisma.paymentRecord.findMany
      .mockResolvedValueOnce([{ paymentId: "payment-1" }, { paymentId: "payment-2" }])
      .mockResolvedValueOnce([{ id: "record-1" }]);
    mocks.getExactTransaction
      .mockResolvedValueOnce({ payment_id: "payment-1" })
      .mockRejectedValueOnce(new Error("one lookup failed"));

    await expect(loadPaymentHistory("user-1")).resolves.toEqual({ records: [{ id: "record-1" }], stale: true });
    expect(mocks.syncExactPaymentRecordFromRemnashop).toHaveBeenCalledOnce();
    expect(mocks.syncOnePaymentHistoryPage).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));
    expect(mocks.loggerWarn).toHaveBeenCalledWith("payment_history_exact_sync_failed", expect.anything(), expect.anything());
  });

  it("serves owner-bound cached history when the provider is unavailable", async () => {
    mocks.getAuthorizedRemnashopTokens.mockRejectedValue(new Error("offline"));
    mocks.prisma.paymentRecord.findMany.mockResolvedValueOnce([{ id: "cached-record" }]);
    await expect(loadPaymentHistory("user-1")).resolves.toEqual({
      records: [{ id: "cached-record" }],
      stale: true,
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith("payment_history_sync_degraded", expect.anything(), expect.anything());
  });

  it("supports the legacy payment history endpoint", async () => {
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "access-token" });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-user-1");
    mocks.getPaymentCapabilities.mockResolvedValue(null);
    mocks.getLegacyTransactions.mockResolvedValue([{ payment_id: "payment-1" }]);
    mocks.prisma.paymentRecord.findMany.mockResolvedValueOnce([]);
    await loadPaymentHistory("user-1");
    expect(mocks.syncPaymentRecordsFromRemnashopTransactions).toHaveBeenCalledWith({
      userId: "user-1",
      upstreamAccountId: "upstream-user-1",
      transactions: [{ payment_id: "payment-1" }],
    });
  });

  it("delegates explicit Telegram session recovery", async () => {
    await productionTelegramSessionRecovery.recover("session-1", "user-1");
    expect(mocks.recoverRemnashopTelegramSession).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("authenticates Telegram WebApp data and recovers the reconciled session", async () => {
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

    await productionTelegramWebAppAuthenticator.authenticate("signed-init-data");
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ tgId: 123 }));
    expect(mocks.createWebSessionForRemnashopUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      remnashopAccessTokenEncrypted: "encrypted-access",
    }));
    expect(mocks.recoverRemnashopTelegramSession).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("rejects an unverified Telegram identity", async () => {
    mocks.remnashopAuth.mockResolvedValue({ cookies: { accessToken: "access", refreshToken: "refresh" }, data: {} });
    mocks.getRemnashopMe.mockResolvedValue({ telegram_id: null });
    await expect(productionTelegramWebAppAuthenticator.authenticate("bad-init-data"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(mocks.reconcileUserFromRemnashopAuth).not.toHaveBeenCalled();
  });
});
