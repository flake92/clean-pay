export type TelegramCallbackInput =
  | { kind: "oidc"; code: string; state: string }
  | { kind: "popup-oidc"; idToken: string }
  | { kind: "login-widget"; authData: Record<string, unknown> };

export type TelegramProviderSession = { context: unknown };

export type ConsumedTelegramCallback = {
  user: { id: string; upstreamAccountId: string | null };
  redirectTo: string | null;
  providerSession: TelegramProviderSession | null;
  linked: boolean;
  telegramId: string;
  telegramUsername: string | null;
  mergeConfirmation: { required: boolean; token: string } | null;
};

export type TelegramCallbackSession = {
  userId: string;
  remnashopSession?: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  };
  requiresTelegramRecovery: boolean;
};

export type TelegramCallbackOutcome = {
  redirectTo: string;
  mergeConfirmation?: { token: string };
  session?: TelegramCallbackSession;
  audit: { userId: string; remnashopLinked: boolean };
};

export class TelegramCallbackError extends Error {
  constructor(public readonly code: "ACCOUNT_MERGE_REQUIRED" | "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT") {
    super(code);
  }
}

export interface TelegramCallbackGateway {
  consume(input: TelegramCallbackInput): Promise<ConsumedTelegramCallback>;
  providerAccountId(session: TelegramProviderSession): string;
  attachTelegramToCurrentAccount(input: {
    telegramId: string;
    telegramUsername: string | null;
    ownerFenceHeld: boolean;
  }): Promise<void>;
  mergeProviderAccounts(input: { sourceAccountId: string; targetAccountId: string }): Promise<boolean>;
  linkProviderSession(input: {
    session: TelegramProviderSession;
    ownerFenceHeld: boolean;
    invalidateSiblingTokens: boolean;
  }): Promise<TelegramCallbackSession>;
  reconcileProviderSession(session: TelegramProviderSession): Promise<TelegramCallbackSession>;
  withOwnerChangeFence<T>(input: {
    userIds: string[];
    upstreamAccountIds: string[];
    telegramIds: string[];
    work: () => Promise<T>;
  }): Promise<T>;
  logAttachFailure(error: unknown, telegramId: string): void;
}
