import { Suspense } from "react";

import { CabinetHeaderActions } from "@/frontend/components/cabinet-header-actions";
import { CabinetPanel } from "@/frontend/components/cabinet-panel";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import {
  loadRequestCabinetViewModel,
  loadRequestReferralProgram,
} from "@/app/_composition/request-scoped-readers";
import { ReferralProgramPanel } from "@/frontend/components/referral-program-panel";
import {
  providerSessionRecoveryPath,
  sessionRefreshPath,
} from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

async function loadAuthenticatedCabinet() {
  const model = await loadRequestCabinetViewModel();
  if (model.status === "unauthorized") redirect(sessionRefreshPath("/cabinet"));
  if (model.status === "provider-session-recovery-required") {
    redirect(providerSessionRecoveryPath("/cabinet"));
  }
  return model;
}

async function CabinetActions() {
  const model = await loadAuthenticatedCabinet();
  return <CabinetHeaderActions offers={model.status === "ready" ? model.offers : null} />;
}

async function CabinetContent() {
  return <CabinetPanel model={await loadAuthenticatedCabinet()} />;
}

async function CabinetReferralContent() {
  const model = await loadRequestReferralProgram();
  if (model.status === "error" && model.action === "recover-session") {
    redirect(providerSessionRecoveryPath("/cabinet"));
  }
  return model.status === "ready" ? <ReferralProgramPanel model={model} /> : null;
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
        <div className="col-12" id="referral-program">
          <Suspense fallback={null}>
            <CabinetReferralContent />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
