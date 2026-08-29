import {
  LinkAccountGatewayError,
  type LinkAccountActor,
  type LinkAccountCommands,
  type LinkAccountReader,
} from "@/application/auth/ports/link-account";
import type { LinkAccountCommandResult, LinkAccountViewModel } from "@/application/models/link-account";
import type { TelegramAccountMergeGateway } from "@/application/auth/ports/telegram-account-merge";
import { cancelTelegramAccountMerge, confirmTelegramAccountMerge } from "@/application/auth/confirm-telegram-account-merge";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";
import type { PasskeyManagementGateway } from "@/application/auth/ports/passkey-management";
import { accountAccessIssue } from "@/shared/domain/account-access-policy";
import { paymentOwnerTransitionKey } from "@/shared/domain/payment-owner-transition";

function callbackError(status: string | null) {
  if (status === "telegram_merge_subscriptions") return "В обеих учётных записях есть подписки. Данные не изменены — обратитесь в службу поддержки.";
  if (status === "telegram_merge_required") return "Автоматическое объединение остановлено из-за конфликта данных. Ничего не изменено.";
  if (status === "telegram_failed") return "Не удалось завершить привязку Telegram.";
  if (status === "telegram_recovery_required") return "Привязка Telegram остановилась после безопасной проверки. Повторите привязку; если проблема сохраняется, обратитесь в поддержку.";
  return null;
}

async function loadManagedPasskeys(gateway: PasskeyManagementGateway) {
  const actor = await gateway.loadActor();
  if (!actor || !actor.fullAssurance) throw new LinkAccountGatewayError("UNAUTHORIZED");
  const issue = accountAccessIssue(actor);
  if (issue) throw new LinkAccountGatewayError(issue);
  return gateway.loadOwned(actor.userId);
}

async function loadMergeConfirmation(reader: LinkAccountReader) {
  const actor = await reader.loadMergeActor();
  if (!actor) throw new LinkAccountGatewayError("UNAUTHORIZED");
  if (!actor.fullAssurance) throw new LinkAccountGatewayError("PASSKEY_REQUIRED");
  const confirmation = await reader.loadTelegramMergeConfirmation(actor.userId);
  if (!confirmation
    || (confirmation.expiresAt <= new Date() && !confirmation.recoverableAfterExpiry)
    || confirmation.status === "FAILED") {
    throw new LinkAccountGatewayError("NOT_FOUND");
  }
  return {
    targetEmail: confirmation.targetEmail,
    sourceEmailMasked: confirmation.sourceEmailMasked,
    emailWillBeReplaced: confirmation.emailWillBeReplaced,
    telegramId: confirmation.telegramId,
  };
}

export async function loadLinkAccount(reader: LinkAccountReader, auth: AuthProfileGateway, passkeyGateway: PasskeyManagementGateway, status: string | null): Promise<LinkAccountViewModel> {
  try {
    const [profile, passkeys, mergeConfirmation] = await Promise.all([
      resolveAuthProfile(auth).then((user) => ({
        email: user.email,
        emailVerified: user.emailVerified,
        telegramId: user.telegramId,
      })),
      loadManagedPasskeys(passkeyGateway).catch(() => []),
      status === "telegram_email_replace" || status === "telegram_processing"
        ? loadMergeConfirmation(reader)
        : Promise.resolve(null),
    ]);
    return { status: "ready", profile, passkeys, mergeConfirmation, callbackError: callbackError(status) };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return code === "PROVIDER_SESSION_RECOVERY_REQUIRED"
      ? { status: "provider-session-recovery-required" }
      : code === "UNAUTHORIZED"
      ? { status: "unauthorized" }
      : { status: "error", message: "Не удалось загрузить способы входа." };
  }
}

