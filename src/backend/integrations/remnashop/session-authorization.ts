import { WebSessionAssuranceLevel } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopCreateServiceSession,
  remnashopRefreshTokens,
} from "@/backend/integrations/remnashop/api-client";
import { acquireRemnashopTokensForSession } from "@/backend/integrations/remnashop/session-token-lifecycle";
import { attachRemnashopTokensForTelegramSession } from "@/backend/integrations/remnashop/telegram-session-recovery";
import { protectRemnashopToken } from "@/backend/integrations/remnashop/token-protection";
import {
  assertEmailVerificationPolicy,
  getCurrentSession,
  refreshCurrentAccessCookie,
} from "@/backend/integrations/sessions/web-session-service";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { normalizeRemnashopError } from "@/backend/integrations/remnashop/errors";

export { attachRemnashopTokensForTelegramSession } from "@/backend/integrations/remnashop/telegram-session-recovery";

export async function recoverRemnashopTelegramSession(
  sessionId: string,
  userId: string,
) {
  const session = await prisma.webSession.findFirst({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
    },
    include: { user: true },
  });

  if (!session) {
    throw new ServiceError(
      "UNAUTHORIZED",
      401,
      "Telegram recovery session is no longer active.",
    );
  }

  try {
    const recovered = await attachRemnashopTokensForTelegramSession(session);

    if (!recovered) {
      throw new ServiceError(
        "UPSTREAM_UNAVAILABLE",
        503,
        "Telegram recovery could not obtain a verified Remnashop session.",
      );
    }

    return recovered;
  } catch (error) {
    const isTerminal = error instanceof ServiceError && (
      error.code === "ACCOUNT_MERGE_REQUIRED" ||
      error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
    );

    if (isTerminal) {
      await prisma.webSession.deleteMany({
        where: { id: sessionId, userId },
      });
    }

    throw error;
  }
}

async function attachRemnashopTokensForVerifiedEmailSession(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
) {
  if (
    session.assuranceLevel !== WebSessionAssuranceLevel.FULL ||
    !session.user.email ||
    !session.user.emailVerified ||
    !session.user.remnashopUserId
  ) {
    return null;
  }

  const auth = await remnashopCreateServiceSession({
    email: session.user.email,
    user_id: session.user.remnashopUserId,
  });
  const profile = await getRemnashopMe(auth.cookies.accessToken);
  const remnashopUserId = getRemnashopUserIdFromAccessToken(auth.cookies.accessToken);
  if (
    profile.email !== session.user.email ||
    !profile.is_email_verified ||
    (session.user.remnashopUserId && session.user.remnashopUserId !== remnashopUserId)
  ) {
    throw new ServiceError(
      "ACCOUNT_MERGE_REQUIRED",
      409,
      "Verified e-mail session resolved to another upstream account",
    );
  }

  const accessExpiresAt = new Date(auth.data.expires_at);
  const refreshExpiresAt = new Date(auth.data.refresh_expires_at);
  const protectedAccessToken = protectRemnashopToken(auth.cookies.accessToken);
  const protectedRefreshToken = protectRemnashopToken(auth.cookies.refreshToken);
  const stored = await prisma.webSession.updateMany({
    where: { id: session.id, userId: session.userId, revokedAt: null },
    data: {
      remnashopAccessTokenEncrypted: protectedAccessToken,
      remnashopRefreshTokenEncrypted: protectedRefreshToken,
      remnashopAccessExpiresAt: accessExpiresAt,
      remnashopRefreshExpiresAt: refreshExpiresAt,
    },
  });
  if (stored.count !== 1) {
    throw new ServiceError("UNAUTHORIZED", 401, "Local session changed during automatic recovery");
  }
  await prisma.webUser.update({
    where: { id: session.userId },
    data: { remnashopUserId, lastLoginAt: new Date() },
  });

  authDebugLog("remnashop_email_token_restore_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopUserId,
    accessExpiresAt,
    refreshExpiresAt,
  });

  return {
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    session: {
      ...session,
      user: { ...session.user, remnashopUserId },
      remnashopAccessTokenEncrypted: protectedAccessToken,
      remnashopRefreshTokenEncrypted: protectedRefreshToken,
      remnashopAccessExpiresAt: accessExpiresAt,
      remnashopRefreshExpiresAt: refreshExpiresAt,
    },
  };
}

