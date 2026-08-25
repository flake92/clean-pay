import { Card } from "primereact/card";

import { loadCheckout } from "@/application/payments/checkout";
import {
  requestAuthProfileGateway,
  requestCheckoutReader,
} from "@/app/_composition/request-scoped-readers";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import { PaymentConfirmation } from "@/frontend/components/payment-confirmation";
import { hasAccountSetupNotice } from "@/shared/auth/account-setup-flow";
import {
  providerSessionRecoveryPath,
  sessionRefreshPath,
} from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PaymentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const planCode = first(params.plan) ?? null;
  const durationDays = first(params.duration) ?? null;
  const gatewayType = first(params.gateway) ?? null;
  const paymentParams = new URLSearchParams();
  if (planCode) paymentParams.set("plan", planCode);
  if (durationDays) paymentParams.set("duration", durationDays);
  if (gatewayType) paymentParams.set("gateway", gatewayType);
  const paymentRedirectTo = `/payment${paymentParams.size ? `?${paymentParams}` : ""}`;
  const model = await loadCheckout(requestCheckoutReader, requestAuthProfileGateway);
  if (model.status === "account-action-required" && model.action === "login") {
    redirect(sessionRefreshPath(paymentRedirectTo));
  }
  if (model.status === "provider-session-recovery-required") {
    redirect(providerSessionRecoveryPath(paymentRedirectTo));
  }
  return (
    <AppShell requireAuth returnTo={paymentRedirectTo}>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Проверьте выбранный тариф перед переходом к платёжной странице."
          title="Подтверждение оплаты"
        />
        <Card>
          <PaymentConfirmation
            durationDays={durationDays}
            gatewayType={gatewayType}
            model={model}
            paymentRedirectTo={paymentRedirectTo}
            planCode={planCode}
            showAccountSetupNotice={hasAccountSetupNotice({
              get: (name) => name === "account_setup" ? first(params.account_setup) ?? null : null,
            })}
          />
        </Card>
      </div>
    </AppShell>
  );
}
