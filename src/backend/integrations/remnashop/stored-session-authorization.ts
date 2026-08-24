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
    return unavailableStoredBundle(session, "missing_or_expired_bundle");
  }

  // A claim/recovery fence means a command may be rotating this one-time
  // bundle. Render-time code must wait for that command instead of consuming
  // or repairing either side of the transition.
  if (
    session.remnashopRefreshClaimTokenHash ||
    session.remnashopRefreshLeaseExpiresAt ||
    session.remnashopRefreshDispatchedAt ||
    session.remnashopRefreshRecoveryEncrypted
  ) {
    return unavailableStoredBundle(session, "refresh_transition_in_progress");
  }

  let accessToken: string;
  let refreshToken: string;
  let jwtExpiresAt: Date | null;
  try {
    accessToken = revealRemnashopToken(accessTokenEncrypted);
    refreshToken = revealRemnashopToken(refreshTokenEncrypted);
    jwtExpiresAt = getJwtExpiresAt(accessToken);
  } catch {
    return unavailableStoredBundle(session, "corrupt_bundle");
  }

  if (
    !jwtExpiresAt ||
    Number.isNaN(jwtExpiresAt.getTime()) ||
    jwtExpiresAt <= accessThreshold
  ) {
    return unavailableStoredBundle(session, "access_token_expired");
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

  // authPending denotes an unfinished upstream owner transition. The command
  // authorizer may reconcile it; a render is never allowed to guess the owner.
  if (localSession.user.authPending) {
    return accountOwnerMismatch(localSession, "account_transition_pending");
  }

  const { accessToken, refreshToken } = readStoredBundle(
    localSession,
    new Date(),
  );

  let remnashopUserId: string;
  try {
    remnashopUserId = getRemnashopUserIdFromAccessToken(accessToken);
  } catch {
    return unavailableStoredBundle(localSession, "invalid_access_identity");
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
      profile.email !== session.user.email ||
      !profile.is_email_verified
    ) {
      throw new ServiceError(
        "EMAIL_NOT_VERIFIED",
        403,
        "E-mail must be verified before using Remnashop actions",
      );
    }

    // Preserve the current request's authorization semantics without syncing
    // database state or cookies during render. A command can persist it later.
    session = {
      ...session,
      user: { ...session.user, emailVerified: true },
    };
  }

  authDebugLog("remnashop_stored_tokens_authorize_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
  });

  return { accessToken, refreshToken, session };
}
