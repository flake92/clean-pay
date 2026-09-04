import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeTelegramCallback: vi.fn(),
  resolveVerifiedTelegramIdentity: vi.fn(),
  gatewayConsume: vi.fn(),
  readTelegramCallbackCookieProof: vi.fn(),
  clearTelegramAuthCookiesOnResponse: vi.fn(),
  resumeTelegramOidcCodeExchange: vi.fn(),
  resumeTelegramProviderAuthentication: vi.fn(),
  clearReferralAttributionCookieOnResponse: vi.fn(),
  createWebSessionOnResponse: vi.fn(),
  setDurableCallbackWebSessionCookies: vi.fn(),
  setDurableCallbackReplayCookies: vi.fn(),
  loadDurableTelegramCallback: vi.fn(),
  checkpointDurableTelegramIdentityResolved: vi.fn(),
  checkpointDurableTelegramOutcome: vi.fn(),
  checkpointDurableTelegramRecoveryCommitted: vi.fn(),
  markDurableTelegramRecoveryDispatching: vi.fn(),
  createDurableTelegramCallbackSession: vi.fn(),
  completeDurableTelegramSession: vi.fn(),
  completeDurableTelegramMerge: vi.fn(),
  releaseDurableTelegramCallback: vi.fn(),
  runWithDurableTelegramCallbackLease: vi.fn(),
  failDurableTelegramCallback: vi.fn(),
  getCurrentSession: vi.fn(),
  recoverRemnashopTelegramSession: vi.fn(),
  revokeWebSessionById: vi.fn(),
  readTelegramPopupRequest: vi.fn(),
  logTechnicalError: vi.fn(),
  logTechnicalInfo: vi.fn(),
  logTechnicalWarning: vi.fn(),
}));

vi.mock("@/application/auth/complete-telegram-callback", () => ({
  completeTelegramCallback: mocks.completeTelegramCallback,
  completeResolvedTelegramCallback: mocks.completeTelegramCallback,
  resolveVerifiedTelegramIdentity: mocks.resolveVerifiedTelegramIdentity,
}));
vi.mock("@/application/auth/ports/telegram-callback", () => {
  class TelegramCallbackError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { TelegramCallbackError };
});
vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({
    publicAppUrl: "https://pay.example.com",
    cookieSecure: true,
    cookieSameSite: "lax",
    webJwtSecret: "test-web-jwt-secret-with-enough-entropy",
  }),
}));
vi.mock("@/backend/integrations/auth/telegram-callback-gateway", () => ({
  productionTelegramCallbackGateway: { adapter: "telegram-callback" },
}));
vi.mock("@/app/_composition/session-gateways", () => ({
  productionTelegramCallbackGateway: {
    adapter: "telegram-callback",
    consume: mocks.gatewayConsume,
  },
}));
vi.mock("@/backend/integrations/referral/referral-attribution", () => ({
  clearReferralAttributionCookieOnResponse: mocks.clearReferralAttributionCookieOnResponse,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  recoverRemnashopTelegramSession: mocks.recoverRemnashopTelegramSession,
}));
vi.mock("@/app/_composition/telegram-session-recovery", () => ({
  recoverRemnashopTelegramSession: mocks.recoverRemnashopTelegramSession,
}));
vi.mock("@/backend/integrations/auth/telegram-account-merge-store", () => ({
  telegramAccountMergeCookieMaxAgeSeconds: 600,
  telegramAccountMergeCookieName: "clean_pay_account_merge",
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  createWebSessionOnResponse: mocks.createWebSessionOnResponse,
  setDurableCallbackWebSessionCookies: mocks.setDurableCallbackWebSessionCookies,
  setDurableCallbackReplayCookies: mocks.setDurableCallbackReplayCookies,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/backend/integrations/telegram/durable-callback", () => ({
  loadDurableTelegramCallback: mocks.loadDurableTelegramCallback,
  checkpointDurableTelegramIdentityResolved:
    mocks.checkpointDurableTelegramIdentityResolved,
  checkpointDurableTelegramOutcome: mocks.checkpointDurableTelegramOutcome,
  checkpointDurableTelegramRecoveryCommitted:
    mocks.checkpointDurableTelegramRecoveryCommitted,
  markDurableTelegramRecoveryDispatching:
    mocks.markDurableTelegramRecoveryDispatching,
  createDurableTelegramCallbackSession:
    mocks.createDurableTelegramCallbackSession,
  completeDurableTelegramSession: mocks.completeDurableTelegramSession,
  completeDurableTelegramMerge: mocks.completeDurableTelegramMerge,
  releaseDurableTelegramCallback: mocks.releaseDurableTelegramCallback,
  runWithDurableTelegramCallbackLease:
    mocks.runWithDurableTelegramCallbackLease,
  failDurableTelegramCallback: mocks.failDurableTelegramCallback,
}));
vi.mock("@/backend/integrations/sessions/web-session-revocation", () => ({
  revokeWebSessionById: mocks.revokeWebSessionById,
}));
vi.mock("@/backend/integrations/telegram/popup-request", () => ({
  readTelegramPopupRequest: mocks.readTelegramPopupRequest,
}));
vi.mock("@/backend/integrations/telegram/oidc", () => {
  class TelegramAuthStateAlreadyConsumedError extends Error {}
  return {
    TelegramAuthStateAlreadyConsumedError,
    clearTelegramAuthCookiesOnResponse:
      mocks.clearTelegramAuthCookiesOnResponse,
    readTelegramCallbackCookieProof: mocks.readTelegramCallbackCookieProof,
    resumeTelegramOidcCodeExchange: mocks.resumeTelegramOidcCodeExchange,
    resumeTelegramProviderAuthentication:
      mocks.resumeTelegramProviderAuthentication,
  };
});
vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
  logTechnicalInfo: mocks.logTechnicalInfo,
  logTechnicalWarning: mocks.logTechnicalWarning,
}));

