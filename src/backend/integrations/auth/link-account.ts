import { cookies } from "next/headers";

import {
  LinkAccountGatewayError,
  type LinkAccountCommands,
  type LinkAccountReader,
} from "@/application/auth/ports/link-account";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import {
  getTelegramAccountMergeConfirmation,
  telegramAccountMergeCookieName,
} from "@/backend/integrations/auth/telegram-account-merge-store";
import { requestRemnashopEmailVerification } from "@/backend/integrations/auth/email-verification-delivery";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
  remnashopAuth,
  remnashopAuthTelegramIdentity,
  remnashopLinkTelegram,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/client";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/integrations/sessions/web-session-service";
import {
  assertPaymentOwnerChangeFenceHeld,
  markPaymentOwnerChangeUpstreamMutationStarted,
  withPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-service";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { synchronizeProviderAccountIdentity } from "@/backend/integrations/auth/provider-account-identity-sync";
import { productionTelegramAccountMergeGateway } from "@/backend/integrations/auth/telegram-account-merge-gateway";

type CurrentSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
type ProviderAuth = Awaited<ReturnType<typeof remnashopAuth>>;
type SessionReader = () => ReturnType<typeof getCurrentSession>;

function actorSession(actor: { context: unknown }) {
  return actor.context as CurrentSession;
}

function providerAuth(session: { context: unknown }) {
  return session.context as ProviderAuth;
}

function gatewayError(error: unknown): LinkAccountGatewayError {
  if (error instanceof LinkAccountGatewayError) return error;
  if (!(error instanceof ServiceError)) return new LinkAccountGatewayError("INTERNAL_ERROR");
  const message = String(error.debug?.message ?? error.message).toLowerCase();
  if (error.code === "CONFLICT" && message.includes("email already exists")) {
    return new LinkAccountGatewayError("EMAIL_ALREADY_EXISTS");
  }
  if (error.code === "CONFLICT" && message.includes("email is already verified")) {
    return new LinkAccountGatewayError("EMAIL_ALREADY_VERIFIED");
  }
  if (error.code === "CONFLICT" && message.includes("both users have current subscriptions")) {
    return new LinkAccountGatewayError("ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT");
  }
  return new LinkAccountGatewayError(error.code);
}

async function adapt<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch (error) { throw gatewayError(error); }
}

async function mergeToken() {
  const token = (await cookies()).get(telegramAccountMergeCookieName)?.value;
  if (!token) throw new ServiceError("NOT_FOUND", 404, "Account merge confirmation was not found.");
  return token;
}

export function createProductionLinkAccountReader(
  readSession: SessionReader = getCurrentSession,
): LinkAccountReader {
  return {
    async loadMergeActor() {
      const session = await adapt(readSession);
      return session ? { userId: session.userId, fullAssurance: session.assuranceLevel === "FULL" } : null;
    },
    async loadTelegramMergeConfirmation(userId) {
      try {
        const confirmation = await getTelegramAccountMergeConfirmation(await mergeToken(), userId);
        return { ...confirmation, emailWillBeReplaced: confirmation.emailWillBeReplaced };
      } catch (error) {
        const code = error instanceof ServiceError ? error.code : null;
        if (code !== "NOT_FOUND") throw error;
        let confirmation;
        try {
          confirmation = await productionTelegramAccountMergeGateway.loadConfirmation(userId);
        } catch (fallbackError) {
          if ((fallbackError as { code?: unknown })?.code === "NOT_FOUND") {
            throw new ServiceError("NOT_FOUND", 404, "Account merge confirmation has expired.");
          }
          throw fallbackError;
        }
        const sourceEmail = confirmation.sourceEmail?.trim().toLowerCase() ?? null;
        const targetEmail = confirmation.targetEmail.trim().toLowerCase();
        const sourceEmailMasked = sourceEmail
          ? `${sourceEmail.slice(0, Math.min(2, sourceEmail.indexOf("@")))}***@${sourceEmail.split("@", 2)[1] ?? ""}`
          : null;
        return {
          targetEmail: confirmation.targetEmail,
          sourceEmailMasked,
          emailWillBeReplaced: sourceEmail !== null && sourceEmail !== targetEmail,
          telegramId: confirmation.telegramId,
          status: confirmation.status,
          expiresAt: confirmation.expiresAt,
          recoverableAfterExpiry: confirmation.recoverableAfterExpiry,
        };
      }
    },
  };
}

export const productionLinkAccountReader = createProductionLinkAccountReader();

