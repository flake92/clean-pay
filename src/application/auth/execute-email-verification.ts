import {
  EmailVerificationError,
  type EmailProviderSession,
  type EmailVerificationActor,
  type EmailVerificationCommands,
} from "@/application/auth/ports/email-verification";
import type { AccountReadiness, EmailVerificationResult } from "@/application/models/email-verification";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import { AuthProfileError } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";
import { paymentOwnerTransitionKey } from "@/shared/domain/payment-owner-transition";

function failure(error: unknown, fallback: string): EmailVerificationResult {
  const code = error instanceof EmailVerificationError ? error.code : "INTERNAL_ERROR";
  const retryAfterSeconds = error instanceof EmailVerificationError
    && typeof error.retryAfterSeconds === "number"
    && error.retryAfterSeconds > 0
    ? Math.ceil(error.retryAfterSeconds)
    : null;
  const messages: Record<string, string> = {
    FORBIDDEN: "Проверка безопасности не пройдена. Выполните её ещё раз и повторите попытку.",
    EMAIL_REQUIRED: "Сначала добавьте e-mail и пароль к аккаунту.",
    EMAIL_CODE_INVALID: "Код не подошёл. Проверьте его и попробуйте снова.",
    EMAIL_CODE_EXPIRED: "Код истёк. Запросите новый.",
    CONFLICT: "Этот e-mail уже привязан к другому аккаунту. Войдите в него или укажите другой адрес.",
    RATE_LIMITED: retryAfterSeconds
      ? `Повторите попытку через ${retryAfterSeconds} сек.`
      : "Слишком много попыток. Попробуйте позже.",
  };
  return { ok: false, code, message: messages[code] ?? fallback };
}

function assertPasswordBackedEmail(actor: EmailVerificationActor, target?: string) {
  if (!actor.telegramId) return;
  const normalizedTarget = target?.trim().toLowerCase() || null;
  const normalizedEmail = actor.email?.trim().toLowerCase() || null;
  const normalizedPending = actor.pendingEmail?.trim().toLowerCase() || null;
  const verifiedMatches = actor.emailVerified && normalizedEmail
    && (!normalizedTarget || normalizedEmail === normalizedTarget);
  const stagedMatches = actor.pendingUpstreamAccountId === actor.authorizedUpstreamAccountId
    && normalizedPending && (!normalizedTarget || normalizedPending === normalizedTarget);
  if (!verifiedMatches && !stagedMatches) throw new EmailVerificationError("EMAIL_REQUIRED");
}

export async function requestEmailVerificationCode(
  commands: EmailVerificationCommands,
  input: { email?: string; turnstileToken?: string },
): Promise<EmailVerificationResult> {
  try {
    await commands.verifyHuman(input.turnstileToken ?? null, "email_verification");
    const actor = await commands.loadActor({ allowUnverifiedEmail: true });
    assertPasswordBackedEmail(actor, input.email);
    await commands.assertRequestLimits({
      userId: actor.userId,
      email: input.email ?? actor.email,
      telegramId: actor.telegramId,
    });
    const result = await commands.requestProviderCode(actor, input.email);
    await commands.auditCodeRequested({ userId: actor.userId, targetEmail: result.targetEmail });
    return { ok: true, kind: "code-sent", targetEmail: result.targetEmail };
  } catch (error) {
    return failure(error, "Не удалось отправить код.");
  }
}

async function mergeEmailAndTelegramAccounts(
  commands: EmailVerificationCommands,
  emailSession: EmailProviderSession,
  actor: EmailVerificationActor,
) {
  const identity = { telegramId: actor.telegramId!, telegramUsername: actor.telegramUsername };
  const telegramSession = await commands.telegramProviderSession(identity);
  const sourceAccountId = commands.providerAccountId(telegramSession);
  const targetAccountId = commands.providerAccountId(emailSession);
  if (sourceAccountId !== targetAccountId) {
    await commands.mergeProviderAccounts({
      sourceAccountId,
      targetAccountId,
      reason: "Clean Pay account link: verified e-mail code and Telegram ownership",
    });
  }
  return commands.refreshProviderSession(identity);
}

