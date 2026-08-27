import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { randomToken } from "@/backend/security/crypto";
import { ServiceError } from "@/backend/errors/service-error";
import { securityPolicy } from "@/backend/security/policy";
import { auditLog } from "@/backend/observability/audit";
import { recordOperationalEvent } from "@/backend/observability/metrics";
import { clearWebSessionCookies } from "@/backend/integrations/sessions/web-session-revocation";
import {
  revokeSessionByRefreshToken,
  rotateRefreshTokenFamily,
} from "@/backend/integrations/sessions/web-session-refresh-family";
import {
  createDurableCallbackWebSessionRecord,
  createWebSessionRecord,
  findActiveWebSession,
  findActiveWebSessionIdentity,
  findReplayableWebSession,
  findRefreshSessionCandidate,
  findWebSessionAccessClaims,
  replaceWebSessionAfterPasswordChangeRecord,
  revokeActiveWebSessionIdentity,
  revokeActiveWebSessionsForUser,
  upgradeWebSessionToFull,
} from "@/backend/integrations/sessions/web-session-repository";
import {
  getWebSessionAccessExpiry,
  getWebSessionExpiryWindow,
  getWebSessionRevocationSource,
  resolveWebAccessCredential,
} from "@/backend/integrations/sessions/web-session-transitions";
import {
  getWebSessionCookiePolicy,
  openWebSessionCookieTransport,
  readWebSessionUserAgent,
  setCurrentWebSessionAccessCookie,
  setDurableCallbackWebSessionCookies,
  setResponseCreatedWebSessionCookies,
  verifyWebSessionAccessToken,
} from "@/backend/integrations/sessions/web-session-transport";

type WebSessionResponse = Parameters<
  typeof setResponseCreatedWebSessionCookies
>[0];
type WebSessionAuthMethodInput = Parameters<
  typeof createWebSessionRecord
>[0]["authMethod"];
type WebSessionTransaction = Parameters<
  typeof createDurableCallbackWebSessionRecord
>[0];

async function getSessionByRefreshToken() {
  const cookieStore = await openWebSessionCookieTransport();
  const refreshToken = cookieStore.refreshToken();

  if (!refreshToken) {
    authDebugLog("session_refresh_lookup_skipped", { reason: "missing_refresh_cookie" });
    return null;
  }

  authDebugLog("session_refresh_lookup_started", { hasRefreshCookie: true });
  const rotated = await rotateRefreshTokenFamily(refreshToken);

  if (!rotated) {
    authDebugLog("session_refresh_lookup_miss", { reason: "not_found_revoked_or_expired" });
    await clearWebSessionCookies();
    return null;
  }

  if (rotated.status === "reuse") {
    recordOperationalEvent("refresh_token_reuse_detected");
    cookieStore.deleteAccess();
    cookieStore.deleteRefresh();
    await auditLog({
      action: "refresh_token_reuse_detected",
      severity: "WARN",
      userId: rotated.userId,
      metadata: { sessionId: rotated.sessionId },
    });
    authDebugLog("session_refresh_reuse_detected", {
      sessionId: rotated.sessionId,
      userId: rotated.userId,
    });
    return null;
  }

  const updatedSession = rotated.session;
  await setCurrentWebSessionAccessCookie({
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    expiresAt: updatedSession.accessTokenExpiresAt,
    assuranceLevel: updatedSession.assuranceLevel,
    emailVerified: updatedSession.user.emailVerified,
    telegramId: updatedSession.user.telegramId,
  });
  cookieStore.setRefresh(
    rotated.successorToken,
    updatedSession.refreshExpiresAt,
  );

  authDebugLog("session_refresh_lookup_success", {
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    authMethod: updatedSession.authMethod,
    assuranceLevel: updatedSession.assuranceLevel,
    accessTokenExpiresAt: updatedSession.accessTokenExpiresAt,
    refreshExpiresAt: updatedSession.refreshExpiresAt,
    reusedPrevious: rotated.reusedPrevious,
    hasRemnashopTokens: Boolean(updatedSession.remnashopAccessTokenEncrypted && updatedSession.remnashopRefreshTokenEncrypted),
  });

  return updatedSession;
}

