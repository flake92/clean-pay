import type {
  AuthProfileGateway,
  AuthProfileSession,
} from "@/application/auth/ports/auth-profile";
import { AuthProfileError } from "@/application/auth/ports/auth-profile";
import { ServiceError } from "@/backend/errors/service-error";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
} from "@/backend/integrations/remnashop/client";
import {
  getCurrentSession,
  refreshCurrentAccessCookie,
} from "@/backend/integrations/sessions/web-session-service";
import { prismaProfileAccountRepository } from "@/backend/integrations/profile/prisma-profile-account-repository";
import { authDebugLog } from "@/backend/observability/auth-debug-log";

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
type Authorized = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;
type ProfileAuthorizer = () => Promise<Authorized>;
type SessionReader = () => ReturnType<typeof getCurrentSession>;

async function adapt<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof AuthProfileError) throw error;
    throw new AuthProfileError(error instanceof ServiceError ? error.code : "INTERNAL_ERROR");
  }
}

function adaptSession(session: Session): AuthProfileSession {
  return {
    context: session,
    id: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    hasUpstreamTokens: Boolean(
      session.remnashopAccessTokenEncrypted && session.remnashopRefreshTokenEncrypted,
    ),
    user: {
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      telegramId: session.user.telegramId,
      telegramUsername: session.user.telegramUsername,
      fullName: session.user.fullName,
      displayName: session.user.displayName,
      upstreamUserId: session.user.remnashopUserId,
      pendingUpstreamUserId: session.user.pendingRemnashopUserId,
      pendingEmail: session.user.pendingRemnashopEmail,
      accountSyncPending: session.user.authPending,
    },
  };
}

export function createProductionAuthProfileGateway(
  authorize: ProfileAuthorizer = () => getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
  readSession: SessionReader = getCurrentSession,
  refreshAccess: () => Promise<unknown> = refreshCurrentAccessCookie,
  confirmVerifiedEmail: (userId: string) => Promise<unknown> =
    (userId) => prismaProfileAccountRepository.confirmVerifiedEmail(userId),
  canReconcileVerifiedEmail = true,
): AuthProfileGateway {
  return {
  canReconcileVerifiedEmail,
  async loadCurrentSession() {
    const session = await adapt(readSession);
    return session ? adaptSession(session) : null;
  },
  async authorizeCurrentSession() {
    const authorized = await adapt(authorize);
    return {
      context: authorized,
      session: adaptSession(authorized.session),
      upstreamUserId: getRemnashopUserIdFromAccessToken(authorized.accessToken),
    };
  },
  async loadProviderProfile(authorized) {
    const value = authorized.context as Authorized;
    const profile = await adapt(() => getRemnashopMe(value.accessToken));
    return {
      email: profile.email,
      emailVerified: profile.is_email_verified,
      pendingEmail: profile.pending_email ?? null,
      name: profile.name,
      telegramId: profile.telegram_id?.toString() ?? null,
    };
  },
  async confirmVerifiedEmail(userId) { await adapt(() => confirmVerifiedEmail(userId)); },
  async refreshCurrentAccess() { await adapt(refreshAccess); },
  debug: authDebugLog,
  };
}
