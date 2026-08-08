import type { AuthSessionRepository } from "@/backend/application/auth/ports/auth-session-repository";
import { prisma } from "@/backend/database/prisma";
export const prismaAuthSessionRepository: AuthSessionRepository = {
  async replaceUpstreamTokens(sessionId, tokens) {
    await prisma.webSession.update({ where: { id: sessionId }, data: {
      remnashopAccessTokenEncrypted: tokens.accessTokenEncrypted,
      remnashopRefreshTokenEncrypted: tokens.refreshTokenEncrypted,
      remnashopAccessExpiresAt: tokens.accessExpiresAt,
      remnashopRefreshExpiresAt: tokens.refreshExpiresAt,
    } });
  },
};
