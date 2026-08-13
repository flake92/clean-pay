export type PaymentReconciliationClaim = {
  context: unknown; operationId: string; ownerMatches: boolean; failureCount: number;
};
type PaymentRecovery = {
  context: unknown;
  state: "SUCCEEDED" | "IN_PROGRESS" | "UNKNOWN" | "MANUAL_REQUIRED";
  retryAfterSeconds: number | null;
} | null;
export type PaymentHistoryCandidate = { userId: string; upstreamAccountId: string };
export type PaymentHistoryClaim = { context: unknown; cursor: string | null };
export type PaymentHistoryAuthorization = { context: unknown };
export type PaymentHistoryPage = { context: unknown };
export type PaymentHistoryExact = { context: unknown };

export type PaymentReconciliationBacklog = {
  pending: number;
  due: number;
  manualRequired: number;
  oldestAgeSeconds: number;
  maximumAttemptCount: number;
  totalFailureCount: number;
};

export interface PaymentReconciliationGateway {
  claimReconciliation(userId?: string): Promise<PaymentReconciliationClaim | null>;
  recoverPayment(claim: PaymentReconciliationClaim, authorizationContext?: unknown): Promise<PaymentRecovery>;
  completeRecoveredPayment(claim: PaymentReconciliationClaim, recovery: NonNullable<PaymentRecovery>): Promise<void>;
  resetMissingPayment(claim: PaymentReconciliationClaim): Promise<void>;
  releaseReconciliation(claim: PaymentReconciliationClaim, input: { delayMs: number; failure: boolean; errorCode?: string }): Promise<void>;
  markReconciliationManual(claim: PaymentReconciliationClaim, reason: string, allowOwnerMismatch?: boolean): Promise<void>;
  failReconciliation(claim: PaymentReconciliationClaim, error: unknown): Promise<"released" | "owner_changed">;
  classifyReconciliationError(error: unknown): { kind: "manual"; reason: string } | { kind: "owner_changed" } | { kind: "other" };
}

export interface PaymentMaintenanceRunner extends PaymentReconciliationGateway {
  readReconciliationBacklog?(): Promise<PaymentReconciliationBacklog>;
  listHistoryCandidates(limit: number): Promise<PaymentHistoryCandidate[]>;
  claimHistory(candidate: PaymentHistoryCandidate): Promise<PaymentHistoryClaim | null>;
  authorizeHistory(claim: PaymentHistoryClaim, timeoutMs?: number): Promise<PaymentHistoryAuthorization>;
  historyPageSize(authorization: PaymentHistoryAuthorization, timeoutMs?: number): Promise<number | null>;
  findPendingHistoryPaymentIds(userId: string, limit: number): Promise<string[]>;
  loadExactHistoryPayment(authorization: PaymentHistoryAuthorization, paymentId: string, timeoutMs?: number): Promise<PaymentHistoryExact | null>;
  persistExactHistoryPayment(candidate: PaymentHistoryCandidate, payment: PaymentHistoryExact): Promise<void>;
  loadLegacyHistory(authorization: PaymentHistoryAuthorization, timeoutMs?: number): Promise<PaymentHistoryPage>;
  loadHistoryPage(authorization: PaymentHistoryAuthorization, cursor: string | null, limit: number, timeoutMs?: number): Promise<PaymentHistoryPage>;
  completeHistoryPage(claim: PaymentHistoryClaim, page: PaymentHistoryPage): Promise<{ applied: number; hasMore: boolean }>;
  failHistory(claim: PaymentHistoryClaim, error: unknown): Promise<void>;
  logHistoryExactFailure?(error: unknown, index: number): void;
  now(): number;
}
