import { Card } from "primereact/card";

import { loadCheckout } from "@/application/payments/checkout";
import {
  requestAuthProfileGateway,
  requestChangeQuoteReader,
  requestCheckoutReader,
} from "@/app/_composition/request-scoped-readers";
import { loadChangeQuote } from "@/application/payments/load-change-quote";
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
  const gift = first(params.gift) === "1";
  const paymentParams = new URLSearchParams();
  if (planCode) paymentParams.set("plan", planCode);
  if (durationDays) paymentParams.set("duration", durationDays);
  if (gatewayType) paymentParams.set("gateway", gatewayType);
  if (gift) paymentParams.set("gift", "1");
  const paymentRedirectTo = `/payment${paymentParams.size ? `?${paymentParams}` : ""}`;
  const model = await loadCheckout(requestCheckoutReader, requestAuthProfileGateway);
  const changeQuote = gift || model.status !== "ready" || !model.offers.has_current_subscription
    ? null
    : await loadChangeQuote(requestChangeQuoteReader, planCode, durationDays);
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
          description={gift
            ? "Проверьте подарок перед переходом к платёжной странице. Код появится на странице подарков после оплаты."
            : "Проверьте выбранный тариф перед переходом к платёжной странице."}
          title={gift ? "Оплата подарка" : "Подтверждение оплаты"}
        />
        <Card>
          <PaymentConfirmation
            durationDays={durationDays}
            gatewayType={gatewayType}
            changeQuote={changeQuote}
            gift={gift}
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
