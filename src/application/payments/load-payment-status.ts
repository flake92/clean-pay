import type {
  PaymentStatusOperation,
  PaymentStatusReader,
} from "@/application/payments/ports/payment-status-reader";
import { PaymentStatusGatewayError } from "@/application/payments/ports/payment-status-reader";
import type { PaymentMaintenanceRunner } from "@/application/payments/ports/payment-maintenance";
import { processPaymentHistoryPage, processPaymentReconciliation } from "@/application/payments/run-payment-maintenance";
import type { PaymentStatusPageModel, PaymentStatusViewModel } from "@/application/models/payment-status";
import { accountAccessIssue } from "@/shared/domain/account-access-policy";

const paymentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operationIdPattern = /^[a-z0-9_-]{1,191}$/i;

function operationStatus(operation: PaymentStatusOperation): NonNullable<PaymentStatusViewModel["operation"]> {
  if (operation.manualRequired) return { operation_id: operation.id, status: "manual_required", retry_after_seconds: null, requires_support: true, operator_action: "review_payment_operation" };
  const status = operation.status === "SUCCEEDED" ? "succeeded" : operation.status === "FAILED_FINAL" ? "failed"
    : operation.status === "READY" ? "retry_ready" : operation.status === "OUTCOME_UNKNOWN" ? "outcome_unknown" : "processing";
  return { operation_id: operation.id, status, retry_after_seconds: status === "processing" || status === "outcome_unknown" ? 5 : null, requires_support: false, operator_action: null };
}

function terminal(operation: PaymentStatusOperation, status: NonNullable<PaymentStatusViewModel["operation"]>) {
  return status.status === "manual_required" || operation.status === "FAILED_FINAL"
    || (operation.status === "SUCCEEDED" && (!operation.payment || (operation.paymentStatus !== "PENDING" && operation.paymentStatus !== "UNKNOWN")));
}

function view(operation: PaymentStatusOperation | null, subscription: PaymentStatusViewModel["subscription"], payment: PaymentStatusViewModel["payment"]): PaymentStatusViewModel {
  return { payment, operation: operation ? operationStatus(operation) : null, subscription };
}

function validateInput(input: { paymentId: string | null; operationId: string | null }) {
  if (input.paymentId && !paymentIdPattern.test(input.paymentId)) {
    throw new PaymentStatusGatewayError("VALIDATION_ERROR");
  }
  if (input.operationId && !operationIdPattern.test(input.operationId)) {
    throw new PaymentStatusGatewayError("VALIDATION_ERROR");
  }
}

async function loadActor(reader: PaymentStatusReader) {
  const actor = await reader.loadActor();
  if (!actor) throw new PaymentStatusGatewayError("UNAUTHORIZED");
  const accessIssue = accountAccessIssue(actor);
  if (accessIssue) throw new PaymentStatusGatewayError(accessIssue);
  return actor;
}

async function snapshot(
  reader: PaymentStatusReader,
  input: { paymentId: string | null; operationId: string | null },
) {
  validateInput(input);
  const actor = await loadActor(reader);
  const operation = input.operationId || !input.paymentId
    ? await reader.findOperation(actor.id, input.operationId)
    : null;
  const operationPaymentId = operation?.paymentId ?? null;
  if (input.paymentId && input.operationId && operationPaymentId && input.paymentId !== operationPaymentId) {
    throw new PaymentStatusGatewayError("CONFLICT");
  }
  const resolvedPaymentId = input.operationId ? operationPaymentId : input.paymentId;
  const payment = resolvedPaymentId
    ? await reader.findPayment(actor.id, resolvedPaymentId)
    : input.operationId
      ? operation?.payment ?? null
      : await reader.findLatestPayment(actor.id);

  return view(operation, null, payment);
}

async function execute(reader: PaymentStatusReader, reconciliation: PaymentMaintenanceRunner, input: { paymentId: string | null; operationId: string | null }) {
  validateInput(input);
  const actor = await loadActor(reader);

  let operation = input.operationId || !input.paymentId ? await reader.findOperation(actor.id, input.operationId) : null;
  let status = operation ? operationStatus(operation) : null;
  let operationPaymentId = operation?.paymentId ?? null;
  if (input.paymentId && input.operationId && operationPaymentId && input.paymentId !== operationPaymentId) throw new PaymentStatusGatewayError("CONFLICT");
  let resolvedPaymentId = input.operationId ? operationPaymentId : input.paymentId;
  if (operation && status && terminal(operation, status)) return view(operation, null, operation.payment);

  const authorization = await reader.authorize();
  await reader.assertUpstreamOwner(actor.id, authorization.upstreamAccountId);
  const capabilities = await reader.loadCapabilities(authorization);
  if (capabilities) {
    if (resolvedPaymentId) {
      const exact = await reader.loadExactTransaction(authorization, resolvedPaymentId);
      if (exact) await reader.persistExactTransaction(actor.id, authorization.upstreamAccountId, exact);
    } else {
      await processPaymentHistoryPage(reconciliation, { userId: actor.id, upstreamAccountId: authorization.upstreamAccountId }, authorization.context, capabilities.maxPageSize);
    }
    const claim = await reconciliation.claimReconciliation(actor.id);
    if (claim) await processPaymentReconciliation(reconciliation, claim, authorization.context);
  } else {
    const legacy = await reader.loadLegacyTransactions(authorization);
    await reader.persistLegacyTransactions(actor.id, authorization.upstreamAccountId, legacy);
  }
  if (operation) {
    operation = await reader.findOperation(actor.id, operation.id);
    status = operation ? operationStatus(operation) : null;
    operationPaymentId = operation?.paymentId ?? null;
    resolvedPaymentId = input.operationId ? operationPaymentId : input.paymentId;
  }

  let subscription: PaymentStatusViewModel["subscription"] = null;
  try {
    subscription = await reader.loadSubscription(authorization);
  } catch {
    // Payment synchronization is authoritative; subscription decoration is optional.
  }

  const payment = resolvedPaymentId ? await reader.findPayment(actor.id, resolvedPaymentId)
    : input.operationId ? operation?.payment ?? null : await reader.findLatestPayment(actor.id);
  return view(operation, subscription, payment);
}

export async function loadPaymentStatus(
  reader: PaymentStatusReader,
  reconciliation: PaymentMaintenanceRunner,
  input: { paymentId: string | null; operationId: string | null },
): Promise<PaymentStatusPageModel> {
  try { return { status: "ready", data: await execute(reader, reconciliation, input) }; }
  catch { return { status: "error", message: "Не удалось проверить статус." }; }
}

export async function loadPaymentStatusSnapshot(
  reader: PaymentStatusReader,
  input: { paymentId: string | null; operationId: string | null },
): Promise<PaymentStatusPageModel> {
  try { return { status: "ready", data: await snapshot(reader, input) }; }
  catch { return { status: "error", message: "Не удалось проверить статус." }; }
}
