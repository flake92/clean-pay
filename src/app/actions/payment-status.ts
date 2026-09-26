"use server";

import { loadPaymentStatus } from "@/application/payments/load-payment-status";
import type { PaymentStatusPageModel } from "@/application/models/payment-status";
import { productionPaymentStatusReader } from "@/app/_composition/session-gateways";
import { productionPaymentMaintenanceRunner } from "@/app/_composition/action-runtime";
import { parsePaymentStatusPayload } from "@/app/actions/runtime-payload";

export async function refreshPaymentStatusAction(input: {
  paymentId: string | null;
  operationId: string | null;
}): Promise<PaymentStatusPageModel> {
  const parsed = parsePaymentStatusPayload(input);
  if (!parsed) return { status: "error" as const, message: "Не удалось проверить статус." };
  return loadPaymentStatus(
    productionPaymentStatusReader,
    productionPaymentMaintenanceRunner,
    parsed,
  );
}
