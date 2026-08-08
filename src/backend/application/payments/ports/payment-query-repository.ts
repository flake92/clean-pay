export type PaymentRecordStatus = "PENDING" | "COMPLETED" | "FAILED" | "CANCELED" | "REFUNDED" | "UNKNOWN";
export interface PaymentRecordView {
  id: string; paymentId: string; purchaseType: string; status: PaymentRecordStatus; finalAmount: unknown;
  currency: string; gatewayType: string; planCode: string | null; planName: string | null;
  durationDays: number | null; deviceLimit: number | null; trafficLimit: number | null; isFree: boolean;
  upstreamCreatedAt: Date; upstreamUpdatedAt: Date;
}
export interface PaymentOperationView {
  id: string; status: string; reconciledAt: Date | null; reconcileErrorSnapshot: unknown;
  paymentRecord: PaymentRecordView | null;
}
export interface PaymentQueryRepository {
  findOperation(userId: string, operationId: string | null): Promise<PaymentOperationView | null>;
  findRecord(userId: string, paymentId: string): Promise<PaymentRecordView | null>;
  findLatestRecord(userId: string): Promise<PaymentRecordView | null>;
  findRecentRecords(userId: string, limit: number): Promise<PaymentRecordView[]>;
  findPendingPaymentIds(userId: string, limit: number): Promise<string[]>;
}
