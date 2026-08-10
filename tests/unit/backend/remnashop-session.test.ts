import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRemnashopMe: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
  protectRemnashopToken: vi.fn((token: string) => `protected:${token}`),
  auditLog: vi.fn(),
  logTechnicalError: vi.fn(),
  authDebugLog: vi.fn(),
  clearWebSessionCookies: vi.fn(),
  createWebSessionForRemnashopUser: vi.fn(),
  getCurrentSession: vi.fn(),
  revokeAllWebSessionsForUser: vi.fn(),
  mergeLocalUsersIntoTarget: vi.fn(),
  assertUserMergeFinalOwner: vi.fn(),
  lockPaymentOwnerFence: vi.fn(),
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
  logTechnicalError: mocks.logTechnicalError,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  clearWebSessionCookies: mocks.clearWebSessionCookies,
  createWebSessionForRemnashopUser: mocks.createWebSessionForRemnashopUser,
  getCurrentSession: mocks.getCurrentSession,
  revokeAllWebSessionsForUser: mocks.revokeAllWebSessionsForUser,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/integrations/auth/local-user-merge-service", () => ({
  mergeLocalUsersIntoTarget: mocks.mergeLocalUsersIntoTarget,
  assertUserMergeFinalOwner: mocks.assertUserMergeFinalOwner,
}));

vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({
  lockPaymentOwnerFence: mocks.lockPaymentOwnerFence,
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
    mocks.lockPaymentOwnerFence.mockImplementation(
      async (_tx: unknown, userIds: string[]) => userIds,
    );
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
      replaceExistingSessions: false,
      tx,
    });
  });

  it("replaces prior local sessions for password-reset authentication", async () => {
    await expect(createSessionFromRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
      replaceExistingSessions: true,
    })).resolves.toMatchObject({ user: { id: "user-1" } });

    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.createWebSessionForRemnashopUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        replaceExistingSessions: true,
        tx,
      }),
    );
  });

  it("fails closed when password-reset session replacement cannot commit", async () => {
    const replacementError = new Error("replacement failed");
    mocks.createWebSessionForRemnashopUser.mockRejectedValueOnce(replacementError);

    await expect(createSessionFromRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
      replaceExistingSessions: true,
    })).rejects.toThrow(replacementError);

    expect(mocks.revokeAllWebSessionsForUser).toHaveBeenCalledWith("user-1");
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
  });

  it("revokes every split identity when password-reset replacement rolls back after a merge", async () => {
    const remnashopOwner = {
      id: "remnashop-owner",
      remnashopUserId: "remna-1",
      email: null,
      telegramId: null,
      telegramUsername: null,
      fullName: null,
      displayName: null,
      emailVerified: false,
    };
    const emailOwner = {
      id: "email-owner",
      remnashopUserId: null,
      email: "user@example.com",
      telegramId: null,
      telegramUsername: null,
      fullName: null,
      displayName: null,
      emailVerified: true,
    };
    const telegramOwner = {
      id: "telegram-owner",
      remnashopUserId: null,
      email: null,
      telegramId: "123",
      telegramUsername: "clean_user",
      fullName: "Clean User",
      displayName: "Clean User",
      emailVerified: false,
    };
    const replacementError = new Error("replacement failed after merge");
    tx.webUser.findUnique
      .mockResolvedValueOnce(remnashopOwner)
      .mockResolvedValueOnce(emailOwner)
      .mockResolvedValueOnce(telegramOwner);
    tx.webUser.update.mockResolvedValueOnce({
      ...emailOwner,
      remnashopUserId: "remna-1",
      telegramId: "123",
    });
    mocks.createWebSessionForRemnashopUser.mockRejectedValueOnce(
      replacementError,
    );

    await expect(
      createSessionFromRemnashopAuth({
        accessToken: "access",
        refreshToken: "refresh",
        auth,
        replaceExistingSessions: true,
        replacementIdentityEmail: "user@example.com",
      }),
    ).rejects.toBe(replacementError);

    expect(mocks.mergeLocalUsersIntoTarget).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        targetUserId: "email-owner",
        sourceUserIds: ["remnashop-owner", "telegram-owner"],
      }),
    );
    expect(mocks.revokeAllWebSessionsForUser.mock.calls).toEqual([
      ["remnashop-owner"],
      ["email-owner"],
      ["telegram-owner"],
    ]);
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
  });

  it("revokes an existing Remnashop owner's sessions when profile loading fails after reset", async () => {
    const profileError = new Error("profile unavailable");
    mocks.getRemnashopMe.mockRejectedValueOnce(profileError);
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({ id: "existing-owner" });

    await expect(createSessionFromRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
      replaceExistingSessions: true,
      replacementIdentityEmail: "user@example.com",
    })).rejects.toThrow(profileError);

    expect(mocks.prisma.webUser.findUnique).toHaveBeenCalledWith({
      where: { remnashopUserId: "remna-1" },
      select: { id: true },
    });
    expect(mocks.revokeAllWebSessionsForUser).toHaveBeenCalledWith("existing-owner");
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("clears reset cookies without revoking an unrelated user when profile loading finds no owner", async () => {
    const profileError = new Error("profile unavailable");
    mocks.getRemnashopMe.mockRejectedValueOnce(profileError);
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(null);

    await expect(createSessionFromRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
      replaceExistingSessions: true,
      replacementIdentityEmail: "user@example.com",
    })).rejects.toThrow(profileError);

    expect(mocks.prisma.webUser.findUnique).toHaveBeenNthCalledWith(1, {
      where: { remnashopUserId: "remna-1" },
      select: { id: true },
    });
    expect(mocks.prisma.webUser.findUnique).toHaveBeenNthCalledWith(2, {
      where: { email: "user@example.com" },
      select: { id: true },
    });
    expect(mocks.revokeAllWebSessionsForUser).not.toHaveBeenCalled();
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
  });

  it("falls back to the unique reset email when the parsed Remnashop owner is not linked locally", async () => {
    const profileError = new Error("profile unavailable");
    mocks.getRemnashopMe.mockRejectedValueOnce(profileError);
    mocks.prisma.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "email-owner" });

    await expect(createSessionFromRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
      replaceExistingSessions: true,
      replacementIdentityEmail: "user@example.com",
    })).rejects.toThrow(profileError);

    expect(mocks.prisma.webUser.findUnique).toHaveBeenNthCalledWith(1, {
      where: { remnashopUserId: "remna-1" },
      select: { id: true },
    });
    expect(mocks.prisma.webUser.findUnique).toHaveBeenNthCalledWith(2, {
      where: { email: "user@example.com" },
      select: { id: true },
    });
    expect(mocks.revokeAllWebSessionsForUser).toHaveBeenCalledWith("email-owner");
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
  });

  it("falls back to the normalized reset email when the access-token owner cannot be parsed", async () => {
    const tokenError = new Error("missing sub");
    mocks.getRemnashopUserIdFromAccessToken.mockImplementationOnce(() => {
      throw tokenError;
    });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({ id: "email-owner" });

    await expect(createSessionFromRemnashopAuth({
      accessToken: "malformed-access",
      refreshToken: "refresh",
      auth,
      replaceExistingSessions: true,
      replacementIdentityEmail: " User@Example.COM ",
    })).rejects.toThrow(tokenError);

    expect(mocks.getRemnashopMe).not.toHaveBeenCalled();
    expect(mocks.prisma.webUser.findUnique).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      select: { id: true },
    });
    expect(mocks.revokeAllWebSessionsForUser).toHaveBeenCalledWith("email-owner");
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
  });

  it("preserves the profile error and still clears cookies when fail-closed revocation fails", async () => {
    const profileError = new Error("profile unavailable");
    const revokeError = new Error("database unavailable");
    mocks.getRemnashopMe.mockRejectedValueOnce(profileError);
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce({ id: "existing-owner" });
    mocks.revokeAllWebSessionsForUser.mockRejectedValueOnce(revokeError);

    const replacement = createSessionFromRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
      replaceExistingSessions: true,
      replacementIdentityEmail: "user@example.com",
    });

    await expect(replacement).rejects.toBe(profileError);
    expect(mocks.clearWebSessionCookies).toHaveBeenCalledOnce();
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "remnashop_session_replacement_revoke_failed",
      revokeError,
      expect.objectContaining({
        hasRemnashopUserId: true,
        hasFallbackEmail: true,
      }),
    );
  });

  it("does not run replacement cleanup for an ordinary login profile failure", async () => {
    const profileError = new Error("profile unavailable");
    mocks.getRemnashopMe.mockRejectedValueOnce(profileError);

    await expect(createSessionFromRemnashopAuth({
      accessToken: "access",
      refreshToken: "refresh",
      auth,
    })).rejects.toThrow(profileError);

    expect(mocks.prisma.webUser.findUnique).not.toHaveBeenCalled();
    expect(mocks.revokeAllWebSessionsForUser).not.toHaveBeenCalled();
    expect(mocks.clearWebSessionCookies).not.toHaveBeenCalled();
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
      paymentOwnerFenceHeld: true,
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
