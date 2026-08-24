import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  getJwtExpiresAt: vi.fn(),
  getRemnashopMe: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({
  assertEmailVerificationPolicy: vi.fn(),
  getCurrentSessionReadOnly: vi.fn(),
}));
const tokenMock = vi.hoisted(() => ({
  revealRemnashopToken: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/api-client", () => apiMock);
vi.mock("@/backend/integrations/remnashop/token-protection", () => tokenMock);
vi.mock("@/backend/integrations/sessions/web-session-service", () => sessionMock);
vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: vi.fn(),
}));

import { ServiceError } from "@/backend/errors/service-error";
import { getStoredAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/stored-session-authorization";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function session(overrides: Record<string, unknown> = {}) {
  const base = {
    id: "session-1",
    userId: "user-1",
    authMethod: "TELEGRAM",
    assuranceLevel: "FULL",
    remnashopAccessTokenEncrypted: "protected:access",
    remnashopRefreshTokenEncrypted: "protected:refresh",
    remnashopAccessExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
    remnashopRefreshExpiresAt: new Date(NOW.getTime() + 60 * 60_000),
    remnashopRefreshClaimTokenHash: null,
    remnashopRefreshLeaseExpiresAt: null,
    remnashopRefreshDispatchedAt: null,
    remnashopRefreshRecoveryEncrypted: null,
    revokedAt: null,
    user: {
      id: "user-1",
      remnashopUserId: "42",
      email: null,
      emailVerified: false,
      authPending: false,
      pendingRemnashopUserId: null,
      pendingRemnashopEmail: null,
      telegramId: "123456",
      telegramUsername: "clean_user",
    },
  };

  return {
    ...base,
    ...overrides,
    user: {
      ...base.user,
      ...((overrides.user as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

function authorize(
  value: ReturnType<typeof session> | null,
  options: Parameters<typeof getStoredAuthorizedRemnashopTokens>[0] = {},
) {
  sessionMock.getCurrentSessionReadOnly.mockResolvedValueOnce(value as never);
  return getStoredAuthorizedRemnashopTokens(options);
}

describe("stored-only Remnashop session authorization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    tokenMock.revealRemnashopToken.mockImplementation((value: string) => {
      if (!value.startsWith("protected:")) throw new Error("corrupt token");
      return value.slice("protected:".length);
    });
    apiMock.getJwtExpiresAt.mockReturnValue(
      new Date(NOW.getTime() + 10 * 60_000),
    );
    apiMock.getRemnashopUserIdFromAccessToken.mockReturnValue("42");
    apiMock.getRemnashopMe.mockResolvedValue({
      email: "user@example.com",
      is_email_verified: true,
    });
    sessionMock.assertEmailVerificationPolicy.mockImplementation(
      (user: { emailVerified: boolean; telegramId: string | null }) => {
        if (!user.emailVerified && !user.telegramId) {
          throw new ServiceError("EMAIL_NOT_VERIFIED", 403);
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses only the current session's already-usable stored bundle", async () => {
    await expect(
      authorize(session(), {
        allowUnverifiedEmail: true,
      }),
    ).resolves.toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      session: { id: "session-1", userId: "user-1" },
    });

    expect(sessionMock.getCurrentSessionReadOnly).toHaveBeenCalledOnce();
    expect(tokenMock.revealRemnashopToken).toHaveBeenCalledTimes(2);
    expect(apiMock.getRemnashopMe).not.toHaveBeenCalled();
  });

  it.each([
    [
      "near-expiry access",
      { remnashopAccessExpiresAt: new Date(NOW.getTime() + 30_000) },
    ],
    [
      "expired refresh",
      { remnashopRefreshExpiresAt: new Date(NOW.getTime() - 1) },
    ],
    ["partial bundle", { remnashopRefreshTokenEncrypted: null }],
    ["corrupt bundle", { remnashopAccessTokenEncrypted: "corrupt" }],
    ["active refresh claim", { remnashopRefreshClaimTokenHash: "claim" }],
    [
      "active refresh lease",
      { remnashopRefreshLeaseExpiresAt: new Date(NOW.getTime() + 60_000) },
    ],
    [
      "dispatched refresh",
      { remnashopRefreshDispatchedAt: new Date(NOW.getTime() - 1_000) },
    ],
    [
      "pending refresh recovery",
      { remnashopRefreshRecoveryEncrypted: "recovery" },
    ],
  ])("fails closed for %s without attempting provider recovery", async (_name, overrides) => {
    await expect(
      authorize(session(overrides), {
        allowUnverifiedEmail: true,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 503 });

    expect(apiMock.getRemnashopMe).not.toHaveBeenCalled();
  });

  it("rejects a JWT that expires inside the refresh threshold", async () => {
    apiMock.getJwtExpiresAt.mockReturnValueOnce(
      new Date(NOW.getTime() + 30_000),
    );

    await expect(
      authorize(session(), { allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 503 });

    expect(apiMock.getRemnashopUserIdFromAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ["unfinished owner transition", { user: { authPending: true } }],
    [
      "local owner mismatch",
      { user: { remnashopUserId: "7" } },
    ],
    [
      "pending owner mismatch",
      { user: { pendingRemnashopUserId: "7" } },
    ],
  ])("rejects %s instead of merging or recovering", async (_name, overrides) => {
    await expect(
      authorize(session(overrides), {
        allowUnverifiedEmail: true,
      }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(apiMock.getRemnashopMe).not.toHaveBeenCalled();
  });

  it("preserves verified-email ownership checks without persisting state", async () => {
    const value = session({
      user: { email: "user@example.com", emailVerified: true },
    });
    apiMock.getRemnashopMe.mockResolvedValueOnce({
      email: "other@example.com",
      is_email_verified: true,
    });

    await expect(
      authorize(value),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(sessionMock.assertEmailVerificationPolicy).toHaveBeenCalledWith(
      value.user,
    );
    expect(apiMock.getRemnashopMe).toHaveBeenCalledWith("access");
  });

  it("reflects upstream e-mail verification only in the returned snapshot", async () => {
    const value = session({
      user: { email: "user@example.com", emailVerified: false },
    });

    await expect(
      authorize(value),
    ).resolves.toMatchObject({ session: { user: { emailVerified: true } } });

    expect(value.user.emailVerified).toBe(false);
    expect(apiMock.getRemnashopMe).toHaveBeenCalledWith("access");
  });

  it("keeps missing and bootstrap sessions fail-closed", async () => {
    await expect(
      authorize(null),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(
      authorize(session({ assuranceLevel: "BOOTSTRAP" })),
    ).rejects.toMatchObject({ code: "PASSKEY_REQUIRED", status: 403 });

    expect(tokenMock.revealRemnashopToken).not.toHaveBeenCalled();
  });
});
