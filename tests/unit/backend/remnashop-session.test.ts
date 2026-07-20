import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRemnashopMe: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  protectRemnashopToken: vi.fn((token: string) => `protected:${token}`),
  auditLog: vi.fn(),
  authDebugLog: vi.fn(),
  createWebSessionForRemnashopUser: vi.fn(),
  getCurrentSession: vi.fn(),
  mergeLocalUsersIntoTarget: vi.fn(),
  assertUserMergeFinalOwner: vi.fn(),
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
  paymentOperation: { updateMany: vi.fn() },
  paymentHistorySyncState: {
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
  paymentRecord: { updateMany: vi.fn() },
  emailVerificationCode: { updateMany: vi.fn() },
  telegramAuthState: { updateMany: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn().mockResolvedValue([{ id: "user-1" }]),
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

vi.mock("@/backend/auth/user-merge", () => ({
  mergeLocalUsersIntoTarget: mocks.mergeLocalUsersIntoTarget,
  assertUserMergeFinalOwner: mocks.assertUserMergeFinalOwner,
}));

import {
  createSessionFromRemnashopAuth,
  linkCurrentUserToRemnashopAuth,
  reconcileUserFromRemnashopAuth,
} from "@/backend/integrations/remnashop/session";

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
      if (typeof model === "function") {
        model.mockReset();
        return;
      }

      Object.values(model).forEach((fn) => {
        if (typeof fn === "function") fn.mockReset();
      });
    });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("remna-1");
    mocks.getRemnashopMe.mockResolvedValue(profile);
    mocks.mergeLocalUsersIntoTarget.mockResolvedValue({});
    mocks.assertUserMergeFinalOwner.mockResolvedValue({ id: "user-1" });
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.$queryRaw.mockResolvedValue([{
      id: "user-1",
      remnashopUserId: null,
      email: "local@example.com",
      telegramId: null,
    }]);
    tx.webUser.findUnique.mockResolvedValue(null);
    tx.webUser.create.mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerified: true, telegramId: "123" });
    tx.webUser.update.mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerified: true, telegramId: "123" });
    mocks.createWebSessionForRemnashopUser.mockResolvedValue({ id: "session-1" });
    mocks.getCurrentSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      user: {
        id: "user-1",
        remnashopUserId: null,
        email: "local@example.com",
        telegramId: null,
      },
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

  it("requires coordinated Telegram recovery instead of switching an established upstream owner", async () => {
    mocks.getRemnashopMe.mockResolvedValueOnce({
      ...profile,
      email: null,
      is_email_verified: false,
      telegram_id: 123,
    });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({
      id: "local-email-user",
      remnashopUserId: "remna-email-owner",
      email: "user@example.com",
      emailVerified: true,
      telegramId: "123",
    });

    await expect(
      reconcileUserFromRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth }),
    ).resolves.toMatchObject({
      user: { id: "local-email-user" },
      requiresTelegramRecovery: true,
      remnashopSession: undefined,
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.webUser.update).not.toHaveBeenCalled();
  });

  it("requires coordinated recovery for durable pending merge evidence even when Telegram is already the local owner", async () => {
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValueOnce("remna-telegram-owner");
    mocks.getRemnashopMe.mockResolvedValueOnce({
      ...profile,
      email: null,
      is_email_verified: false,
      telegram_id: 123,
    });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({
      id: "local-telegram-user",
      remnashopUserId: "remna-telegram-owner",
      email: null,
      emailVerified: false,
      telegramId: "123",
      authPending: true,
      pendingRemnashopUserId: "remna-email-owner",
      pendingRemnashopEmail: "user@example.com",
    });

    await expect(
      reconcileUserFromRemnashopAuth({
        accessToken: "access",
        refreshToken: "refresh",
        auth,
      }),
    ).resolves.toMatchObject({
      user: { id: "local-telegram-user" },
      requiresTelegramRecovery: true,
      remnashopSession: undefined,
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.webUser.update).not.toHaveBeenCalled();
  });

  it("rejects a generic reconciliation that would overwrite an established upstream owner", async () => {
    tx.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "local-email-user",
        remnashopUserId: "remna-existing",
        email: "user@example.com",
      })
      .mockResolvedValueOnce(null);

    await expect(
      createSessionFromRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
    expect(tx.webUser.update).not.toHaveBeenCalled();
    expect(mocks.createWebSessionForRemnashopUser).not.toHaveBeenCalled();
  });

  it("links current user, merges other matched identities and updates session tokens", async () => {
    mocks.prisma.webUser.findUnique
      .mockResolvedValueOnce({
        id: "other-remna",
        remnashopUserId: "remna-1",
        email: null,
        telegramId: null,
      })
      .mockResolvedValueOnce({
        id: "other-email",
        remnashopUserId: null,
        email: "user@example.com",
        telegramId: null,
      });
    tx.webUser.update.mockResolvedValue({ id: "user-1", email: "user@example.com", emailVerified: true });

    await expect(linkCurrentUserToRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth })).resolves.toMatchObject({
      user: { id: "user-1" },
      profile,
    });

    expect(mocks.mergeLocalUsersIntoTarget).toHaveBeenCalledWith(tx, {
      targetUserId: "user-1",
      targetUpstreamAccountId: "remna-1",
      sourceUserIds: ["other-remna", "other-email"],
      ownerExpectations: [
        {
          id: "user-1",
          remnashopUserId: null,
          email: "local@example.com",
          telegramId: null,
        },
        {
          id: "other-remna",
          remnashopUserId: "remna-1",
          email: null,
          telegramId: null,
        },
        {
          id: "other-email",
          remnashopUserId: null,
          email: "user@example.com",
          telegramId: null,
        },
      ],
    });
    expect(mocks.assertUserMergeFinalOwner).toHaveBeenCalledWith(tx, {
      targetUserId: "user-1",
      sourceUserIds: ["other-remna", "other-email"],
      expected: {
        remnashopUserId: "remna-1",
        email: "user@example.com",
        telegramId: "123",
      },
    });
    expect(tx.webSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: "protected:access",
        remnashopRefreshTokenEncrypted: "protected:refresh",
      }),
    });
  });

  it("keeps a known Telegram id when an email-only Remnashop profile is linked", async () => {
    mocks.getRemnashopMe.mockResolvedValueOnce({
      ...profile,
      telegram_id: null,
      username: null,
    });
    mocks.getCurrentSession.mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      user: {
        id: "user-1",
        remnashopUserId: null,
        email: "user@example.com",
        emailVerified: true,
        telegramId: "123",
        telegramUsername: "clean_user",
        fullName: "Clean User",
        displayName: "Clean User",
      },
    });
    tx.$queryRaw.mockResolvedValueOnce([{
      id: "user-1",
      remnashopUserId: null,
      email: "user@example.com",
      telegramId: "123",
    }]);

    await linkCurrentUserToRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth });

    expect(tx.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({
        remnashopUserId: "remna-1",
        email: "user@example.com",
        emailVerified: true,
        telegramId: "123",
        telegramUsername: "clean_user",
      }),
    });
  });

  it("clears sibling upstream token bundles after an upstream merge", async () => {
    await linkCurrentUserToRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
      invalidateSiblingRemnashopTokens: true,
    });

    expect(tx.webSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        id: { not: "session-1" },
        revokedAt: null,
      },
      data: {
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopAccessExpiresAt: null,
        remnashopRefreshExpiresAt: null,
      },
    });
  });

  it("does not overwrite a current owner that changed after the link proof", async () => {
    tx.$queryRaw.mockResolvedValueOnce([{
      id: "user-1",
      remnashopUserId: "another-owner",
      email: "another@example.com",
      telegramId: null,
    }]);

    await expect(linkCurrentUserToRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
    })).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(tx.webUser.update).not.toHaveBeenCalled();
    expect(tx.webSession.update).not.toHaveBeenCalled();
  });

  it("requires a current session for explicit account linking", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);

    await expect(linkCurrentUserToRemnashopAuth({ accessToken: "access", refreshToken: "refresh", auth })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