export async function getCurrentUser() {
  const cookieStore = await openWebSessionCookieTransport();
  const accessToken = cookieStore.accessToken();
  const credential = resolveWebAccessCredential(
    accessToken,
    verifyWebSessionAccessToken,
  );

  if (credential.kind === "missing") {
    authDebugLog("session_current_user_access_missing", {});
    const session = await getSessionByRefreshToken();

    authDebugLog("session_current_user_result", {
      source: "refresh",
      found: Boolean(session),
      sessionId: session?.id,
      userId: session?.userId,
    });

    return session?.user ?? null;
  }

  if (credential.kind === "invalid") {
    authDebugLog("session_current_user_access_invalid", {});
    const session = await getSessionByRefreshToken();

    authDebugLog("session_current_user_result", {
      source: "refresh_after_invalid_access",
      found: Boolean(session),
      sessionId: session?.id,
      userId: session?.userId,
    });

    return session?.user ?? null;
  }

  const { payload } = credential;
  authDebugLog("session_current_user_access_valid", {
    sessionId: payload.sid,
    userId: payload.uid,
    expiresAtEpochSeconds: payload.exp,
  });
  const session = await findActiveWebSession(payload);

  if (session) {
    authDebugLog("session_current_user_result", {
      source: "access",
      found: true,
      sessionId: session.id,
      userId: session.userId,
    });

    return session.user;
  }

  authDebugLog("session_current_user_access_db_miss", {
    sessionId: payload.sid,
    userId: payload.uid,
  });
  const refreshedSession = await getSessionByRefreshToken();

  authDebugLog("session_current_user_result", {
    source: "refresh_after_access_db_miss",
    found: Boolean(refreshedSession),
    sessionId: refreshedSession?.id,
    userId: refreshedSession?.userId,
  });

  return refreshedSession?.user ?? null;
}

export async function getCurrentSession() {
  const cookieStore = await openWebSessionCookieTransport();
  const accessToken = cookieStore.accessToken();
  const credential = resolveWebAccessCredential(
    accessToken,
    verifyWebSessionAccessToken,
  );

  if (credential.kind === "missing") {
    authDebugLog("session_current_access_missing", {});
    return getSessionByRefreshToken();
  }

  if (credential.kind === "invalid") {
    authDebugLog("session_current_access_invalid", {});
    return getSessionByRefreshToken();
  }

  const { payload } = credential;
  authDebugLog("session_current_access_valid", {
    sessionId: payload.sid,
    userId: payload.uid,
    expiresAtEpochSeconds: payload.exp,
  });
  const session = await findActiveWebSession(payload);

  if (session) {
    authDebugLog("session_current_result", {
      source: "access",
      found: true,
      sessionId: session.id,
      userId: session.userId,
      authMethod: session.authMethod,
      hasRemnashopTokens: Boolean(session.remnashopAccessTokenEncrypted && session.remnashopRefreshTokenEncrypted),
    });

    return session;
  }

  authDebugLog("session_current_access_db_miss", {
    sessionId: payload.sid,
    userId: payload.uid,
  });

  return getSessionByRefreshToken();
}

/**
 * Reads only the short-lived access session.
 *
 * Server Components must use this reader: Next.js render phases cannot mutate
 * cookies, and rotating the database-backed refresh token without returning
 * its successor to the browser would strand the session. Navigation requests
 * with only a refresh candidate are resumed by the dedicated Route Handler
 * before React renders.
 */
export async function getCurrentSessionReadOnly() {
  const cookieStore = await openWebSessionCookieTransport();
  const accessToken = cookieStore.accessToken();
  const credential = resolveWebAccessCredential(
    accessToken,
    verifyWebSessionAccessToken,
  );

  if (credential.kind === "missing") {
    authDebugLog("session_read_only_access_missing", {});
    return null;
  }

  if (credential.kind === "invalid") {
    authDebugLog("session_read_only_access_invalid", {});
    return null;
  }

  const { payload } = credential;
  const session = await findActiveWebSession(payload);

  authDebugLog("session_read_only_result", {
    found: Boolean(session),
    sessionId: payload.sid,
    userId: payload.uid,
  });

  return session;
}

/**
 * Verifies that the browser still has a usable refresh-session candidate
 * without consuming or rotating its one-time refresh token.
 *
 * Polling Server Actions may use this only to tell the browser to visit the
 * dedicated refresh Route Handler. They must never turn this read into a
 * session or mutate either credential cookie themselves.
 */
export async function getCurrentRefreshSessionCandidateReadOnly() {
  const cookieStore = await openWebSessionCookieTransport();
  const refreshToken = cookieStore.refreshToken();

  if (!refreshToken) {
    authDebugLog("session_refresh_candidate_read_only_skipped", {
      reason: "missing_refresh_cookie",
    });
    return null;
  }

  const session = await findRefreshSessionCandidate(refreshToken);

  authDebugLog("session_refresh_candidate_read_only_result", {
    found: Boolean(session),
    sessionId: session?.id,
    userId: session?.userId,
  });

  return session
    ? { sessionId: session.id, userId: session.userId }
    : null;
}

