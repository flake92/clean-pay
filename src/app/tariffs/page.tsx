import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import { TariffsPanel } from "@/frontend/components/tariffs-panel";
import { getBranding } from "@/shared/branding";
import { loadTariffsViewModel } from "@/application/subscriptions/load-tariffs";
import { requestSubscriptionCatalog } from "@/app/_composition/request-scoped-readers";

export default async function TariffsPage() {
  const branding = getBranding();
  const model = await loadTariffsViewModel(requestSubscriptionCatalog);

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
