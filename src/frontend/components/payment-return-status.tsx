"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { readBffError } from "@/frontend/lib/client-api";
import { Tag } from "primereact/tag";

import { AppShell, PageHeader } from "@/frontend/components/layout";
import { LinkButton } from "@/frontend/components/prime/link-button";

type PaymentStatus = {
  payment_id: string;
  purchase_type: string;
  status: string;
  final_amount: string;
  currency: string;
  gateway_type: string;
  plan_name: string | null;
  created_at: string;
} | null;

type CurrentSubscription = {
  status: string;
  plan_name: string;
  expire_at: string;
} | null;

type StatusResponse = {
  payment: PaymentStatus;
  subscription: CurrentSubscription;
};

type Props = {
  kind: "success" | "fail" | "pending";
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function heading(kind: Props["kind"]) {
  if (kind === "success") {
    return "Оплата принята";
  }

  if (kind === "fail") {
    return "Оплата не завершена";
  }

  return "Платёж обрабатывается";
}

function intro(kind: Props["kind"]) {
  if (kind === "success") {
    return "Проверяем локальную запись платежа и актуальную подписку.";
  }

  if (kind === "fail") {
    return "Если платёж был отменён, можно выбрать тариф заново.";
  }

  return "Статус может обновиться после обработки платежа.";
}

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Ожидает",
    completed: "Оплачен",
    failed: "Ошибка",
    canceled: "Отменён",
    refunded: "Возврат",
    unknown: "Неизвестно",
  };

  return labels[status] ?? status;
}

function paymentSeverity(status: string): "success" | "warning" | "danger" | "info" {
  if (status === "completed") {
    return "success";
  }

  if (status === "pending") {
    return "warning";
  }

  if (status === "failed" || status === "canceled") {
    return "danger";
  }

  return "info";
}

export function PaymentReturnStatus({ kind }: Props) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paymentId = useMemo(() => {
    return (
      searchParams.get("payment_id") ??
      searchParams.get("paymentId") ??
      searchParams.get("order_id") ??
      searchParams.get("id")
    );
  }, [searchParams]);

  useEffect(() => {
    const fallbackPaymentId = window.localStorage.getItem("cleanPayLastPaymentId");
    const resolvedPaymentId = paymentId ?? fallbackPaymentId;
    const query = resolvedPaymentId
      ? `?payment_id=${encodeURIComponent(resolvedPaymentId)}`
      : "";

    fetch(`/api/bff/payments/status${query}`)
      .then(async (response) => {
        if (!response.ok) {
          throw await readBffError(response, 'Не удалось проверить статус.');
        }

        const body = await response.json().catch(() => null);

        return body.data as StatusResponse;
      })
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [paymentId]);

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader description={intro(kind)} title={heading(kind)} />
      <Card>
        <div className="flex flex-column gap-4">
        {error ? <Message severity="error" text={error} /> : null}
        {!error && !data ? <Message severity="info" text="Проверка..." /> : null}
        {data?.payment ? (
          <div className="grid">
            <div className="col-12 md:col-6">
              <Metric label="Платёж" value={data.payment.payment_id} />
            </div>
            <div className="col-12 md:col-6">
            <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
              <div className="text-xs uppercase text-500">Статус</div>
              <div className="mt-2">
                <Tag
                  severity={paymentSeverity(data.payment.status)}
                  value={paymentStatusLabel(data.payment.status)}
                />
              </div>
            </div>
            </div>
            <div className="col-12 md:col-6">
            <Metric
              label="Сумма"
              value={`${data.payment.final_amount} ${data.payment.currency}`}
            />
            </div>
            <div className="col-12 md:col-6">
              <Metric label="Дата" value={formatDate(data.payment.created_at)} />
            </div>
          </div>
        ) : null}
        {data && !data.payment ? (
          <Message severity="warn" text="Локальная запись платежа не найдена. Проверьте кабинет позже." />
        ) : null}
        {data?.subscription ? (
          <Message
            severity="success"
            text={`Текущая подписка: ${data.subscription.plan_name}, до ${formatDate(data.subscription.expire_at)}.`}
          />
        ) : null}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <LinkButton href="/cabinet" label="Открыть кабинет" />
        {kind === "fail" ? (
          <LinkButton href="/tariffs" label="Вернуться к тарифам" outlined />
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="surface-50 border-1 border-200 border-round-lg p-3">
      <div className="text-xs uppercase text-500">{label}</div>
      <div className="mt-1 break-all font-medium text-900">{value}</div>
    </div>
  );
}
