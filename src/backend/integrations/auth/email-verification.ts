import {
  EmailVerificationError,
  type EmailProviderSession,
  type EmailVerificationActor,
  type EmailVerificationCommands,
} from "@/application/auth/ports/email-verification";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { requestRemnashopEmailVerification } from "@/backend/integrations/auth/email-verification-delivery";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopAuthTelegramIdentity,
  remnashopLinkTelegram,
  remnashopMergeUsers,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { refreshCurrentAccessCookie } from "@/backend/integrations/sessions/web-session-service";
import { withPaymentOwnerChangeFence } from "@/backend/integrations/payments/payment-user-merge-service";
import { synchronizeProviderAccountIdentity } from "@/backend/integrations/auth/provider-account-identity-sync";
import { assertCooldown, assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { logger } from "@/backend/observability/logger";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import type { ChangeEmailResponse, ConfirmEmailVerificationResponse } from "@/backend/integrations/remnashop/contracts";

type Authorized = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;
type ActorContext = Pick<Authorized, "accessToken" | "refreshToken" | "session">;
type ProviderContext = {
  accessToken: string;
  refreshToken: string;
  auth: { expires_at: string; refresh_expires_at: string };
};

function actorContext(actor: EmailVerificationActor) {
  return actor.context as ActorContext;
}

function providerContext(session: EmailProviderSession) {
  return session.context as ProviderContext;
}

async function adapt<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof EmailVerificationError) throw error;
    throw new EmailVerificationError(
      error instanceof ServiceError ? error.code : "INTERNAL_ERROR",
      error instanceof ServiceError ? error.debug?.retryAfterSeconds : undefined,
    );
  }
}

function providerSession(auth: {
  cookies: { accessToken: string; refreshToken: string };
  data: { expires_at: string; refresh_expires_at: string };
}): EmailProviderSession {
  return {
    context: {
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
    } satisfies ProviderContext,
  };
}

