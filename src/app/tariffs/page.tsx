import { AppShell, PageHeader } from "@/frontend/components/layout";
import { TariffsPanel } from "@/frontend/components/tariffs-panel";

export default function TariffsPage() {
  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Доступные тарифы, длительности и способы оплаты загружаются из CleanVPN."
          title="Тарифы"
        />
        <TariffsPanel />
      </div>
    </AppShell>
  );
}
