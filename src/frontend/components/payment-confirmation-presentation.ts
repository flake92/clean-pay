import type {
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";
import type { CheckoutViewModel } from "@/application/models/checkout";

export type PaymentConfirmationViewState =
  | { kind: "verify-email" }
  | {
      kind: "account-action";
      action: "login" | "linkEmail";
      message: string;
    }
  | { kind: "account-error"; message: string }
  | { kind: "provider-session-recovery" }
  | { kind: "error"; message: string }
  | { kind: "selection-missing" }
  | {
      kind: "ready";
      selection: NonNullable<ReturnType<typeof findPaymentSelection>>;
    };

export function paymentDurationLabel(days: number) {
  if (days <= 0) {
    return "∞";
  }

  if (days % 30 === 0) {
    return `${days / 30} мес.`;
  }

  return `${days} дн.`;
}

export function paymentTrafficLabel(limit: number) {
  return limit <= 0 ? "Без лимита" : `${limit} ГБ`;
}

export function paymentDeviceLimitLabel(limit: number) {
  return limit > 0 ? String(limit) : "∞";
}

export function findPaymentSelection(
  offers: SubscriptionOffersResponse,
  planCode: string | null,
  durationDays: string | null,
  gatewayType: string | null,
) {
  const plan = offers.plans.find((item) => item.public_code === planCode);
  const duration = plan?.durations.find(
    (item) => String(item.days) === durationDays,
  );
  const price = duration?.prices.find(
    (item) => item.gateway_type === gatewayType,
  );

  if (!plan || !duration || !price) {
    return null;
  }

  return { plan, duration, price };
}

export function paymentPlanDescription(plan: PlanOffer) {
  return [
    `${paymentDeviceLimitLabel(plan.device_limit)} устройств`,
    paymentTrafficLabel(plan.traffic_limit),
    plan.type,
  ].join(" · ");
}

export function selectPaymentConfirmationView(
  model: CheckoutViewModel,
  planCode: string | null,
  durationDays: string | null,
  gatewayType: string | null,
): PaymentConfirmationViewState {
  if (model.status === "account-action-required") {
    if (model.action === "verifyEmail") return { kind: "verify-email" };
    if (model.action === "login" || model.action === "linkEmail") {
      return {
        kind: "account-action",
        action: model.action,
        message: model.message,
      };
    }
    return { kind: "account-error", message: model.message };
  }

  if (model.status === "provider-session-recovery-required") {
    return { kind: "provider-session-recovery" };
  }

  if (model.status === "error") {
    return { kind: "error", message: model.message };
  }

  const selection = findPaymentSelection(
    model.offers,
    planCode,
    durationDays,
    gatewayType,
  );
  return selection
    ? { kind: "ready", selection }
    : { kind: "selection-missing" };
}
