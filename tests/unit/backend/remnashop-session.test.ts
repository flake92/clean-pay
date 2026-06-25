import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRemnashopMe: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  protectRemnashopToken: vi.fn((token: string) => `protected:${token}`),
  auditLog: vi.fn(),
  authDebugLog: vi.fn(),
  createWebSessionForRemnashopUser: vi.fn(),
  getCurrentSession: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    webUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const tx = vi.hoisted(() => ({
  webUser: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  webSession: { update: vi.fn(), updateMany: vi.fn() },
  auditLog: { updateMany: vi.fn() },
  paymentRecord: { updateMany: vi.fn() },
  emailVerificationCode: { updateMany: vi.fn() },
  telegramAuthState: { updateMany: vi.fn() },
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getRemnashopMe: mocks.getRemnashopMe,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
  protectRemnashopToken: mocks.protectRemnashopToken,
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

vi.mock("@/backend/sessions/web-session", () => ({
  createWebSessionForRemnashopUser: mocks.createWebSessionForRemnashopUser,
  getCurrentSession: mocks.getCurrentSession,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  createSessionFromRemnashopAuth,
  linkCurrentUserToRemnashopAuth,
  reconcileUserFromRemnashopAuth,
} from "@/backend/integrations/remnashop/session";
import { BffError } from "@/backend/integrations/remnashop/errors";

const auth = {
  expires_at: "2026-06-25T10:00:00.000Z",
  refresh_expires_at: "2026-07-25T10:00:00.000Z",
};

const profile = {
  email: "user@example.com",
  is_email_verified: true,
  telegram_id: 123,
  username: "clean_user",
  name: "Clean User",
  auth_type: "email",
  pending_email: null,
  language: "ru",
};

describe("Remnashop session reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(tx).forEach((model) => {
      Object.values(model).forEach((fn) => {
        if (typeof fn === "function") fn.mockReset();
      });
    });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("remna-1");
    mocks.getRemnashopMe.mockResolvedValue(profile);
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.webUser.findUnique.mockResolvedValue(null);
    tx.webUser.create.mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerified: true, telegramId: "123" });
    tx.webUser.update.mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerified: true, telegramId: "123" });
    mocks.createWebSessionForRemnashopUser.mockResolvedValue({ id: "session-1" });
    mocks.getCurrentSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      user: { email: "local@example.com" },
    });
    mocks.prisma.webUser.findUnique.mockResolvedValue(null);
  });

  it("creates a local user and web session from Remnashop auth", async () => {
    await expect(
      createSessionFromRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth }),
    ).resolves.toMatchObject({
      user: { id: "user-1" },
      profile,
    });

    expect(tx.webUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        remnashopUserId: "remna-1",
        email: "user@example.com",
        telegramId: "123",
        authPending: false,
      }),
    });
    expect(mocks.createWebSessionForRemnashopUser).toHaveBeenCalledWith({
      userId: "user-1",
      remnashopAccessTokenEncrypted: "protected:access",
      remnashopRefreshTokenEncrypted: "protected:refresh",
      remnashopAccessExpiresAt: new Date(auth.expires_at),
      remnashopRefreshExpiresAt: new Date(auth.refresh_expires_at),
      assuranceLevel: "FULL",
      tx,
    });
  });

  it("reconciles an existing user from Remnashop auth without creating a session", async () => {
    tx.webUser.findUnique.mockResolvedValueOnce({ id: "user-email-match" }).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tx.webUser.update.mockResolvedValue({ id: "user-email-match", email: "user@example.com" });

    await expect(reconcileUserFromRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth })).resolves.toMatchObject({
      user: { id: "user-email-match" },
      remnashopSession: {
        accessTokenEncrypted: "protected:access",
        refreshTokenEncrypted: "protected:refresh",
      },
    });

    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "remnashop_account_linked" }));
  });

  it("links current user, merges other matched identities and updates session tokens", async () => {
    mocks.prisma.webUser.findUnique
      .mockResolvedValueOnce({ id: "other-remna" })
      .mockResolvedValueOnce({ id: "other-email" });
    tx.webUser.update.mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerified: true });

    await expect(linkCurrentUserToRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth })).resolves.toMatchObject({
      user: { id: "user-1" },
      profile,
    });

    expect(tx.webUser.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["other-remna", "other-email"] } },
      data: { remnashopUserId: null, email: null, telegramId: null },
    });
    expect(tx.webSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: "protected:access",
        remnashopRefreshTokenEncrypted: "protected:refresh",
      }),
    });
  });

  it("requires a current session for explicit account linking", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);

    await expect(linkCurrentUserToRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth })).rejects.toMatchObject<BffError>({
      code: "UNAUTHORIZED",
    });
  });
});
