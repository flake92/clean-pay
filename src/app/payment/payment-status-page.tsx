import { Card } from "primereact/card";

import { loadPaymentStatus } from "@/application/payments/load-payment-status";
import { requestPaymentStatusReader } from "@/app/_composition/request-scoped-readers";
import { productionPaymentMaintenanceRunner } from "@/backend/integrations/payments/payment-maintenance-runner";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import { PaymentReturnStatus } from "@/frontend/components/payment-return-status";

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function intro(kind: "success" | "fail" | "pending") {
  return kind === "fail" ? "Возврат от провайдера не является подтверждением результата — сверяем серверный статус." : "Результат определяется по локальной операции, провайдеру и актуальной подписке.";
}

export async function PaymentStatusPage({ kind, searchParams }: {
  kind: "success" | "fail" | "pending";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const paymentId = first(params.payment_id) ?? first(params.paymentId) ?? first(params.order_id) ?? first(params.id) ?? null;
  const operationId = first(params.operation_id) ?? first(params.operationId) ?? null;
  const returnParams = new URLSearchParams();
  if (paymentId) returnParams.set("payment_id", paymentId);
  if (operationId) returnParams.set("operation_id", operationId);
  const returnTo = `/payment/${kind}${returnParams.size ? `?${returnParams}` : ""}`;
  const model = await loadPaymentStatus(requestPaymentStatusReader, productionPaymentMaintenanceRunner, {
    paymentId,
    operationId,
  });
  return (
    <AppShell requireAuth returnTo={returnTo}>
      <div className="flex flex-column gap-6">
        <PageHeader description={intro(kind)} title="Статус платежа" />
        <Card><PaymentReturnStatus kind={kind} model={model} /></Card>
      </div>
    </AppShell>
  );
}
