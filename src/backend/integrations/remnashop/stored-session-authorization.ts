import { WebSessionAssuranceLevel } from "@prisma/client";

import { ServiceError } from "@/backend/errors/service-error";
import {
  getJwtExpiresAt,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
} from "@/backend/integrations/remnashop/api-client";
import { normalizeRemnashopError } from "@/backend/integrations/remnashop/errors";
import { revealRemnashopToken } from "@/backend/integrations/remnashop/token-protection";
import {
  assertEmailVerificationPolicy,
  getCurrentSessionReadOnly,
} from "@/backend/integrations/sessions/web-session-service";
import { authDebugLog } from "@/backend/observability/auth-debug-log";

type ReadOnlySession = NonNullable<
  Awaited<ReturnType<typeof getCurrentSessionReadOnly>>
>;

// Match the mutating lifecycle's refresh threshold. A render must not start an
// upstream request with a token that the command path would already refresh.
const MIN_ACCESS_TTL_MS = 60_000;

function unavailableStoredBundle(
  session: ReadOnlySession,
  reason: string,
): never {
  authDebugLog("remnashop_stored_tokens_authorize_failed", {
    reason,
    sessionId: session.id,
    userId: session.userId,
  });
  throw new ServiceError(
    "UPSTREAM_UNAVAILABLE",
    503,
    "A usable stored Remnashop session is unavailable",
  );
}

function recoverableStoredBundle(
  session: ReadOnlySession,
  reason: string,
): never {
  authDebugLog("remnashop_stored_tokens_authorize_failed", {
    reason,
    sessionId: session.id,
    userId: session.userId,
  });
  throw new ServiceError(
    "PROVIDER_SESSION_RECOVERY_REQUIRED",
    409,
    "The stored Remnashop session requires cookie-capable recovery",
  );
}

function accountOwnerMismatch(
  session: ReadOnlySession,
  reason: string,
): never {
  authDebugLog("remnashop_stored_tokens_authorize_failed", {
    reason,
    sessionId: session.id,
    userId: session.userId,
  });
  throw new ServiceError(
    "ACCOUNT_MERGE_REQUIRED",
    409,
    "Stored Remnashop credentials are not owned by the current account",
  );
}

function readStoredBundle(session: ReadOnlySession, now: Date) {
  const accessExpiresAt = session.remnashopAccessExpiresAt;
  const refreshExpiresAt = session.remnashopRefreshExpiresAt;
  const accessTokenEncrypted = session.remnashopAccessTokenEncrypted;
  const refreshTokenEncrypted = session.remnashopRefreshTokenEncrypted;
  const accessThreshold = new Date(now.getTime() + MIN_ACCESS_TTL_MS);

  if (
    !accessTokenEncrypted ||
    !refreshTokenEncrypted ||
    !accessExpiresAt ||
    accessExpiresAt <= accessThreshold ||
    !refreshExpiresAt ||
    refreshExpiresAt <= now
  ) {
    return recoverableStoredBundle(session, "missing_or_expired_bundle");
  }

  // A refresh fence means a command may be rotating this one-time bundle.
  // Render-time code must never consume or repair either side of the
  // transition, but it also must not park the user behind a fence that nothing
  // will ever clear: only a fence with a live lease is genuinely in progress
  // and worth waiting for. An expired or lease-less fence (a refresh that was
  // interrupted by a restart/deploy, or a finished-but-unpromoted recovery) is
  // cleared only by the cookie-capable authorizer, so hand it over to that
  // recovery route instead of rendering a permanent "try later" error.
  const hasRefreshFence = Boolean(
    session.remnashopRefreshClaimTokenHash ||
    session.remnashopRefreshLeaseExpiresAt ||
    session.remnashopRefreshDispatchedAt ||
    session.remnashopRefreshRecoveryEncrypted,
  );
  if (hasRefreshFence) {
    const leaseIsLive = Boolean(
      session.remnashopRefreshLeaseExpiresAt &&
      session.remnashopRefreshLeaseExpiresAt > now,
    );
    return leaseIsLive
      ? unavailableStoredBundle(session, "refresh_transition_in_progress")
      : recoverableStoredBundle(session, "stale_refresh_transition");
  }

  let accessToken: string;
  let refreshToken: string;
  let jwtExpiresAt: Date | null;
  try {
    accessToken = revealRemnashopToken(accessTokenEncrypted);
    refreshToken = revealRemnashopToken(refreshTokenEncrypted);
    jwtExpiresAt = getJwtExpiresAt(accessToken);
  } catch {
    return recoverableStoredBundle(session, "corrupt_bundle");
  }

  if (
    !jwtExpiresAt ||
    Number.isNaN(jwtExpiresAt.getTime()) ||
    jwtExpiresAt <= accessThreshold
  ) {
    return recoverableStoredBundle(session, "access_token_expired");
  }

  return { accessToken, refreshToken };
}

