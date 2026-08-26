"use server";

import { loadPaymentStatus } from "@/application/payments/load-payment-status";
import { productionPaymentMaintenanceRunner } from "@/backend/integrations/payments/payment-maintenance-runner";
import { productionPaymentStatusReader } from "@/app/_composition/session-gateways";

export async function refreshPaymentStatusAction(input: {
  paymentId: string | null;
  operationId: string | null;
}) {
  return loadPaymentStatus(
    productionPaymentStatusReader,
    productionPaymentMaintenanceRunner,
    input,
  );
}
