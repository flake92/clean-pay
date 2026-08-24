"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { shouldPollPaymentOperation } from "@/frontend/lib/payment-idempotency";
import {
  paymentPollDelayMs,
  paymentReturnOutcome,
  shouldPollPaymentReturn,
} from "@/frontend/lib/payment-return";
import type { PaymentStatusPageModel, PaymentStatusViewModel } from "@/application/models/payment-status";
import { refreshPaymentStatusAction } from "@/app/actions/payment-status";

type Props = {
  kind: "success" | "fail" | "pending";
  model: PaymentStatusPageModel;
  operationId: string | null;
  paymentId: string | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function heading(data: PaymentStatusViewModel | null) {
  const outcome = paymentReturnOutcome(data);

  if (outcome === "success") return "Оплата подтверждена";
  if (outcome === "failed") return "Оплата не завершена";
  if (outcome === "pending") return "Платёж обрабатывается";
  if (outcome === "unknown") return "Статус платежа требует проверки";

  return "Проверяем статус платежа";
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

export function PaymentReturnStatus({ kind, model, operationId, paymentId }: Props) {
  const [loading, startRefresh] = useTransition();
  const [currentModel, setCurrentModel] = useState(model);
  const initialLookupAttemptedRef = useRef(false);
  const pollAttemptRef = useRef(0);
  const data = currentModel.status === "ready" ? currentModel.data : null;
  const error = currentModel.status === "error" ? currentModel.message : null;

  const refreshStatus = useCallback(() => {
    startRefresh(async () => {
      setCurrentModel(await refreshPaymentStatusAction({ operationId, paymentId }));
    });
  }, [operationId, paymentId]);

  useEffect(() => {
    const shouldAttemptInitialRefresh = !data?.operation && !data?.payment
      || data?.operation?.status === "retry_ready";

    if (
      initialLookupAttemptedRef.current
      || (!operationId && !paymentId)
      || !shouldAttemptInitialRefresh
    ) {
      return;
    }

    initialLookupAttemptedRef.current = true;
    refreshStatus();
  }, [data, operationId, paymentId, refreshStatus]);

  useEffect(() => {
    if (!data || !shouldPollPaymentReturn(data)) {
      pollAttemptRef.current = 0;
      return;
    }

    const attempt = pollAttemptRef.current;
    const timer = window.setTimeout(() => {
      pollAttemptRef.current = attempt + 1;
      refreshStatus();
    }, paymentPollDelayMs(attempt, data.operation?.retry_after_seconds));

    return () => window.clearTimeout(timer);
  }, [data, refreshStatus]);

  return (
    <div className="flex flex-column gap-6">
      <h1 className="text-3xl font-semibold m-0">{heading(data)}</h1>
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
      <div className="flex flex-wrap gap-2">
        <Button
          icon="pi pi-refresh"
          label="Обновить статус"
          loading={loading}
          onClick={refreshStatus}
          outlined
          type="button"
        />
        <LinkButton href="/cabinet" label="Открыть кабинет" />
        {kind === "fail" ? (
          <LinkButton href="/tariffs" label="Вернуться к тарифам" outlined />
        ) : null}
      </div>
    </div>
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
