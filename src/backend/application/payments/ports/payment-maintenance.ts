export type PaymentReconciliationBatch = {
  claimed: number;
  succeeded: number;
  inProgress: number;
  unknown: number;
  manualRequired: number;
  retryReady: number;
  failed: number;
  manualRequiredOperationIds: string[];
};

export type PaymentHistoryBackfillBatch = {
  attempted: number;
  applied: number;
  completed: number;
  failed: number;
};

export interface PaymentMaintenanceRunner {
  reconcile(input: { limit: number; deadlineMs: number }): Promise<PaymentReconciliationBatch>;
  continueHistory(input: { limit: number; deadlineMs: number }): Promise<PaymentHistoryBackfillBatch>;
}
