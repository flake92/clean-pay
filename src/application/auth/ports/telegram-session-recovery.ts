import type { ExpectedProviderAccountIdentity } from "@/application/auth/ports/provider-account-identity";

export type TelegramRecoverySession = {
  context: unknown;
  sessionId: string;
  userId: string;
  upstreamAccountId: string | null;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
  authPending: boolean;
  pendingUpstreamAccountId: string | null;
  pendingEmail: string | null;
};

export type TelegramRecoveryProviderSession = {
  context: unknown;
  accountId: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  telegramId: string | null;
};

export type TelegramRecoveryPlan = {
  session: TelegramRecoverySession;
  initialProvider: TelegramRecoveryProviderSession;
  sourceAccountId: string | null;
  targetAccountId: string;
  expectedEmail: string | null;
  finalEmail: string | null;
  finalEmailVerified: boolean;
};

export type TelegramRecoveryLocalSnapshot = {
  context: unknown;
};

export type TelegramRecoveryMergeResult = {
  dryRun: boolean;
  sourceAccountId: string;
  targetAccountId: string;
  targetAccountMatches: boolean;
  conflicts: string[];
  requiresRelogin: boolean;
};

export class TelegramSessionRecoveryError extends Error {
  readonly code = "ACCOUNT_MERGE_REQUIRED";

  constructor(public readonly reason: string) {
    super(reason);
  }
}

export interface TelegramSessionRecoveryGateway<TResult> {
  configurationAvailable(): boolean;
  recoverySkipped(session: TelegramRecoverySession): void;
  recoveryStarted(session: TelegramRecoverySession): void;
  authenticateTelegram(input: {
    telegramId: string;
    telegramUsername: string | null;
    deadlineAt?: number;
  }): Promise<TelegramRecoveryProviderSession>;
  withOwnerChangeFence<T>(input: {
    plan: TelegramRecoveryPlan;
    operationKey: string;
    work: () => Promise<T>;
  }): Promise<T>;
  captureLocalSnapshot(plan: TelegramRecoveryPlan): Promise<TelegramRecoveryLocalSnapshot>;
  mergeProviderAccounts(input: {
    sourceAccountId: string;
    targetAccountId: string;
    reason: string;
    emailResolution: "KEEP_TARGET";
    telegramResolution: "KEEP_SOURCE";
    paymentResolution: "REKEY_SOURCE";
    deadlineAt: number;
  }): Promise<TelegramRecoveryMergeResult>;
  synchronizeProviderIdentity(input: {
    provider: TelegramRecoveryProviderSession;
    expected: ExpectedProviderAccountIdentity;
  }): Promise<TelegramRecoveryProviderSession>;
  commitLocalRecovery(input: {
    plan: TelegramRecoveryPlan;
    snapshot: TelegramRecoveryLocalSnapshot;
    provider: TelegramRecoveryProviderSession;
    upstreamMerged: boolean;
  }): Promise<TResult>;
  recoverySucceeded(input: {
    session: TelegramRecoverySession;
    provider: TelegramRecoveryProviderSession;
    upstreamMerged: boolean;
  }): void;
}