import { GET, POST } from "@/app/auth/telegram/callback/route";

const sessionOutcome = {
  redirectTo: "/cabinet",
  session: { userId: "user-1", requiresTelegramRecovery: false },
  audit: { userId: "user-1", remnashopLinked: true },
};
const mergeOutcome = {
  redirectTo: "/link-account",
  session: null,
  mergeConfirmation: { token: "merge-token" },
  audit: { userId: "user-1", remnashopLinked: false },
};
const oidcState = "telegram-state-with-sufficient-entropy";
const durableOwnership = {
  authStateId: "auth-state-1",
  stateHash: "state-hash",
  codeHash: "code-hash",
  claimToken: "claim-token",
};
const verifiedCallback = {
  authState: { id: "auth-state-1", targetUserId: null, redirectTo: "/cabinet" },
  identity: {
    telegramId: "1001",
    telegramUsername: "tester",
    fullName: "Test User",
    photoUrl: null,
    providerSession: null,
  },
  durable: durableOwnership,
};

function oidcRequest() {
  return new Request(
    `https://pay.example.com/auth/telegram/callback?code=code&state=${oidcState}`,
  );
}

function popupRequest() {
  return new Request("https://pay.example.com/auth/telegram/callback", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://pay.example.com" },
    body: JSON.stringify({ idToken: "id-token" }),
  });
}

