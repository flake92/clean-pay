import type { CabinetPaymentViewModel } from "@/application/models/cabinet";

export type PaymentHistoryAuthorization = { context: unknown; upstreamAccountId: string };
export type PaymentHistoryTransaction = { context: unknown };

export interface PaymentHistoryGateway {
  authorize(userId: string): Promise<PaymentHistoryAuthorization>;
  loadCapabilities(authorization: PaymentHistoryAuthorization): Promise<{ maxPageSize: number } | null>;
  findPendingPaymentIds(userId: string, limit: number): Promise<string[]>;
  loadExactTransaction(authorization: PaymentHistoryAuthorization, paymentId: string): Promise<PaymentHistoryTransaction | null>;
  persistExactTransaction(userId: string, authorization: PaymentHistoryAuthorization, transaction: PaymentHistoryTransaction): Promise<void>;
  loadLegacyTransactions(authorization: PaymentHistoryAuthorization): Promise<PaymentHistoryTransaction[]>;
  persistLegacyTransactions(userId: string, authorization: PaymentHistoryAuthorization, transactions: PaymentHistoryTransaction[]): Promise<void>;
  loadRecent(userId: string, limit: number): Promise<CabinetPaymentViewModel[]>;
  logExactFailure(error: unknown, index: number): void;
  logDegraded(error: unknown): void;
}
