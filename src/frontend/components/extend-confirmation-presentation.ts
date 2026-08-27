import { paymentGatewayLabel } from "@/frontend/lib/payment-gateway";
import { findRenewPlan } from "@/frontend/lib/subscription-offers";
import type { CheckoutViewModel } from "@/application/models/checkout";
import type { PlanOffer } from "@/shared/domain/subscriptions";

export type ExtendConfirmationViewState =
  | { kind: "verify-email" }
  | {
      kind: "account-action";
      action: "login" | "linkEmail";
      message: string;
    }
  | { kind: "account-error"; message: string }
  | { kind: "provider-session-recovery" }
  | { kind: "error"; message: string }
  | { kind: "no-subscription" }
  | { kind: "renew-unavailable" }
  | {
      kind: "ready";
      model: Extract<CheckoutViewModel, { status: "ready" }>;
      plan: PlanOffer;
    };

export type ExtendPriceOption = {
  amount: string;
  currency: string;
  days: number;
  duration: string;
  gateway: string;
  label: string;
  value: string;
};

export function extendSelectionValue(days: number | string, gateway: string) {
  return JSON.stringify([String(days), gateway]);
}

export function parseExtendSelection(value: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Invalid UI state is handled as no selection by the unchanged view.
  }

  return ["", ""];
}

export function extendDurationLabel(days: number) {
  if (days <= 0) {
    return "∞";
  }

  if (days % 30 === 0) {
    return `${days / 30} мес.`;
  }

  return `${days} дн.`;
}

export function buildExtendPriceOptions(plan: PlanOffer | undefined) {
  if (!plan) {
    return [];
  }

  return plan.durations
    .flatMap((duration) =>
      duration.prices.map((price) => ({
        amount: String(price.final_amount),
        currency: price.currency_symbol,
        days: duration.days,
        duration: extendDurationLabel(duration.days),
        gateway: price.gateway_type,
        label: `${extendDurationLabel(duration.days)} - ${price.final_amount} ${price.currency_symbol} - ${paymentGatewayLabel(price.gateway_type)}`,
        value: extendSelectionValue(duration.days, price.gateway_type),
      })),
    )
    .sort(
      (left, right) =>
        Number(left.amount) - Number(right.amount) ||
        left.days - right.days ||
        left.gateway.localeCompare(right.gateway),
    );
}

export function firstExtendSelection(plan: PlanOffer | undefined) {
  return buildExtendPriceOptions(plan)[0]?.value ?? "";
}

export function extensionDestination(
  duration: string | number | null | undefined,
  gateway: string | null | undefined,
) {
  const normalizedDuration =
    duration === null || duration === undefined ? "" : String(duration);
  const normalizedGateway = gateway ?? "";

  if (
    !/^(?:0|[1-9]\d{0,5})$/.test(normalizedDuration) ||
    !normalizedGateway ||
    normalizedGateway.length > 100
  ) {
    return "/extend";
  }

  return `/extend?${new URLSearchParams({
    duration: normalizedDuration,
    gateway: normalizedGateway,
  }).toString()}`;
}

export function initialExtendSelection(
  plan: PlanOffer | undefined,
  duration: string | null,
  gateway: string | null,
) {
  const requested = duration && gateway
    ? extendSelectionValue(duration, gateway)
    : "";

  return buildExtendPriceOptions(plan).some(({ value }) => value === requested)
    ? requested
    : firstExtendSelection(plan);
}

export function selectExtendConfirmationView(
  model: CheckoutViewModel,
): ExtendConfirmationViewState {
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
  if (model.status === "error") return { kind: "error", message: model.message };

  const plan = findRenewPlan(model.offers);
  if (!model.offers.has_current_subscription) return { kind: "no-subscription" };
  if (!plan) return { kind: "renew-unavailable" };
  return { kind: "ready", model, plan };
}