describe("referral attribution after Telegram callbacks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createWebSessionOnResponse.mockResolvedValue({ id: "session-1" });
    mocks.readTelegramCallbackCookieProof.mockResolvedValue({
      stateHash: "state-hash",
      nonceHash: "nonce-hash",
      codeVerifierHash: "verifier-hash",
    });
    mocks.gatewayConsume.mockResolvedValue(verifiedCallback);
    mocks.resumeTelegramOidcCodeExchange.mockResolvedValue(verifiedCallback);
    mocks.resolveVerifiedTelegramIdentity.mockResolvedValue({
      user: { id: "user-1" },
      linked: false,
    });
    mocks.setDurableCallbackReplayCookies.mockResolvedValue({ id: "session-1" });
    mocks.loadDurableTelegramCallback.mockResolvedValue({ status: "none" });
    mocks.createDurableTelegramCallbackSession.mockImplementation(
      async (_ownership, callbackOutcome) => ({
        replay: {
          redirectTo: callbackOutcome.redirectTo,
          session: {
            webSessionId: "session-1",
            userId: callbackOutcome.session.userId,
            bootstrapRefreshToken: "browser-refresh-token",
            requiresTelegramRecovery:
              callbackOutcome.session.requiresTelegramRecovery,
          },
          audit: callbackOutcome.audit,
        },
      }),
    );
    mocks.completeDurableTelegramMerge.mockImplementation(
      async (_ownership, callbackOutcome) => ({
        redirectTo: callbackOutcome.redirectTo,
        mergeConfirmation: callbackOutcome.mergeConfirmation,
        audit: callbackOutcome.audit,
      }),
    );
    mocks.checkpointDurableTelegramIdentityResolved.mockResolvedValue(undefined);
    mocks.checkpointDurableTelegramOutcome.mockResolvedValue(undefined);
    mocks.markDurableTelegramRecoveryDispatching.mockResolvedValue(undefined);
    mocks.checkpointDurableTelegramRecoveryCommitted.mockImplementation(
      async (_ownership, callbackReplay) => ({
        ...callbackReplay,
        session: callbackReplay.session
          ? {
              ...callbackReplay.session,
              requiresTelegramRecovery: false,
            }
          : undefined,
      }),
    );
    mocks.completeDurableTelegramSession.mockResolvedValue(undefined);
    mocks.releaseDurableTelegramCallback.mockResolvedValue(undefined);
    mocks.runWithDurableTelegramCallbackLease.mockImplementation(
      async (_ownership, _status, work) => work(),
    );
    mocks.failDurableTelegramCallback.mockResolvedValue(undefined);
    mocks.recoverRemnashopTelegramSession.mockResolvedValue(undefined);
    mocks.revokeWebSessionById.mockResolvedValue(undefined);
    mocks.getCurrentSession.mockResolvedValue(null);
    mocks.readTelegramPopupRequest.mockResolvedValue({ method: "oidc", idToken: "id-token" });
  });

  it("clears attribution after successful OIDC GET and popup POST sessions", async () => {
    mocks.completeTelegramCallback.mockResolvedValue(sessionOutcome);

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.status).toBe(307);
    expect(popup.status).toBe(200);
    expect(mocks.createWebSessionOnResponse).toHaveBeenCalledTimes(1);
    expect(mocks.setDurableCallbackReplayCookies).toHaveBeenCalledTimes(1);
    expect(mocks.clearReferralAttributionCookieOnResponse).toHaveBeenCalledTimes(2);
    expect(mocks.clearTelegramAuthCookiesOnResponse).toHaveBeenCalledTimes(1);
  });

  it("treats a sequential replay of a completed OIDC callback as the same success", async () => {
    mocks.completeTelegramCallback.mockResolvedValueOnce(sessionOutcome);
    const first = await GET(oidcRequest());
    const receipt = first.cookies.get("clean_pay_tg_callback_receipt")?.value;
    expect(receipt).toBeTruthy();

    const replay = await GET(new Request(
      `https://pay.example.com/auth/telegram/callback?code=code&state=${oidcState}`,
      { headers: { cookie: `clean_pay_tg_callback_receipt=${receipt}` } },
    ));

    expect(replay.headers.get("location")).toBe("https://pay.example.com/cabinet");
    expect(mocks.logTechnicalInfo).toHaveBeenCalledWith(
      "telegram_callback_duplicate_completed",
      { redirectTo: "/cabinet" },
    );
    expect(mocks.logTechnicalError).not.toHaveBeenCalledWith(
      "telegram_callback_failed",
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.completeTelegramCallback).toHaveBeenCalledTimes(1);
    expect(mocks.createWebSessionOnResponse).not.toHaveBeenCalled();
    expect(mocks.setDurableCallbackReplayCookies).toHaveBeenCalledTimes(1);
  });

  it("recovers a completed callback after the first response is lost", async () => {
    const recoveryOutcome = {
      ...sessionOutcome,
      session: { userId: "user-1", requiresTelegramRecovery: true },
    };
    mocks.completeTelegramCallback.mockResolvedValueOnce(recoveryOutcome);
    mocks.loadDurableTelegramCallback
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValue({
        status: "completed",
        outcome: {
          redirectTo: "/cabinet",
          session: {
            webSessionId: "session-1",
            userId: "user-1",
            bootstrapRefreshToken: "browser-refresh-token",
            requiresTelegramRecovery: true,
          },
          audit: sessionOutcome.audit,
        },
      });

    const lostResponse = await GET(oidcRequest());
    expect(lostResponse.status).toBe(307);
    expect(mocks.createDurableTelegramCallbackSession).toHaveBeenCalledWith(
      durableOwnership,
      recoveryOutcome,
    );
    expect(mocks.completeDurableTelegramSession).toHaveBeenCalledTimes(1);

    // The simulated browser never receives cookies from lostResponse.
    const [firstReplay, secondReplay] = await Promise.all([
      GET(oidcRequest()),
      GET(oidcRequest()),
    ]);

    expect(firstReplay.headers.get("location")).toBe("https://pay.example.com/cabinet");
    expect(secondReplay.headers.get("location")).toBe("https://pay.example.com/cabinet");
    expect(mocks.completeTelegramCallback).toHaveBeenCalledTimes(1);
    expect(mocks.createWebSessionOnResponse).not.toHaveBeenCalled();
    expect(mocks.setDurableCallbackWebSessionCookies).not.toHaveBeenCalled();
    expect(mocks.setDurableCallbackReplayCookies).toHaveBeenCalledTimes(3);
    expect(mocks.setDurableCallbackReplayCookies).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "session-1",
      "user-1",
      "browser-refresh-token",
    );
    expect(mocks.setDurableCallbackReplayCookies).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      "session-1",
      "user-1",
      "browser-refresh-token",
    );
    expect(mocks.recoverRemnashopTelegramSession).toHaveBeenCalledTimes(1);
    expect(mocks.recoverRemnashopTelegramSession).toHaveBeenCalledWith(
      "session-1",
      "user-1",
    );
    expect(mocks.logTechnicalInfo).toHaveBeenCalledWith(
      "telegram_callback_duplicate_durable_completed",
      { redirectTo: "/cabinet" },
    );
  });

  it("never replays a completed session without nonce and PKCE cookie proof", async () => {
    mocks.readTelegramCallbackCookieProof.mockRejectedValueOnce(
      new Error("Telegram OIDC state is invalid"),
    );
    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/login?auth=telegram_failed",
    );
    expect(mocks.loadDurableTelegramCallback).not.toHaveBeenCalled();
    expect(mocks.setDurableCallbackReplayCookies).not.toHaveBeenCalled();
    expect(mocks.setDurableCallbackWebSessionCookies).not.toHaveBeenCalled();
  });

  it("replays a lost merge-confirmation response without staging the merge again", async () => {
    mocks.completeTelegramCallback.mockResolvedValueOnce(mergeOutcome);
    mocks.loadDurableTelegramCallback
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValueOnce({
        status: "completed",
        outcome: {
          redirectTo: "/link-account",
          mergeConfirmation: { token: "merge-token" },
          audit: mergeOutcome.audit,
        },
      });

    await GET(oidcRequest());
    const replay = await GET(oidcRequest());

    expect(mocks.completeTelegramCallback).toHaveBeenCalledTimes(1);
    expect(mocks.createWebSessionOnResponse).not.toHaveBeenCalled();
    expect(mocks.setDurableCallbackReplayCookies).not.toHaveBeenCalled();
    expect(replay.cookies.get("clean_pay_account_merge")?.value).toBe("merge-token");
    expect(replay.headers.get("location")).toBe("https://pay.example.com/link-account");
  });

  it.each([
    ["processing", "/login?auth=telegram_processing"],
    ["failed", "/login?auth=telegram_recovery_required"],
  ] as const)("reports durable %s state without repeating callback work", async (status, destination) => {
    mocks.loadDurableTelegramCallback.mockResolvedValueOnce(
      status === "failed"
        ? { status, redirectTo: destination }
        : { status },
    );
    mocks.getCurrentSession.mockResolvedValueOnce(null);

    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(`https://pay.example.com${destination}`);
    expect(mocks.completeTelegramCallback).not.toHaveBeenCalled();
    expect(mocks.createWebSessionOnResponse).not.toHaveBeenCalled();
    expect(mocks.setDurableCallbackReplayCookies).not.toHaveBeenCalled();
    expect(mocks.resumeTelegramOidcCodeExchange).not.toHaveBeenCalled();
    expect(mocks.resumeTelegramProviderAuthentication).not.toHaveBeenCalled();
  });

  it("resumes only the pre-dispatch provider checkpoint", async () => {
    mocks.loadDurableTelegramCallback.mockResolvedValueOnce({
      status: "resume",
      ownership: durableOwnership,
      checkpoint: {
        phase: "PROVIDER_READY",
        authState: {
          id: "auth-state-1",
          targetUserId: null,
          redirectTo: "/cabinet",
        },
      },
    });
    mocks.completeTelegramCallback.mockResolvedValueOnce(sessionOutcome);

    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/cabinet",
    );
    expect(mocks.gatewayConsume).not.toHaveBeenCalled();
    expect(mocks.resumeTelegramOidcCodeExchange).toHaveBeenCalledWith(
      "code",
      oidcState,
      expect.objectContaining({ id: "auth-state-1" }),
      durableOwnership,
    );
  });

  it("resumes after provider authentication without repeating either provider", async () => {
    mocks.loadDurableTelegramCallback.mockResolvedValueOnce({
      status: "resume",
      ownership: durableOwnership,
      checkpoint: {
        phase: "PROVIDER_AUTHENTICATED",
        verified: { ...verifiedCallback, durable: undefined },
      },
    });
    mocks.completeTelegramCallback.mockResolvedValueOnce(sessionOutcome);

    await GET(oidcRequest());

    expect(mocks.gatewayConsume).not.toHaveBeenCalled();
    expect(mocks.resumeTelegramOidcCodeExchange).not.toHaveBeenCalled();
    expect(mocks.resumeTelegramProviderAuthentication).not.toHaveBeenCalled();
    expect(mocks.resolveVerifiedTelegramIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.createDurableTelegramCallbackSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a linked session was revoked before IDENTITY_VERIFIED resume", async () => {
    const linkedVerified = {
      ...verifiedCallback,
      authState: {
        ...verifiedCallback.authState,
        targetUserId: "target-user",
      },
    };
    mocks.loadDurableTelegramCallback.mockResolvedValueOnce({
      status: "resume",
      ownership: durableOwnership,
      checkpoint: {
        phase: "IDENTITY_VERIFIED",
        verified: linkedVerified,
      },
    });
    mocks.getCurrentSession.mockResolvedValue(null);

    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/login?auth=telegram_failed",
    );
    expect(mocks.resumeTelegramProviderAuthentication).not.toHaveBeenCalled();
    expect(mocks.resolveVerifiedTelegramIdentity).not.toHaveBeenCalled();
    expect(mocks.failDurableTelegramCallback).toHaveBeenCalledWith(
      durableOwnership,
      "IDENTITY_VERIFIED",
      "UNAUTHORIZED",
      "/login?auth=telegram_failed",
      undefined,
    );
  });

  it("fails closed when a different user owns the session at PROVIDER_AUTHENTICATED resume", async () => {
    const linkedVerified = {
      ...verifiedCallback,
      authState: {
        ...verifiedCallback.authState,
        targetUserId: "target-user",
      },
    };
    mocks.loadDurableTelegramCallback.mockResolvedValueOnce({
      status: "resume",
      ownership: durableOwnership,
      checkpoint: {
        phase: "PROVIDER_AUTHENTICATED",
        verified: linkedVerified,
      },
    });
    mocks.getCurrentSession.mockResolvedValue({
      id: "other-session",
      userId: "other-user",
    });

    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/link-account?auth=telegram_failed",
    );
    expect(mocks.resolveVerifiedTelegramIdentity).not.toHaveBeenCalled();
    expect(mocks.checkpointDurableTelegramIdentityResolved).not.toHaveBeenCalled();
    expect(mocks.failDurableTelegramCallback).toHaveBeenCalledWith(
      durableOwnership,
      "PROVIDER_AUTHENTICATED",
      "UNAUTHORIZED",
      "/link-account?auth=telegram_failed",
      undefined,
    );
  });

  it("keeps the original callback failure when lease release also fails", async () => {
    const callbackError = new Error("provider result unavailable");
    const releaseError = new Error("lease release unavailable");
    mocks.loadDurableTelegramCallback.mockResolvedValueOnce({
      status: "resume",
      ownership: durableOwnership,
      checkpoint: {
        phase: "PROVIDER_AUTHENTICATED",
        verified: { ...verifiedCallback, durable: undefined },
      },
    });
    mocks.resolveVerifiedTelegramIdentity.mockRejectedValueOnce(callbackError);
    mocks.releaseDurableTelegramCallback.mockRejectedValueOnce(releaseError);

    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/login?auth=telegram_failed",
    );
    expect(mocks.releaseDurableTelegramCallback).toHaveBeenCalledWith(
      durableOwnership,
      "PROVIDER_AUTHENTICATED",
    );
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "telegram_callback_lease_release_failed",
      releaseError,
      { phase: "PROVIDER_AUTHENTICATED" },
    );
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "telegram_callback_failed",
      callbackError,
      expect.any(Object),
    );
  });

  it("resumes the exact SESSION_CREATED checkpoint after recovery-response loss", async () => {
    const replay = {
      redirectTo: "/cabinet",
      session: {
        webSessionId: "session-1",
        userId: "user-1",
        bootstrapRefreshToken: "browser-refresh-token",
        requiresTelegramRecovery: true,
      },
      audit: sessionOutcome.audit,
    };
    mocks.loadDurableTelegramCallback.mockResolvedValueOnce({
      status: "resume",
      ownership: durableOwnership,
      checkpoint: { phase: "SESSION_CREATED", replay },
    });

    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/cabinet",
    );
    expect(mocks.gatewayConsume).not.toHaveBeenCalled();
    expect(mocks.createDurableTelegramCallbackSession).not.toHaveBeenCalled();
    expect(mocks.recoverRemnashopTelegramSession).toHaveBeenCalledOnce();
    expect(mocks.completeDurableTelegramSession).toHaveBeenCalledWith(
      durableOwnership,
      expect.objectContaining({
        session: expect.objectContaining({
          requiresTelegramRecovery: false,
        }),
      }),
    );
    expect(mocks.markDurableTelegramRecoveryDispatching).toHaveBeenCalledWith(
      durableOwnership,
      replay,
    );
    expect(mocks.setDurableCallbackReplayCookies).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      "user-1",
      "browser-refresh-token",
    );
  });

  it("does not accept a completion receipt for a different callback state", async () => {
    mocks.completeTelegramCallback.mockResolvedValueOnce(sessionOutcome);
    const first = await GET(oidcRequest());
    const receipt = first.cookies.get("clean_pay_tg_callback_receipt")?.value;

    mocks.completeTelegramCallback.mockRejectedValueOnce(
      new Error("Telegram OIDC state is invalid"),
    );
    const forgedReplay = await GET(new Request(
      "https://pay.example.com/auth/telegram/callback?code=code&state=different-state-value",
      { headers: { cookie: `clean_pay_tg_callback_receipt=${receipt}` } },
    ));

    expect(forgedReplay.headers.get("location")).toBe(
      "https://pay.example.com/login?auth=telegram_failed",
    );
    expect(mocks.logTechnicalError).toHaveBeenCalledWith(
      "telegram_callback_failed",
      expect.any(Error),
      expect.any(Object),
    );
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "javascript:alert(1)",
    "/missing",
  ])("revalidates a corrupted callback destination at both final sinks: %s", async (redirectTo) => {
    mocks.completeTelegramCallback.mockResolvedValue({
      ...sessionOutcome,
      redirectTo,
    });

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.headers.get("location")).toBe("https://pay.example.com/cabinet");
    await expect(popup.json()).resolves.toEqual({ redirectTo: "/cabinet" });
  });

  it("preserves attribution while an account merge awaits confirmation", async () => {
    mocks.completeTelegramCallback.mockResolvedValue(mergeOutcome);

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.status).toBe(307);
    expect(popup.status).toBe(200);
    expect(mocks.createWebSessionOnResponse).not.toHaveBeenCalled();
    expect(mocks.clearReferralAttributionCookieOnResponse).not.toHaveBeenCalled();
  });

  it("preserves attribution after transient GET and popup callback failures", async () => {
    mocks.completeTelegramCallback.mockRejectedValue(new Error("provider unavailable"));

    const oidc = await GET(oidcRequest());
    const popup = await POST(popupRequest());

    expect(oidc.status).toBe(307);
    expect(popup.status).toBe(400);
    expect(mocks.clearReferralAttributionCookieOnResponse).not.toHaveBeenCalled();
  });

  it("terminally revokes ambiguous post-session recovery without redispatch", async () => {
    mocks.completeTelegramCallback.mockResolvedValueOnce({
      ...sessionOutcome,
      session: { userId: "user-1", requiresTelegramRecovery: true },
    });
    mocks.recoverRemnashopTelegramSession.mockRejectedValueOnce(
      new Error("recovery unavailable"),
    );

    const response = await GET(oidcRequest());

    expect(response.headers.get("location")).toBe(
      "https://pay.example.com/login?auth=telegram_recovery_required",
    );
    expect(response.cookies.get("clean_pay_tg_callback_receipt")).toBeUndefined();
    expect(mocks.completeDurableTelegramSession).not.toHaveBeenCalled();
    expect(mocks.failDurableTelegramCallback).toHaveBeenCalledWith(
      durableOwnership,
      "RECOVERY_DISPATCHING",
      "REMNASHOP_RECOVERY_AMBIGUOUS",
      "/login?auth=telegram_recovery_required",
      expect.objectContaining({
        session: expect.objectContaining({ webSessionId: "session-1" }),
      }),
    );
    expect(mocks.releaseDurableTelegramCallback).not.toHaveBeenCalled();
    expect(mocks.revokeWebSessionById).not.toHaveBeenCalled();
    expect(mocks.clearTelegramAuthCookiesOnResponse).toHaveBeenCalledOnce();
    expect(mocks.clearReferralAttributionCookieOnResponse).not.toHaveBeenCalled();
  });

  it("does not clear attribution when post-session recovery rolls back", async () => {
    mocks.completeTelegramCallback.mockResolvedValue({
      ...sessionOutcome,
      session: { userId: "user-1", requiresTelegramRecovery: true },
    });
    mocks.recoverRemnashopTelegramSession.mockRejectedValue(
      new Error("recovery unavailable"),
    );

    const response = await POST(popupRequest());

    expect(response.status).toBe(400);
    expect(mocks.revokeWebSessionById).toHaveBeenCalledWith("session-1", "user-1");
    expect(mocks.clearReferralAttributionCookieOnResponse).not.toHaveBeenCalled();
  });
});
