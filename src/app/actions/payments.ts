"use server";

import { executePayment } from "@/application/payments/checkout";
import { executePaymentWorkflow } from "@/application/payments/execute-payment-workflow";
import type { PaymentCommands } from "@/application/payments/ports/checkout";
import { productionPaymentWorkflowGateway } from "@/app/_composition/session-gateways";
import type {
  PaymentCommand,
  PaymentCommandResult,
} from "@/application/models/checkout";
import { parsePaymentCommandPayload } from "@/app/actions/runtime-payload";

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

export async function executePaymentAction(
  command: PaymentCommand,
): Promise<PaymentCommandResult> {
  const parsed = parsePaymentCommandPayload(command);
  return parsed
    ? executePayment(productionPaymentCommands, parsed)
    : {
        ok: false as const,
        code: "VALIDATION_ERROR",
        message: "Не удалось подтвердить результат оплаты. Повторите попытку с тем же запросом.",
        retainIdempotencyKey: false,
      };
}
