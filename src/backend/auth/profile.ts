import {
  getAuthorizedRemnashopTokens,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
} from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/integrations/sessions/web-session-service";
import { localUserProfile, remnashopUserProfile } from "@/backend/integrations/auth/profile-presenter";
import { prismaProfileAccountRepository } from "@/backend/integrations/profile/prisma-profile-account-repository";

export async function getCurrentAuthProfile() {
  authDebugLog("auth_me_started", {});
  const session = await getCurrentSession();

  if (!session) {
    authDebugLog("auth_me_unauthorized", { reason: "missing_session" });
    throw new ServiceError("UNAUTHORIZED", 401, "Session is required");
  }

  const canResolveRemnashopSession = Boolean(
    (session.remnashopAccessTokenEncrypted &&
      session.remnashopRefreshTokenEncrypted) ||
      session.user.remnashopUserId ||
      session.user.telegramId,
  );

  if (!canResolveRemnashopSession) {
    authDebugLog("auth_me_local_profile_returned", {
      sessionId: session.id,
      userId: session.userId,
      authMethod: session.authMethod,
      hasRemnashopTokens: false,
    });
    return { user: localUserProfile(session) };
  }

  let accessToken: string;
  let authorizedSession = session;

  try {
    ({ accessToken, session: authorizedSession } = await getAuthorizedRemnashopTokens({
      allowUnverifiedEmail: true,
    }));
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "EMAIL_REQUIRED" || error.code === "PASSKEY_REQUIRED")
    ) {
      authDebugLog("auth_me_local_profile_returned", {
        sessionId: session.id,
        userId: session.userId,
        authMethod: session.authMethod,
        hasRemnashopTokens: false,
        reason: error.code === "PASSKEY_REQUIRED"
          ? "passkey_required"
          : "no_claimable_remnashop_token_bundle",
      });
      return { user: localUserProfile(session) };
    }

    throw error;
  }

  const profile = await getRemnashopMe(accessToken);
  const authorizedRemnashopUserId =
    getRemnashopUserIdFromAccessToken(accessToken);
  const pendingOwnerMatches =
    !authorizedSession.user.pendingRemnashopUserId ||
    authorizedSession.user.pendingRemnashopUserId ===
      authorizedRemnashopUserId;
  const unresolvedTelegramMerge = Boolean(
    authorizedSession.user.authPending &&
      authorizedSession.user.telegramId,
  );
  const shouldReconcileVerifiedEmail = Boolean(
    profile.email &&
    profile.is_email_verified &&
    authorizedSession.user.email === profile.email &&
    (!authorizedSession.user.emailVerified || authorizedSession.user.authPending) &&
    pendingOwnerMatches &&
    !unresolvedTelegramMerge,
  );

  let reconciledSession = authorizedSession;

  if (shouldReconcileVerifiedEmail) {
    await prismaProfileAccountRepository.confirmVerifiedEmail(authorizedSession.userId);
    reconciledSession = {
      ...authorizedSession,
      user: {
        ...authorizedSession.user,
        emailVerified: true,
        authPending: false,
        pendingRemnashopUserId: null,
        pendingRemnashopEmail: null,
      },
    };
    await refreshCurrentAccessCookie();
    authDebugLog("auth_me_verified_email_reconciled", {
      sessionId: authorizedSession.id,
      userId: authorizedSession.userId,
    });
  }
  authDebugLog("auth_me_remnashop_profile_returned", {
    sessionId: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    hasEmail: Boolean(profile.email),
    emailVerified: profile.is_email_verified,
  });

  return { user: remnashopUserProfile(reconciledSession, profile) };
}
