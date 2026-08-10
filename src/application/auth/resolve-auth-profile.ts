import {
  AuthProfileError,
  type AuthProfileGateway,
  type AuthProfileSession,
  type ProviderAuthProfile,
} from "@/application/auth/ports/auth-profile";

export type AuthAccountProfile = {
  userId: string;
  authType: "email" | "telegram" | "passkey";
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  fullName: string | null;
  displayName: string | null;
  accountSyncPending: boolean;
};

function authType(method: AuthProfileSession["authMethod"]): AuthAccountProfile["authType"] {
  if (method === "TELEGRAM") return "telegram";
  if (method === "PASSKEY") return "passkey";
  return "email";
}

function localProfile(session: AuthProfileSession): AuthAccountProfile {
  return {
    userId: session.userId,
    authType: authType(session.authMethod),
    email: session.user.email,
    emailVerified: Boolean(session.user.email && session.user.emailVerified),
    pendingEmail: null,
    telegramId: session.user.telegramId,
    telegramUsername: session.user.telegramUsername,
    fullName: session.user.fullName,
    displayName: session.user.displayName,
    accountSyncPending: session.user.accountSyncPending,
  };
}

function providerProfile(
  session: AuthProfileSession,
  provider: ProviderAuthProfile,
): AuthAccountProfile {
  const providerEmailMatchesLocal = Boolean(
    session.user.email && provider.email === session.user.email,
  );
  return {
    userId: session.userId,
    authType: authType(session.authMethod),
    email: provider.email ?? session.user.email,
    emailVerified: Boolean(
      session.user.email && providerEmailMatchesLocal &&
      (session.user.emailVerified || provider.emailVerified),
    ),
    pendingEmail: provider.pendingEmail,
    telegramId: session.user.telegramId ?? provider.telegramId,
    telegramUsername: session.user.telegramUsername,
    fullName: session.user.fullName ?? provider.name,
    displayName: session.user.displayName ?? provider.name,
    accountSyncPending: session.user.accountSyncPending,
  };
}

export async function resolveAuthProfile(gateway: AuthProfileGateway): Promise<AuthAccountProfile> {
  gateway.debug("auth_me_started", {});
  const session = await gateway.loadCurrentSession();
  if (!session) {
    gateway.debug("auth_me_unauthorized", { reason: "missing_session" });
    throw new AuthProfileError("UNAUTHORIZED");
  }

  const canResolveProvider = session.hasUpstreamTokens || Boolean(
    session.user.upstreamUserId || session.user.telegramId,
  );
  if (!canResolveProvider) {
    gateway.debug("auth_me_local_profile_returned", {
      sessionId: session.id, userId: session.userId, authMethod: session.authMethod,
      hasUpstreamTokens: false,
    });
    return localProfile(session);
  }

  let authorized;
  try {
    authorized = await gateway.authorizeCurrentSession();
  } catch (error) {
    if (error instanceof AuthProfileError &&
      (error.code === "EMAIL_REQUIRED" || error.code === "PASSKEY_REQUIRED")) {
      gateway.debug("auth_me_local_profile_returned", {
        sessionId: session.id, userId: session.userId, authMethod: session.authMethod,
        hasUpstreamTokens: false,
        reason: error.code === "PASSKEY_REQUIRED"
          ? "passkey_required"
          : "no_claimable_upstream_token_bundle",
      });
      return localProfile(session);
    }
    throw error;
  }

  const profile = await gateway.loadProviderProfile(authorized);
  const pendingOwnerMatches = !authorized.session.user.pendingUpstreamUserId ||
    authorized.session.user.pendingUpstreamUserId === authorized.upstreamUserId;
  const unresolvedTelegramMerge = Boolean(
    authorized.session.user.accountSyncPending && authorized.session.user.telegramId,
  );
  const shouldReconcileVerifiedEmail = Boolean(
    profile.email && profile.emailVerified &&
    authorized.session.user.email === profile.email &&
    (!authorized.session.user.emailVerified || authorized.session.user.accountSyncPending) &&
    pendingOwnerMatches && !unresolvedTelegramMerge,
  );

  let reconciledSession = authorized.session;
  if (shouldReconcileVerifiedEmail) {
    await gateway.confirmVerifiedEmail(authorized.session.userId);
    reconciledSession = {
      ...authorized.session,
      user: {
        ...authorized.session.user,
        emailVerified: true,
        accountSyncPending: false,
        pendingUpstreamUserId: null,
        pendingEmail: null,
      },
    };
    await gateway.refreshCurrentAccess();
    gateway.debug("auth_me_verified_email_reconciled", {
      sessionId: authorized.session.id, userId: authorized.session.userId,
    });
  }

  gateway.debug("auth_me_provider_profile_returned", {
    sessionId: session.id, userId: session.userId, authMethod: session.authMethod,
    hasEmail: Boolean(profile.email), emailVerified: profile.emailVerified,
  });
  return providerProfile(reconciledSession, profile);
}
