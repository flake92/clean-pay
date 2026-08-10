export class EmailVerificationError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export type EmailVerificationActor = {
  context: unknown;
  userId: string;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
  pendingUpstreamAccountId: string | null;
  pendingEmail: string | null;
  authorizedUpstreamAccountId: string;
  telegramUsername: string | null;
};

export type EmailProviderSession = { context: unknown };
export type EmailVerificationHumanAction = "email_verification" | "email_change";

export interface EmailVerificationCommands {
  verifyHuman(token: string | null, action: EmailVerificationHumanAction): Promise<void>;
  loadActor(options?: { allowUnverifiedEmail: boolean }): Promise<EmailVerificationActor>;
  assertRequestLimits(input: { userId: string; email: string | null; telegramId: string | null }): Promise<void>;
  requestProviderCode(actor: EmailVerificationActor, email?: string): Promise<{ targetEmail: string }>;
  auditCodeRequested(input: { userId: string; targetEmail: string }): Promise<void>;
  loadProviderProfile(actor: EmailVerificationActor): Promise<{ email: string | null; pendingEmail: string | null; emailVerified: boolean }>;
  assertConfirmationLimit(input: { email: string | null; telegramId: string | null }): Promise<void>;
  confirmProviderCode(actor: EmailVerificationActor, input: { email?: string; code: string; alreadyVerified: boolean }): Promise<{ email: string }>;
  persistConfirmedEmail(actor: EmailVerificationActor, email: string): Promise<{ existingOwnerId: string | null; upstreamAccountId: string; localVerificationChanged: boolean }>;
  currentProviderSession(actor: EmailVerificationActor): EmailProviderSession;
  providerAccountId(session: EmailProviderSession): string;
  telegramProviderSession(input: { telegramId: string; telegramUsername: string | null }): Promise<EmailProviderSession>;
  attachTelegram(session: EmailProviderSession, input: { telegramId: string; telegramUsername: string | null }): Promise<void>;
  mergeProviderAccounts(input: { sourceAccountId: string; targetAccountId: string; reason: string }): Promise<void>;
  refreshProviderSession(input: { telegramId: string; telegramUsername: string | null }): Promise<EmailProviderSession>;
  linkCurrentAccount(session: EmailProviderSession, input: { upstreamMerged: boolean; ownerFenceHeld: boolean }): Promise<void>;
  withOwnerChangeFence<T>(input: { userIds: string[]; upstreamAccountIds: string[]; emails: string[]; telegramIds: Array<string | null>; work: () => Promise<T> }): Promise<T>;
  refreshLocalSession(): Promise<void>;
  auditEmailVerified(input: { userId: string; email: string }): Promise<void>;
  markAccountSyncPending(userId: string, error: unknown): Promise<void>;
  assertChangeLimits(input: { userId: string }): Promise<void>;
  emailOwnerId(email: string): Promise<string | null>;
  assertChangeCooldown(userId: string): Promise<void>;
  changeProviderEmail(actor: EmailVerificationActor, email: string): Promise<{ pendingEmail: string }>;
  persistPendingEmail(actor: EmailVerificationActor, pendingEmail: string): Promise<void>;
  auditEmailChangeRequested(input: { userId: string; pendingEmail: string; verificationTargetEmail: string }): Promise<void>;
}
