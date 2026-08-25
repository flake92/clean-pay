import { Suspense } from "react";

import { AppShell } from "@/app/_components/app-shell";
import { loadRequestReferralProgram } from "@/app/_composition/request-scoped-readers";
import { PageHeader } from "@/frontend/components/page-header";
import { ReferralProgramPanel } from "@/frontend/components/referral-program-panel";
import { providerSessionRecoveryPath } from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

async function ReferralContent() {
  const model = await loadRequestReferralProgram();
  if (model.status === "error" && model.action === "recover-session") {
    redirect(providerSessionRecoveryPath("/referral"));
  }
  return <ReferralProgramPanel model={model} />;
}

function ReferralLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="card">
      <div className="flex align-items-center gap-2 text-600">
        <i aria-hidden="true" className="pi pi-spin pi-spinner" />
        <span>Загрузка реферальной программы...</span>
      </div>
    </div>
  );
}

export default function ReferralPage() {
  return (
    <AppShell requireAuth returnTo="/referral">
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Делитесь единой ссылкой, следите за приглашениями и полученными наградами."
          title="Пригласить друзей"
        />
        <Suspense fallback={<ReferralLoading />}>
          <ReferralContent />
        </Suspense>
      </div>
    </AppShell>
  );
}
