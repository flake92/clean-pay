export type PaymentReconciliationClaim = {
  context: unknown; operationId: string; ownerMatches: boolean; failureCount: number;
};
export type PaymentReconciliationResult = "SUCCEEDED" | "IN_PROGRESS" | "UNKNOWN" | "MANUAL_REQUIRED" | "RETRY_READY";
export type PaymentRecovery = {
  context: unknown;
  state: "SUCCEEDED" | "IN_PROGRESS" | "UNKNOWN" | "MANUAL_REQUIRED";
  retryAfterSeconds: number | null;
} | null;
export type PaymentHistoryCandidate = { userId: string; upstreamAccountId: string };
export type PaymentHistoryClaim = { context: unknown; cursor: string | null };
export type PaymentHistoryAuthorization = { context: unknown };
export type PaymentHistoryPage = { context: unknown };

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
  listHistoryCandidates(limit: number): Promise<PaymentHistoryCandidate[]>;
  claimHistory(candidate: PaymentHistoryCandidate): Promise<PaymentHistoryClaim | null>;
  authorizeHistory(claim: PaymentHistoryClaim): Promise<PaymentHistoryAuthorization>;
  historyPageSize(authorization: PaymentHistoryAuthorization): Promise<number | null>;
  loadHistoryPage(authorization: PaymentHistoryAuthorization, cursor: string | null, limit: number): Promise<PaymentHistoryPage>;
  completeHistoryPage(claim: PaymentHistoryClaim, page: PaymentHistoryPage): Promise<{ applied: number; hasMore: boolean }>;
  failHistory(claim: PaymentHistoryClaim, error: unknown): Promise<void>;
  now(): number;
}
