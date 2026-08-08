export interface AuthSessionRepository {
  replaceUpstreamTokens(sessionId: string, tokens: {
    accessTokenEncrypted: string; refreshTokenEncrypted: string;
    accessExpiresAt: Date; refreshExpiresAt: Date;
  }): Promise<void>;
}
