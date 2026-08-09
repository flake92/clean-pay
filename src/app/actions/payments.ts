"use server";

import { executePayment } from "@/application/payments/checkout";
import { productionPaymentCommands } from "@/backend/integrations/payments/payment-commands";
import type { PaymentCommand } from "@/application/models/checkout";

export async function executePaymentAction(command: PaymentCommand) {
  return executePayment(productionPaymentCommands, command);
}
