import { describe, expect, it, vi } from "vitest";

import {
  cancelLinkedTelegram,
  confirmLinkedTelegram,
  linkAccountEmail,
  loadLinkAccount,
  removeLinkedPasskey,
} from "@/application/auth/manage-linked-account";
import { ServiceError } from "@/backend/errors/service-error";
import { LinkAccountGatewayError, type LinkAccountCommands } from "@/application/auth/ports/link-account";
import type { TelegramAccountMergeGateway } from "@/application/auth/ports/telegram-account-merge";
import type { AuthProfileGateway, AuthProfileSession } from "@/application/auth/ports/auth-profile";
import type { LinkAccountReader } from "@/application/auth/ports/link-account";
import type { PasskeyManagementGateway } from "@/application/auth/ports/passkey-management";

function mockCommands(overrides: Partial<LinkAccountCommands> & { confirmTelegramMerge?: () => Promise<void> } = {}): LinkAccountCommands & TelegramAccountMergeGateway & { confirmTelegramMerge: () => Promise<void> } {
  const commands = {
    loadLinkActor: vi.fn(async () => ({ context: {}, userId: "user-1", email: null, emailVerified: false, telegramId: null, telegramUsername: null, upstreamAccountId: null, fullAssurance: true })),
    assertLinkRateLimit: vi.fn(async () => undefined),
    authenticateEmail: vi.fn(async () => ({ context: {} })),
    linkActorIsCurrent: vi.fn(async () => true),
    loadProviderProfile: vi.fn(async () => ({ email: "test@test.com", emailVerified: false })),
    providerAccountId: vi.fn(() => "upstream-1"),
    telegramProviderSession: vi.fn(async () => ({ context: {} })),
    attachTelegram: vi.fn(async () => undefined),
    mergeProviderAccounts: vi.fn(async () => undefined),
    refreshTelegramProviderSession: vi.fn(async () => ({ context: {} })),
    linkCurrentAccount: vi.fn(async () => ({ userId: "user-1" })),
    withOwnerChangeFence: vi.fn(async ({ work }) => work()),
    emailOwnerId: vi.fn(async () => null),
    stagePendingEmail: vi.fn(async () => undefined),
    requestProviderVerification: vi.fn(async (_session, email) => ({ targetEmail: email })),
    auditLinkEvent: vi.fn(async () => undefined),
    confirmTelegramMerge: vi.fn(async () => undefined),
    cancelTelegramMerge: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as LinkAccountCommands & TelegramAccountMergeGateway & { confirmTelegramMerge: () => Promise<void> };
  commands.loadActor = vi.fn(async () => ({ userId: "user-1", fullAssurance: true }));
  commands.loadConfirmation = vi.fn(async () => {
    await commands.confirmTelegramMerge();
    return {
      context: {}, id: "merge-1", userId: "user-1", status: "COMPLETED" as const, expiresAt: new Date(Date.now() + 60_000),
      sourceAccountId: "source", targetAccountId: "target", sourceEmail: null, targetEmail: "u@example.com",
      targetTelegramId: null, telegramId: "777", telegramUsername: null,
    };
  });
  commands.assertRateLimit = vi.fn(async () => undefined);
  commands.audit = vi.fn(async () => undefined);
  commands.claim = vi.fn(async () => true);
  commands.loadCurrentOwner = vi.fn(); commands.authenticateTelegram = vi.fn(); commands.preflight = vi.fn();
  commands.synchronizeSubscriptionIdentity = vi.fn(); commands.complete = vi.fn(); commands.release = vi.fn();
  commands.cancel = vi.fn(async () => true);
  commands.refreshLocalSession = vi.fn();
  return commands;
}

describe("failed() error message mapping", () => {
  it("loads the account-link view without blocking profile rendering on optional passkeys", async () => {
    const session: AuthProfileSession = {
      context: {}, id: "session-1", userId: "user-1", authMethod: "EMAIL", hasUpstreamTokens: false,
      user: { email: "user@example.com", emailVerified: true, telegramId: null, telegramUsername: null,
        fullName: null, displayName: null, upstreamUserId: null, pendingUpstreamUserId: null,
        pendingEmail: null, accountSyncPending: false },
    };
    const auth = {
      loadCurrentSession: vi.fn(async () => session), debug: vi.fn(),
    } as unknown as AuthProfileGateway;
    const reader = {} as LinkAccountReader;
    const passkeys = {
      loadActor: vi.fn(async () => { throw new Error("passkey store unavailable"); }),
    } as unknown as PasskeyManagementGateway;
    await expect(loadLinkAccount(reader, auth, passkeys, "telegram_failed")).resolves.toMatchObject({
      status: "ready", profile: { email: "user@example.com", emailVerified: true }, passkeys: [],
      callbackError: expect.any(String), mergeConfirmation: null,
    });
  });

  it("loads a valid merge confirmation only for merge statuses", async () => {
    const session = {
      context: {}, id: "session-1", userId: "user-1", authMethod: "TELEGRAM", hasUpstreamTokens: false,
      user: { email: null, emailVerified: false, telegramId: "777", telegramUsername: null,
        fullName: null, displayName: null, upstreamUserId: null, pendingUpstreamUserId: null,
        pendingEmail: null, accountSyncPending: false },
    } as AuthProfileSession;
    const auth = {
      loadCurrentSession: vi.fn(async () => session),
      authorizeCurrentSession: vi.fn(async () => ({ context: {}, session, upstreamUserId: "upstream-1" })),
      loadProviderProfile: vi.fn(async () => ({ email: null, emailVerified: false, pendingEmail: null, name: "Telegram User", telegramId: "777" })),
      debug: vi.fn(),
    } as unknown as AuthProfileGateway;
    const reader = {
      loadMergeActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true })),
      loadTelegramMergeConfirmation: vi.fn(async () => ({
        targetEmail: "target@example.com", sourceEmailMasked: "so***@example.com", emailWillBeReplaced: true,
        telegramId: "777", status: "PENDING", expiresAt: new Date(Date.now() + 60_000),
      })),
    } as unknown as LinkAccountReader;
    const passkeys = {
      loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true, email: null, emailVerified: false, telegramId: "777" })),
      loadOwned: vi.fn(async () => [{ id: "key-1", name: "Phone", createdAt: "2026-01-01", lastUsedAt: null }]),
    } as unknown as PasskeyManagementGateway;
    await expect(loadLinkAccount(reader, auth, passkeys, "telegram_email_replace")).resolves.toMatchObject({
      status: "ready", mergeConfirmation: { targetEmail: "target@example.com", telegramId: "777" },
      passkeys: [{ id: "key-1" }],
    });
  });

  it("maps missing sessions to unauthorized and other profile errors to a safe error state", async () => {
    const passkeys = { loadActor: vi.fn(async () => null) } as unknown as PasskeyManagementGateway;
    const noSession = { loadCurrentSession: vi.fn(async () => null), debug: vi.fn() } as unknown as AuthProfileGateway;
    await expect(loadLinkAccount({} as LinkAccountReader, noSession, passkeys, null)).resolves.toEqual({ status: "unauthorized" });
    const broken = { loadCurrentSession: vi.fn(async () => { throw new Error("db details"); }), debug: vi.fn() } as unknown as AuthProfileGateway;
    await expect(loadLinkAccount({} as LinkAccountReader, broken, passkeys, null)).resolves.toMatchObject({ status: "error" });
  });

  it.each([
    [null, "UNAUTHORIZED"],
    [{ context: {}, userId: "user-1", email: null, emailVerified: false, telegramId: "777", telegramUsername: null, upstreamAccountId: null, fullAssurance: false }, "PASSKEY_REQUIRED"],
  ])("rejects an absent or partial-assurance link actor", async (actor, code) => {
    const commands = mockCommands({ loadLinkActor: vi.fn(async () => actor) });
    await expect(linkAccountEmail(commands, { email: " User@Example.com ", password: "password" })).resolves.toMatchObject({ ok: false, code });
    expect(commands.authenticateEmail).not.toHaveBeenCalled();
  });

  it("registers a new provider account and stages e-mail verification", async () => {
    const commands = mockCommands({
      authenticateEmail: vi.fn()
        .mockRejectedValueOnce(new LinkAccountGatewayError("AUTH_FAILED"))
        .mockResolvedValueOnce({ context: { accountId: "new" } }),
      loadProviderProfile: vi.fn(async () => ({ email: "user@example.com", emailVerified: false })),
    });
    await expect(linkAccountEmail(commands, { email: " User@Example.com ", password: "password" })).resolves.toEqual({
      ok: true, kind: "verification-required",
    });
    expect(commands.authenticateEmail).toHaveBeenNthCalledWith(1, { operation: "login", email: "user@example.com", password: "password" });
    expect(commands.authenticateEmail).toHaveBeenNthCalledWith(2, { operation: "register", email: "user@example.com", password: "password" });
    expect(commands.stagePendingEmail).toHaveBeenCalledWith(expect.objectContaining({ email: "user@example.com", stagedLocally: true }));
  });

  it("preserves the original login failure when registration says the e-mail exists", async () => {
    const loginFailure = new LinkAccountGatewayError("AUTH_FAILED");
    const commands = mockCommands({
      authenticateEmail: vi.fn().mockRejectedValueOnce(loginFailure).mockRejectedValueOnce(new LinkAccountGatewayError("EMAIL_ALREADY_EXISTS")),
    });
    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "wrong" })).resolves.toMatchObject({ ok: false, code: "AUTH_FAILED" });
  });

  it("fails closed if the actor changes after provider authentication", async () => {
    const commands = mockCommands({ linkActorIsCurrent: vi.fn(async () => false) });
    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "password" })).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(commands.stagePendingEmail).not.toHaveBeenCalled();
  });

  it("links an already verified login without requiring Telegram", async () => {
    const commands = mockCommands({
      loadProviderProfile: vi.fn(async () => ({ email: "user@example.com", emailVerified: true })),
    });
    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "password" })).resolves.toEqual({ ok: true, kind: "linked" });
    expect(commands.linkCurrentAccount).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ upstreamMerged: false, ownerFenceHeld: true }));
    expect(commands.stagePendingEmail).toHaveBeenCalledWith(expect.objectContaining({ ownerTransitionStarted: true }));
    expect(vi.mocked(commands.withOwnerChangeFence).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(commands.stagePendingEmail).mock.invocationCallOrder[0]!);
    expect(vi.mocked(commands.stagePendingEmail).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(commands.linkCurrentAccount).mock.invocationCallOrder[0]!);
    expect(commands.requestProviderVerification).not.toHaveBeenCalled();
  });

  it("does not overwrite a durable transition when another owner fence wins", async () => {
    const commands = mockCommands({
      loadProviderProfile: vi.fn(async () => ({ email: "user@example.com", emailVerified: true })),
      withOwnerChangeFence: vi.fn(async () => { throw new LinkAccountGatewayError("CONFLICT"); }),
    });
    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "password" }))
      .resolves.toMatchObject({ ok: false, code: "CONFLICT" });
    expect(commands.stagePendingEmail).not.toHaveBeenCalled();
    expect(commands.attachTelegram).not.toHaveBeenCalled();
    expect(commands.linkCurrentAccount).not.toHaveBeenCalled();
  });

  it("requires real verification if a newly registered provider reports e-mail as already verified", async () => {
    const commands = mockCommands({
      authenticateEmail: vi.fn().mockRejectedValueOnce(new LinkAccountGatewayError("AUTH_FAILED")).mockResolvedValueOnce({ context: {} }),
      requestProviderVerification: vi.fn(async () => { throw new LinkAccountGatewayError("EMAIL_ALREADY_VERIFIED"); }),
    });
    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "password" })).resolves.toMatchObject({
      ok: false, code: "EMAIL_LINK_REQUIRES_VERIFICATION",
    });
  });

  it("finishes an existing login when verification is already complete", async () => {
    const commands = mockCommands({
      requestProviderVerification: vi.fn(async () => { throw new LinkAccountGatewayError("EMAIL_ALREADY_VERIFIED"); }),
    });
    await expect(linkAccountEmail(commands, { email: "user@example.com", password: "password" })).resolves.toEqual({ ok: true, kind: "linked" });
  });

  it("cancels merge and deletes only an owned passkey under full assurance", async () => {
    const merge = mockCommands();
    vi.mocked(merge.loadConfirmation).mockResolvedValueOnce({
      context: {}, id: "merge-1", userId: "user-1", status: "PENDING", expiresAt: new Date(Date.now() + 60_000),
      sourceAccountId: "source", targetAccountId: "target", sourceEmail: null, targetEmail: "u@example.com",
      targetTelegramId: null, telegramId: "777", telegramUsername: null,
    });
    await expect(cancelLinkedTelegram(merge)).resolves.toEqual({ ok: true, kind: "merge-cancelled" });
    const passkeys = {
      loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true, email: null, emailVerified: false, telegramId: "777" })),
      deleteOwned: vi.fn(async () => ({ externalCredentialId: "external-1" })),
      auditDeleted: vi.fn(async () => undefined),
    } as unknown as PasskeyManagementGateway;
    await expect(removeLinkedPasskey(passkeys, "key-1")).resolves.toEqual({ ok: true, kind: "passkey-deleted" });
    expect(passkeys.deleteOwned).toHaveBeenCalledWith("user-1", "key-1");
    expect(passkeys.auditDeleted).toHaveBeenCalledWith("user-1", "external-1");
  });

  it("blocks passkey deletion when it would leave no usable account identity", async () => {
    const passkeys = {
      loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true, email: null, emailVerified: false, telegramId: null })),
      deleteOwned: vi.fn(), auditDeleted: vi.fn(),
    } as unknown as PasskeyManagementGateway;
    await expect(removeLinkedPasskey(passkeys, "key-1")).resolves.toMatchObject({ ok: false, code: "EMAIL_NOT_VERIFIED" });
    expect(passkeys.deleteOwned).not.toHaveBeenCalled();
  });

  it("keeps the authenticated e-mail and password while replacing Telegram in the reverse merge flow", async () => {
    const emailSession = { context: { accountId: "email-account" } };
    const telegramSession = { context: { accountId: "telegram-account" } };
    const commands = mockCommands({
      loadLinkActor: vi.fn(async () => ({
        context: {}, userId: "user-1", email: null, emailVerified: false,
        telegramId: "777", telegramUsername: "clean", upstreamAccountId: "telegram-account", fullAssurance: true,
      })),
      authenticateEmail: vi.fn(async () => emailSession),
      loadProviderProfile: vi.fn(async () => ({ email: "owner@example.com", emailVerified: true })),
      providerAccountId: vi.fn((session) => (session.context as { accountId: string }).accountId),
      telegramProviderSession: vi.fn(async () => telegramSession),
      attachTelegram: vi.fn(async () => { throw new LinkAccountGatewayError("CONFLICT"); }),
      refreshTelegramProviderSession: vi.fn(async () => emailSession),
    });

    await expect(linkAccountEmail(commands, { email: "owner@example.com", password: "password-1" }))
      .resolves.toEqual({ ok: true, kind: "linked" });
    expect(commands.mergeProviderAccounts).toHaveBeenCalledWith(expect.objectContaining({
      sourceAccountId: "telegram-account",
      targetAccountId: "email-account",
    }));
  });

  it("uses ServiceError.prodMessage for ACCOUNT_MERGE_REQUIRED", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("ACCOUNT_MERGE_REQUIRED", 409, "custom debug message");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "ACCOUNT_MERGE_REQUIRED",
      message: "Этот Telegram уже привязан к другой почте. Сначала объедините аккаунты через поддержку.",
    });
  });

  it("uses ServiceError.prodMessage for NOT_FOUND", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("NOT_FOUND", 404, "confirmation expired");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Данные не найдены.",
    });
  });

  it("uses ServiceError.prodMessage for CONFLICT", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("CONFLICT", 409, "already processing");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Не удалось выполнить действие. Проверьте данные и попробуйте снова.",
    });
  });

  it("uses ServiceError.prodMessage for UPSTREAM_UNAVAILABLE", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("UPSTREAM_UNAVAILABLE", 502, "remnashop down");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Сервис временно недоступен. Попробуйте позже.",
    });
  });

  it("uses specific message for AUTH_FAILED", async () => {
    const commands = mockCommands({
      loadLinkActor: vi.fn(async () => {
        throw new ServiceError("AUTH_FAILED", 401, "bad credentials");
      }),
    });

    const result = await linkAccountEmail(commands, { email: "test@test.com", password: "wrong" });
    expect(result).toEqual({
      ok: false,
      code: "AUTH_FAILED",
      message: "Неверный e-mail или пароль.",
    });
  });

  it("uses specific message for UNAUTHORIZED", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("UNAUTHORIZED", 401, "no session");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Сессия завершилась. Войдите снова.",
    });
  });

  it("falls back to generic message for non-ServiceError", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new Error("something unexpected");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Не удалось объединить аккаунты.",
    });
  });

  it("does not trust a duck-typed public message from an unknown failure", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw {
          code: "UPSTREAM_ERROR",
          publicMessage: "provider debug secret",
        };
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "UPSTREAM_ERROR",
      message: "Не удалось объединить аккаунты.",
    });
  });

  it("uses ServiceError.prodMessage for ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT", 409, "both have subs");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
      message: "В обеих учётных записях есть подписки. Данные не изменены — обратитесь в службу поддержки.",
    });
  });

  it("uses ServiceError.prodMessage for RATE_LIMITED", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("RATE_LIMITED", 429, "too many attempts");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "Слишком много попыток. Попробуйте позже.",
    });
  });
});
