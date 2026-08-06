import type { PaymentStatusViewModel } from "@/shared/presentation/payment-status";

export interface PaymentStatusReader {
  load(input: { paymentId: string | null; operationId: string | null }): Promise<PaymentStatusViewModel>;
}
