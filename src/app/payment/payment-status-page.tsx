import { Card } from "primereact/card";

import { loadPaymentStatus } from "@/application/payments/load-payment-status";
import { productionPaymentStatusReader } from "@/backend/integrations/payments/payment-status-reader";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
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
  const model = await loadPaymentStatus(productionPaymentStatusReader, {
    paymentId: first(params.payment_id) ?? first(params.paymentId) ?? first(params.order_id) ?? first(params.id) ?? null,
    operationId: first(params.operation_id) ?? first(params.operationId) ?? null,
  });
  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader description={intro(kind)} title="Статус платежа" />
        <Card><PaymentReturnStatus kind={kind} model={model} /></Card>
      </div>
    </AppShell>
  );
}