export async function getAuthorizedRemnashopTokens({
  allowUnverifiedEmail = false,
}: { allowUnverifiedEmail?: boolean } = {}) {
  authDebugLog("remnashop_tokens_authorize_started", { allowUnverifiedEmail });
  const localSession = await getCurrentSession();

  if (!localSession) {
    authDebugLog("remnashop_tokens_authorize_failed", { reason: "missing_session" });
    throw normalizeRemnashopError(401, "Not authenticated", { path: "/auth/session" });
  }

  // The refresh cookie proves only that the local session can be resumed. It
  // must never promote a deliberately restricted BOOTSTRAP session into an
  // upstream-authorized session after the short-lived access cookie expires.
  if (localSession.assuranceLevel === WebSessionAssuranceLevel.BOOTSTRAP) {
    authDebugLog("remnashop_tokens_authorize_failed", {
      reason: "passkey_required",
      assuranceLevel: localSession.assuranceLevel,
    });
    throw new ServiceError(
      "PASSKEY_REQUIRED",
      403,
      "Create a passkey to continue",
    );
  }

  // Mirror the proxy policy from current database state before token refresh,
  // Telegram recovery or any other upstream side effect. Verification flows
  // opt out explicitly while they are completing that state transition.
  if (!allowUnverifiedEmail) {
    assertEmailVerificationPolicy(localSession.user);
  }

  let authorized: Awaited<ReturnType<typeof acquireRemnashopTokensForSession>> = null;
  let authorizationSource: "stored" | "refresh" | "email_restore" | "telegram_restore" | null = null;

  if (
    localSession.user.authPending &&
    localSession.user.telegramId &&
    (
      localSession.user.emailVerified ||
      Boolean(
        localSession.user.pendingRemnashopUserId &&
        localSession.user.pendingRemnashopEmail
      )
    )
  ) {
    const restoredTelegramSession =
      await attachRemnashopTokensForTelegramSession(localSession);

    if (restoredTelegramSession) {
      authorized = {
        ...restoredTelegramSession,
        source: "stored" as const,
      };
      authorizationSource = "telegram_restore";
    }
  }

  if (!authorized) {
    authorized = await acquireRemnashopTokensForSession({
      session: localSession,
      refresh: remnashopRefreshTokens,
    });
    authorizationSource = authorized?.source ?? null;
  }

  if (
    !authorized &&
    localSession.assuranceLevel === WebSessionAssuranceLevel.FULL &&
    localSession.user.email &&
    localSession.user.emailVerified
  ) {
    const recoverySession = await getCurrentSession();
    if (
      !recoverySession ||
      recoverySession.id !== localSession.id ||
      recoverySession.userId !== localSession.userId
    ) {
      throw new ServiceError("UNAUTHORIZED", 401, "Current session changed before e-mail recovery");
    }
    const restoredEmailSession =
      await attachRemnashopTokensForVerifiedEmailSession(recoverySession);
    if (restoredEmailSession) {
      authorized = { ...restoredEmailSession, source: "stored" as const };
      authorizationSource = "email_restore";
    }
  }

  if (!authorized && localSession.user.telegramId) {
    // Token acquisition can atomically clear an expired/corrupt legacy bundle.
    // Reload before Telegram recovery so the transaction compares against the
    // committed cleanup rather than the stale request snapshot.
    const recoverySession = await getCurrentSession();

    if (
      !recoverySession ||
      recoverySession.id !== localSession.id ||
      recoverySession.userId !== localSession.userId
    ) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session changed before Remnashop recovery",
      );
    }

    let restoredTelegramSession;
    try {
      restoredTelegramSession =
        await attachRemnashopTokensForTelegramSession(recoverySession);
    } catch (error) {
      const concurrentRecoveryWon =
        error instanceof ServiceError &&
        error.code === "ACCOUNT_MERGE_REQUIRED" &&
        error.debug?.message === "local_identity_changed_before_recovery";
      if (!concurrentRecoveryWon) {
        throw error;
      }

      const convergedSession = await getCurrentSession();
      if (
        !convergedSession ||
        convergedSession.id !== localSession.id ||
        convergedSession.userId !== localSession.userId
      ) {
        throw new ServiceError(
          "UNAUTHORIZED",
          401,
          "Current session changed after concurrent Remnashop recovery",
        );
      }
      authorized = await acquireRemnashopTokensForSession({
        session: convergedSession,
        refresh: remnashopRefreshTokens,
      });
      if (!authorized) {
        throw error;
      }
      authorizationSource = authorized.source;
      authDebugLog("remnashop_token_restore_converged", {
        sessionId: convergedSession.id,
        userId: convergedSession.userId,
      });
    }

    if (restoredTelegramSession) {
      authorized = {
        ...restoredTelegramSession,
        source: "stored" as const,
      };
      authorizationSource = "telegram_restore";
    }
  }

  if (!authorized) {
    authDebugLog("remnashop_tokens_authorize_failed", {
      reason: "session_not_linked_to_remnashop",
      sessionId: localSession.id,
      userId: localSession.userId,
      authMethod: localSession.authMethod,
    });
    throw new ServiceError(
      "EMAIL_REQUIRED",
      401,
      "Clean Pay session must be linked to Remnashop before using Remnashop actions",
    );
  }

  const { accessToken, refreshToken, session } = authorized;

  authDebugLog("remnashop_tokens_authorize_session_loaded", {
    source: authorizationSource,
    sessionId: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
    allowUnverifiedEmail,
  });

  // Token acquisition (including a required refresh) is deliberately complete
  // before the first /auth/me request, so an expired access token is never used
  // for identity verification.
  if (session.user.email && session.user.emailVerified && !allowUnverifiedEmail) {
    const profile = await getRemnashopMe(accessToken);
    const remnashopEmailMatches = profile.email === session.user.email;

    if (!remnashopEmailMatches || !profile.is_email_verified) {
      authDebugLog("remnashop_tokens_authorize_failed", {
        reason: "account_merge_required",
        sessionId: session.id,
        userId: session.userId,
        localEmail: session.user.email,
        remnashopEmail: profile.email,
        remnashopEmailVerified: profile.is_email_verified,
        hasTelegramId: Boolean(session.user.telegramId),
      });
      throw new ServiceError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Telegram and e-mail accounts must be merged in Remnashop before payment.",
      );
    }
  }

  if (session.user.email && !session.user.emailVerified && !allowUnverifiedEmail) {
    const profile = await getRemnashopMe(accessToken);
    const remnashopEmailMatches = profile.email === session.user.email;

    if (remnashopEmailMatches && profile.is_email_verified) {
      await prisma.webUser.update({
        where: { id: session.userId },
        data: { emailVerified: true },
      });
      await refreshCurrentAccessCookie();
      session.user.emailVerified = true;
      authDebugLog("remnashop_tokens_authorize_email_verified_synced", {
        sessionId: session.id,
        userId: session.userId,
        email: session.user.email,
      });
    } else {
      authDebugLog("remnashop_tokens_authorize_failed", {
        reason: "email_not_verified",
        sessionId: session.id,
        userId: session.userId,
        hasEmail: true,
        remnashopEmailMatches,
        remnashopEmailVerified: profile.is_email_verified,
      });
      throw new ServiceError(
        "EMAIL_NOT_VERIFIED",
        403,
        "E-mail must be verified before using Remnashop actions",
      );
    }
  }

  authDebugLog("remnashop_tokens_authorize_success", {
    source: authorizationSource,
    sessionId: session.id,
    userId: session.userId,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
  });

  return {
    accessToken,
    refreshToken,
    session,
  };
}
