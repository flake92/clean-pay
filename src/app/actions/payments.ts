"use server";

import { executePayment } from "@/backend/application/payments/checkout";
import { productionPaymentCommands } from "@/backend/integrations/payments/payment-commands";
import type { PaymentCommand } from "@/shared/presentation/checkout";

export async function executePaymentAction(command: PaymentCommand) {
  return executePayment(productionPaymentCommands, command);
}
