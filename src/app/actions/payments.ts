"use server";

import { executePayment } from "@/application/payments/checkout";
import { executePaymentWorkflow } from "@/application/payments/execute-payment-workflow";
import type { PaymentCommands } from "@/application/payments/ports/checkout";
import { productionPaymentWorkflowGateway } from "@/app/_composition/session-gateways";
import type { PaymentCommand } from "@/application/models/checkout";

const productionPaymentCommands: PaymentCommands = {
  purchase: (request, idempotencyKey) => executePaymentWorkflow(
    productionPaymentWorkflowGateway,
    { kind: "PURCHASE", request },
    idempotencyKey,
  ),
  extend: (request, idempotencyKey) => executePaymentWorkflow(
    productionPaymentWorkflowGateway,
    { kind: "EXTEND", request },
    idempotencyKey,
  ),
};

export async function executePaymentAction(command: PaymentCommand) {
  return executePayment(productionPaymentCommands, command);
}
