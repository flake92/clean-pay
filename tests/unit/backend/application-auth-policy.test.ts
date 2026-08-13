import { describe, expect, it, vi } from "vitest";

import {
  changeVerifiedEmail,
  confirmEmailVerificationCode,
  requestEmailVerificationCode,
} from "@/application/auth/execute-email-verification";
import { linkAccountEmail } from "@/application/auth/manage-linked-account";
import {
  EmailVerificationError,
  type EmailVerificationActor,
  type EmailVerificationCommands,
} from "@/application/auth/ports/email-verification";
import {
  LinkAccountGatewayError,
  type LinkAccountCommands,
} from "@/application/auth/ports/link-account";
import { changeProfilePassword } from "@/application/profile/execute-profile-command";
import {
  ProfileGatewayError,
  type ProfileCommands,
} from "@/application/profile/ports/profile-commands";

const emailActor: EmailVerificationActor = {
  context: { accessToken: "email-token" },
  userId: "user-1",
  email: "user@example.com",
  emailVerified: false,
  telegramId: null,
  pendingUpstreamAccountId: null,
  pendingEmail: null,
  authorizedUpstreamAccountId: "email-account",
  localUpstreamAccountId: "email-account",
  telegramUsername: null,
};

function emailCommands(overrides: Partial<EmailVerificationCommands> = {}): EmailVerificationCommands {
  return {
    verifyHuman: vi.fn(async () => undefined),
    loadActor: vi.fn(async () => emailActor),
    assertRequestLimits: vi.fn(async () => undefined),
    requestProviderCode: vi.fn(async (_actor, email) => ({ targetEmail: email ?? "user@example.com" })),
    auditCodeRequested: vi.fn(async () => undefined),
    loadProviderProfile: vi.fn(async () => ({ email: "user@example.com", pendingEmail: null, emailVerified: false })),
    assertConfirmationLimit: vi.fn(async () => undefined),
    confirmProviderCode: vi.fn(async () => ({ email: "user@example.com" })),
    persistConfirmedEmail: vi.fn(async () => ({ existingOwnerId: null, upstreamAccountId: "email-account", localVerificationChanged: true })),
    currentProviderSession: vi.fn(() => ({ context: { accountId: "email-account" } })),
    providerAccountId: vi.fn((session) => (session.context as { accountId?: string }).accountId ?? "email-account"),
    telegramProviderSession: vi.fn(async () => ({ context: { accountId: "telegram-account" } })),
    attachTelegram: vi.fn(async () => undefined),
    mergeProviderAccounts: vi.fn(async () => undefined),
    refreshProviderSession: vi.fn(async () => ({ context: { accountId: "telegram-account" } })),
    linkCurrentAccount: vi.fn(async () => undefined),
    withOwnerChangeFence: vi.fn(async ({ work }) => work()),
    refreshLocalSession: vi.fn(async () => undefined),
    auditEmailVerified: vi.fn(async () => undefined),
    markAccountSyncPending: vi.fn(async () => undefined),
    assertChangeLimits: vi.fn(async () => undefined),
    emailOwnerId: vi.fn(async () => null),
    assertChangeCooldown: vi.fn(async () => undefined),
    changeProviderEmail: vi.fn(async (_actor, email) => ({ pendingEmail: email })),
    persistPendingEmail: vi.fn(async () => undefined),
    auditEmailChangeRequested: vi.fn(async () => undefined),
    ...overrides,
  };
}

const linkActor = {
  context: { sessionId: "session-1" },
  userId: "user-1",
  email: null,
  emailVerified: false,
  telegramId: "777",
  telegramUsername: "clean_user",
  upstreamAccountId: "telegram-account",
  fullAssurance: true,
};