function failed(error: unknown, fallback: string): LinkAccountCommandResult {
  const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "INTERNAL_ERROR";
  const publicMessage = error instanceof LinkAccountGatewayError
    ? error.publicMessage ?? null
    : null;
  const prodMessage = typeof (error as { prodMessage?: unknown })?.prodMessage === "string" ? (error as { prodMessage: string }).prodMessage : null;
  const message = code === "AUTH_FAILED" ? "Неверный e-mail или пароль." : code === "UNAUTHORIZED" ? "Сессия завершилась. Войдите снова." : publicMessage ?? prodMessage ?? fallback;
  return { ok: false, code, message };
}

async function mergeLinkAccounts(
  commands: LinkAccountCommands,
  emailSession: { context: unknown },
  identity: { telegramId: string; telegramUsername: string | null },
) {
  const telegramSession = await commands.telegramProviderSession(identity);
  const sourceAccountId = commands.providerAccountId(telegramSession);
  const targetAccountId = commands.providerAccountId(emailSession);
  if (sourceAccountId !== targetAccountId) {
    await commands.mergeProviderAccounts({
      sourceAccountId,
      targetAccountId,
      reason: "Clean Pay account link: verified e-mail password and Telegram ownership",
    });
  }
  return commands.refreshTelegramProviderSession(identity);
}

async function linkVerifiedEmailAccount(
  commands: LinkAccountCommands,
  actor: LinkAccountActor,
  initialSession: { context: unknown },
  email: string,
) {
  const identity = actor.telegramId
    ? { telegramId: actor.telegramId, telegramUsername: actor.telegramUsername }
    : null;
  const targetAccountId = commands.providerAccountId(initialSession);
  const existingOwnerId = await commands.emailOwnerId(email);
  const linked = await commands.withOwnerChangeFence({
    userIds: [actor.userId, existingOwnerId ?? ""],
    upstreamAccountIds: [targetAccountId, actor.upstreamAccountId ?? ""],
    emails: [email, actor.email],
    telegramIds: [actor.telegramId],
    operationKey: paymentOwnerTransitionKey({
      actorUserId: actor.userId,
      sourceUpstreamAccountId: actor.upstreamAccountId ?? targetAccountId,
      targetUpstreamAccountId: targetAccountId,
      telegramId: actor.telegramId,
    }),
    targetUpstreamAccountId: targetAccountId,
    work: async () => {
      await commands.stagePendingEmail({
        actor,
        providerSession: initialSession,
        email,
        providerEmail: email,
        stagedLocally: false,
        ownerTransitionStarted: true,
      });
      let providerSession = initialSession;
      let upstreamMerged = false;
      if (identity) {
        try {
          await commands.attachTelegram(providerSession, identity);
        } catch (error) {
          if (!(error instanceof LinkAccountGatewayError) || error.code !== "CONFLICT") throw error;
          providerSession = await mergeLinkAccounts(commands, initialSession, identity);
          upstreamMerged = true;
        }
        const telegramSession = await commands.telegramProviderSession(identity);
        if (commands.providerAccountId(providerSession) !== commands.providerAccountId(telegramSession)) {
          providerSession = await mergeLinkAccounts(commands, initialSession, identity);
          upstreamMerged = true;
        }
      }
      return commands.linkCurrentAccount(providerSession, {
        upstreamMerged,
        ownerFenceHeld: true,
        expectedIdentity: {
          accountId: targetAccountId,
          email,
          emailVerified: true,
          pendingEmail: null,
          telegramId: actor.telegramId,
        },
      });
    },
  });
  try {
    await commands.auditLinkEvent({
      action: "remnashop_account_linked_verified_email",
      userId: linked.userId,
      metadata: { email, telegramId: actor.telegramId },
    });
  } catch { /* committed owner transition must remain successful */ }
}