export const productionEmailVerificationCommands: EmailVerificationCommands = {
  verifyHuman: (token, action) => adapt(() => verifyTurnstileToken(token, action)),

  async loadActor(options) {
    const authorized = await adapt(() => getAuthorizedRemnashopTokens(
      options?.allowUnverifiedEmail ? { allowUnverifiedEmail: true } : undefined,
    ));
    const { accessToken, session } = authorized;
    return {
      context: authorized,
      userId: session.userId,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      telegramId: session.user.telegramId,
      telegramUsername: session.user.telegramUsername,
      pendingUpstreamAccountId: session.user.pendingRemnashopUserId,
      pendingEmail: session.user.pendingRemnashopEmail,
      authorizedUpstreamAccountId: getRemnashopUserIdFromAccessToken(accessToken),
    };
  },

  async assertRequestLimits(input) {
    await adapt(async () => {
      await assertCooldown({ key: `email-verification:${input.userId}`, action: "email_verification_request", windowSeconds: 60 });
      await assertRateLimit({
        action: "email_verification_request",
        email: input.email,
        tgId: input.telegramId,
        limit: 5,
        windowSeconds: 15 * 60,
      });
    });
  },

  async requestProviderCode(actor, email) {
    const result = await adapt(() => requestRemnashopEmailVerification({
      accessToken: actorContext(actor).accessToken,
      body: email ? { email } : {},
      source: "resend",
    }));
    return { targetEmail: result.target_email };
  },

  async auditCodeRequested(input) {
    await adapt(() => auditLog({
      action: "email_verification_requested",
      userId: input.userId,
      metadata: { targetEmail: input.targetEmail },
    }));
  },

  async loadProviderProfile(actor) {
    const profile = await adapt(() => getRemnashopMe(actorContext(actor).accessToken));
    return {
      email: profile.email,
      pendingEmail: profile.pending_email,
      emailVerified: profile.is_email_verified,
    };
  },

  async assertConfirmationLimit(input) {
    await adapt(() => assertRateLimit({
      action: "email_verification_confirm",
      email: input.email,
      tgId: input.telegramId,
      limit: 5,
      windowSeconds: 15 * 60,
    }));
  },

  async confirmProviderCode(actor, input) {
    if (input.alreadyVerified) return { email: input.email! };
    return adapt(() => remnashopRequest<ConfirmEmailVerificationResponse>(
      "/auth/email/confirm",
      {
        method: "POST",
        accessToken: actorContext(actor).accessToken,
        body: { code: input.code, ...(input.email ? { email: input.email } : {}) },
      },
    ));
  },

  async persistConfirmedEmail(actor, email) {
    return adapt(async () => {
      const existingOwner = await prisma.webUser.findUnique({ where: { email } });
      const currentUserOwnsEmail = !existingOwner || existingOwner.id === actor.userId;
      const localVerificationChanged = !currentUserOwnsEmail || !actor.emailVerified || actor.email !== email;
      await prisma.$transaction(async (tx) => {
        if (existingOwner && existingOwner.id !== actor.userId) {
          await tx.webUser.update({ where: { id: existingOwner.id }, data: { emailVerified: true } });
        }
        await tx.webUser.update({
          where: { id: actor.userId },
          data: {
            ...(currentUserOwnsEmail ? { email, emailVerified: true } : {}),
            authPending: true,
            pendingRemnashopUserId: actor.authorizedUpstreamAccountId,
            pendingRemnashopEmail: email,
          },
        });
      });
      return {
        existingOwnerId: existingOwner?.id ?? null,
        upstreamAccountId: actor.authorizedUpstreamAccountId,
        localVerificationChanged,
      };
    });
  },

  currentProviderSession(actor) {
    const { accessToken, refreshToken, session } = actorContext(actor);
    return {
      context: {
        accessToken,
        refreshToken,
        auth: {
          expires_at: session.remnashopAccessExpiresAt?.toISOString() ?? new Date(Date.now() + 60_000).toISOString(),
          refresh_expires_at: session.remnashopRefreshExpiresAt?.toISOString() ?? new Date(Date.now() + 86_400_000).toISOString(),
        },
      } satisfies ProviderContext,
    };
  },

  providerAccountId(session) {
    return getRemnashopUserIdFromAccessToken(providerContext(session).accessToken);
  },

  async telegramProviderSession(input) {
    return providerSession(await adapt(() => remnashopAuthTelegramIdentity(input)));
  },

  async attachTelegram(session, input) {
    const provider = providerContext(session);
    await adapt(() => remnashopLinkTelegram({ accessToken: provider.accessToken, ...input }));
  },

  async mergeProviderAccounts(input) {
    await adapt(async () => {
      try {
        await remnashopMergeUsers({
          sourceUserId: input.sourceAccountId,
          targetUserId: input.targetAccountId,
          reason: input.reason,
          emailResolution: "KEEP_TARGET",
          telegramResolution: "KEEP_SOURCE",
          paymentResolution: "REKEY_SOURCE",
        });
      } catch (error) {
        if (error instanceof ServiceError && error.code === "CONFLICT"
          && String(error.debug?.message ?? error.message).toLowerCase().includes("both users have current subscriptions")) {
          throw new EmailVerificationError("ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT");
        }
        throw error;
      }
    });
  },

  async refreshProviderSession(input) {
    return providerSession(await adapt(() => remnashopAuthTelegramIdentity(input)));
  },

  async linkCurrentAccount(session, input) {
    const provider = providerContext(session);
    await adapt(() => synchronizeProviderAccountIdentity(provider.accessToken));
    await adapt(async () => {
      await linkCurrentUserToRemnashopAuth({
        accessToken: provider.accessToken,
        refreshToken: provider.refreshToken,
        auth: provider.auth,
        ...(input.upstreamMerged ? { invalidateSiblingRemnashopTokens: true } : {}),
        paymentOwnerFenceHeld: input.ownerFenceHeld,
      });
    });
  },

  withOwnerChangeFence: withPaymentOwnerChangeFence,

  async refreshLocalSession() {
    await adapt(() => refreshCurrentAccessCookie());
  },

  async auditEmailVerified(input) {
    await adapt(() => auditLog({ action: "email_verified", userId: input.userId, metadata: { email: input.email } }));
  },

  async markAccountSyncPending(userId, error) {
    await prisma.webUser.update({ where: { id: userId }, data: { authPending: true } });
    logger.warn("email_verification_post_confirm_sync_failed", {
      userId,
      errorCode: error instanceof EmailVerificationError ? error.code : "INTERNAL_ERROR",
    }, {
      category: "auth",
      source: "email.verification",
      message: "E-mail was verified but post-confirm account synchronization is pending",
    });
  },

  async assertChangeLimits(input) {
    await adapt(async () => {
      await assertRateLimit({
        action: "email_change_attempt",
        sessionId: input.userId,
        limit: 5,
        windowSeconds: 15 * 60,
      });
    });
  },

  async emailOwnerId(email) {
    return adapt(async () => (await prisma.webUser.findUnique({
      where: { email },
      select: { id: true },
    }))?.id ?? null);
  },

  async assertChangeCooldown(userId) {
    await adapt(() => assertCooldown({
      key: `email-change:${userId}`,
      action: "email_change_cooldown",
      windowSeconds: 60,
    }));
  },

  async changeProviderEmail(actor, email) {
    const result = await adapt(() => remnashopRequest<ChangeEmailResponse>(
      "/auth/email/change",
      { method: "POST", accessToken: actorContext(actor).accessToken, body: { email } },
    ));
    return { pendingEmail: result.pending_email };
  },

  async persistPendingEmail(actor, pendingEmail) {
    await adapt(() => prisma.webUser.update({
      where: { id: actor.userId },
      data: {
        emailVerified: false,
        ...(actor.telegramId ? {
          authPending: false,
          pendingRemnashopUserId: actor.authorizedUpstreamAccountId,
          pendingRemnashopEmail: pendingEmail,
        } : {}),
      },
    }).then(() => undefined));
  },

  async auditEmailChangeRequested(input) {
    await adapt(() => auditLog({
      action: "email_change_requested",
      userId: input.userId,
      metadata: {
        pendingEmail: input.pendingEmail,
        verificationTargetEmail: input.verificationTargetEmail,
      },
    }));
  },

};
