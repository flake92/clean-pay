export type TelegramCallbackInput =
  | { kind: "oidc"; code: string; state: string }
  | { kind: "popup-oidc"; idToken: string }
  | { kind: "login-widget"; authData: Record<string, unknown> };

export type TelegramProviderSession = { context: unknown };

export type TelegramCallbackDurableOwnership = {
  authStateId: string;
  stateHash: string;
  codeHash: string;
  claimToken: string;
};

export type ConsumedTelegramCallback = {
  user: TelegramLocalUser;
  redirectTo: string | null;
  providerSession: TelegramProviderSession | null;
  linked: boolean;
  telegramId: string;
  telegramUsername: string | null;
  mergeConfirmation: { required: boolean; token: string } | null;
};

export type VerifiedTelegramCallback = {
  authState: { id: string; targetUserId: string | null; redirectTo: string | null };
  identity: {
    telegramId: string;
    telegramUsername: string | null;
    fullName: string | null;
    photoUrl: string | null;
    providerSession: TelegramProviderSession | null;
  };
  durable?: TelegramCallbackDurableOwnership;
};

export type TelegramLocalUser = {
  id: string;
  upstreamAccountId: string | null;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
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
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface TelegramCallbackGateway {
  consume(input: TelegramCallbackInput): Promise<VerifiedTelegramCallback>;
  assertIdentityRateLimit(input: { linked: boolean; telegramId: string }): Promise<void>;
  findUserByTelegramId(telegramId: string): Promise<TelegramLocalUser | null>;
  findUserById(userId: string): Promise<TelegramLocalUser | null>;
  loadProviderMergeIdentity(session: TelegramProviderSession): Promise<{ accountId: string; email: string | null; emailVerified: boolean; pendingEmail: string | null; telegramId: string | null }>;
  preflightAccountMerge(input: { sourceAccountId: string; targetAccountId: string }): Promise<{
    conflicts: string[]; dryRun: boolean; sourceAccountId: string; targetAccountId: string;
    target: { accountId: string; email: string | null; emailVerified: boolean; telegramId: string | null };
    requiresRelogin: boolean;
  }>;
  persistAccountMergeConfirmation(input: {
    userId: string; telegramId: string; telegramUsername: string | null; sourceEmail: string | null;
    targetEmail: string; targetTelegramId: string | null; sourceAccountId: string; targetAccountId: string;
  }): Promise<{ token: string }>;
  applyTelegramIdentity(input: {
    targetUserId: string | null;
    existingTelegramUserId: string | null;
    expectedExistingUpstreamAccountId: string | null;
    provenProviderAccountId: string | null;
    telegramId: string;
    telegramUsername: string | null;
    fullName: string | null;
    photoUrl: string | null;
  }): Promise<TelegramLocalUser>;
  markAuthStateUser(authStateId: string, userId: string): Promise<void>;
  auditIdentityResolved(input: { linked: boolean; userId: string }): Promise<void>;
  clearTemporaryAuth(): Promise<void>;
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
    expectedIdentity: import("@/application/auth/ports/provider-account-identity").ExpectedProviderAccountIdentity;
  }): Promise<TelegramCallbackSession>;
  reconcileProviderSession(session: TelegramProviderSession): Promise<TelegramCallbackSession>;
  withOwnerChangeFence<T>(input: {
    userIds: string[];
    upstreamAccountIds: string[];
    telegramIds: string[];
    operationKey: string;
    targetUpstreamAccountId: string;
    work: () => Promise<T>;
  }): Promise<T>;
  logAttachFailure(error: unknown, telegramId: string): void;
}
