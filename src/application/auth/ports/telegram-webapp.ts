export interface TelegramWebAppAuthenticator {
  authenticate(initData: string): Promise<void>;
}
