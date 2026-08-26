import { serviceErrorPublicMessage } from "@/shared/domain/service-error-catalog";

export type AccountMergeConfirmation = {
  context: unknown;
  id: string;
  userId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  expiresAt: Date;
  recoverableAfterExpiry?: boolean;
  sourceAccountId: string;
  targetAccountId: string;
  sourceEmail: string | null;
  targetEmail: string;
  targetTelegramId: string | null;
  telegramId: string;
  telegramUsername: string | null;
};

export type AccountMergeProviderIdentity = {
  context: unknown;
  accountId: string;
  telegramId: string | null;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
};

export type AccountMergePreflight = {
  conflicts: string[];
  dryRun: boolean;
  sourceAccountId: string;
  targetAccountId: string;
  target: { accountId: string; email: string | null; emailVerified: boolean; telegramId: string | null };
  requiresRelogin: boolean;
};

export class AccountMergeError extends Error {
  public readonly prodMessage: string | undefined;

  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.prodMessage = serviceErrorPublicMessage(code);
  }
}

export interface TelegramAccountMergeGateway {
  loadActor(): Promise<{ userId: string; fullAssurance: boolean } | null>;
  loadConfirmation(userId: string): Promise<AccountMergeConfirmation>;
  assertRateLimit(telegramId: string): Promise<void>;
  audit(input: { action: string; userId: string; severity?: "WARN"; metadata?: Record<string, unknown> }): Promise<void>;
  claim(confirmation: AccountMergeConfirmation, now: Date): Promise<boolean>;
  withOwnerChangeFence<T>(confirmation: AccountMergeConfirmation, work: () => Promise<T>): Promise<T>;
  loadCurrentOwner(userId: string): Promise<{ email: string | null; emailVerified: boolean; upstreamAccountId: string | null; telegramId: string | null } | null>;
  authenticateTelegram(confirmation: AccountMergeConfirmation): Promise<AccountMergeProviderIdentity>;
  preflight(confirmation: AccountMergeConfirmation): Promise<AccountMergePreflight>;
  mergeProviderAccounts(confirmation: AccountMergeConfirmation): Promise<{ targetHasSubscription: boolean }>;
  synchronizeSubscriptionIdentity(identity: AccountMergeProviderIdentity): Promise<{
    hasSubscription: boolean;
    identity: AccountMergeProviderIdentity;
  }>;
  linkCurrentAccount(identity: AccountMergeProviderIdentity): Promise<{ userId: string }>;
  complete(confirmation: AccountMergeConfirmation): Promise<boolean>;
  cancel(confirmation: AccountMergeConfirmation): Promise<boolean>;
  release(confirmation: AccountMergeConfirmation, input: { terminal: boolean; errorCode: string }): Promise<void>;
  refreshLocalSession(): Promise<void>;
  reconcileCompletedOwnerChange(confirmation: AccountMergeConfirmation): Promise<void>;
}
