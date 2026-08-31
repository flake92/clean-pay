import { WebSessionAuthMethod } from "@prisma/client";

import type {
  TelegramWebAppGateway,
  TelegramWebAppProviderSession,
} from "@/application/auth/ports/telegram-webapp";
import {
  getRemnashopMe,
  recoverRemnashopTelegramSession,
  remnashopAuth,
} from "@/backend/integrations/remnashop/client";
import { reconcileUserFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import {
  assertRateLimitCapacity,
  assertTargetRateLimit,
  withAuthConcurrency,
} from "@/backend/limits/rate-limit";
import { createWebSessionForRemnashopUser } from "@/backend/integrations/sessions/web-session-service";
import {
  clearWebSessionCookies,
  revokeWebSessionById,
} from "@/backend/integrations/sessions/web-session-revocation";

type ProviderAuth = Awaited<ReturnType<typeof remnashopAuth>>;

function providerAuth(session: TelegramWebAppProviderSession) {
  return session.context as ProviderAuth;
}

type TelegramSessionRecoverer = typeof recoverRemnashopTelegramSession;

export function createProductionTelegramWebAppGateway(
  recoverSession: TelegramSessionRecoverer = recoverRemnashopTelegramSession,
): TelegramWebAppGateway {
  return {
  async preflightCapacity() {
    await assertRateLimitCapacity("telegram_webapp_login");
  },

  withUpstreamConcurrency(action, work) {
    return withAuthConcurrency(action, work);
  },

  async authenticateProvider(initData) {
    return { context: await remnashopAuth("/auth/telegram/webapp", { init_data: initData }) };
  },

  async verifiedIdentity(session) {
    const profile = await getRemnashopMe(providerAuth(session).cookies.accessToken);
    return {
      telegramId: profile.telegram_id === null ? null : String(profile.telegram_id),
      context: profile,
    };
  },

  async rateLimit(telegramId) {
    await assertTargetRateLimit({
      action: "telegram_webapp_login",
      tgId: telegramId,
      limit: 20,
      windowSeconds: 15 * 60,
    });
  },

  async reconcileIdentity(session, verifiedIdentity) {
    const auth = providerAuth(session);
    const result = await reconcileUserFromRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
      verifiedProfile: verifiedIdentity.context as Awaited<ReturnType<typeof getRemnashopMe>>,
    });
    return {
      userId: result.user.id,
      upstreamSession: result.remnashopSession,
      requiresRecovery: result.requiresTelegramRecovery,
    };
  },

  async createSession({ userId, upstreamSession }) {
    return createWebSessionForRemnashopUser({
      userId,
      authMethod: WebSessionAuthMethod.TELEGRAM,
      remnashopAccessTokenEncrypted: upstreamSession.accessTokenEncrypted,
      remnashopRefreshTokenEncrypted: upstreamSession.refreshTokenEncrypted,
      remnashopAccessExpiresAt: upstreamSession.accessExpiresAt,
      remnashopRefreshExpiresAt: upstreamSession.refreshExpiresAt,
    });
  },

  async recoverSession(sessionId, userId) {
    await recoverSession(sessionId, userId);
  },

  async revokeSession(sessionId, userId) {
    await revokeWebSessionById(sessionId, userId);
  },

  async clearSessionCookies() {
    await clearWebSessionCookies();
  },
  };
}