async function synchronizeConfirmedAccount(
  commands: EmailVerificationCommands,
  actor: EmailVerificationActor,
  email: string,
  persisted: { existingOwnerId: string | null; upstreamAccountId: string },
) {
  await commands.withOwnerChangeFence({
    userIds: [actor.userId, persisted.existingOwnerId ?? ""],
    upstreamAccountIds: [persisted.upstreamAccountId],
    emails: [email],
    telegramIds: [actor.telegramId],
    operationKey: paymentOwnerTransitionKey({
      actorUserId: actor.userId,
      sourceUpstreamAccountId:
        actor.localUpstreamAccountId ?? persisted.upstreamAccountId,
      targetUpstreamAccountId: persisted.upstreamAccountId,
      telegramId: actor.telegramId,
    }),
    targetUpstreamAccountId: persisted.upstreamAccountId,
    work: async () => {
      let providerSession = commands.currentProviderSession(actor);
      let upstreamMerged = false;
      if (actor.telegramId) {
        try {
          await commands.attachTelegram(providerSession, {
            telegramId: actor.telegramId,
            telegramUsername: actor.telegramUsername,
          });
        } catch (error) {
          if (!(error instanceof EmailVerificationError) || error.code !== "CONFLICT") throw error;
          providerSession = await mergeEmailAndTelegramAccounts(commands, providerSession, actor);
          upstreamMerged = true;
        }
        const telegramSession = await commands.telegramProviderSession({
          telegramId: actor.telegramId,
          telegramUsername: actor.telegramUsername,
        });
        if (commands.providerAccountId(providerSession) !== commands.providerAccountId(telegramSession)) {
          providerSession = await mergeEmailAndTelegramAccounts(
            commands,
            commands.currentProviderSession(actor),
            actor,
          );
          upstreamMerged = true;
        }
      }
      await commands.linkCurrentAccount(providerSession, {
        upstreamMerged,
        ownerFenceHeld: true,
        expectedIdentity: {
          accountId: persisted.upstreamAccountId,
          email,
          emailVerified: true,
          pendingEmail: null,
          telegramId: actor.telegramId,
        },
      });
      await commands.refreshLocalSession();
    },
  });
}

export async function confirmEmailVerificationCode(
  commands: EmailVerificationCommands,
  input: { email?: string; code: string; turnstileToken?: string },
): Promise<EmailVerificationResult> {
  if (!/^\d{6}$/.test(input.code)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Введите код из 6 цифр." };
  }
  try {
    await commands.verifyHuman(input.turnstileToken ?? null, "email_verification");
    const actor = await commands.loadActor({ allowUnverifiedEmail: true });
    const profile = await commands.loadProviderProfile(actor);
    const targetEmail = input.email ?? profile.pendingEmail ?? profile.email ?? actor.email ?? undefined;
    assertPasswordBackedEmail(actor, targetEmail);
    await commands.assertConfirmationLimit({ email: targetEmail ?? null, telegramId: actor.telegramId });
    const alreadyVerified = Boolean(
      profile.email && profile.emailVerified
      && (!targetEmail || profile.email.toLowerCase() === targetEmail.toLowerCase()),
    );
    const confirmed = await commands.confirmProviderCode(actor, {
      email: targetEmail,
      code: input.code,
      alreadyVerified,
    });
    const persisted = await commands.persistConfirmedEmail(actor, confirmed.email);
    await commands.refreshLocalSession();
    if (persisted.localVerificationChanged) {
      await commands.auditEmailVerified({ userId: actor.userId, email: confirmed.email });
    }

    let accountSyncPending = false;
    try {
      await synchronizeConfirmedAccount(commands, actor, confirmed.email, persisted);
    } catch (error) {
      accountSyncPending = true;
      await commands.markAccountSyncPending(actor.userId, error);
    }
    const readiness = accountSyncPending
      ? { status: "pending" as const, emailVerified: true }
      : { status: "ready" as const };
    return { ok: true, kind: "confirmed", readiness };
  } catch (error) {
    return failure(error, "Не удалось подтвердить e-mail.");
  }
}

export async function safeReadiness(gateway: AuthProfileGateway): Promise<AccountReadiness> {
  try {
    const user = await resolveAuthProfile(gateway);
    return user.emailVerified && !user.accountSyncPending
      ? { status: "ready" }
      : { status: "pending", emailVerified: user.emailVerified };
  } catch (error) {
    if (error instanceof AuthProfileError) {
      if (error.code === "ACCOUNT_MERGE_REQUIRED" || error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT") return { status: "merge-conflict" };
      if (error.code === "UNAUTHORIZED") return { status: "unauthorized" };
      if (error.code === "PROVIDER_SESSION_RECOVERY_REQUIRED") return { status: "provider-session-recovery-required" };
    }
    return { status: "unavailable" };
  }
}

export async function changeVerifiedEmail(
  commands: EmailVerificationCommands,
  input: { email: string; turnstileToken?: string },
): Promise<EmailVerificationResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, code: "VALIDATION_ERROR", message: "Укажите e-mail." };
  try {
    await commands.verifyHuman(input.turnstileToken ?? null, "email_change");
    const actor = await commands.loadActor({ allowUnverifiedEmail: false });
    assertPasswordBackedEmail(actor);
    await commands.assertChangeLimits({ userId: actor.userId });
    const ownerId = await commands.emailOwnerId(email);
    if (ownerId && ownerId !== actor.userId) throw new EmailVerificationError("CONFLICT");
    await commands.assertChangeCooldown(actor.userId);
    const changed = await commands.changeProviderEmail(actor, email);
    await commands.persistPendingEmail(actor, changed.pendingEmail);
    await commands.refreshLocalSession();
    const verification = await commands.requestProviderCode(actor, changed.pendingEmail);
    await commands.auditEmailChangeRequested({
      userId: actor.userId,
      pendingEmail: changed.pendingEmail,
      verificationTargetEmail: verification.targetEmail,
    });
    return { ok: true, kind: "code-sent", targetEmail: verification.targetEmail };
  } catch (error) {
    return failure(error, "Не удалось изменить e-mail.");
  }
}
