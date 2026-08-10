type TelegramAuthStartUser = {
  id: string;
  email: string | null;
  telegramId: string | null;
};

export interface TelegramAuthStartSecurity {
  loadCurrentUser(): Promise<TelegramAuthStartUser | null>;
  verifyHuman(token: string | null, action: "telegram_auth_start" | "auth_login"): Promise<void>;
  assertLinkRateLimit(user: TelegramAuthStartUser): Promise<void>;
}
