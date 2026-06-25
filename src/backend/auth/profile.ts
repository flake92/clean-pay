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

  if (!session.remnashopAccessTokenEncrypted || !session.remnashopRefreshTokenEncrypted) {
    authDebugLog("auth_me_local_profile_returned", {
      sessionId: session.id,
      userId: session.userId,
      authMethod: session.authMethod,
      hasRemnashopTokens: false,
    });
    return { user: localUserProfile(session) };
  }

  const { accessToken } = await getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  });
  const profile = await getRemnashopMe(accessToken);
  authDebugLog("auth_me_remnashop_profile_returned", {
    sessionId: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    hasEmail: Boolean(profile.email),
    emailVerified: profile.is_email_verified,
  });

  return { user: remnashopUserProfile(session, profile) };
}
