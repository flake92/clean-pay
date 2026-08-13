import type { PaymentMaintenanceRunner } from "@/application/payments/ports/payment-maintenance";
import type { PaymentHistoryGateway } from "@/application/payments/ports/payment-history";

export async function loadPaymentHistory(
  gateway: PaymentHistoryGateway,
  _maintenance: PaymentMaintenanceRunner,
  userId: string,
) {
  const [records, stale] = await Promise.all([
    gateway.loadRecent(userId, 20),
    gateway.isSnapshotStale(userId),
  ]);
  return { records, stale };
}
