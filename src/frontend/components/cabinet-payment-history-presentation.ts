import type { PaymentHistorySnapshotStatus } from "@/application/models/cabinet";
import type { PaymentRecord } from "@/frontend/components/cabinet-presentation";

export const CABINET_MOBILE_PAYMENT_PREVIEW_COUNT = 5;

export function selectCabinetPaymentHistoryPresentation({
  isExpanded,
  payments,
  status,
}: {
  isExpanded: boolean;
  payments: PaymentRecord[];
  status: PaymentHistorySnapshotStatus;
}) {
  const hiddenPaymentCount = Math.max(
    0,
    payments.length - CABINET_MOBILE_PAYMENT_PREVIEW_COUNT,
  );
  const mobilePayments = isExpanded
    ? payments
    : payments.slice(0, CABINET_MOBILE_PAYMENT_PREVIEW_COUNT);
  const notice = status === "refreshing"
    ? {
        severity: "info" as const,
        text: "История платежей обновляется. Пока показаны сохранённые данные.",
      }
    : status === "unavailable"
      ? {
          severity: "warn" as const,
          text: "Не удалось обновить статусы платежей. Показаны сохранённые данные.",
        }
      : null;

  return {
    hiddenPaymentCount,
    mobilePayments,
    notice,
  };
}
