import type { PaymentHistoryGateway } from "@/application/payments/ports/payment-history";

export async function loadPaymentHistory(
  gateway: PaymentHistoryGateway,
  userId: string,
) {
  const [records, status] = await Promise.all([
    gateway.loadRecent(userId, 20),
    gateway.readSnapshotStatus(userId),
  ]);
  return { records, status };
}
