import { AppShell, PageHeader } from "@/frontend/components/layout";
import { TariffsPanel } from "@/frontend/components/tariffs-panel";
import { getBranding } from "@/shared/branding";

export default function TariffsPage() {
  const branding = getBranding();

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description={`Доступные тарифы, длительности и способы оплаты загружаются для ${branding.name}.`}
          title="Тарифы"
        />
        <TariffsPanel />
      </div>
    </AppShell>
  );
}
