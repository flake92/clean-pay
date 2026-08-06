import { Card } from "primereact/card";

import { loadCheckout } from "@/backend/application/payments/checkout";
import { productionCheckoutReader } from "@/backend/integrations/payments/checkout-reader";
import { ExtendConfirmation } from "@/frontend/components/extend-confirmation";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function ExtendPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedDuration = first(params.duration) ?? null;
  const requestedGateway = first(params.gateway) ?? null;
  const model = await loadCheckout(productionCheckoutReader);
  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Выберите доступное предложение продления и способ оплаты."
          title="Продление подписки"
        />
        <Card>
          <ExtendConfirmation model={model} requestedDuration={requestedDuration} requestedGateway={requestedGateway} />
        </Card>
      </div>
    </AppShell>
  );
}
