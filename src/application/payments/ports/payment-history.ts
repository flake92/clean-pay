import type {
  CabinetPaymentViewModel,
  PaymentHistorySnapshotStatus,
} from "@/application/models/cabinet";

export interface PaymentHistoryGateway {
  loadRecent(userId: string, limit: number): Promise<CabinetPaymentViewModel[]>;
  readSnapshotStatus(userId: string): Promise<PaymentHistorySnapshotStatus>;
}
