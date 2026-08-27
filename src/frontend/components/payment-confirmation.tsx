"use client";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { InstallAppButton } from "@/frontend/components/install-app-button";
import { paymentGatewayLabel } from "@/frontend/lib/payment-gateway";
import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { usePaymentConfirmationController } from "@/frontend/hooks/use-payment-confirmation-controller";
import { passkeySetupPath } from "@/shared/auth/account-setup-flow";
import type { CheckoutViewModel } from "@/application/models/checkout";
import {
  paymentDeviceLimitLabel,
  paymentDurationLabel,
  paymentPlanDescription,
  paymentTrafficLabel,
} from "@/frontend/components/payment-confirmation-presentation";

const defaultCheckoutModel: CheckoutViewModel = { status: "error", message: "Не удалось загрузить данные оплаты." };

function pendingOperationDestination(operationId: string) {
  return `/payment/pending?operation_id=${encodeURIComponent(operationId)}`;
}

function pendingPaymentDestination(paymentId: string) {
  return `/payment/pending?payment_id=${encodeURIComponent(paymentId)}`;
}

export function PaymentConfirmation({
  durationDays = null,
  gatewayType = null,
  model = defaultCheckoutModel,
  paymentRedirectTo = "/payment",
  planCode = null,
  showAccountSetupNotice = false,
}: {
  durationDays?: string | null;
  gatewayType?: string | null;
  model?: CheckoutViewModel;
  paymentRedirectTo?: string;
  planCode?: string | null;
  showAccountSetupNotice?: boolean;
}) {
  const {
    createPayment,
    selection,
    submitError,
    submitting,
    view,
  } = usePaymentConfirmationController({
    durationDays,
    gatewayType,
    model,
    pendingOperationDestination,
    pendingPaymentDestination,
    paymentRedirectTo,
    planCode,
  });

  if (view.kind === "verify-email") return null;

  if (view.kind === "account-action") {
    return (
      <AccountActionRequired
        action={view.action}
        message={view.message}
        redirectTo={paymentRedirectTo}
      />
    );
  }

  if (view.kind === "account-error") {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={view.message} />
      </div>
    );
  }

  if (view.kind === "provider-session-recovery") {
    return (
      <AccountActionRequired
        action="recover-session"
        redirectTo={paymentRedirectTo}
      />
    );
  }

  if (view.kind === "error") return <Message severity="error" text={view.message} />;

  if (view.kind === "selection-missing" || !selection) {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="info" text="Для оплаты сначала выберите тариф, срок и способ оплаты." />
        <LinkButton className="w-fit" href="/tariffs" label="Выбрать тариф" />
      </div>
    );
  }

  return (
    <div className="flex flex-column gap-4">
      {showAccountSetupNotice ? (
        <Card>
          <div className="flex flex-column gap-3">
            <Message
              severity="success"
              text="E-mail подтверждён. Вы вернулись к выбранной оплате и можете продолжить."
            />
            <p className="m-0 line-height-3 text-600">
              Теперь в аккаунт можно войти по e-mail и паролю, даже если
              Telegram временно недоступен. Дополнительно можно установить
              приложение и настроить быстрый вход — это необязательно и не
              мешает оплате.
            </p>
            <div className="flex flex-wrap gap-3">
              <InstallAppButton
                alwaysVisible
                autoOpenIosGuide={false}
              />
              <LinkButton
                href={passkeySetupPath(paymentRedirectTo)}
                icon="pi pi-lock"
                label="Настроить быстрый вход"
                outlined
              />
            </div>
          </div>
        </Card>
      ) : null}
      <Card>
        <div className="flex flex-wrap align-items-start justify-content-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{selection.plan.name}</h2>
            <p className="mt-1 line-height-3 text-600">
              {paymentPlanDescription(selection.plan)}
            </p>
          </div>
          <div className="text-right">
            <p className="m-0 text-3xl font-semibold text-900">
              {selection.price.final_amount} {selection.price.currency_symbol}
            </p>
            <p className="m-0 mt-1 text-sm text-500">
              {paymentGatewayLabel(selection.price.gateway_type)}
            </p>
          </div>
        </div>
        <div className="mt-4 grid">
          <div className="col-12 md:col-4">
            <Metric label="Длительность" value={paymentDurationLabel(selection.duration.days)} />
          </div>
          <div className="col-12 md:col-4">
            <Metric label="Устройства" value={paymentDeviceLimitLabel(selection.plan.device_limit)} />
          </div>
          <div className="col-12 md:col-4">
            <Metric label="Трафик" value={paymentTrafficLabel(selection.plan.traffic_limit)} />
          </div>
        </div>
      </Card>
      {submitError ? <Message severity="error" text={submitError} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={submitting}
          label="Перейти к оплате"
          loading={submitting}
          onClick={createPayment}
          type="button"
        />
        <LinkButton href="/tariffs" label="Изменить выбор" outlined />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="surface-50 border-1 border-200 border-round-lg p-3">
      <div className="text-xs uppercase text-500">{label}</div>
      <div className="mt-1 font-medium text-900">{value}</div>
    </div>
  );
}
