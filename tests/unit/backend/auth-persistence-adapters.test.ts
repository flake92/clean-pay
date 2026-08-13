import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    accountMergeConfirmation: { findFirst: vi.fn() },
    webSession: { update: vi.fn() },
    webUser: { update: vi.fn() },
  },
  sha256: vi.fn((value: string) => `hash:${value}`),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/security/crypto", () => ({ sha256: mocks.sha256 }));

import {
  getTelegramAccountMergeConfirmation,
  telegramAccountMergeCookieMaxAgeSeconds,
  telegramAccountMergeCookieName,
} from "@/backend/integrations/auth/telegram-account-merge-store";
import { prismaProfileAccountRepository } from "@/backend/integrations/profile/prisma-profile-account-repository";

describe("authentication persistence adapters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads a user-scoped merge confirmation and exposes only masked identity data", async () => {
    const expiresAt = new Date("2026-08-10T10:00:00Z");
    mocks.prisma.accountMergeConfirmation.findFirst.mockResolvedValue({
      sourceEmail: "  User.Name@Example.COM ",
      targetEmail: "target@example.com",
      telegramId: "7295815705",
      status: "PENDING",
      expiresAt,
    });

    await expect(getTelegramAccountMergeConfirmation("secret-token", "user-1")).resolves.toEqual({
      targetEmail: "target@example.com",
      sourceEmailMasked: "us*******@example.com",
      emailWillBeReplaced: true,
      telegramId: "7295815705",
      status: "PENDING",
      expiresAt,
    });
    expect(mocks.prisma.accountMergeConfirmation.findFirst).toHaveBeenCalledWith({
      where: { tokenHash: "hash:secret-token", userId: "user-1" },
    });
    expect(telegramAccountMergeCookieName).toBe("clean_pay_account_merge");
    expect(telegramAccountMergeCookieMaxAgeSeconds).toBe(600);
  });

  it("does not report replacement when normalized addresses are equal", async () => {
    mocks.prisma.accountMergeConfirmation.findFirst.mockResolvedValue({
      sourceEmail: " User@Example.com ", targetEmail: "user@example.COM",
      telegramId: "1", status: "PENDING", expiresAt: new Date(),
    });

    await expect(getTelegramAccountMergeConfirmation("token", "user-1")).resolves.toMatchObject({
      emailWillBeReplaced: false,
    });
  });

  it("fails closed when the merge confirmation cannot be found", async () => {
    mocks.prisma.accountMergeConfirmation.findFirst.mockResolvedValue(null);

    await expect(getTelegramAccountMergeConfirmation("expired", "user-1")).rejects.toMatchObject({
      code: "NOT_FOUND", status: 404,
    });
  });

  it("confirms the local e-mail and clears pending provider identity", async () => {
    await prismaProfileAccountRepository.confirmVerifiedEmail("user-1");
    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        emailVerified: true,
        authPending: false,
        pendingRemnashopUserId: null,
        pendingRemnashopEmail: null,
      },
    });
  });
});
