import { Card } from "primereact/card";

import { loadCheckout } from "@/application/payments/checkout";
import {
  requestAuthProfileGateway,
  requestCheckoutReader,
} from "@/app/_composition/request-scoped-readers";
import { ExtendConfirmation } from "@/frontend/components/extend-confirmation";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import {
  providerSessionRecoveryPath,
  sessionRefreshPath,
} from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function ExtendPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedDuration = first(params.duration) ?? null;
  const requestedGateway = first(params.gateway) ?? null;
  const extendParams = new URLSearchParams();
  if (requestedDuration) extendParams.set("duration", requestedDuration);
  if (requestedGateway) extendParams.set("gateway", requestedGateway);
  const extendReturnTo = `/extend${extendParams.size ? `?${extendParams}` : ""}`;
  const model = await loadCheckout(requestCheckoutReader, requestAuthProfileGateway);
  if (model.status === "account-action-required" && model.action === "login") {
    redirect(sessionRefreshPath(extendReturnTo));
  }
  if (model.status === "provider-session-recovery-required") {
    redirect(providerSessionRecoveryPath(extendReturnTo));
  }
  return (
    <AppShell requireAuth returnTo={extendReturnTo}>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Выберите доступное предложение продления и способ оплаты."
          title="Продление подписки"
        />
        <Card>
          <ExtendConfirmation model={model} requestedDuration={requestedDuration} requestedGateway={requestedGateway} />
        </Card>
      </div>
    </AppShell>
  );
}
