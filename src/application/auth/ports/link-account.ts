import type { LinkAccountPasskeyViewModel, TelegramMergeViewModel } from "@/application/models/link-account";

export interface LinkAccountReader {
  loadProfile(): Promise<{ email: string | null; emailVerified: boolean; telegramId: string | null }>;
  loadPasskeys(): Promise<LinkAccountPasskeyViewModel[]>;
  loadTelegramMergeConfirmation(): Promise<TelegramMergeViewModel | null>;
}

export interface LinkAccountCommands {
  linkEmail(input: { email: string; password: string }): Promise<{ linked: boolean }>;
  confirmTelegramMerge(): Promise<void>;
  cancelTelegramMerge(): Promise<void>;
  deletePasskey(id: string): Promise<void>;
}
