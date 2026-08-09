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
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { createWebSessionForRemnashopUser } from "@/backend/integrations/sessions/web-session-service";

type ProviderAuth = Awaited<ReturnType<typeof remnashopAuth>>;

function providerAuth(session: TelegramWebAppProviderSession) {
  return session.context as ProviderAuth;
}

export const productionTelegramWebAppGateway: TelegramWebAppGateway = {
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
    await assertRateLimit({
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
    await recoverRemnashopTelegramSession(sessionId, userId);
  },
};
