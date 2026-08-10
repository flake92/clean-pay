import { prisma } from "@/backend/database/prisma";
export const prismaAuthSessionRepository = {
  async replaceUpstreamTokens(sessionId: string, tokens: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }) {
    await prisma.webSession.update({ where: { id: sessionId }, data: {
      remnashopAccessTokenEncrypted: tokens.accessTokenEncrypted,
      remnashopRefreshTokenEncrypted: tokens.refreshTokenEncrypted,
      remnashopAccessExpiresAt: tokens.accessExpiresAt,
      remnashopRefreshExpiresAt: tokens.refreshExpiresAt,
    } });
  },
};
