import { CabinetHeaderActions } from "@/frontend/components/cabinet-header-actions";
import { CabinetPanel } from "@/frontend/components/cabinet-panel";
import { AppShell, PageHeader } from "@/frontend/components/layout";

export default function CabinetPage() {
  return (
    <AppShell>
      <div className="grid">
        <div className="col-12">
          <PageHeader
            actions={<CabinetHeaderActions />}
            description="Статус подписки, подключение, устройства и платежи в одном рабочем экране."
            title="Личный кабинет"
          />
        </div>
        <div className="col-12">
          <CabinetPanel />
        </div>
      </div>
    </AppShell>
  );
}
