import { describe, expect, it, vi } from "vitest";

import { safeReadiness } from "@/application/auth/execute-email-verification";
import { AuthProfileError, type AuthProfileGateway, type AuthProfileSession } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";

function session(overrides: Partial<AuthProfileSession> = {}): AuthProfileSession {
  return {
    context: {}, id: "session-1", userId: "user-1", authMethod: "EMAIL",
    hasUpstreamTokens: true,
    user: {
      email: "u@example.com", emailVerified: false, telegramId: null,
      telegramUsername: null, fullName: null, displayName: null,
      upstreamUserId: "upstream-1", pendingUpstreamUserId: null,
      pendingEmail: null, accountSyncPending: false,
    },
    ...overrides,
  };
}

function gateway(overrides: Partial<AuthProfileGateway> = {}): AuthProfileGateway {
  const current = session();
  return {
    loadCurrentSession: vi.fn(async () => current),
    authorizeCurrentSession: vi.fn(async () => ({ context: {}, session: current, upstreamUserId: "upstream-1" })),
    loadProviderProfile: vi.fn(async () => ({ email: "u@example.com", emailVerified: true, pendingEmail: null, name: "User", telegramId: null })),
    confirmVerifiedEmail: vi.fn(async () => undefined),
    refreshCurrentAccess: vi.fn(async () => undefined),
    debug: vi.fn(),
    ...overrides,
  };
}

describe("application auth profile policy", () => {
  it("rejects a missing session in the application layer", async () => {
    await expect(resolveAuthProfile(gateway({ loadCurrentSession: vi.fn(async () => null) })))
      .rejects.toEqual(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("returns a local profile when no provider identity can be resolved", async () => {
    const local = session({
      hasUpstreamTokens: false,
      authMethod: "TELEGRAM",
      user: { ...session().user, upstreamUserId: null, telegramId: null, emailVerified: true },
    });
    const port = gateway({ loadCurrentSession: vi.fn(async () => local) });
    await expect(resolveAuthProfile(port)).resolves.toMatchObject({
      authType: "telegram", email: "u@example.com", emailVerified: true,
    });
    expect(port.authorizeCurrentSession).not.toHaveBeenCalled();
  });

  it("keeps a passkey session authenticated while its provider tokens are being restored", async () => {
    const local = session({
      hasUpstreamTokens: false,
      authMethod: "PASSKEY",
      user: {
        ...session().user,
        emailVerified: true,
        upstreamUserId: "upstream-1",
        telegramId: "777",
      },
    });
    const port = gateway({ loadCurrentSession: vi.fn(async () => local) });

    await expect(resolveAuthProfile(port)).resolves.toMatchObject({
      authType: "passkey",
      email: "u@example.com",
      emailVerified: true,
      telegramId: "777",
    });
    expect(port.authorizeCurrentSession).not.toHaveBeenCalled();
  });

  it.each(["EMAIL_REQUIRED", "PASSKEY_REQUIRED"])("falls back locally on %s", async (code) => {
    const port = gateway({ authorizeCurrentSession: vi.fn(async () => { throw new AuthProfileError(code); }) });
    await expect(resolveAuthProfile(port)).resolves.toMatchObject({ email: "u@example.com", emailVerified: false });
    expect(port.loadProviderProfile).not.toHaveBeenCalled();
  });

  it("reconciles matching verified provider proof and refreshes access", async () => {
    const port = gateway();
    await expect(resolveAuthProfile(port)).resolves.toMatchObject({
      email: "u@example.com", emailVerified: true, accountSyncPending: false,
    });
    expect(port.confirmVerifiedEmail).toHaveBeenCalledWith("user-1");
    expect(port.refreshCurrentAccess).toHaveBeenCalledOnce();
  });

  it("defers verified-email reconciliation for render-only adapters", async () => {
    const port = gateway({ canReconcileVerifiedEmail: false });

    await expect(resolveAuthProfile(port)).resolves.toMatchObject({
      email: "u@example.com",
      emailVerified: false,
      accountSyncPending: false,
    });
    expect(port.confirmVerifiedEmail).not.toHaveBeenCalled();
    expect(port.refreshCurrentAccess).not.toHaveBeenCalled();
    expect(port.debug).toHaveBeenCalledWith(
      "auth_me_verified_email_reconciliation_deferred",
      { sessionId: "session-1", userId: "user-1" },
    );
  });

  it("does not reconcile an unresolved Telegram merge or a different pending owner", async () => {
    for (const user of [
      { ...session().user, telegramId: "777", accountSyncPending: true },
      { ...session().user, pendingUpstreamUserId: "other-upstream" },
    ]) {
      const current = session({ user });
      const port = gateway({
        loadCurrentSession: vi.fn(async () => current),
        authorizeCurrentSession: vi.fn(async () => ({ context: {}, session: current, upstreamUserId: "upstream-1" })),
      });
      await resolveAuthProfile(port);
      expect(port.confirmVerifiedEmail).not.toHaveBeenCalled();
    }
  });

  it("maps provider data without trusting a mismatched provider email", async () => {
    const current = session({ user: { ...session().user, emailVerified: true } });
    const port = gateway({
      loadCurrentSession: vi.fn(async () => current),
      authorizeCurrentSession: vi.fn(async () => ({ context: {}, session: current, upstreamUserId: "upstream-1" })),
      loadProviderProfile: vi.fn(async () => ({ email: "other@example.com", emailVerified: true, pendingEmail: "next@example.com", name: "Provider", telegramId: "888" })),
    });
    await expect(resolveAuthProfile(port)).resolves.toMatchObject({
      email: "other@example.com", emailVerified: false, pendingEmail: "next@example.com", telegramId: "888",
    });
  });

  it("derives readiness and preserves typed authorization and merge failures", async () => {
    await expect(safeReadiness(gateway())).resolves.toEqual({ status: "ready" });
    const pending = session({ hasUpstreamTokens: false, user: { ...session().user, upstreamUserId: null, accountSyncPending: true } });
    await expect(safeReadiness(gateway({ loadCurrentSession: vi.fn(async () => pending) })))
      .resolves.toEqual({ status: "pending", emailVerified: false });
    await expect(safeReadiness(gateway({ loadCurrentSession: vi.fn(async () => null) })))
      .resolves.toEqual({ status: "unauthorized" });
    await expect(safeReadiness(gateway({ authorizeCurrentSession: vi.fn(async () => { throw new AuthProfileError("ACCOUNT_MERGE_REQUIRED"); }) })))
      .resolves.toEqual({ status: "merge-conflict" });
    await expect(safeReadiness(gateway({ authorizeCurrentSession: vi.fn(async () => { throw new Error("offline"); }) })))
      .resolves.toEqual({ status: "unavailable" });
  });
});
