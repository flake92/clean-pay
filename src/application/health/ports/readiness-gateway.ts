export interface ReadinessGateway {
  checkDatabase(signal: AbortSignal): Promise<void>;
  checkRedis(signal: AbortSignal): Promise<void>;
  checkRemnashop(signal: AbortSignal): Promise<void>;
  checkTelegramOidc(signal: AbortSignal): Promise<void>;
  checkMailpit?: (signal: AbortSignal) => Promise<void>;
  checkRemnawave?: (signal: AbortSignal) => Promise<void>;
  readSharedState(): Promise<unknown>;
  writeSharedState(value: string, ttlSeconds: number): Promise<void>;
}
