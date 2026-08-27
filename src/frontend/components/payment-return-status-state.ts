import type {
  PaymentStatusPageModel,
  PaymentStatusViewModel,
} from "@/application/models/payment-status";
import {
  canAutoPollPaymentReturn,
  paymentReturnOutcome,
  shouldPollPaymentReturn,
} from "@/frontend/lib/payment-return";

export function formatPaymentReturnDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function paymentReturnHeading(data: PaymentStatusViewModel | null) {
  const outcome = paymentReturnOutcome(data);

  if (outcome === "success") return "Оплата подтверждена";
  if (outcome === "failed") return "Оплата не завершена";
  if (outcome === "pending") return "Платёж обрабатывается";
  if (outcome === "unknown") return "Статус платежа требует проверки";

  return "Проверяем статус платежа";
}

export function paymentReturnStatusLabel(status: string) {
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

export function paymentReturnSeverity(
  status: string,
): "success" | "warning" | "danger" | "info" {
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

export function selectPaymentReturnStatusState({
  currentModel,
  operationId,
  paymentId,
  refreshError,
  stoppedPollingKey,
}: {
  currentModel: PaymentStatusPageModel;
  operationId: string | null;
  paymentId: string | null;
  refreshError: string | null;
  stoppedPollingKey: string | null;
}) {
  const data = currentModel.status === "ready" ? currentModel.data : null;
  const error = refreshError
    ?? (currentModel.status === "error" ? currentModel.message : null);
  const pollingKey = data?.operation?.operation_id
    ?? data?.payment?.payment_id
    ?? operationId
    ?? paymentId
    ?? "payment-return";
  const autoPollingStopped = Boolean(
    data
    && shouldPollPaymentReturn(data)
    && stoppedPollingKey === pollingKey,
  );

  return { autoPollingStopped, data, error, pollingKey };
}

export function shouldWakePaymentReturnPolling(
  visibilityState: string,
  online: boolean,
) {
  return visibilityState !== "hidden" && online !== false;
}

export function shouldAttemptInitialPaymentReturnRefresh({
  data,
  initialLookupAttempted,
  operationId,
  paymentId,
}: {
  data: PaymentStatusViewModel | null;
  initialLookupAttempted: boolean;
  operationId: string | null;
  paymentId: string | null;
}) {
  const shouldAttemptInitialRefresh = !data?.operation && !data?.payment
    || data?.operation?.status === "retry_ready";

  return !initialLookupAttempted
    && Boolean(operationId || paymentId)
    && shouldAttemptInitialRefresh;
}

export function advancePaymentReturnPollAttempt(attempt: number) {
  const nextAttempt = attempt + 1;

  return {
    nextAttempt,
    stopsAfterRefresh: !canAutoPollPaymentReturn(nextAttempt),
  };
}
