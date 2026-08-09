import { CabinetHeaderActions } from "@/frontend/components/cabinet-header-actions";
import { CabinetPanel } from "@/frontend/components/cabinet-panel";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { loadCabinetViewModel } from "@/application/cabinet/load-cabinet";
import { productionCabinetReader } from "@/backend/integrations/cabinet/cabinet-reader";

export default async function CabinetPage() {
  const model = await loadCabinetViewModel(productionCabinetReader);
  return (
    <AppShell>
      <div className="grid">
        <div className="col-12">
          <PageHeader
            actions={<CabinetHeaderActions offers={model.status === "ready" ? model.offers : null} />}
            description="Статус подписки, подключение, устройства и платежи в одном рабочем экране."
            title="Личный кабинет"
          />
        </div>
        <div className="col-12">
          <CabinetPanel model={model} />
        </div>
      </div>
    </AppShell>
  );
}
