import { CabinetPanel } from "@/components/cabinet-panel";
import { AppShell, PageHeader } from "@/components/layout";
import { LinkButton } from "@/components/prime/link-button";

export default function CabinetPage() {
  return (
    <AppShell>
      <div className="grid">
        <div className="col-12">
          <PageHeader
            actions={
              <>
                <LinkButton href="/tariffs" label="Тарифы" outlined />
                <LinkButton href="/extend" label="Продлить" />
              </>
            }
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
