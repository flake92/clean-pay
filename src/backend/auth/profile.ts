import { getAuthorizedRemnashopTokens, getRemnashopMe } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { getCurrentSession } from "@/backend/sessions/web-session";
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
  authDebugLog("auth_me_remnashop_profile_returned", {
    sessionId: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    hasEmail: Boolean(profile.email),
    emailVerified: profile.is_email_verified,
  });

  return { user: remnashopUserProfile(authorizedSession, profile) };
}