function linkCommands(overrides: Partial<LinkAccountCommands> = {}): LinkAccountCommands {
  return {
    loadLinkActor: vi.fn(async () => linkActor),
    assertLinkRateLimit: vi.fn(async () => undefined),
    authenticateEmail: vi.fn(async () => ({ context: { accountId: "email-account" } })),
    linkActorIsCurrent: vi.fn(async () => true),
    loadProviderProfile: vi.fn(async () => ({ email: "user@example.com", emailVerified: false })),
    providerAccountId: vi.fn((session) => (session.context as { accountId?: string }).accountId ?? "email-account"),
    telegramProviderSession: vi.fn(async () => ({ context: { accountId: "telegram-account" } })),
    attachTelegram: vi.fn(async () => undefined),
    mergeProviderAccounts: vi.fn(async () => undefined),
    refreshTelegramProviderSession: vi.fn(async () => ({ context: { accountId: "telegram-account" } })),
    linkCurrentAccount: vi.fn(async () => ({ userId: "user-1" })),
    withOwnerChangeFence: vi.fn(async ({ work }) => work()),
    emailOwnerId: vi.fn(async () => null),
    stagePendingEmail: vi.fn(async () => undefined),
    requestProviderVerification: vi.fn(async (_session, email) => ({ targetEmail: email })),
    auditLinkEvent: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("application authentication policy", () => {
  it("verifies the human and rate limit before requesting a provider code", async () => {
    const order: string[] = [];
    const commands = emailCommands({
      verifyHuman: vi.fn(async () => { order.push("human"); }),
      loadActor: vi.fn(async () => { order.push("actor"); return emailActor; }),
      assertRequestLimits: vi.fn(async () => { order.push("limit"); }),
      requestProviderCode: vi.fn(async () => { order.push("provider"); return { targetEmail: "user@example.com" }; }),
      auditCodeRequested: vi.fn(async () => { order.push("audit"); }),
    });

    await expect(requestEmailVerificationCode(commands, { turnstileToken: "human" }))
      .resolves.toEqual({ ok: true, kind: "code-sent", targetEmail: "user@example.com" });
    expect(commands.verifyHuman).toHaveBeenCalledWith("human", "email_verification");
    expect(order).toEqual(["human", "actor", "limit", "provider", "audit"]);
  });

  it("rejects a Telegram-only actor before provider email side effects", async () => {
    const commands = emailCommands({
      loadActor: vi.fn(async () => ({ ...emailActor, email: null, telegramId: "777" })),
    });

    await expect(requestEmailVerificationCode(commands, { email: "foreign@example.com" }))
      .resolves.toMatchObject({ ok: false, code: "EMAIL_REQUIRED" });
    expect(commands.assertRequestLimits).not.toHaveBeenCalled();
    expect(commands.requestProviderCode).not.toHaveBeenCalled();
  });

  it("persists proof before taking the owner fence and merges conflicting Telegram ownership inside it", async () => {
    const order: string[] = [];
    const actor = { ...emailActor, telegramId: "777", telegramUsername: "clean_user", pendingEmail: "user@example.com", pendingUpstreamAccountId: "email-account" };
    const commands = emailCommands({
      confirmProviderCode: vi.fn(async () => { order.push("confirm-code"); return { email: "user@example.com" }; }),
      loadActor: vi.fn(async () => actor),
      persistConfirmedEmail: vi.fn(async () => { order.push("persist-proof"); return { existingOwnerId: "old-owner", upstreamAccountId: "email-account", localVerificationChanged: true }; }),
      refreshLocalSession: vi.fn(async () => { order.push("refresh-local"); }),
      auditEmailVerified: vi.fn(async () => { order.push("audit-proof"); }),
      withOwnerChangeFence: vi.fn(async ({ userIds, upstreamAccountIds, work }) => {
        order.push("fence");
        expect(userIds).toEqual(["user-1", "old-owner"]);
        expect(upstreamAccountIds).toEqual(["email-account"]);
        return work();
      }),
      attachTelegram: vi.fn(async () => { order.push("attach"); throw new EmailVerificationError("CONFLICT"); }),
      mergeProviderAccounts: vi.fn(async () => { order.push("merge"); }),
      linkCurrentAccount: vi.fn(async (_session, flags) => { order.push("link"); expect(flags).toEqual({ upstreamMerged: true, ownerFenceHeld: true }); }),
    });

    await expect(confirmEmailVerificationCode(commands, { code: "123456" }))
      .resolves.toEqual({ ok: true, kind: "confirmed", readiness: { status: "ready" } });
    expect(order.slice(0, 5)).toEqual(["confirm-code", "persist-proof", "refresh-local", "audit-proof", "fence"]);
    expect(order).toContain("merge");
    expect(order.at(-2)).toBe("link");
    expect(commands.mergeProviderAccounts).toHaveBeenCalledWith(expect.objectContaining({ sourceAccountId: "telegram-account", targetAccountId: "email-account" }));
  });

  it("keeps successful verification and records pending synchronization on an optional sync failure", async () => {
    const commands = emailCommands({
      withOwnerChangeFence: vi.fn(async () => { throw new Error("provider offline"); }),
    });

    await expect(confirmEmailVerificationCode(commands, { code: "123456" }))
      .resolves.toEqual({ ok: true, kind: "confirmed", readiness: { status: "pending", emailVerified: true } });
    expect(commands.markAccountSyncPending).toHaveBeenCalledWith("user-1", expect.any(Error));
  });

  it("owns verified-email change ordering through code delivery and audit", async () => {
    const order: string[] = [];
    const commands = emailCommands({
      verifyHuman: vi.fn(async () => { order.push("human"); }),
      assertChangeLimits: vi.fn(async () => { order.push("limit"); }),
      emailOwnerId: vi.fn(async () => { order.push("owner"); return null; }),
      assertChangeCooldown: vi.fn(async () => { order.push("cooldown"); }),
      changeProviderEmail: vi.fn(async () => { order.push("provider-change"); return { pendingEmail: "new@example.com" }; }),
      persistPendingEmail: vi.fn(async () => { order.push("persist"); }),
      refreshLocalSession: vi.fn(async () => { order.push("refresh"); }),
      requestProviderCode: vi.fn(async () => { order.push("code"); return { targetEmail: "new@example.com" }; }),
      auditEmailChangeRequested: vi.fn(async () => { order.push("audit"); }),
    });

    await expect(changeVerifiedEmail(commands, { email: " New@Example.com " }))
      .resolves.toEqual({ ok: true, kind: "code-sent", targetEmail: "new@example.com" });
    expect(commands.verifyHuman).toHaveBeenCalledWith(null, "email_change");
    expect(order).toEqual(["human", "limit", "owner", "cooldown", "provider-change", "persist", "refresh", "code", "audit"]);
  });

  it("reports an existing e-mail owner before consuming the change cooldown", async () => {
    const commands = emailCommands({
      emailOwnerId: vi.fn(async () => "other-user"),
    });

    await expect(changeVerifiedEmail(commands, { email: "owned@example.com" })).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Этот e-mail уже привязан к другому аккаунту. Войдите в него или укажите другой адрес.",
    });
    expect(commands.assertChangeLimits).toHaveBeenCalledOnce();
    expect(commands.assertChangeCooldown).not.toHaveBeenCalled();
    expect(commands.changeProviderEmail).not.toHaveBeenCalled();
  });

  it("reports the exact remaining rate-limit delay", async () => {
    const commands = emailCommands({
      assertChangeLimits: vi.fn(async () => { throw new EmailVerificationError("RATE_LIMITED", 47); }),
    });

    await expect(changeVerifiedEmail(commands, { email: "new@example.com" })).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "Повторите попытку через 47 сек.",
    });
  });

  it("returns an actionable security-check error without calling the provider", async () => {
    const commands = emailCommands({
      verifyHuman: vi.fn(async () => { throw new EmailVerificationError("FORBIDDEN"); }),
    });

    await expect(changeVerifiedEmail(commands, {
      email: "new@example.com",
      turnstileToken: "wrong-action-token",
    })).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Проверка безопасности не пройдена. Выполните её ещё раз и повторите попытку.",
    });
    expect(commands.changeProviderEmail).not.toHaveBeenCalled();
  });

  it("falls back from login to registration but does not mutate ownership before verification", async () => {
    const commands = linkCommands({
      authenticateEmail: vi.fn()
        .mockRejectedValueOnce(new LinkAccountGatewayError("AUTH_FAILED"))
        .mockResolvedValueOnce({ context: { accountId: "new-account" } }),
    });

    await expect(linkAccountEmail(commands, { email: " User@Example.com ", password: "secret123" }))
      .resolves.toEqual({ ok: true, kind: "verification-required" });
    expect(commands.authenticateEmail).toHaveBeenNthCalledWith(1, { operation: "login", email: "user@example.com", password: "secret123" });
    expect(commands.authenticateEmail).toHaveBeenNthCalledWith(2, { operation: "register", email: "user@example.com", password: "secret123" });
    expect(commands.stagePendingEmail).toHaveBeenCalled();
    expect(commands.mergeProviderAccounts).not.toHaveBeenCalled();
    expect(commands.linkCurrentAccount).not.toHaveBeenCalled();
  });

  it("revalidates the actor before staging or linking an authenticated provider account", async () => {
    const commands = linkCommands({ linkActorIsCurrent: vi.fn(async () => false) });

    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "secret123" }))
      .resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(commands.loadProviderProfile).not.toHaveBeenCalled();
    expect(commands.stagePendingEmail).not.toHaveBeenCalled();
    expect(commands.linkCurrentAccount).not.toHaveBeenCalled();
  });

  it("links a verified account only inside the owner fence and merges conflicting Telegram ownership", async () => {
    const commands = linkCommands({
      loadProviderProfile: vi.fn(async () => ({ email: "user@example.com", emailVerified: true })),
      attachTelegram: vi.fn(async () => { throw new LinkAccountGatewayError("CONFLICT"); }),
    });

    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "secret123" }))
      .resolves.toEqual({ ok: true, kind: "linked" });
    expect(commands.withOwnerChangeFence).toHaveBeenCalledOnce();
    expect(commands.mergeProviderAccounts).toHaveBeenCalledWith(expect.objectContaining({ sourceAccountId: "telegram-account", targetAccountId: "email-account" }));
    expect(commands.linkCurrentAccount).toHaveBeenCalledWith(expect.anything(), { upstreamMerged: true, ownerFenceHeld: true });
  });

  it("refreshes a stale provider session once before replacing the local password session", async () => {
    const order: string[] = [];
    const original = { context: { token: "old" }, userId: "user-1" };
    const refreshed = { context: { token: "fresh" }, userId: "user-1" };
    const changed = { context: { token: "changed" } };
    const commands: ProfileCommands = {
      loadPasswordSession: vi.fn(async () => original),
      assertPasswordChangeRateLimit: vi.fn(async () => { order.push("rate-limit"); }),
      changeProviderPassword: vi.fn()
        .mockImplementationOnce(async () => { order.push("change-old"); throw new ProfileGatewayError("CURRENT_PASSWORD_INVALID"); })
        .mockImplementationOnce(async () => { order.push("change-fresh"); return changed; }),
      refreshProviderSession: vi.fn(async () => { order.push("refresh-provider"); return refreshed; }),
      persistRefreshedProviderSession: vi.fn(async () => { order.push("persist-refresh"); }),
      replaceLocalPasswordSession: vi.fn(async () => { order.push("replace-local"); }),
      auditPasswordChanged: vi.fn(async () => { order.push("audit"); }),
    };

    await expect(changeProfilePassword(commands, { currentPassword: "old-password", newPassword: "new-password" }))
      .resolves.toMatchObject({ ok: true });
    expect(order).toEqual(["rate-limit", "change-old", "refresh-provider", "persist-refresh", "change-fresh", "replace-local", "audit"]);
    expect(commands.replaceLocalPasswordSession).toHaveBeenCalledWith(original, changed);
  });
});