export async function refreshCurrentAccessCookie() {
  authDebugLog("session_access_cookie_refresh_started", {});
  const session = await getCurrentSession();

  if (!session) {
    authDebugLog("session_access_cookie_refresh_skipped", { reason: "missing_session" });
    return null;
  }

  const user = await findWebSessionAccessClaims(session.userId);

  await setCurrentWebSessionAccessCookie({
    sessionId: session.id,
    userId: session.userId,
    expiresAt: session.accessTokenExpiresAt,
    assuranceLevel: session.assuranceLevel,
    emailVerified: user?.emailVerified,
    telegramId: user?.telegramId,
  });

  authDebugLog("session_access_cookie_refresh_success", {
    sessionId: session.id,
    userId: session.userId,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
  });

  return session;
}

export async function createWebSessionOnResponse(
  response: WebSessionResponse,
  userId: string,
  options: {
    authMethod?: WebSessionAuthMethodInput;
    remnashopSession?: {
      accessTokenEncrypted: string;
      refreshTokenEncrypted: string;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
    };
  } = {},
) {
  const cookiePolicy = getWebSessionCookiePolicy();
  const userAgent = await readWebSessionUserAgent();
  authDebugLog("session_response_create_started", {
    userId,
    hasProvidedRemnashopSession: Boolean(options.remnashopSession),
  });
  const now = new Date();
  const { accessTokenExpiresAt, refreshExpiresAt } = getWebSessionExpiryWindow(
    now,
    securityPolicy.accessSessionTtlMinutes,
    securityPolicy.refreshSessionTtlDays,
  );
  const refreshToken = randomToken(48);

  authDebugLog("session_response_create_persist_started", {
    userId,
    authMethod: options.authMethod ?? "TELEGRAM",
    assuranceLevel: "FULL",
    accessTokenExpiresAt,
    refreshExpiresAt,
    hasProvidedRemnashopSession: Boolean(options.remnashopSession),
  });

  const session = await createWebSessionRecord({
    userId,
    refreshToken,
    remnashopSession: options.remnashopSession,
    authMethod: options.authMethod,
    userAgent,
    accessTokenExpiresAt,
    refreshExpiresAt,
  });
  const user = await findWebSessionAccessClaims(userId);
  setResponseCreatedWebSessionCookies(
    response,
    session,
    {
      emailVerified: user?.emailVerified ?? null,
      telegramId: user?.telegramId ?? null,
    },
    refreshToken,
    cookiePolicy,
  );

  authDebugLog("session_response_create_success", {
    sessionId: session.id,
    userId,
    authMethod: session.authMethod,
    assuranceLevel: session.assuranceLevel,
    hasProvidedRemnashopSession: Boolean(options.remnashopSession),
    accessTokenExpiresAt,
    refreshExpiresAt,
  });

  return session;
}

export async function createDurableCallbackWebSession(
  tx: WebSessionTransaction,
  userId: string,
  options: {
    authMethod?: WebSessionAuthMethodInput;
    remnashopSession?: {
      accessTokenEncrypted: string;
      refreshTokenEncrypted: string;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
    };
    now?: Date;
  } = {},
) {
  const userAgent = await readWebSessionUserAgent();
  const now = options.now ?? new Date();
  const { accessTokenExpiresAt, refreshExpiresAt } = getWebSessionExpiryWindow(
    now,
    securityPolicy.accessSessionTtlMinutes,
    securityPolicy.refreshSessionTtlDays,
  );
  const refreshToken = randomToken(48);
  const session = await createDurableCallbackWebSessionRecord(tx, {
    userId,
    refreshToken,
    remnashopSession: options.remnashopSession,
    authMethod: options.authMethod,
    userAgent,
    accessTokenExpiresAt,
    refreshExpiresAt,
  });
  return { session, refreshToken };
}

/**
 * Replays the exact encrypted callback bootstrap bearer without rotating the
 * refresh family. Concurrent/lost callback responses therefore carry
 * byte-identical credentials and cannot overwrite one another out of order.
 */
export async function setDurableCallbackReplayCookies(
  response: WebSessionResponse,
  sessionId: string,
  userId: string,
  bootstrapRefreshToken: string,
  now = new Date(),
) {
  const session = await findReplayableWebSession(
    sessionId,
    userId,
    bootstrapRefreshToken,
    now,
  );
  if (!session) {
    throw new ServiceError(
      "UNAUTHORIZED",
      401,
      "Telegram callback bootstrap session is no longer replayable",
    );
  }
  setDurableCallbackWebSessionCookies(response, {
    session,
    refreshToken: bootstrapRefreshToken,
  });
  return session;
}