export async function linkAccountEmail(
  commands: LinkAccountCommands,
  input: { email: string; password: string },
): Promise<LinkAccountCommandResult> {
  try {
    const email = input.email.trim().toLowerCase();
    const actor = await commands.loadLinkActor();
    if (!actor) throw new LinkAccountGatewayError("UNAUTHORIZED");
    if (!actor.fullAssurance) throw new LinkAccountGatewayError("PASSKEY_REQUIRED");
    await commands.assertLinkRateLimit(email);
    let providerSession: { context: unknown };
    let source: "login" | "register" = "login";
    let loginFailure: unknown;
    try {
      providerSession = await commands.authenticateEmail({ operation: "login", email, password: input.password });
    } catch (error) {
      if (!(error instanceof LinkAccountGatewayError) || error.code !== "AUTH_FAILED") throw error;
      loginFailure = error;
      source = "register";
      try {
        providerSession = await commands.authenticateEmail({ operation: "register", email, password: input.password });
      } catch (registerError) {
        if (registerError instanceof LinkAccountGatewayError && registerError.code === "EMAIL_ALREADY_EXISTS") throw loginFailure;
        throw registerError;
      }
    }
    if (!await commands.linkActorIsCurrent(actor)) throw new LinkAccountGatewayError("UNAUTHORIZED");
    const profile = await commands.loadProviderProfile(providerSession);
    if (source === "login" && profile.email && profile.emailVerified && !profile.pendingEmail) {
      await linkVerifiedEmailAccount(commands, actor, providerSession, profile.email);
      return { ok: true, kind: "linked" };
    }
    const emailOwnerId = await commands.emailOwnerId(email);
    const stagedLocally = !emailOwnerId || emailOwnerId === actor.userId;
    await commands.stagePendingEmail({ actor, providerSession, email, providerEmail: profile.email, stagedLocally });
    try {
      const verification = await commands.requestProviderVerification(providerSession, email);
      await commands.auditLinkEvent({
        action: "remnashop_account_link_requested",
        userId: actor.userId,
        metadata: {
          email: profile.email,
          telegramId: actor.telegramId,
          verificationTargetEmail: verification.targetEmail,
          stagedLocalEmail: stagedLocally,
        },
      });
      return { ok: true, kind: "verification-required" };
    } catch (error) {
      if (!(error instanceof LinkAccountGatewayError) || error.code !== "EMAIL_ALREADY_VERIFIED") throw error;
      if (source !== "login") throw new LinkAccountGatewayError("EMAIL_LINK_REQUIRES_VERIFICATION");
      await linkVerifiedEmailAccount(commands, actor, providerSession, profile.email ?? email);
      return { ok: true, kind: "linked" };
    }
  } catch (error) {
    return failed(error, "Не удалось связать e-mail с аккаунтом.");
  }
}

export async function confirmLinkedTelegram(gateway: TelegramAccountMergeGateway): Promise<LinkAccountCommandResult> {
  try { await confirmTelegramAccountMerge(gateway); return { ok: true, kind: "merge-confirmed" }; }
  catch (error) { return failed(error, "Не удалось объединить аккаунты."); }
}

export async function cancelLinkedTelegram(gateway: TelegramAccountMergeGateway): Promise<LinkAccountCommandResult> {
  try { await cancelTelegramAccountMerge(gateway); return { ok: true, kind: "merge-cancelled" }; }
  catch (error) { return failed(error, "Не удалось отменить объединение."); }
}

export async function removeLinkedPasskey(gateway: PasskeyManagementGateway, id: string): Promise<LinkAccountCommandResult> {
  try {
    const actor = await gateway.loadActor();
    if (!actor || !actor.fullAssurance) throw new LinkAccountGatewayError("UNAUTHORIZED");
    const issue = accountAccessIssue(actor);
    if (issue) throw new LinkAccountGatewayError(issue);
    const deleted = await gateway.deleteOwned(actor.userId, id);
    await gateway.auditDeleted(actor.userId, deleted.externalCredentialId);
    return { ok: true, kind: "passkey-deleted" };
  }
  catch (error) { return failed(error, "Не удалось удалить ключ быстрого входа."); }
}
