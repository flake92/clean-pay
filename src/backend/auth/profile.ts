import { prisma } from "@/backend/database/prisma";
import { getAuthorizedRemnashopTokens, getRemnashopMe } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/sessions/web-session";
import { localUserProfile, remnashopUserProfile } from "@/backend/auth/profile-presenter";

export async function getCurrentAuthProfile() {
  authDebugLog("auth_me_started", {});
  const session = await getCurrentSession();

  if (!session) {
    authDebugLog("auth_me_unauthorized", { reason: "missing_session" });
    throw new BffError("UNAUTHORIZED", 401, "Session is required");
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
    if (error instanceof BffError && error.code === "EMAIL_REQUIRED") {
      authDebugLog("auth_me_local_profile_returned", {
        sessionId: session.id,
        userId: session.userId,
        authMethod: session.authMethod,
        hasRemnashopTokens: false,
        reason: "no_claimable_remnashop_token_bundle",
      });
      return { user: localUserProfile(session) };
    }

    throw error;
  }

  const profile = await getRemnashopMe(accessToken);
  const shouldSyncVerifiedEmail = Boolean(
    profile.email &&
    profile.is_email_verified &&
    authorizedSession.user.email === profile.email &&
    !authorizedSession.user.emailVerified,
  );

  let reconciledSession = authorizedSession;

  if (shouldSyncVerifiedEmail) {
    await prisma.webUser.update({
      where: { id: authorizedSession.userId },
      data: { emailVerified: true, authPending: false },
    });
    reconciledSession = {
      ...authorizedSession,
      user: { ...authorizedSession.user, emailVerified: true },
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
