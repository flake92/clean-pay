"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { readBffError } from "@/frontend/lib/client-api";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";

import { AppShell, PageHeader } from "@/frontend/components/layout";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { shouldPollPaymentOperation } from "@/frontend/lib/payment-idempotency";
import {
  paymentPollDelayMs,
  paymentReturnOutcome,
  shouldPollPaymentReturn,
} from "@/frontend/lib/payment-return";

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
  operation: {
    operation_id: string;
    status:
      | "processing"
      | "outcome_unknown"
      | "manual_required"
      | "succeeded"
      | "failed"
      | "retry_ready";
    retry_after_seconds: number | null;
    requires_support: boolean;
    operator_action: string | null;
  } | null;
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

function heading(data: StatusResponse | null) {
  const outcome = paymentReturnOutcome(data);

  if (outcome === "success") return "Оплата подтверждена";
  if (outcome === "failed") return "Оплата не завершена";
  if (outcome === "pending") return "Платёж обрабатывается";
  if (outcome === "unknown") return "Статус платежа требует проверки";

  return "Проверяем статус платежа";
}

function intro(kind: Props["kind"]) {
  if (kind === "fail") {
    return "Возврат от провайдера не является подтверждением результата — сверяем серверный статус.";
  }

  return "Результат определяется по локальной операции, провайдеру и актуальной подписке.";
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const paymentId = useMemo(() => {
    return (
      searchParams.get("payment_id") ??
      searchParams.get("paymentId") ??
      searchParams.get("order_id") ??
      searchParams.get("id")
    );
  }, [searchParams]);

  const operationId = useMemo(() => {
    return (
      searchParams.get("operation_id") ?? searchParams.get("operationId")
    );
  }, [searchParams]);

  useEffect(() => {
    let fallbackPaymentId: string | null = null;
    let fallbackOperationId: string | null = null;

    try {
      fallbackPaymentId = window.localStorage.getItem("cleanPayLastPaymentId");
      fallbackOperationId = window.localStorage.getItem(
        "cleanPayLastPaymentOperationId",
      );
    } catch {
      // Explicit URL identifiers continue to work without browser storage.
    }

    const resolvedPaymentId = paymentId ?? fallbackPaymentId;
    const resolvedOperationId = operationId ?? fallbackOperationId;
    const query = new URLSearchParams();

    if (resolvedPaymentId) query.set("payment_id", resolvedPaymentId);
    if (resolvedOperationId) query.set("operation_id", resolvedOperationId);

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pollAttempt = 0;

    const loadStatus = async () => {
      if (!cancelled) setLoading(true);

      try {
        const response = await fetch(
          `/api/bff/payments/status${query.size > 0 ? `?${query.toString()}` : ""}`,
        );

        if (!response.ok) {
          throw await readBffError(response, "Не удалось проверить статус.");
        }

        const body = await response.json().catch(() => null);
        const nextData = body?.data as StatusResponse | undefined;

        if (!nextData) {
          throw new Error("Сервер вернул некорректный статус платежа.");
        }

        if (!cancelled) {
          setData(nextData);
          setError(null);
          setLoading(false);

          if (shouldPollPaymentReturn(nextData)) {
            const delay = paymentPollDelayMs(
              pollAttempt,
              nextData.operation?.retry_after_seconds,
            );
            pollAttempt += 1;
            pollTimer = setTimeout(loadStatus, delay);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Не удалось проверить статус.",
          );
          setLoading(false);

          // An operation id is durable, so a transient BFF/Remnashop outage
          // must not permanently stop the callback page from observing it.
          if (resolvedOperationId || resolvedPaymentId) {
            const delay = paymentPollDelayMs(pollAttempt);
            pollAttempt += 1;
            pollTimer = setTimeout(loadStatus, delay);
          }
        }
      }
    };

    void loadStatus();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [operationId, paymentId, refreshKey]);

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader description={intro(kind)} title={heading(data)} />
      <Card>
        <div className="flex flex-column gap-4">
        {error ? <Message severity="warn" text={`Результат пока неизвестен. ${error}`} /> : null}
        {loading && !data ? <Message severity="info" text="Проверка..." /> : null}
        {data?.operation?.status === "manual_required" ? (
          <Message
            severity="error"
            text={`Статус оплаты не удалось определить автоматически. Не повторяйте оплату; обратитесь в поддержку и сообщите номер операции ${data.operation.operation_id}.`}
          />
        ) : null}
        {data?.operation && shouldPollPaymentOperation(data.operation.status) ? (
          <Message
            severity="info"
            text={`Операция ${data.operation.operation_id} ещё проверяется. Новую оплату создавать не нужно.`}
          />
        ) : null}
        {data?.operation?.status === "retry_ready" ? (
          <Message
            severity="warn"
            text={`Операция ${data.operation.operation_id} не дошла до платёжного провайдера. Вернитесь к исходному действию и повторите его — сохранённый ключ не создаст дубликат.`}
          />
        ) : null}
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
        {data && !data.payment && !data.operation ? (
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
        <Button
          icon="pi pi-refresh"
          label="Обновить статус"
          loading={loading}
          onClick={() => setRefreshKey((value) => value + 1)}
          outlined
          type="button"
        />
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
