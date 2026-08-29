import type { TelegramMergeViewModel } from "@/application/models/link-account";

export interface LinkAccountReader {
  loadMergeActor(): Promise<{ userId: string; fullAssurance: boolean } | null>;
  loadTelegramMergeConfirmation(userId: string): Promise<(TelegramMergeViewModel & {
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
    expiresAt: Date;
    recoverableAfterExpiry?: boolean;
  }) | null>;
}

export type LinkAccountActor = {
    context: unknown; userId: string; email: string | null; emailVerified: boolean;
    telegramId: string | null; telegramUsername: string | null; upstreamAccountId: string | null;
    fullAssurance: boolean;
};

export interface LinkAccountCommands {
  loadLinkActor(): Promise<LinkAccountActor | null>;
  assertLinkRateLimit(email: string): Promise<void>;
  authenticateEmail(input: { operation: "login" | "register"; email: string; password: string }): Promise<{ context: unknown }>;
  linkActorIsCurrent(actor: { context: unknown }): Promise<boolean>;
  loadProviderProfile(session: { context: unknown }): Promise<{
    email: string | null;
    emailVerified: boolean;
    pendingEmail?: string | null;
    telegramId?: string | null;
  }>;
  providerAccountId(session: { context: unknown }): string;
  telegramProviderSession(input: { telegramId: string; telegramUsername: string | null }): Promise<{ context: unknown }>;
  attachTelegram(session: { context: unknown }, input: { telegramId: string; telegramUsername: string | null }): Promise<void>;
  mergeProviderAccounts(input: { sourceAccountId: string; targetAccountId: string; reason: string }): Promise<void>;
  refreshTelegramProviderSession(input: { telegramId: string; telegramUsername: string | null }): Promise<{ context: unknown }>;
  linkCurrentAccount(session: { context: unknown }, input: {
    upstreamMerged: boolean;
    ownerFenceHeld: boolean;
    expectedIdentity: import("@/application/auth/ports/provider-account-identity").ExpectedProviderAccountIdentity;
  }): Promise<{ userId: string }>;
  withOwnerChangeFence<T>(input: { userIds: string[]; upstreamAccountIds: string[]; emails: Array<string | null>; telegramIds: Array<string | null>; operationKey: string; targetUpstreamAccountId: string; work: () => Promise<T> }): Promise<T>;
  emailOwnerId(email: string): Promise<string | null>;
  stagePendingEmail(input: {
    actor: LinkAccountActor;
    providerSession: { context: unknown };
    email: string;
    providerEmail: string | null;
    stagedLocally: boolean;
    ownerTransitionStarted?: boolean;
  }): Promise<void>;
  requestProviderVerification(session: { context: unknown }, email: string): Promise<{ targetEmail: string }>;
  auditLinkEvent(input: { action: string; userId: string; metadata?: Record<string, unknown> }): Promise<void>;
}

export class LinkAccountGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage?: string,
  ) {
    super(code);
  }
}
