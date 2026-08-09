export interface TelegramSessionRecovery {
  recover(sessionId: string, userId: string): Promise<void>;
}
