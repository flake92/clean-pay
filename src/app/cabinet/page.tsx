import { CabinetHeaderActions } from "@/frontend/components/cabinet-header-actions";
import { CabinetPanel } from "@/frontend/components/cabinet-panel";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { loadCabinetViewModel } from "@/application/cabinet/load-cabinet";
import { productionCabinetReader } from "@/backend/integrations/cabinet/cabinet-reader";
import { productionPaymentHistoryGateway } from "@/backend/integrations/payments/payment-history-reader";
import { productionPaymentMaintenanceRunner } from "@/backend/integrations/payments/payment-maintenance-runner";
import { productionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";

export default async function CabinetPage() {
  const model = await loadCabinetViewModel(productionCabinetReader, productionAuthProfileGateway, productionPaymentHistoryGateway, productionPaymentMaintenanceRunner);
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