export async function upgradeCurrentSessionToFull() {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  const accessTokenExpiresAt = getWebSessionAccessExpiry(
    new Date(),
    securityPolicy.accessSessionTtlMinutes,
  );
  const updatedSession = await upgradeWebSessionToFull(
    session.id,
    accessTokenExpiresAt,
  );

  await setCurrentWebSessionAccessCookie({
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
    expiresAt: updatedSession.accessTokenExpiresAt,
    assuranceLevel: updatedSession.assuranceLevel,
    emailVerified: updatedSession.user.emailVerified,
    telegramId: updatedSession.user.telegramId,
  });

  authDebugLog("session_upgraded_to_full", {
    sessionId: updatedSession.id,
    userId: updatedSession.userId,
  });

  return updatedSession;
}

export async function replaceWebSessionAfterPasswordChange({
  sessionId,
  userId,
  remnashopAccessTokenEncrypted,
  remnashopRefreshTokenEncrypted,
  remnashopAccessExpiresAt,
  remnashopRefreshExpiresAt,
}: {
  sessionId: string;
  userId: string;
  remnashopAccessTokenEncrypted: string;
  remnashopRefreshTokenEncrypted: string;
  remnashopAccessExpiresAt: Date;
  remnashopRefreshExpiresAt: Date;
}) {
  const cookiePolicy = getWebSessionCookiePolicy();
  const cookieStore = await openWebSessionCookieTransport();
  const now = new Date();
  const { accessTokenExpiresAt, refreshExpiresAt } = getWebSessionExpiryWindow(
    now,
    securityPolicy.accessSessionTtlMinutes,
    securityPolicy.refreshSessionTtlDays,
  );
  const refreshToken = randomToken(48);
  const replaceSession = () => replaceWebSessionAfterPasswordChangeRecord({
    sessionId,
    userId,
    refreshToken,
    accessTokenExpiresAt,
    refreshExpiresAt,
    remnashopAccessTokenEncrypted,
    remnashopRefreshTokenEncrypted,
    remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt,
    now,
  });
  let replacement: Awaited<ReturnType<typeof replaceSession>>;

  try {
    replacement = await replaceSession();
  } catch (error) {
    // The upstream password is already changed at this point. If creating the
    // replacement fails, fail closed by revoking every still-active local
    // session and clearing this browser's credentials.
    try {
      await revokeActiveWebSessionsForUser(userId, now);
    } finally {
      cookieStore.deleteAccess();
      cookieStore.deleteRefresh();
    }

    throw error;
  }

  await setCurrentWebSessionAccessCookie({
    sessionId: replacement.newSession.id,
    userId,
    expiresAt: accessTokenExpiresAt,
    assuranceLevel: replacement.newSession.assuranceLevel,
    emailVerified: replacement.user.emailVerified,
    telegramId: replacement.user.telegramId,
  });
  cookieStore.setRefresh(refreshToken, refreshExpiresAt, cookiePolicy);

  authDebugLog("session_replaced_after_password_change", {
    oldSessionId: sessionId,
    newSessionId: replacement.newSession.id,
    userId,
    revokedSessionCount: replacement.revokedSessionCount,
    accessTokenExpiresAt,
    refreshExpiresAt,
  });

  return {
    session: replacement.newSession,
    revokedSessionCount: replacement.revokedSessionCount,
  };
}

export async function getWebSessionUserIdFromAccessCookie() {
  const cookieStore = await openWebSessionCookieTransport();
  const accessToken = cookieStore.accessToken();

  const credential = resolveWebAccessCredential(
    accessToken,
    verifyWebSessionAccessToken,
  );
  return credential.kind === "valid" ? credential.payload.uid : null;
}

export async function clearWebSession() {
  const cookieStore = await openWebSessionCookieTransport();
  const accessToken = cookieStore.accessToken();
  const refreshToken = cookieStore.refreshToken();
  const credential = resolveWebAccessCredential(
    accessToken,
    verifyWebSessionAccessToken,
  );
  const payload = credential.kind === "valid" ? credential.payload : null;

  authDebugLog("session_clear_started", {
    hasAccessCookie: Boolean(accessToken),
    hasRefreshCookie: Boolean(refreshToken),
    accessPayloadValid: Boolean(payload),
    sessionId: payload?.sid,
    userId: payload?.uid,
  });

  try {
    if (payload) {
      const session = await findActiveWebSessionIdentity(payload);

      if (session) {
        const now = new Date();
        await revokeActiveWebSessionIdentity(
          session.id,
          session.userId,
          now,
        );
      } else if (refreshToken) {
        await revokeSessionByRefreshToken(refreshToken);
      }
    } else if (refreshToken) {
      await revokeSessionByRefreshToken(refreshToken);
    }
    authDebugLog("session_clear_success", {
      revokedBy: getWebSessionRevocationSource(
        Boolean(payload),
        Boolean(refreshToken),
      ),
      sessionId: payload?.sid,
    });
  } finally {
    cookieStore.deleteAccess();
    cookieStore.deleteRefresh();
  }
}
