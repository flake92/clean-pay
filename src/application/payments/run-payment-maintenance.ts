import type {
  PaymentMaintenanceRunner,
} from "@/application/payments/ports/payment-maintenance";

export async function runPaymentMaintenance(
  runner: PaymentMaintenanceRunner,
  input: { paymentLimit: number; deadlineMs: number },
) {
  const payments = await runner.reconcile({
    limit: input.paymentLimit,
    deadlineMs: input.deadlineMs,
  });
  const history = await runner.continueHistory({
    limit: 1,
    deadlineMs: input.deadlineMs,
  });

  return { ...payments, history };
}