/**
 * Authorizes an RSC request from the current session's already-usable token
 * bundle only. It deliberately has no refresh, recovery, merge, persistence,
 * transaction or cookie capability; commands keep using their mutating
 * authorizer.
 */
export async function getStoredAuthorizedRemnashopTokens({
  allowUnverifiedEmail = false,
}: {
  allowUnverifiedEmail?: boolean;
} = {}) {
  authDebugLog("remnashop_stored_tokens_authorize_started", {
    allowUnverifiedEmail,
  });
  const localSession = await getCurrentSessionReadOnly();

  if (!localSession) {
    throw normalizeRemnashopError(401, "Not authenticated", {
      path: "/auth/session",
    });
  }

  if (localSession.assuranceLevel === WebSessionAssuranceLevel.BOOTSTRAP) {
    throw new ServiceError(
      "PASSKEY_REQUIRED",
      403,
      "Create a passkey to continue",
    );
  }

  if (!allowUnverifiedEmail) {
    assertEmailVerificationPolicy(localSession.user);
  }

  // authPending denotes an unfinished upstream owner transition. A render is
  // never allowed to guess the owner. When the cookie-capable authorizer can
  // finish the transition on its own (Telegram identity plus a verified or
  // staged e-mail, exactly its own precondition) hand it over to that recovery
  // route; otherwise the ownership is genuinely unresolved.
  if (localSession.user.authPending) {
    const user = localSession.user;
    const recoverableByTelegram = Boolean(
      user.telegramId && (
        user.emailVerified ||
        (user.pendingRemnashopUserId && user.pendingRemnashopEmail)
      ),
    );
    return recoverableByTelegram
      ? recoverableStoredBundle(localSession, "account_transition_recoverable")
      : accountOwnerMismatch(localSession, "account_transition_pending");
  }

  const { accessToken, refreshToken } = readStoredBundle(
    localSession,
    new Date(),
  );

  let remnashopUserId: string;
  try {
    remnashopUserId = getRemnashopUserIdFromAccessToken(accessToken);
  } catch {
    return recoverableStoredBundle(localSession, "invalid_access_identity");
  }

  if (
    !localSession.user.remnashopUserId ||
    localSession.user.remnashopUserId !== remnashopUserId ||
    (localSession.user.pendingRemnashopUserId !== null &&
      localSession.user.pendingRemnashopUserId !== remnashopUserId)
  ) {
    return accountOwnerMismatch(localSession, "account_owner_mismatch");
  }

  let session = localSession;

  if (
    session.user.email &&
    session.user.emailVerified &&
    !allowUnverifiedEmail
  ) {
    const profile = await getRemnashopMe(accessToken);
    if (
      profile.email !== session.user.email ||
      !profile.is_email_verified
    ) {
      return accountOwnerMismatch(session, "verified_email_owner_mismatch");
    }
  }

  if (
    session.user.email &&
    !session.user.emailVerified &&
    !allowUnverifiedEmail
  ) {
    const profile = await getRemnashopMe(accessToken);
    if (
      profile.email === session.user.email &&
      profile.is_email_verified
    ) {
      // Preserve the current request's authorization semantics without syncing
      // database state or cookies during render. A command can persist it later.
      session = {
        ...session,
        user: { ...session.user, emailVerified: true },
      };
    } else if (!session.user.telegramId) {
      throw new ServiceError(
        "EMAIL_NOT_VERIFIED",
        403,
        "E-mail must be verified before using Remnashop actions",
      );
    }
    // A Telegram-linked account is already identified by Telegram, so a
    // half-finished (unconfirmed) e-mail must not take the cabinet away. It is
    // shown as a "confirm e-mail" prompt instead, and payments still enforce a
    // verified e-mail on their own.
  }

  authDebugLog("remnashop_stored_tokens_authorize_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
  });

  return { accessToken, refreshToken, session };
}
