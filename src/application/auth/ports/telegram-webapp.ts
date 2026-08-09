export type TelegramWebAppProviderSession = { context: unknown };

type UpstreamSession = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export interface TelegramWebAppGateway {
  authenticateProvider(initData: string): Promise<TelegramWebAppProviderSession>;
  verifiedIdentity(session: TelegramWebAppProviderSession): Promise<{ telegramId: string | null; context: unknown }>;
  rateLimit(telegramId: string): Promise<void>;
  reconcileIdentity(session: TelegramWebAppProviderSession, verifiedIdentity: { context: unknown }): Promise<{
    userId: string;
    upstreamSession?: UpstreamSession;
    requiresRecovery: boolean;
  }>;
  createSession(input: { userId: string; upstreamSession: UpstreamSession }): Promise<{ id: string } | null>;
  recoverSession(sessionId: string, userId: string): Promise<void>;
}
