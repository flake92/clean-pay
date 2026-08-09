import type { PaymentStatusReader } from "@/application/payments/ports/payment-status-reader";
import type { PaymentStatusPageModel } from "@/application/models/payment-status";

export async function loadPaymentStatus(
  reader: PaymentStatusReader,
  input: { paymentId: string | null; operationId: string | null },
): Promise<PaymentStatusPageModel> {
  try { return { status: "ready", data: await reader.load(input) }; }
  catch { return { status: "error", message: "Не удалось проверить статус." }; }
}
