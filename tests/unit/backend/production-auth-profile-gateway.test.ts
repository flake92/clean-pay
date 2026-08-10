import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(), refreshCurrentAccessCookie: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(), getRemnashopMe: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(), confirmVerifiedEmail: vi.fn(), debug: vi.fn(),
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession,
  refreshCurrentAccessCookie: mocks.refreshCurrentAccessCookie,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  getRemnashopMe: mocks.getRemnashopMe,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
}));
vi.mock("@/backend/integrations/profile/prisma-profile-account-repository", () => ({
  prismaProfileAccountRepository: { confirmVerifiedEmail: mocks.confirmVerifiedEmail },
}));
vi.mock("@/backend/observability/auth-debug-log", () => ({ authDebugLog: mocks.debug }));

import { ServiceError } from "@/backend/errors/service-error";
import { productionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";

const session = {
  id: "session-1", userId: "user-1", authMethod: "EMAIL",
  remnashopAccessTokenEncrypted: "access", remnashopRefreshTokenEncrypted: "refresh",
  user: {
    email: "u@example.com", emailVerified: false, telegramId: "777", telegramUsername: "user",
    fullName: "Full", displayName: "Display", remnashopUserId: "upstream-1",
    pendingRemnashopUserId: null, pendingRemnashopEmail: null, authPending: false,
  },
};

describe("production auth profile gateway", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("maps session and provider DTOs into application port models", async () => {
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({ accessToken: "token", session });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("upstream-1");
    mocks.getRemnashopMe.mockResolvedValue({ email: "u@example.com", is_email_verified: true, pending_email: "next@example.com", name: "Provider", telegram_id: 888n });

    await expect(productionAuthProfileGateway.loadCurrentSession()).resolves.toMatchObject({
      id: "session-1", hasUpstreamTokens: true,
      user: { upstreamUserId: "upstream-1", accountSyncPending: false },
    });
    const authorized = await productionAuthProfileGateway.authorizeCurrentSession();
    expect(mocks.getAuthorizedRemnashopTokens).toHaveBeenCalledWith({ allowUnverifiedEmail: true });
    await expect(productionAuthProfileGateway.loadProviderProfile(authorized)).resolves.toEqual({
      email: "u@example.com", emailVerified: true, pendingEmail: "next@example.com", name: "Provider", telegramId: "888",
    });
  });

  it("translates backend failures and exposes persistence as granular operations", async () => {
    mocks.getAuthorizedRemnashopTokens.mockRejectedValueOnce(new ServiceError("PASSKEY_REQUIRED", 403));
    await expect(productionAuthProfileGateway.authorizeCurrentSession()).rejects.toMatchObject({ code: "PASSKEY_REQUIRED" });
    mocks.getCurrentSession.mockRejectedValueOnce(new Error("database offline"));
    await expect(productionAuthProfileGateway.loadCurrentSession()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    await productionAuthProfileGateway.confirmVerifiedEmail("user-1");
    await productionAuthProfileGateway.refreshCurrentAccess();
    productionAuthProfileGateway.debug("event", { userId: "user-1" });
    expect(mocks.confirmVerifiedEmail).toHaveBeenCalledWith("user-1");
    expect(mocks.refreshCurrentAccessCookie).toHaveBeenCalledOnce();
    expect(mocks.debug).toHaveBeenCalledWith("event", { userId: "user-1" });
  });
});
