import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { TariffsPanel } from "@/frontend/components/tariffs-panel";
import { getBranding } from "@/shared/branding";
import { loadTariffsViewModel } from "@/application/subscriptions/load-tariffs";
import { remnashopSubscriptionCatalog } from "@/backend/integrations/remnashop/subscription-catalog";

export default async function TariffsPage() {
  const branding = getBranding();
  const model = await loadTariffsViewModel(remnashopSubscriptionCatalog);

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description={`Доступные тарифы, длительности и способы оплаты загружаются для ${branding.name}.`}
          title="Тарифы"
        />
        <TariffsPanel model={model} />
      </div>
    </AppShell>
  );
}
