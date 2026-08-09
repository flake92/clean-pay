import type { PaymentStatusViewModel } from "@/application/models/payment-status";

export interface PaymentStatusReader {
  load(input: { paymentId: string | null; operationId: string | null }): Promise<PaymentStatusViewModel>;
}
