import {
  MISSING_DEVICE_VALUE,
  type DevicePresentation,
} from "@/frontend/lib/device-display";
import type { SubscriptionDevice } from "@/shared/domain/subscriptions";

export type CabinetUser = {
  email: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  is_email_verified?: boolean;
  emailVerified?: boolean;
};

export type CurrentSubscription = {
  user_remna_id: string;
  status: string;
  is_trial: boolean;
  traffic_limit: number;
  device_limit: number;
  traffic_limit_strategy: string;
  expire_at: string;
  url: string;
  plan_name: string;
  plan_duration_days: number;
  used_traffic_bytes?: number | null;
  lifetime_used_traffic_bytes?: number | null;
  online_at?: string | null;
};

export type PaymentRecord = {
  payment_id: string;
  purchase_type: string;
  status: string;
  final_amount: string;
  currency: string;
  gateway_type: string;
  plan_name: string | null;
  duration_days: number | null;
  is_free: boolean;
  created_at: string;
};

export type SubscriptionDeviceView = {
  device: SubscriptionDevice;
  presentation: DevicePresentation;
  deleteLabel: string;
};

export type SupportSettings = {
  enabled: boolean;
  email: string | null;
  telegramUsername: string | null;
  faqUrl: string | null;
};

export function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatBytes(value?: number | null) {
  if (value === null || value === undefined) return "-";
  if (value <= 0) return "0 Б";

  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** index;
  return `${amount.toLocaleString("ru-RU", {
    maximumFractionDigits: amount >= 10 ? 1 : 2,
  })} ${units[index]}`;
}

export function formatTrafficLimit(value: number) {
  return value > 0 ? formatBytes(value) : "Без лимита";
}

export function formatDeviceLimit(value: number) {
  return value > 0 ? String(value) : "∞";
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Активна",
    disabled: "Отключена",
    expired: "Истекла",
    limited: "Ограничена",
  };
  return labels[status] ?? status;
}

export function paymentStatusLabel(status: string) {
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

export function statusSeverity(
  status?: string,
): "success" | "warning" | "danger" | "info" {
  if (status === "active" || status === "completed") return "success";
  if (status === "pending" || status === "limited") return "warning";
  if (["failed", "canceled", "expired", "disabled"].includes(status ?? "")) {
    return "danger";
  }
  return "info";
}

export function detailValue(value?: string | number | boolean | null) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value);
}

export function deviceDeleteLabel(
  presentation: DevicePresentation,
  position: number,
) {
  const safeDetails = [
    ...new Set(
      [presentation.summary, presentation.os].filter(
        (value) => value !== MISSING_DEVICE_VALUE,
      ),
    ),
  ];
  const details = safeDetails.length > 0 ? `: ${safeDetails.join(", ")}` : "";
  return `Удалить устройство ${position}${details}`;
}

export function trafficLimitStrategyLabel(strategy?: string | null) {
  const normalized = strategy?.toUpperCase();
  if (normalized === "NO_RESET") return "Не сбрасывать";
  if (normalized === "RESET") return "Сбрасывать";
  return detailValue(strategy);
}
