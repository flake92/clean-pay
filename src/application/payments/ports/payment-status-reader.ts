import type { PaymentStatusViewModel } from "@/application/models/payment-status";

export class PaymentStatusGatewayError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export type PaymentStatusOperation = {
  id: string;
  status: string;
  manualRequired: boolean;
  paymentId: string | null;
  paymentStatus: string | null;
  payment: PaymentStatusViewModel["payment"];
};

export type PaymentStatusAuthorization = { context: unknown; upstreamAccountId: string };
export type PaymentStatusTransaction = { context: unknown };

export interface PaymentStatusReader {
  loadActor(): Promise<{ id: string; emailVerified: boolean; telegramId: string | null } | null>;
  findOperation(userId: string, operationId: string | null): Promise<PaymentStatusOperation | null>;
  authorize(): Promise<PaymentStatusAuthorization>;
  assertUpstreamOwner(userId: string, upstreamAccountId: string): Promise<void>;
  loadCapabilities(authorization: PaymentStatusAuthorization): Promise<{ maxPageSize: number } | null>;
  loadExactTransaction(authorization: PaymentStatusAuthorization, paymentId: string): Promise<PaymentStatusTransaction | null>;
  persistExactTransaction(userId: string, upstreamAccountId: string, transaction: PaymentStatusTransaction): Promise<void>;
  loadLegacyTransactions(authorization: PaymentStatusAuthorization): Promise<PaymentStatusTransaction[]>;
  persistLegacyTransactions(userId: string, upstreamAccountId: string, transactions: PaymentStatusTransaction[]): Promise<void>;
  loadSubscription(authorization: PaymentStatusAuthorization): Promise<PaymentStatusViewModel["subscription"]>;
  findPayment(userId: string, paymentId: string): Promise<PaymentStatusViewModel["payment"]>;
  findLatestPayment(userId: string): Promise<PaymentStatusViewModel["payment"]>;
  isSubscriptionMissing(error: unknown): boolean;
}