export const productionLinkAccountCommands: LinkAccountCommands = {
  async loadLinkActor() {
    const session = await adapt(() => getCurrentSession());
    if (!session) return null;
    return {
      context: session,
      userId: session.userId,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      telegramId: session.user.telegramId,
      telegramUsername: session.user.telegramUsername,
      upstreamAccountId: session.user.remnashopUserId,
      fullAssurance: session.assuranceLevel === "FULL",
    };
  },

  async assertLinkRateLimit(email) {
    await adapt(() => assertRateLimit({ action: "remnashop_link", email, limit: 10, windowSeconds: 15 * 60 }));
  },

  async authenticateEmail(input) {
    return { context: await adapt(() => remnashopAuth(
      input.operation === "login" ? "/auth/login" : "/auth/register",
      { email: input.email, password: input.password },
    )) };
  },

  async linkActorIsCurrent(actor) {
    const expected = actorSession(actor);
    const current = await adapt(() => getCurrentSession());
    return Boolean(current
      && current.id === expected.id
      && current.userId === expected.userId
      && current.user.remnashopUserId === expected.user.remnashopUserId
      && current.user.email === expected.user.email
      && current.user.emailVerified === expected.user.emailVerified
      && current.user.telegramId === expected.user.telegramId
      && current.user.telegramUsername === expected.user.telegramUsername
      && current.user.authPending === expected.user.authPending
      && current.user.pendingRemnashopUserId === expected.user.pendingRemnashopUserId
      && current.user.pendingRemnashopEmail === expected.user.pendingRemnashopEmail);
  },

  async loadProviderProfile(session) {
    const profile = await adapt(() => getRemnashopMe(providerAuth(session).cookies.accessToken));
    return {
      email: profile.email,
      emailVerified: profile.is_email_verified,
      pendingEmail: profile.pending_email,
      telegramId: profile.telegram_id === null ? null : String(profile.telegram_id),
    };
  },

  providerAccountId(session) {
    return getRemnashopUserIdFromAccessToken(providerAuth(session).cookies.accessToken);
  },

  async telegramProviderSession(input) {
    return { context: await adapt(() => remnashopAuthTelegramIdentity(input)) };
  },

  async attachTelegram(session, input) {
    await markPaymentOwnerChangeUpstreamMutationStarted();
    await adapt(() => remnashopLinkTelegram({ accessToken: providerAuth(session).cookies.accessToken, ...input }));
  },

  async mergeProviderAccounts(input) {
    await markPaymentOwnerChangeUpstreamMutationStarted();
    await adapt(() => remnashopMergeUsers({
      sourceUserId: input.sourceAccountId,
      targetUserId: input.targetAccountId,
      reason: input.reason,
      emailResolution: "KEEP_TARGET",
      telegramResolution: "KEEP_SOURCE",
      paymentResolution: "REKEY_SOURCE",
    }).then(() => undefined));
  },

  async refreshTelegramProviderSession(input) {
    return { context: await adapt(() => remnashopAuthTelegramIdentity(input)) };
  },

  async linkCurrentAccount(session, input) {
    const auth = providerAuth(session);
    const verified = await adapt(() => synchronizeProviderAccountIdentity(
      auth.cookies.accessToken,
      input.expectedIdentity,
    ));
    const linked = await adapt(() => linkCurrentUserToRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
      ...(input.upstreamMerged ? { invalidateSiblingRemnashopTokens: true } : {}),
      paymentOwnerFenceHeld: input.ownerFenceHeld,
      verifiedProfile: verified.profile,
    }));
    await adapt(() => refreshCurrentAccessCookie());
    return { userId: linked.user.id };
  },

  withOwnerChangeFence: withPaymentOwnerChangeFence,

  async emailOwnerId(email) {
    return (await adapt(() => prisma.webUser.findUnique({ where: { email }, select: { id: true } })))?.id ?? null;
  },

  async stagePendingEmail({ actor, providerSession, email, providerEmail, stagedLocally, ownerTransitionStarted }) {
    const session = actorSession(actor);
    const auth = providerAuth(providerSession);
    await adapt(() => prisma.$transaction(async (tx) => {
      if (ownerTransitionStarted) {
        await assertPaymentOwnerChangeFenceHeld(tx, [session.userId]);
      }
      await tx.webSession.update({
        where: { id: session.id, userId: session.userId, revokedAt: null },
        data: {
          remnashopAccessTokenEncrypted: protectRemnashopToken(auth.cookies.accessToken),
          remnashopRefreshTokenEncrypted: protectRemnashopToken(auth.cookies.refreshToken),
          remnashopAccessExpiresAt: new Date(auth.data.expires_at),
          remnashopRefreshExpiresAt: new Date(auth.data.refresh_expires_at),
          remnashopRefreshClaimTokenHash: null,
          remnashopRefreshLeaseExpiresAt: null,
          remnashopRefreshDispatchedAt: null,
          remnashopRefreshRecoveryEncrypted: null,
        },
      });
      const staged = await tx.webUser.updateMany({
        where: {
          id: session.userId,
          remnashopUserId: session.user.remnashopUserId,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          telegramId: session.user.telegramId,
          telegramUsername: session.user.telegramUsername,
          authPending: session.user.authPending,
          pendingRemnashopUserId: session.user.pendingRemnashopUserId,
          pendingRemnashopEmail: session.user.pendingRemnashopEmail,
        },
        data: {
          pendingRemnashopUserId: getRemnashopUserIdFromAccessToken(auth.cookies.accessToken),
          pendingRemnashopEmail: providerEmail ?? email,
          ...(ownerTransitionStarted ? { authPending: true } : {}),
          ...(stagedLocally ? { email, emailVerified: false, authPending: false } : {}),
        },
      });
      if (staged.count !== 1) {
        throw new ServiceError("UNAUTHORIZED", 401, "The local link actor changed before staging.");
      }
    }));
    if (stagedLocally) await adapt(() => refreshCurrentAccessCookie());
  },

  async requestProviderVerification(session, email) {
    const result = await adapt(() => requestRemnashopEmailVerification({
      accessToken: providerAuth(session).cookies.accessToken,
      body: { email },
      source: "link_remnashop",
    }));
    return { targetEmail: result.target_email };
  },

  async auditLinkEvent(input) {
    await adapt(() => auditLog(input));
  },

};
