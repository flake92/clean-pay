import { WebSessionAuthMethod } from "@prisma/client";

import type { TelegramWebAppAuthenticator } from "@/backend/application/auth/ports/telegram-webapp";
import { getRemnashopMe, recoverRemnashopTelegramSession, remnashopAuth } from "@/backend/integrations/remnashop/client";
import { reconcileUserFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { ServiceError } from "@/backend/errors/service-error";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { createWebSessionForRemnashopUser } from "@/backend/sessions/web-session";

export const productionTelegramWebAppAuthenticator: TelegramWebAppAuthenticator = {
  async authenticate(initData) {
    const auth = await remnashopAuth("/auth/telegram/webapp", { init_data: initData });
    const verifiedProfile = await getRemnashopMe(auth.cookies.accessToken);
    if (verifiedProfile.telegram_id === null) throw new ServiceError("UNAUTHORIZED", 401, "Telegram identity could not be verified.");
    await assertRateLimit({ action: "telegram_webapp_login", tgId: verifiedProfile.telegram_id, limit: 20, windowSeconds: 15 * 60 });
    const reconciled = await reconcileUserFromRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
      verifiedProfile,
    });

    if (reconciled.requiresTelegramRecovery) {
      const session = await createWebSessionForRemnashopUser({
        userId: reconciled.user.id,
        authMethod: WebSessionAuthMethod.TELEGRAM,
        remnashopAccessTokenEncrypted: "",
        remnashopRefreshTokenEncrypted: "",
        remnashopAccessExpiresAt: new Date(0),
        remnashopRefreshExpiresAt: new Date(0),
      });
      await recoverRemnashopTelegramSession(session.id, reconciled.user.id);
      return;
    }

    if (!reconciled.remnashopSession) {
      throw new ServiceError("INTERNAL_ERROR", 500, "Remnashop session was not reconciled.");
    }

    await createWebSessionForRemnashopUser({
      userId: reconciled.user.id,
      authMethod: WebSessionAuthMethod.TELEGRAM,
      remnashopAccessTokenEncrypted: reconciled.remnashopSession.accessTokenEncrypted,
      remnashopRefreshTokenEncrypted: reconciled.remnashopSession.refreshTokenEncrypted,
      remnashopAccessExpiresAt: reconciled.remnashopSession.accessExpiresAt,
      remnashopRefreshExpiresAt: reconciled.remnashopSession.refreshExpiresAt,
    });
  },
};
