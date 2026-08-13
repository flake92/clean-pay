import { Suspense } from "react";

import { CabinetHeaderActions } from "@/frontend/components/cabinet-header-actions";
import { CabinetPanel } from "@/frontend/components/cabinet-panel";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { loadRequestCabinetViewModel } from "@/app/_composition/request-scoped-readers";
import { sessionRefreshPath } from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

async function loadAuthenticatedCabinet() {
  const model = await loadRequestCabinetViewModel();
  if (model.status === "unauthorized") redirect(sessionRefreshPath("/cabinet"));
  return model;
}

async function CabinetActions() {
  const model = await loadAuthenticatedCabinet();
  return <CabinetHeaderActions offers={model.status === "ready" ? model.offers : null} />;
}

async function CabinetContent() {
  return <CabinetPanel model={await loadAuthenticatedCabinet()} />;
}

function CabinetLoading() {
  return (
    <div className="card" aria-busy="true" aria-live="polite">
      <div className="flex align-items-center gap-2 text-600">
        <i className="pi pi-spin pi-spinner" aria-hidden="true" />
        <span>Загрузка данных кабинета...</span>
      </div>
    </div>
  );
}

export default function CabinetPage() {
  return (
    <AppShell requireAuth>
      <div className="grid">
        <div className="col-12">
          <PageHeader
            actions={<Suspense fallback={null}><CabinetActions /></Suspense>}
            description="Статус подписки, подключение, устройства и платежи в одном рабочем экране."
            title="Личный кабинет"
          />
        </div>
        <div className="col-12">
          <Suspense fallback={<CabinetLoading />}>
            <CabinetContent />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
