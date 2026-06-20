import { AppShell, PageHeader } from "@/components/layout";
import { TariffsPanel } from "@/components/tariffs-panel";

export default function TariffsPage() {
  return (
    <AppShell>
      <div className="grid gap-6">
        <PageHeader
          description="Доступные тарифы, длительности и способы оплаты загружаются из Remnashop через BFF."
          title="Тарифы"
        />
        <TariffsPanel />
      </div>
    </AppShell>
  );
}
