import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCurrentSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/app/_composition/request-scoped-readers", () => ({
  requestAuthProfileGateway: {
    loadCurrentSession: mocks.loadCurrentSession,
  },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  requestSessionHasNoEmailToConfirm,
  requestSessionRequiresEmailVerification,
  requireCabinetEntrySession,
  requireRequestSession,
} from "@/app/_composition/require-request-session";

describe("database-backed protected setup boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a current database session on the protected setup page", async () => {
    const session = { id: "session-1" };
    mocks.loadCurrentSession.mockResolvedValueOnce(session);

    await expect(requireRequestSession("/passkey/setup?redirect_to=%2Fpayment"))
      .resolves.toBe(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends a stale signed access cookie through the cookie-capable refresh boundary", async () => {
    mocks.loadCurrentSession.mockResolvedValueOnce(null);
    mocks.redirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireRequestSession(
      "/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro",
    )).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth/session/refresh?return_to=%2Fregister%2Fverify-email%3Fredirect_to%3D%252Fpayment%253Fplan%253Dpro",
    );
  });

  it("does not turn a database outage into a false logout", async () => {
    mocks.loadCurrentSession.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(requireRequestSession("/passkey/setup"))
      .rejects.toThrow("database unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("gates an e-mail-present unverified web-only session before cabinet rendering", async () => {
    const session = {
      id: "session-unverified-web",
      user: {
        email: "web-unverified@example.com",
        emailVerified: false,
        telegramId: null,
      },
    };
    mocks.loadCurrentSession.mockResolvedValueOnce(session);
    mocks.redirect.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireCabinetEntrySession()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/register/verify-email?redirect_to=%2Fcabinet",
    );
  });

  it("never locks a Telegram-linked account out of the cabinet over an unverified local e-mail", async () => {
    const session = {
      id: "session-unverified-linked",
      user: {
        email: "linked-unverified@example.com",
        emailVerified: false,
        telegramId: "777000",
      },
    };
    mocks.loadCurrentSession.mockResolvedValueOnce(session);

    expect(requestSessionRequiresEmailVerification(session)).toBe(false);
    await expect(requireCabinetEntrySession()).resolves.toBe(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preserves cabinet access for Telegram-only and verified e-mail sessions", async () => {
    const telegramOnly = {
      id: "session-telegram-only",
      user: { email: null, emailVerified: false, telegramId: "777001" },
    };
    const verifiedEmail = {
      id: "session-verified-email",
      user: {
        email: "verified@example.com",
        emailVerified: true,
        telegramId: "777002",
      },
    };

    expect(requestSessionRequiresEmailVerification(telegramOnly)).toBe(false);
    expect(requestSessionRequiresEmailVerification(verifiedEmail)).toBe(false);
    mocks.loadCurrentSession.mockResolvedValueOnce(telegramOnly);
    await expect(requireCabinetEntrySession()).resolves.toBe(telegramOnly);
    mocks.loadCurrentSession.mockResolvedValueOnce(verifiedEmail);
    await expect(requireCabinetEntrySession()).resolves.toBe(verifiedEmail);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not offer the confirmation page to a Telegram account that has nothing to confirm", () => {
    const nothingStaged = {
      user: { email: "half@example.com", emailVerified: false, telegramId: "777003", pendingEmail: null },
    };
    const stagedForConfirmation = {
      user: { email: "half@example.com", emailVerified: false, telegramId: "777003", pendingEmail: "half@example.com" },
    };
    const webOnly = {
      user: { email: "web@example.com", emailVerified: false, telegramId: null, pendingEmail: null },
    };

    expect(requestSessionHasNoEmailToConfirm(nothingStaged)).toBe(true);
    expect(requestSessionHasNoEmailToConfirm(stagedForConfirmation)).toBe(false);
    expect(requestSessionHasNoEmailToConfirm(webOnly)).toBe(false);
  });
});
